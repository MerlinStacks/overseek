import { FastifyPluginAsync } from 'fastify';
import { prisma } from '../../utils/prisma';
import { Logger } from '../../utils/logger';
import { requireAuthFastify } from '../../middleware/auth';
import { EmailService } from '../../services/EmailService';
import { DeliveryEventBodySchema } from './schemas';
import { applyDeliveryEventToLog } from './helpers';
import { getEmailAccountIdOrReply, parseBodyOrReply } from './routeHelpers';

const emailService = new EmailService();

interface QueryParams {
    limit?: string;
    offset?: string;
    status?: string;
    source?: string;
    search?: string;
}

function parseIntOrFallback(value: string | undefined, fallback: number) {
    const parsed = Number.parseInt(value || String(fallback), 10);
    return Number.isFinite(parsed) ? parsed : fallback;
}

const emailLogRoutes: FastifyPluginAsync = async (fastify) => {
    fastify.addHook('preHandler', requireAuthFastify);

    fastify.get('/logs', async (request, reply) => {
        const accountId = getEmailAccountIdOrReply(request, reply);
        if (!accountId) return;
        const {
            limit: rawLimit,
            offset: rawOffset,
            status: rawStatus,
            source: rawSource,
            search: rawSearch
        } = request.query as QueryParams;
        const limit = Math.min(parseIntOrFallback(rawLimit, 50), 100);
        const offset = parseIntOrFallback(rawOffset, 0);
        const statuses = (rawStatus || '')
            .split(',')
            .map((value) => value.trim().toUpperCase())
            .filter(Boolean);
        const sources = (rawSource || '')
            .split(',')
            .map((value) => value.trim().toUpperCase())
            .filter(Boolean);
        const search = rawSearch?.trim();

        const where = {
            accountId,
            ...(statuses.length > 0 ? { status: { in: statuses } } : {}),
            ...(sources.length > 0 ? { source: { in: sources } } : {}),
            ...(search ? {
                OR: [
                    { to: { contains: search, mode: 'insensitive' as const } },
                    { subject: { contains: search, mode: 'insensitive' as const } },
                    { messageId: { contains: search, mode: 'insensitive' as const } },
                    { errorMessage: { contains: search, mode: 'insensitive' as const } }
                ]
            } : {})
        };

        try {
            const [logs, total] = await Promise.all([
                prisma.emailLog.findMany({
                    where,
                    orderBy: { createdAt: 'desc' },
                    take: limit,
                    skip: offset,
                    select: {
                        id: true,
                        to: true,
                        subject: true,
                        status: true,
                        errorMessage: true,
                        errorCode: true,
                        source: true,
                        sourceId: true,
                        messageId: true,
                        createdAt: true,
                        emailBodyExpiresAt: true,
                        emailAccount: { select: { name: true, email: true } },
                        trackingEvents: {
                            where: { eventType: { in: ['BOUNCE', 'COMPLAINT'] } },
                            select: { id: true, eventType: true, createdAt: true },
                            orderBy: { createdAt: 'desc' }
                        }
                    }
                }),
                prisma.emailLog.count({ where })
            ]);
            return {
                logs: logs.map((log) => ({
                    ...log,
                    hasStoredEmailBody: Boolean(log.emailBodyExpiresAt && log.emailBodyExpiresAt > new Date())
                })),
                total,
                limit,
                offset
            };
        } catch (error: any) {
            Logger.error('Failed to fetch email logs', { error });
            return reply.code(500).send({ error: 'Failed to fetch email logs' });
        }
    });

    fastify.get('/logs/:id/content', async (request, reply) => {
        const accountId = getEmailAccountIdOrReply(request, reply);
        if (!accountId) return;
        const { id } = request.params as { id: string };

        try {
            const log = await prisma.emailLog.findFirst({
                where: { id, accountId },
                select: {
                    id: true,
                    subject: true,
                    to: true,
                    emailPayload: true,
                    emailBodyExpiresAt: true
                }
            });

            if (!log) return reply.code(404).send({ error: 'Email log not found' });

            const payload = log.emailPayload as {
                html?: unknown;
                truncated?: unknown;
                originalLength?: unknown;
                storedAt?: unknown;
            } | null;
            if (!payload || typeof payload.html !== 'string') {
                return reply.code(404).send({ error: 'Stored email body not available' });
            }

            return {
                id: log.id,
                subject: log.subject,
                to: log.to,
                html: payload.html,
                truncated: payload.truncated === true,
                originalLength: typeof payload.originalLength === 'number' ? payload.originalLength : payload.html.length,
                storedAt: typeof payload.storedAt === 'string' ? payload.storedAt : null,
                expiresAt: log.emailBodyExpiresAt
            };
        } catch (error: any) {
            Logger.error('Failed to fetch email log content', { error, emailLogId: id });
            return reply.code(500).send({ error: 'Failed to fetch email log content' });
        }
    });

    fastify.post('/logs/:id/retry', async (request, reply) => {
        const accountId = getEmailAccountIdOrReply(request, reply);
        if (!accountId) return;
        const { id } = request.params as { id: string };
        try {
            const result = await emailService.retryFailedEmail(id, accountId);
            if (!result.success) return reply.code(400).send({ success: false, error: result.error });
            Logger.info('Email retry successful', { emailLogId: id, messageId: result.messageId });
            return { success: true, messageId: result.messageId };
        } catch (error: any) {
            Logger.error('Failed to retry email', { error });
            return reply.code(500).send({ error: 'Failed to retry email' });
        }
    });

    fastify.post('/logs/:id/resend', async (request, reply) => {
        const accountId = getEmailAccountIdOrReply(request, reply);
        if (!accountId) return;
        const { id } = request.params as { id: string };
        try {
            const result = await emailService.resendEmail(id, accountId);
            if (!result.success) return reply.code(400).send({ success: false, error: result.error });
            Logger.info('Email resend successful', { emailLogId: id, messageId: result.messageId });
            return { success: true, messageId: result.messageId };
        } catch (error: any) {
            Logger.error('Failed to resend email', { error });
            return reply.code(500).send({ error: 'Failed to resend email' });
        }
    });

    fastify.post('/logs/:id/delivery-event', async (request, reply) => {
        const accountId = getEmailAccountIdOrReply(request, reply);
        if (!accountId) return;
        const parsed = parseBodyOrReply(reply, DeliveryEventBodySchema.safeParse(request.body));
        if (!parsed) return;
        const { eventType, reason } = parsed;
        const { id } = request.params as { id: string };
        try {
            const updatedLog = await applyDeliveryEventToLog({ logId: id, accountId, eventType, reason });
            if (!updatedLog) return reply.code(404).send({ error: 'Email log not found' });
            Logger.info('Recorded email delivery event', { accountId, emailLogId: updatedLog.id, recipient: updatedLog.to, eventType });
            return { success: true, log: updatedLog };
        } catch (error: any) {
            Logger.error('Failed to record delivery event', { error });
            return reply.code(500).send({ error: 'Failed to record delivery event' });
        }
    });

    fastify.post('/sync', async (request, reply) => {
        const accountId = getEmailAccountIdOrReply(request, reply);
        if (!accountId) return;
        try {
            const imapAccounts = await prisma.emailAccount.findMany({ where: { accountId, imapEnabled: true } });
            if (imapAccounts.length === 0) return { success: true, message: 'No IMAP accounts configured', checked: 0 };
            let checked = 0;
            const errors: string[] = [];
            for (const acc of imapAccounts) {
                try {
                    await emailService.checkEmails(acc.id);
                    checked++;
                } catch (e: any) {
                    Logger.error('Manual sync error', { emailAccountId: acc.id, error: e });
                    errors.push(`${acc.email}: ${e.message}`);
                }
            }
            return { success: true, checked, total: imapAccounts.length, errors: errors.length > 0 ? errors : undefined };
        } catch (error: any) {
            Logger.error('Sync error', { error });
            return reply.code(500).send({ error: 'Failed to sync emails' });
        }
    });
};

export default emailLogRoutes;
