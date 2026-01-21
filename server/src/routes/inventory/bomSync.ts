/**
 * BOM Inventory Sync Routes
 * 
 * Handles BOM-based inventory synchronization with WooCommerce.
 * Extracted from inventory.ts for maintainability.
 */

import { FastifyPluginAsync } from 'fastify';
import { prisma } from '../../utils/prisma';
import { requireAuthFastify } from '../../middleware/auth';
import { Logger } from '../../utils/logger';
import { BOMInventorySyncService } from '../../services/BOMInventorySyncService';

export const bomSyncRoutes: FastifyPluginAsync = async (fastify) => {
    fastify.addHook('preHandler', requireAuthFastify);

    /**
     * POST /products/:productId/bom/sync
     * Sync a single product's inventory to WooCommerce based on BOM calculation.
     */
    fastify.post<{ Params: { productId: string } }>('/products/:productId/bom/sync', async (request, reply) => {
        const accountId = request.accountId!;
        const { productId } = request.params;
        const query = request.query as { variationId?: string };
        const variationId = parseInt(query.variationId || '0');

        try {
            const result = await BOMInventorySyncService.syncProductToWoo(accountId, productId, variationId);

            if (!result.success) {
                return reply.code(400).send({
                    error: result.error || 'Sync failed',
                    result
                });
            }

            return result;
        } catch (error) {
            Logger.error('Error syncing BOM inventory', { error, accountId, productId });
            return reply.code(500).send({ error: 'Failed to sync inventory to WooCommerce' });
        }
    });

    /**
     * POST /bom/sync-all
     * Bulk sync ALL BOM parent products for the account to WooCommerce.
     */
    fastify.post('/bom/sync-all', async (request, reply) => {
        const accountId = request.accountId!;

        const { QueueFactory, QUEUES } = await import('../../services/queue/QueueFactory');

        const bomCount = await prisma.bOM.count({
            where: {
                product: { accountId },
                items: {
                    some: { childProductId: { not: null } }
                }
            }
        });

        const queue = QueueFactory.getQueue(QUEUES.BOM_SYNC);
        const jobId = `bom_sync_${accountId.replace(/:/g, '_')}`;

        const existingJob = await queue.getJob(jobId);
        if (existingJob) {
            const state = await existingJob.getState();
            if (['active', 'waiting', 'delayed'].includes(state)) {
                return {
                    status: 'already_running',
                    message: `BOM sync is already ${state} for this account.`,
                    estimatedProducts: bomCount
                };
            }
            try { await existingJob.remove(); } catch (e) { /* ignore */ }
        }

        await queue.add(QUEUES.BOM_SYNC, { accountId }, {
            jobId,
            priority: 10,
            removeOnComplete: true,
            removeOnFail: 100
        });

        Logger.info(`[BOMInventorySync] Dispatched queue job`, { accountId, jobId, bomCount });

        return {
            status: 'queued',
            message: `BOM sync queued for ${bomCount} products. Check sync history for results.`,
            estimatedProducts: bomCount,
            jobId
        };
    });

    /**
     * GET /bom/sync-status
     * Check current status of BOM sync job for this account.
     */
    fastify.get('/bom/sync-status', async (request, reply) => {
        const accountId = request.accountId!;
        const { QueueFactory, QUEUES } = await import('../../services/queue/QueueFactory');

        const queue = QueueFactory.getQueue(QUEUES.BOM_SYNC);
        const jobId = `bom_sync_${accountId.replace(/:/g, '_')}`;

        try {
            const existingJob = await queue.getJob(jobId);
            if (existingJob) {
                const state = await existingJob.getState();
                if (['active', 'waiting', 'delayed'].includes(state)) {
                    return { isSyncing: true, state };
                }
            }
            return { isSyncing: false, state: null };
        } catch (err) {
            Logger.error('Error checking BOM sync status', { error: err, accountId });
            return { isSyncing: false, state: null };
        }
    });

    /**
     * GET /bom/pending-changes
     * Returns all BOM products with current vs effective stock comparison.
     */
    fastify.get('/bom/pending-changes', async (request, reply) => {
        const accountId = request.accountId!;

        try {
            const bomsWithChildProducts = await prisma.bOM.findMany({
                where: {
                    product: { accountId },
                    items: {
                        some: { childProductId: { not: null } }
                    }
                },
                include: {
                    product: {
                        select: { id: true, wooId: true, name: true, sku: true, mainImage: true }
                    }
                }
            });

            Logger.info(`[BOMSync] Found ${bomsWithChildProducts.length} BOMs with child products`, { accountId });

            const pendingChanges = [];
            let calculationFailures = 0;

            for (const bom of bomsWithChildProducts) {
                try {
                    const calculation = await BOMInventorySyncService.calculateEffectiveStockLocal(
                        bom.productId,
                        bom.variationId
                    );

                    if (calculation) {
                        pendingChanges.push({
                            productId: bom.product.id,
                            wooId: bom.product.wooId,
                            name: bom.product.name,
                            sku: bom.product.sku,
                            mainImage: bom.product.mainImage,
                            variationId: bom.variationId,
                            currentWooStock: calculation.currentWooStock,
                            effectiveStock: calculation.effectiveStock,
                            needsSync: calculation.needsSync,
                            components: calculation.components
                        });
                    } else {
                        calculationFailures++;
                        Logger.warn(`[BOMSync] calculateEffectiveStock returned null for product`, {
                            productId: bom.productId,
                            variationId: bom.variationId,
                            productName: bom.product.name
                        });
                    }
                } catch (calcError) {
                    calculationFailures++;
                    Logger.error(`[BOMSync] calculateEffectiveStock threw error`, {
                        productId: bom.productId,
                        variationId: bom.variationId,
                        error: calcError
                    });
                }
            }

            Logger.info(`[BOMSync] Results: ${pendingChanges.length} success, ${calculationFailures} failures`, { accountId });

            pendingChanges.sort((a, b) => {
                if (a.needsSync !== b.needsSync) return a.needsSync ? -1 : 1;
                return a.name.localeCompare(b.name);
            });

            return {
                total: pendingChanges.length,
                needsSync: pendingChanges.filter(p => p.needsSync).length,
                inSync: pendingChanges.filter(p => !p.needsSync).length,
                products: pendingChanges
            };
        } catch (error) {
            Logger.error('Error fetching pending BOM changes', { error, accountId });
            return reply.code(500).send({ error: 'Failed to fetch pending changes' });
        }
    });

    /**
     * DELETE /bom/sync-cancel
     * Cancel or clear any stuck BOM sync job for the current account.
     */
    fastify.delete('/bom/sync-cancel', async (request, reply) => {
        const accountId = request.accountId!;
        const { QueueFactory, QUEUES } = await import('../../services/queue/QueueFactory');

        const queue = QueueFactory.getQueue(QUEUES.BOM_SYNC);
        const jobId = `bom_sync_${accountId.replace(/:/g, '_')}`;

        try {
            const existingJob = await queue.getJob(jobId);
            if (existingJob) {
                const state = await existingJob.getState();
                await existingJob.remove();
                Logger.info(`[BOMSync] Canceled stuck job`, { accountId, jobId, previousState: state });
                return { success: true, message: `Canceled BOM sync job (was: ${state})` };
            }
            return { success: true, message: 'No BOM sync job found to cancel' };
        } catch (err: any) {
            Logger.error('Failed to cancel BOM sync job', { error: err, accountId });
            return reply.code(500).send({ error: 'Failed to cancel job', details: err.message });
        }
    });

    /**
     * GET /bom/sync-history
     * Returns recent BOM sync logs from AuditLog.
     */
    fastify.get('/bom/sync-history', async (request, reply) => {
        const accountId = request.accountId!;
        const query = request.query as { limit?: string };
        const limit = Math.min(parseInt(query.limit || '50'), 100);

        try {
            const logs = await prisma.auditLog.findMany({
                where: {
                    accountId,
                    source: 'SYSTEM_BOM'
                },
                orderBy: { createdAt: 'desc' },
                take: limit,
                select: {
                    id: true,
                    resourceId: true,
                    previousValue: true,
                    details: true,
                    createdAt: true
                }
            });

            const productIds = [...new Set(logs.map(l => l.resourceId))];
            const products = await prisma.wooProduct.findMany({
                where: { id: { in: productIds } },
                select: { id: true, name: true, sku: true }
            });
            const productMap = new Map(products.map(p => [p.id, p]));

            const enrichedLogs = logs.map(log => {
                const product = productMap.get(log.resourceId);
                const prev = log.previousValue as any;
                const details = log.details as any;

                return {
                    id: log.id,
                    productId: log.resourceId,
                    productName: product?.name || 'Unknown Product',
                    productSku: product?.sku,
                    previousStock: prev?.stock_quantity ?? null,
                    newStock: details?.stock_quantity ?? null,
                    trigger: details?.trigger || 'BOM_SYNC',
                    createdAt: log.createdAt
                };
            });

            return {
                total: enrichedLogs.length,
                logs: enrichedLogs
            };
        } catch (error) {
            Logger.error('Error fetching BOM sync history', { error, accountId });
            return reply.code(500).send({ error: 'Failed to fetch sync history' });
        }
    });
};
