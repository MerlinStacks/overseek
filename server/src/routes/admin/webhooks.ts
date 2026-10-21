import { type FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { requireAuthFastify, requireSuperAdminFastify } from '../../middleware/auth';
import { WebhookDeliveryService } from '../../services/WebhookDeliveryService';

const id = z.string().trim().min(1).max(128);
const query = z.object({ page: z.string().regex(/^[1-9]\d*$/).transform(Number).pipe(z.number().int().max(100000)).optional(), limit: z.string().regex(/^[1-9]\d*$/).transform(Number).pipe(z.number().int().max(100)).optional(), status: z.enum(['RECEIVED', 'PROCESSED', 'FAILED']).optional(), source: z.enum(['WOOCOMMERCE', 'META', 'TIKTOK']).optional(), accountId: id.optional() }).strict();
const supportedTopics = new Set(['order.created', 'order.updated', 'order.deleted', 'product.created', 'product.updated', 'product.deleted', 'customer.created', 'customer.updated']);
function completePayload(topic: string, payload: unknown): boolean {
    if (!payload || typeof payload !== 'object' || Array.isArray(payload) || '__truncated' in payload) return false;
    const value = payload as Record<string, unknown>;
    if (!['string', 'number'].includes(typeof value.id) || !/^\d+$/.test(String(value.id)) || !Number.isSafeInteger(Number(value.id)) || Number(value.id) <= 0) return false;
    const record = (item: unknown) => !!item && typeof item === 'object' && !Array.isArray(item);
    if (topic.endsWith('.deleted')) return true;
    if (topic.startsWith('order.')) return typeof value.status === 'string' && typeof value.currency === 'string' && /^[A-Z]{3}$/.test(value.currency) && ['string', 'number'].includes(typeof value.total) && /^\d+(?:\.\d+)?$/.test(String(value.total)) && record(value.billing) && Array.isArray(value.line_items);
    if (topic.startsWith('product.')) return ['name', 'status', 'type'].every(key => typeof value[key] === 'string');
    return typeof value.email === 'string' && record(value.billing) && ['first_name', 'last_name'].every(key => typeof value[key] === 'string');
}
export const webhookAdminRoutes: FastifyPluginAsync = async fastify => {
    fastify.addHook('preHandler', requireAuthFastify);
    fastify.addHook('preHandler', requireSuperAdminFastify);
    fastify.get('/webhooks', async (request, reply) => {
        const parsed = query.safeParse(request.query);
        if (!parsed.success) return reply.code(400).send({ error: 'Invalid webhook filters or pagination' });
        const { accountId, page, limit, status, source } = parsed.data;
        try { return await WebhookDeliveryService.getDeliveries(accountId || null, { status, source }, { page: page ?? 1, limit: limit ?? 20 }); }
        catch { return reply.code(500).send({ error: 'Failed to fetch webhook deliveries' }); }
    });
    fastify.get<{ Params: { deliveryId: string } }>('/webhooks/:deliveryId', async (request, reply) => {
        if (!id.safeParse(request.params.deliveryId).success) return reply.code(400).send({ error: 'Invalid delivery ID' });
        try { const delivery = await WebhookDeliveryService.getDelivery(request.params.deliveryId); return delivery || reply.code(404).send({ error: 'Delivery not found' }); }
        catch { return reply.code(500).send({ error: 'Failed to fetch webhook delivery' }); }
    });
    fastify.post<{ Params: { deliveryId: string } }>('/webhooks/:deliveryId/replay', async (request, reply) => {
        if (!id.safeParse(request.params.deliveryId).success) return reply.code(400).send({ error: 'Invalid delivery ID' });
        try {
            const delivery = await WebhookDeliveryService.getDelivery(request.params.deliveryId);
            if (!delivery) return reply.code(404).send({ error: 'Delivery not found' });
            const now = new Date(); const receivedAt = new Date(delivery.receivedAt);
            const age = now.getTime() - receivedAt.getTime();
            if (!Number.isFinite(age) || age < 0 || age > 86400000) return reply.code(400).send({ error: 'Only deliveries with a valid timestamp within the last 24 hours can be replayed' });
            const payload = delivery.payload;
            if (delivery.source !== 'WOOCOMMERCE' || !supportedTopics.has(delivery.topic) || !completePayload(delivery.topic, payload)) return reply.code(400).send({ error: 'Unsupported source, topic or incomplete webhook payload. Re-sync the resource instead.' });
            if (delivery.status !== 'FAILED') return reply.code(409).send({ error: 'Only failed, unclaimed deliveries can be replayed' });
            const claimed = await WebhookDeliveryService.replay(delivery.id, delivery.accountId, { receivedAt, source: delivery.source, topic: delivery.topic, now });
            if (!claimed) return reply.code(409).send({ error: 'Delivery changed or is already being replayed' });
            let processed = false;
            try {
                const { processWebhookPayload } = await import('../webhook');
                await processWebhookPayload(claimed.accountId, claimed.topic, claimed.payload as Record<string, unknown>);
                processed = true;
                await WebhookDeliveryService.markProcessed(claimed.id);
                return { success: true, message: 'Webhook replayed successfully', ...(age > 3600000 ? { warning: 'Delivery was over one hour old; verify the resource against the store.' } : {}) };
            } catch {
                if (processed) return reply.code(500).send({ error: 'Processing completed but audit confirmation failed. Delivery remains claimed; do not replay. Verify the resource and repair the audit status.' });
                await WebhookDeliveryService.markFailed(claimed.id, 'Replay could not be confirmed; verify the resource before retrying.');
                return reply.code(500).send({ error: 'Replay could not be confirmed. Check the resource before retrying.' });
            }
        } catch { return reply.code(500).send({ error: 'Failed to replay webhook' }); }
    });
    fastify.get('/webhooks/stats/failed', async (_request, reply) => {
        try { return { failedCount24h: await WebhookDeliveryService.getFailedCount() }; }
        catch { return reply.code(500).send({ error: 'Failed to fetch stats' }); }
    });
};
