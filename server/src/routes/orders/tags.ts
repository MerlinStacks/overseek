/**
 * Order Tagging Sub-Routes
 */

import { FastifyPluginAsync } from 'fastify';
import { Logger } from '../../utils/logger';
import { requireAuthFastify } from '../../middleware/auth';
import { prisma } from '../../utils/prisma';
import { findOrderByAnyId, getOrderAccountIdOrReply, parseOrderIdParamOrReply } from './helpers';

function hasOrderVersionConflict(request: any, updatedAt: Date): boolean {
    const version = request.headers['x-order-version'] as string | undefined;
    return Boolean(version && updatedAt.toISOString() !== version);
}

function getRawDataTags(rawData: Record<string, unknown> | null): string[] {
    if (!Array.isArray(rawData?.tags)) return [];
    return rawData.tags.filter((tag): tag is string => typeof tag === 'string');
}

async function persistTagsAndReindex(
    accountId: string,
    order: { id: string; wooId: number },
    rawData: Record<string, unknown> | null,
    tags: string[],
) {
    const updatedRawData = { ...(rawData || {}), tags };

    await prisma.wooOrder.update({
        where: { id: order.id },
        data: { rawData: updatedRawData }
    });

    try {
        const { IndexingService } = await import('../../services/search/IndexingService');
        await IndexingService.indexOrder(accountId, { ...updatedRawData, id: order.wooId }, tags);
    } catch (err) {
        Logger.warn('[Orders] DB-ES divergence: tag update committed but ES reindex failed', {
            orderId: order.wooId,
            error: err instanceof Error ? err.message : String(err)
        });
    }
}

const tagsRoutes: FastifyPluginAsync = async (fastify) => {
    fastify.addHook('preHandler', requireAuthFastify);

    // Remove a tag from an order
    fastify.delete<{ Params: { id: string; tag: string } }>('/:id/tags/:tag', async (request, reply) => {
        const id = parseOrderIdParamOrReply(request, reply);
        if (!id) return;
        const tag = decodeURIComponent(request.params.tag);
        const accountId = getOrderAccountIdOrReply(request, reply);
        if (!accountId) return;

        try {
            const order = await findOrderByAnyId(accountId, id);

            if (!order) {
                return reply.code(404).send({ error: 'Order not found' });
            }

            if (hasOrderVersionConflict(request, order.updatedAt)) {
                return reply.code(409).send({ error: 'Order has been modified by another user' });
            }

            // Get current rawData and remove the tag
            const rawData = order.rawData as Record<string, unknown> | null;
            const currentTags = getRawDataTags(rawData);
            const newTags = currentTags.filter(t => t !== tag);

            await persistTagsAndReindex(accountId, order, rawData, newTags);

            Logger.info('Tag removed from order', { orderId: order.wooId, tag, remainingTags: newTags });

            return { success: true, tags: newTags };
        } catch (error) {
            Logger.error('Failed to remove tag from order', { error });
            return reply.code(500).send({ error: 'Failed to remove tag' });
        }
    });

    // Add a tag to an order
    fastify.post<{ Params: { id: string }; Body: { tag: string } }>('/:id/tags', async (request, reply) => {
        const id = parseOrderIdParamOrReply(request, reply);
        if (!id) return;
        const { tag } = request.body as { tag: string };
        const accountId = getOrderAccountIdOrReply(request, reply);
        if (!accountId) return;

        if (!tag || typeof tag !== 'string' || !tag.trim()) {
            return reply.code(400).send({ error: 'tag is required' });
        }

        const cleanTag = tag.trim();

        try {
            const order = await findOrderByAnyId(accountId, id);

            if (!order) {
                return reply.code(404).send({ error: 'Order not found' });
            }

            if (hasOrderVersionConflict(request, order.updatedAt)) {
                return reply.code(409).send({ error: 'Order has been modified by another user' });
            }

            // Get current rawData and add the tag
            const rawData = order.rawData as Record<string, unknown> | null;
            const currentTags = getRawDataTags(rawData);
            const newTags = currentTags.includes(cleanTag) ? currentTags : [...currentTags, cleanTag];

            await persistTagsAndReindex(accountId, order, rawData, newTags);

            Logger.info('Tag added to order', { orderId: order.wooId, tag: cleanTag, allTags: newTags });

            return { success: true, tags: newTags };
        } catch (error) {
            Logger.error('Failed to add tag to order', { error });
            return reply.code(500).send({ error: 'Failed to add tag' });
        }
    });
};

export default tagsRoutes;
