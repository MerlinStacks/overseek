import { FastifyPluginAsync } from 'fastify';
import { prisma } from '../../utils/prisma';
import { Logger } from '../../utils/logger';
import { normalizeDeliveryWebhookEntries, authenticateRelayEmailAccount, applyDeliveryEventToLog } from './helpers';

const emailWebhookRoutes: FastifyPluginAsync = async fastify => {
    fastify.post('/delivery-events', { bodyLimit: 256 * 1024 }, async (request, reply) => {
        const relayKey = request.headers['x-relay-key'];
        if (typeof relayKey !== 'string' || !relayKey || relayKey.length > 8000) return reply.code(401).send({ error: 'Relay authentication required' });
        let entries: ReturnType<typeof normalizeDeliveryWebhookEntries>;
        try { entries = normalizeDeliveryWebhookEntries(request.body); }
        catch { return reply.code(400).send({ error: 'Invalid or oversized delivery event batch' }); }
        if (!entries.length || entries.some(entry => !entry.emailAccountId || !entry.messageId && !entry.trackingId)) return reply.code(400).send({ error: 'Each event requires an emailAccountId and a messageId or trackingId; recipient-only correlation is not supported' });
        try {
            // Validate the entire batch before applying events; never scan all tenant credentials.
            const accounts = new Map<string, Awaited<ReturnType<typeof authenticateRelayEmailAccount>>>();
            for (const entry of entries) if (!accounts.has(entry.emailAccountId)) {
                const account = await authenticateRelayEmailAccount(relayKey, entry.emailAccountId);
                if (!account) return reply.code(401).send({ error: 'Invalid relay credentials for batch' });
                accounts.set(entry.emailAccountId, account);
            }
            const results: Array<Record<string, unknown>> = [];
            for (const entry of entries) {
                const account = accounts.get(entry.emailAccountId)!;
                const logs = await prisma.emailLog.findMany({ where: { accountId: account.accountId, emailAccountId: account.id,
                    ...(entry.messageId ? { messageId: entry.messageId } : {}), ...(entry.trackingId ? { trackingId: entry.trackingId } : {}),
                    ...(entry.recipientEmail ? { to: { equals: entry.recipientEmail, mode: 'insensitive' } } : {}) }, take: 2 });
                if (logs.length !== 1) { results.push({ success: false, reason: logs.length ? 'AMBIGUOUS_MESSAGE' : 'EMAIL_LOG_NOT_FOUND', eventType: entry.eventType }); continue; }
                const outcome = await applyDeliveryEventToLog({ logId: logs[0].id, accountId: account.accountId, eventType: entry.eventType, reason: entry.reason });
                results.push({ success: outcome?.deliveryEventApplied === true, emailLogId: logs[0].id, eventType: entry.eventType,
                    reason: outcome?.deliveryEventReason || 'EMAIL_LOG_NOT_FOUND', status: outcome?.status || null });
            }
            const processedCount = results.filter(result => result.success).length;
            return { success: processedCount > 0, processedCount, totalEvents: entries.length, results };
        } catch (error) {
            Logger.error('Failed to process delivery webhook event', { error });
            return reply.code(500).send({ error: 'Delivery batch could not be fully confirmed; safe duplicate processing is supported' });
        }
    });
};
export default emailWebhookRoutes;
