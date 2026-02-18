/**
 * BOM Management Routes
 * 
 * Endpoints for managing deactivated BOM items — visibility and reactivation.
 * Extracted from bomSync.ts for modularity (200-line rule).
 */

import { FastifyPluginAsync } from 'fastify';
import { prisma } from '../../utils/prisma';
import { requireAuthFastify } from '../../middleware/auth';
import { Logger } from '../../utils/logger';

export const bomManagementRoutes: FastifyPluginAsync = async (fastify) => {
    fastify.addHook('preHandler', requireAuthFastify);

    /**
     * GET /bom/deactivated-items
     * Returns all auto-deactivated BOM items for this account,
     * grouped by deactivation reason. Gives users visibility into
     * items that were disabled because the linked WooCommerce
     * product or variation was deleted.
     */
    fastify.get('/bom/deactivated-items', async (request, reply) => {
        const accountId = request.accountId!;

        try {
            const deactivatedItems = await prisma.bOMItem.findMany({
                where: {
                    isActive: false,
                    bom: { product: { accountId } }
                },
                include: {
                    bom: {
                        include: {
                            product: { select: { id: true, wooId: true, name: true } }
                        }
                    },
                    childProduct: { select: { id: true, wooId: true, name: true } },
                    childVariation: { select: { wooId: true, sku: true } },
                    internalProduct: { select: { id: true, name: true } }
                }
            });

            const items = deactivatedItems.map(item => ({
                id: item.id,
                bomId: item.bomId,
                parentProduct: {
                    id: item.bom.product.id,
                    wooId: item.bom.product.wooId,
                    name: item.bom.product.name,
                    variationId: item.bom.variationId
                },
                component: item.childProduct
                    ? {
                        type: 'WooProduct' as const,
                        id: item.childProduct.id,
                        wooId: item.childProduct.wooId,
                        name: item.childProduct.name,
                        variationWooId: item.childVariation?.wooId,
                        variationSku: item.childVariation?.sku
                    }
                    : item.internalProduct
                        ? { type: 'InternalProduct' as const, id: item.internalProduct.id, name: item.internalProduct.name }
                        : { type: 'Unknown' as const },
                quantity: item.quantity,
                deactivatedReason: item.deactivatedReason || 'UNKNOWN',
            }));

            // Group by reason for summary
            const byReason: Record<string, number> = {};
            for (const item of items) {
                byReason[item.deactivatedReason] = (byReason[item.deactivatedReason] || 0) + 1;
            }

            return {
                total: items.length,
                byReason,
                items
            };
        } catch (error) {
            Logger.error('[BOMManagement] Error fetching deactivated items', { error, accountId });
            return reply.code(500).send({ error: 'Failed to fetch deactivated items' });
        }
    });

    /**
     * PATCH /bom/items/:itemId/reactivate
     * Re-enables a deactivated BOM item after the user has
     * re-mapped or verified the component still exists.
     */
    fastify.patch<{ Params: { itemId: string } }>('/bom/items/:itemId/reactivate', async (request, reply) => {
        const accountId = request.accountId!;
        const { itemId } = request.params;

        try {
            // Verify the item belongs to this account
            const item = await prisma.bOMItem.findFirst({
                where: {
                    id: itemId,
                    bom: { product: { accountId } }
                },
                select: { id: true, isActive: true, deactivatedReason: true }
            });

            if (!item) {
                return reply.code(404).send({ error: 'BOM item not found' });
            }

            if (item.isActive) {
                return { message: 'Item is already active', itemId };
            }

            await prisma.bOMItem.update({
                where: { id: itemId },
                data: { isActive: true, deactivatedReason: null }
            });

            Logger.info('[BOMManagement] BOM item reactivated', {
                accountId,
                itemId,
                previousReason: item.deactivatedReason
            });

            return { message: 'BOM item reactivated successfully', itemId };
        } catch (error) {
            Logger.error('[BOMManagement] Error reactivating BOM item', { error, accountId, itemId });
            return reply.code(500).send({ error: 'Failed to reactivate BOM item' });
        }
    });
};
