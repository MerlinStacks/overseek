/**
 * Order Bulk Operations Sub-Routes
 */

import { FastifyPluginAsync } from 'fastify';
import { prisma } from '../../utils/prisma';
import { Logger } from '../../utils/logger';
import { requireAuthFastify } from '../../middleware/auth';
import { getOrderRequestAccountIdOrReply } from './helpers';
import { isValidWooOrderStatusSlug, normalizeOrderStatus } from '../../constants/orderStatus';
import { EventBus, EVENTS } from '../../services/events';

const PAID_EVENT_STATUSES = ['processing', 'on-hold'];

function buildOrderEventPayload(updatedOrder: any, previousOrder: { wooId: number; rawData: unknown } | undefined, status: string) {
    const rawData = previousOrder?.rawData && typeof previousOrder.rawData === 'object' ? previousOrder.rawData : {};
    return {
        ...rawData,
        ...updatedOrder,
        id: updatedOrder?.id ?? previousOrder?.wooId,
        status
    };
}

const bulkRoutes: FastifyPluginAsync = async (fastify) => {
    fastify.addHook('preHandler', requireAuthFastify);

    /**
     * Bulk update order status.
     * Updates status in WooCommerce and syncs back to local database.
     */
    fastify.put('/bulk-status', async (request, reply) => {
        const accountId = getOrderRequestAccountIdOrReply(request, reply);
        if (!accountId) return;

        const body = request.body as { orderIds: number[]; status: string };

        if (!body.orderIds || !Array.isArray(body.orderIds) || body.orderIds.length === 0) {
            return reply.code(400).send({ error: 'orderIds array is required' });
        }

        if (!body.status || typeof body.status !== 'string') {
            return reply.code(400).send({ error: 'status is required' });
        }

        const normalizedStatus = normalizeOrderStatus(body.status);
        if (!isValidWooOrderStatusSlug(normalizedStatus)) {
            return reply.code(400).send({ error: 'Invalid status. Use a WooCommerce status slug (for example: processing or wc-awaiting-shipment), excluding trash/auto-draft/checkout-draft.' });
        }

        // Limit bulk updates to prevent abuse
        if (body.orderIds.length > 50) {
            return reply.code(400).send({ error: 'Maximum 50 orders can be updated at once' });
        }

        try {
            const { WooService } = await import('../../services/woo');
            const woo = await WooService.forAccount(accountId);

            const previousOrders = await prisma.wooOrder.findMany({
                where: {
                    accountId,
                    wooId: { in: body.orderIds }
                },
                select: { wooId: true, status: true, rawData: true }
            });
            const previousOrderByWooId = new Map(previousOrders.map(order => [order.wooId, order]));

            // Use WooCommerce Batch API for efficient bulk update (single API call)
            const updates = body.orderIds.map(id => ({ id, status: normalizedStatus }));

            let updated = 0;
            let failed = 0;
            const errors: string[] = [];
            const successfulUpdates: Array<{ wooId: number; order: any }> = [];

            try {
                // Single batch API call instead of N individual calls
                const batchResult = await woo.batchUpdateOrders(updates, request.user?.id);

                // Process batch response
                if (batchResult.update && Array.isArray(batchResult.update)) {
                    for (const result of batchResult.update as Array<{ id?: number; error?: { message: string } }>) {
                        if (result.error) {
                            failed++;
                            errors.push(`Order #${result.id}: ${result.error.message}`);
                        } else {
                            updated++;
                            if (typeof result.id === 'number') {
                                successfulUpdates.push({ wooId: result.id, order: result });
                            }
                        }
                    }
                }

                // Sync only the successfully updated orders to local database
                const successfulIds = (batchResult.update && Array.isArray(batchResult.update))
                    ? batchResult.update
                        .filter((r: { error?: unknown }) => !r.error)
                        .map((r: { id?: number }) => r.id)
                        .filter((id): id is number => typeof id === 'number')
                    : [];

                if (successfulIds.length > 0) {
                    await prisma.wooOrder.updateMany({
                        where: {
                            accountId,
                            wooId: { in: successfulIds }
                        },
                        data: { status: normalizedStatus }
                    });
                }
            } catch (batchError) {
                // Fallback to individual updates if batch fails (older WooCommerce versions)
                const batchErrMsg = batchError instanceof Error ? batchError.message : String(batchError);
                Logger.warn('Batch API failed, falling back to individual updates', { error: batchErrMsg });

                for (const orderId of body.orderIds) {
                    try {
                        const updatedOrder = await woo.updateOrder(orderId, { status: normalizedStatus });
                        await prisma.wooOrder.updateMany({
                            where: { accountId, wooId: orderId },
                            data: { status: normalizedStatus }
                        });
                        successfulUpdates.push({ wooId: orderId, order: updatedOrder });
                        updated++;
                    } catch (err) {
                        failed++;
                        errors.push(`Order #${orderId}: ${err instanceof Error ? err.message : String(err)}`);
                    }
                }
            }

            for (const successfulUpdate of successfulUpdates) {
                const previousOrder = previousOrderByWooId.get(successfulUpdate.wooId);
                const previousStatus = previousOrder?.status;
                if (!previousStatus || previousStatus === normalizedStatus) continue;

                const order = buildOrderEventPayload(successfulUpdate.order, previousOrder, normalizedStatus);
                EventBus.emit(EVENTS.ORDER.STATUS_CHANGED, {
                    accountId,
                    order,
                    previousStatus,
                    newStatus: normalizedStatus
                });

                if (PAID_EVENT_STATUSES.includes(normalizedStatus)) {
                    EventBus.emit(EVENTS.ORDER.PAID, { accountId, order });
                }

                if (normalizedStatus === 'completed' && previousStatus !== 'completed') {
                    EventBus.emit(EVENTS.ORDER.COMPLETED, { accountId, order });
                }

                EventBus.emit(EVENTS.ORDER.SYNCED, { accountId, order });
            }

            Logger.info('Bulk order status update completed', {
                accountId,
                status: normalizedStatus,
                updated,
                failed,
                total: body.orderIds.length,
                usedBatchApi: errors.length === 0
            });

            return {
                updated,
                failed,
                total: body.orderIds.length,
                errors: errors.length > 0 ? errors : undefined
            };
        } catch (error) {
            Logger.error('Bulk status update failed', { error: error instanceof Error ? error.message : String(error) });
            return reply.code(500).send({ error: 'Failed to update order statuses' });
        }
    });
};

export default bulkRoutes;
