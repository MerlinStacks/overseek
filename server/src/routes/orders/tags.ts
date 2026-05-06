/**
 * Order Tagging Sub-Routes
 */

import { FastifyPluginAsync } from 'fastify';
import { prisma } from '../../utils/prisma';
import { Logger } from '../../utils/logger';
import { requireAuthFastify } from '../../middleware/auth';
import { z } from 'zod';

const orderIdParamSchema = z.object({
    id: z.union([
        z.string().uuid(),
        z.string().regex(/^\d+$/, "ID must be a UUID or a numeric string")
    ])
});

const tagsRoutes: FastifyPluginAsync = async (fastify) => {
    fastify.addHook('preHandler', requireAuthFastify);

    // Remove a tag from an order
    fastify.delete<{ Params: { id: string; tag: string } }>('/:id/tags/:tag', async (request, reply) => {
        const parsedParams = orderIdParamSchema.safeParse(request.params);
        if (!parsedParams.success) return reply.code(400).send({ error: parsedParams.error.issues[0].message });
        const { id } = parsedParams.data;
        const tag = decodeURIComponent(request.params.tag);
        const accountId = request.user?.accountId;

        if (!accountId) {
            return reply.code(400).send({ error: 'accountId header is required' });
        }

        try {
            let order;

            // Try finding by internal UUID first (scoped to account to prevent IDOR)
            order = await prisma.wooOrder.findFirst({ where: { id, accountId } });

            // If not found and ID is numeric, try finding by WooID
            if (!order && !isNaN(Number(id))) {
                order = await prisma.wooOrder.findUnique({
                    where: { accountId_wooId: { accountId, wooId: Number(id) } }
                });
            }

            if (!order) {
                return reply.code(404).send({ error: 'Order not found' });
            }

            // OPTIMISTIC LOCKING CHECK
            const version = request.headers['x-order-version'] as string;
            if (version && order.updatedAt.toISOString() !== version) {
                return reply.code(409).send({ error: 'Order has been modified by another user' });
            }

            // Get current rawData and remove the tag
            const rawData = order.rawData as Record<string, unknown> | null;
            const currentTags: string[] = Array.isArray(rawData?.tags) ? rawData.tags.filter(t => typeof t === 'string') : [];
            const newTags = currentTags.filter(t => t !== tag);

            // Update rawData with new tags
            const updatedRawData = { ...(rawData || {}), tags: newTags };

            // Update the order in PostgreSQL
            await prisma.wooOrder.update({
                where: { id: order.id },
                data: { rawData: updatedRawData }
            });

            // Reindex the order in Elasticsearch
            try {
                const { IndexingService } = await import('../../services/search/IndexingService');
                await IndexingService.indexOrder(accountId, { ...updatedRawData, id: order.wooId }, newTags);
            } catch (err) {
                Logger.warn('[Orders] DB-ES divergence: tag update committed but ES reindex failed', { orderId: order.wooId, error: err instanceof Error ? err.message : String(err) });
            }

            Logger.info('Tag removed from order', { orderId: order.wooId, tag, remainingTags: newTags });

            return { success: true, tags: newTags };
        } catch (error) {
            Logger.error('Failed to remove tag from order', { error });
            return reply.code(500).send({ error: 'Failed to remove tag' });
        }
    });

    // Add a tag to an order
    fastify.post<{ Params: { id: string }; Body: { tag: string } }>('/:id/tags', async (request, reply) => {
        const parsedParams = orderIdParamSchema.safeParse(request.params);
        if (!parsedParams.success) return reply.code(400).send({ error: parsedParams.error.issues[0].message });
        const { id } = parsedParams.data;
        const { tag } = request.body as { tag: string };
        const accountId = request.user?.accountId;

        if (!accountId) {
            return reply.code(400).send({ error: 'accountId header is required' });
        }

        if (!tag || typeof tag !== 'string' || !tag.trim()) {
            return reply.code(400).send({ error: 'tag is required' });
        }

        const cleanTag = tag.trim();

        try {
            let order;

            // Try finding by internal UUID first (scoped to account to prevent IDOR)
            order = await prisma.wooOrder.findFirst({ where: { id, accountId } });

            // If not found and ID is numeric, try finding by WooID
            if (!order && !isNaN(Number(id))) {
                order = await prisma.wooOrder.findUnique({
                    where: { accountId_wooId: { accountId, wooId: Number(id) } }
                });
            }

            if (!order) {
                return reply.code(404).send({ error: 'Order not found' });
            }

            // OPTIMISTIC LOCKING CHECK
            const version = request.headers['x-order-version'] as string;
            if (version && order.updatedAt.toISOString() !== version) {
                return reply.code(409).send({ error: 'Order has been modified by another user' });
            }

            // Get current rawData and add the tag
            const rawData = order.rawData as Record<string, unknown> | null;
            const currentTags: string[] = Array.isArray(rawData?.tags) ? rawData.tags.filter(t => typeof t === 'string') : [];
            const newTags = currentTags.includes(cleanTag) ? currentTags : [...currentTags, cleanTag];

            // Update rawData with new tags
            const updatedRawData = { ...(rawData || {}), tags: newTags };

            // Update the order in PostgreSQL
            await prisma.wooOrder.update({
                where: { id: order.id },
                data: { rawData: updatedRawData }
            });

            // Reindex the order in Elasticsearch
            try {
                const { IndexingService } = await import('../../services/search/IndexingService');
                await IndexingService.indexOrder(accountId, { ...updatedRawData, id: order.wooId }, newTags);
            } catch (err) {
                Logger.warn('[Orders] DB-ES divergence: tag update committed but ES reindex failed', { orderId: order.wooId, error: err instanceof Error ? err.message : String(err) });
            }

            Logger.info('Tag added to order', { orderId: order.wooId, tag: cleanTag, allTags: newTags });

            return { success: true, tags: newTags };
        } catch (error) {
            Logger.error('Failed to add tag to order', { error });
            return reply.code(500).send({ error: 'Failed to add tag' });
        }
    });
};

export default tagsRoutes;
