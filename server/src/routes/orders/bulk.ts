/**
 * Order Bulk Operations Sub-Routes
 */

import { FastifyPluginAsync } from 'fastify';
import { prisma } from '../../utils/prisma';
import { Logger } from '../../utils/logger';
import { requireAuthFastify } from '../../middleware/auth';

const bulkRoutes: FastifyPluginAsync = async (fastify) => {
    fastify.addHook('preHandler', requireAuthFastify);

    /**
     * Bulk update order status.
     * Updates status in WooCommerce and syncs back to local database.
     */
    fastify.put('/bulk-status', async (request, reply) => {
        const accountId = request.accountId;
        if (!accountId) {
            return reply.code(400).send({ error: 'accountId header is required' });
        }

        const body = request.body as { orderIds: number[]; status: string };

        if (!body.orderIds || !Array.isArray(body.orderIds) || body.orderIds.length === 0) {
            return reply.code(400).send({ error: 'orderIds array is required' });
        }

        if (!body.status || typeof body.status !== 'string') {
            return reply.code(400).send({ error: 'status is required' });
        }

        const validStatuses = ['pending', 'processing', 'on-hold', 'completed', 'cancelled', 'refunded', 'failed'];
        if (!validStatuses.includes(body.status)) {
            return reply.code(400).send({ error: `Invalid status. Must be one of: ${validStatuses.join(', ')}` });
        }

        // Limit bulk updates to prevent abuse
        if (body.orderIds.length > 50) {
            return reply.code(400).send({ error: 'Maximum 50 orders can be updated at once' });
        }

        try {
            const { WooService } = await import('../../services/woo');
            const woo = await WooService.forAccount(accountId);

            // Use WooCommerce Batch API for efficient bulk update (single API call)
            const updates = body.orderIds.map(id => ({ id, status: body.status }));

            let updated = 0;
            let failed = 0;
            const errors: string[] = [];

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
                        data: { status: body.status }
                    });
                }
            } catch (batchError) {
                // Fallback to individual updates if batch fails (older WooCommerce versions)
                const batchErrMsg = batchError instanceof Error ? batchError.message : String(batchError);
                Logger.warn('Batch API failed, falling back to individual updates', { error: batchErrMsg });

                for (const orderId of body.orderIds) {
                    try {
                        await woo.updateOrder(orderId, { status: body.status });
                        await prisma.wooOrder.updateMany({
                            where: { accountId, wooId: orderId },
                            data: { status: body.status }
                        });
                        updated++;
                    } catch (err) {
                        failed++;
                        errors.push(`Order #${orderId}: ${err instanceof Error ? err.message : String(err)}`);
                    }
                }
            }

            Logger.info('Bulk order status update completed', {
                accountId,
                status: body.status,
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
