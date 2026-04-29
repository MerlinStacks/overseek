import { FastifyPluginAsync } from 'fastify';
import { prisma } from '../../utils/prisma';
import { Logger } from '../../utils/logger';
import { requireAuthFastify } from '../../middleware/auth';
import { EmailService } from '../../services/EmailService';
import { DeliveryEventBodySchema } from './schemas';
import { applyDeliveryEventToLog } from './helpers';

const emailService = new EmailService();

interface QueryParams { limit?: string; offset?: string; }

const emailLogRoutes: FastifyPluginAsync = async (fastify) => {
    fastify.addHook('preHandler', requireAuthFastify);

    fastify.get('/logs', async (request, reply) => {
        const accountId = request.accountId;
        if (!accountId) return reply.code(400).send({ error: 'No account selected' });
        const { limit: rawLimit, offset: rawOffset } = request.query as QueryParams;
        const limit = Math.min(parseInt(rawLimit || '50', 10), 100);
        const offset = parseInt(rawOffset || '0', 10);
        try {
            const [logs, total] = await Promise.all([
                prisma.emailLog.findMany({
                    where: { accountId },
                    orderBy: { createdAt: 'desc' },
                    take: limit,
                    skip: offset,
                    include: {
                        emailAccount: { select: { name: true, email: true } },
                        trackingEvents: {
                            where: { eventType: { in: ['BOUNCE', 'COMPLAINT'] } },
                            select: { id: true, eventType: true, createdAt: true },
                            orderBy: { createdAt: 'desc' }
                        }
                    }
                }),
                prisma.emailLog.count({ where: { accountId } })
            ]);
            return { logs, total, limit, offset };
        } catch (error: any) {
            Logger.error('Failed to fetch email logs', { error });
            return reply.code(500).send({ error: 'Failed to fetch email logs' });
        }
    });

    fastify.post('/logs/:id/retry', async (request, reply) => {
        const accountId = request.accountId;
        if (!accountId) return reply.code(400).send({ error: 'No account selected' });
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

    fastify.post('/logs/:id/delivery-event', async (request, reply) => {
        const accountId = request.accountId;
        if (!accountId) return reply.code(400).send({ error: 'No account selected' });
        const parse = DeliveryEventBodySchema.safeParse(request.body);
        if (!parse.success) {
            return reply.code(400).send({ error: 'Invalid input', issues: parse.error.flatten() });
        }
        const { eventType, reason } = parse.data;
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
        const accountId = request.accountId;
        if (!accountId) return reply.code(400).send({ error: 'No account selected' });
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
