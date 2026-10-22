import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { prisma } from '../../utils/prisma';
import { requireAuthFastify } from '../../middleware/auth';
import { PermissionService } from '../../services/PermissionService';
import { findOrderByAnyId, parseOrderIdParamOrReply } from './helpers';
const tagSchema = z.string().trim().min(1).max(100).refine(value => !Array.from(value).some(character => character.charCodeAt(0) < 32 || character.charCodeAt(0) === 127));
class VersionConflict extends Error {}
const tagsRoutes: FastifyPluginAsync = async fastify => {
    fastify.addHook('preHandler', requireAuthFastify);
    fastify.addHook('preHandler', async (request, reply) => {
        if (!request.accountId || !request.user?.id) return reply.code(400).send({ error: 'Select an account' });
        if (!await PermissionService.hasAnyPermission(request.user.id, request.accountId, ['edit_orders', 'edit_order_tags'])) return reply.code(403).send({ error: 'Order tag permission required' });
    });
    for (const method of ['POST', 'DELETE'] as const) fastify.route<{ Params: { id: string; tag?: string } }>({ method, url: method === 'POST' ? '/:id/tags' : '/:id/tags/:tag', handler: async (request, reply) => {
        const id = parseOrderIdParamOrReply(request, reply); if (!id) return;
        const body = method === 'POST' ? z.object({ tag: tagSchema }).strict().safeParse(request.body) : null;
        const parsed = tagSchema.safeParse(method === 'POST' ? body?.success ? body.data.tag : undefined : request.params.tag);
        if (!parsed.success) return reply.code(400).send({ error: 'tag must be 1–100 characters without control characters' });
        const version = request.headers['x-order-version'];
        if (version !== undefined && (typeof version !== 'string' || version.length > 40 || !Number.isFinite(Date.parse(version)))) return reply.code(400).send({ error: 'Invalid order version' });
        const accountId = request.accountId!;
        try {
            const order = await findOrderByAnyId(accountId, id); if (!order) return reply.code(404).send({ error: 'Order not found' });
            if (version && order.updatedAt.toISOString() !== version) throw new VersionConflict();
            const raw = order.rawData && typeof order.rawData === 'object' && !Array.isArray(order.rawData) ? order.rawData : {};
            const current = Array.isArray(raw.tags) ? raw.tags.filter((tag): tag is string => typeof tag === 'string') : [];
            const tags = method === 'DELETE' ? current.filter(tag => tag !== parsed.data) : [...new Set([...current, parsed.data])];
            if (tags.length > 100) return reply.code(400).send({ error: 'Maximum 100 tags per order' });
            const updatedAt = new Date(Math.max(Date.now(), order.updatedAt.getTime() + 1));
            await prisma.$transaction(async tx => {
                const changed = await tx.wooOrder.updateMany({ where: { id: order.id, accountId, updatedAt: order.updatedAt }, data: { rawData: { ...raw, tags }, updatedAt } });
                if (changed.count !== 1) throw new VersionConflict();
                await tx.orderTagIndexOutbox.upsert({ where: { orderId: order.id }, create: { orderId: order.id, accountId }, update: { revision: { increment: 1 }, nextAttemptAt: new Date() } });
            });
            return { success: true, tags, updatedAt: updatedAt.toISOString(), indexing: 'pending' };
        } catch (error) { return reply.code(error instanceof VersionConflict ? 409 : 500).send({ error: error instanceof VersionConflict ? 'Order changed; refresh before retrying' : 'Could not update tags' }); }
    } });
};
export default tagsRoutes;
