import { FastifyPluginAsync } from 'fastify';
import { prisma } from '../../utils/prisma';
import { Logger } from '../../utils/logger';
import { normalizeDeliveryWebhookEntries, authenticateRelayEmailAccount, applyDeliveryEventToLog } from './helpers';

const emailWebhookRoutes: FastifyPluginAsync = async (fastify) => {
    fastify.post('/delivery-events', async (request, reply) => {
        try {
            const relayKeyHeader = request.headers['x-relay-key'];
            const relayKey = Array.isArray(relayKeyHeader) ? relayKeyHeader[0] : relayKeyHeader;
            const entries = normalizeDeliveryWebhookEntries(request.body);
            if (entries.length === 0) {
                return reply.code(400).send({ error: 'No supported delivery events found in payload' });
            }

            const results: Array<Record<string, unknown>> = [];
            for (const entry of entries) {
                const emailAccount = await authenticateRelayEmailAccount(relayKey, entry.emailAccountId);
                if (!emailAccount) {
                    results.push({ success: false, reason: 'INVALID_RELAY_CREDENTIALS', recipientEmail: entry.recipientEmail || null, eventType: entry.eventType });
                    continue;
                }

                const matchClauses = [
                    entry.messageId ? { messageId: entry.messageId } : null,
                    entry.trackingId ? { trackingId: entry.trackingId } : null
                ].filter(Boolean) as Array<Record<string, string>>;
                if (entry.recipientEmail) matchClauses.push({ to: entry.recipientEmail });
                if (matchClauses.length === 0) {
                    results.push({ success: false, reason: 'NO_MATCH_KEYS', accountId: emailAccount.accountId, eventType: entry.eventType });
                    continue;
                }

                const emailLog = await prisma.emailLog.findFirst({
                    where: { accountId: emailAccount.accountId, emailAccountId: emailAccount.id, OR: matchClauses },
                    orderBy: { createdAt: 'desc' }
                });
                if (!emailLog) {
                    results.push({ success: false, reason: 'EMAIL_LOG_NOT_FOUND', accountId: emailAccount.accountId, recipientEmail: entry.recipientEmail || null, eventType: entry.eventType });
                    continue;
                }

                const updatedLog = await applyDeliveryEventToLog({
                    logId: emailLog.id,
                    accountId: emailAccount.accountId,
                    eventType: entry.eventType,
                    reason: entry.reason
                });

                Logger.info('Recorded webhook delivery event', {
                    accountId: emailAccount.accountId,
                    emailAccountId: emailAccount.id,
                    emailLogId: emailLog.id,
                    recipientEmail: emailLog.to,
                    eventType: entry.eventType
                });

                results.push({ success: true, accountId: emailAccount.accountId, emailAccountId: emailAccount.id, emailLogId: emailLog.id, recipientEmail: emailLog.to, eventType: entry.eventType, status: updatedLog?.status || null });
            }

            const processedCount = results.filter((r) => r.success).length;
            return { success: processedCount > 0, processedCount, totalEvents: entries.length, results };
        } catch (error: any) {
            Logger.error('Failed to process delivery webhook event', { error });
            return reply.code(500).send({ error: 'Failed to process delivery webhook event' });
        }
    });
};

export default emailWebhookRoutes;
