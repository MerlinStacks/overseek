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
     * GET /products/:productId/bom/diagnose
     * Diagnose why a product's BOM sync might not be working.
     */
    fastify.get<{ Params: { productId: string } }>('/products/:productId/bom/diagnose', async (request, reply) => {
        const accountId = request.accountId!;
        const { productId } = request.params;
        const query = request.query as { variationId?: string };
        const variationId = parseInt(query.variationId || '0');

        try {
            // Step 1: Check if product exists
            const product = await prisma.wooProduct.findUnique({
                where: { id: productId },
                select: { id: true, wooId: true, name: true, accountId: true }
            });

            if (!product) {
                return {
                    status: 'error',
                    reason: 'PRODUCT_NOT_FOUND',
                    message: `Product with ID ${productId} does not exist in the database.`
                };
            }

            if (product.accountId !== accountId) {
                return {
                    status: 'error',
                    reason: 'WRONG_ACCOUNT',
                    message: `Product belongs to a different account.`
                };
            }

            // Step 2: Check if BOM exists
            const bom = await prisma.bOM.findUnique({
                where: {
                    productId_variationId: { productId, variationId }
                },
                include: {
                    items: {
                        include: {
                            childProduct: { select: { id: true, wooId: true, name: true } },
                            childVariation: { select: { wooId: true, sku: true, stockQuantity: true } },
                            internalProduct: { select: { id: true, name: true, stockQuantity: true } }
                        }
                    }
                }
            });

            if (!bom) {
                return {
                    status: 'error',
                    reason: 'NO_BOM',
                    message: `No BOM found for product "${product.name}" with variationId=${variationId}. ` +
                        `If this is a variation, make sure variationId matches the WooCommerce variation ID.`,
                    productName: product.name,
                    wooId: product.wooId,
                    variationIdUsed: variationId
                };
            }

            if (bom.items.length === 0) {
                return {
                    status: 'error',
                    reason: 'NO_BOM_ITEMS',
                    message: `BOM exists but has no component items. Add child products or internal products to the BOM.`,
                    productName: product.name,
                    bomId: bom.id
                };
            }

            // Step 3: Categorize items
            const wooItems = bom.items.filter(i => i.childProductId);
            const internalItems = bom.items.filter(i => i.internalProductId);

            // Step 4: Try the calculation
            const calculation = await BOMInventorySyncService.calculateEffectiveStockLocal(productId, variationId);

            return {
                status: 'ok',
                message: 'BOM configuration looks correct. Sync should work.',
                productName: product.name,
                wooId: product.wooId,
                variationId,
                bomId: bom.id,
                itemBreakdown: {
                    total: bom.items.length,
                    wooCommerceProducts: wooItems.length,
                    internalProducts: internalItems.length
                },
                items: bom.items.map(item => ({
                    type: item.internalProductId ? 'internal' : 'woocommerce',
                    quantity: item.quantity,
                    childName: item.childProduct?.name || item.internalProduct?.name || 'Unknown',
                    childStock: item.childVariation?.stockQuantity ??
                        item.internalProduct?.stockQuantity ??
                        'N/A (fetch from WooCommerce)'
                })),
                effectiveStockCalculation: calculation ? {
                    effectiveStock: calculation.effectiveStock,
                    currentWooStock: calculation.currentWooStock,
                    needsSync: calculation.needsSync,
                    components: calculation.components
                } : 'Calculation returned null - check component stock values'
            };
        } catch (error: any) {
            Logger.error('Error diagnosing BOM sync', { error, accountId, productId });
            return reply.code(500).send({
                status: 'error',
                reason: 'EXCEPTION',
                message: error.message
            });
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
                    some: {
                        OR: [
                            { childProductId: { not: null } },
                            { internalProductId: { not: null } }
                        ]
                    }
                }
            }
        });

        const queue = QueueFactory.getQueue(QUEUES.BOM_SYNC);
        const jobId = `bom_sync_${accountId.replace(/:/g, '_')}`;

        const existingJob = await queue.getJob(jobId);
        if (existingJob) {
            const state = await existingJob.getState();
            if (['active', 'waiting', 'delayed'].includes(state)) {
                // Check if job is stale (active but not progressing for too long)
                // This handles the "BullMQ Silence" scenario where a worker crashed
                const processedOn = existingJob.processedOn;
                const now = Date.now();
                const STALE_THRESHOLD_MS = 10 * 60 * 1000; // 10 minutes

                if (state === 'active' && processedOn && (now - processedOn > STALE_THRESHOLD_MS)) {
                    // Job is stale - force remove it
                    Logger.warn(`[BOMSync] Detected stale active job, force removing`, {
                        accountId,
                        jobId,
                        processedOn: new Date(processedOn).toISOString(),
                        staleDurationMs: now - processedOn
                    });
                    try {
                        await existingJob.moveToFailed(new Error('Job stale - forcefully removed'), '0');
                        await existingJob.remove();
                    } catch (e) {
                        Logger.warn(`[BOMSync] Failed to remove stale job, proceeding anyway`, { error: e });
                    }
                } else {
                    return {
                        status: 'already_running',
                        message: `BOM sync is already ${state} for this account.`,
                        estimatedProducts: bomCount
                    };
                }
            } else {
                try { await existingJob.remove(); } catch (e) { /* ignore */ }
            }
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
     * DELETE /bom/sync-cancel
     * Cancel a stuck or running BOM sync job for this account.
     * Uses aggressive cleanup for orphaned jobs.
     */
    fastify.delete('/bom/sync-cancel', async (request, reply) => {
        const accountId = request.accountId!;
        const { QueueFactory, QUEUES } = await import('../../services/queue/QueueFactory');
        const { redisClient } = await import('../../utils/redis');

        const queue = QueueFactory.getQueue(QUEUES.BOM_SYNC);
        const jobId = `bom_sync_${accountId.replace(/:/g, '_')}`;

        try {
            const existingJob = await queue.getJob(jobId);
            if (existingJob) {
                const state = await existingJob.getState();

                // Try standard removal methods first
                try {
                    await existingJob.remove();
                    Logger.info(`[BOMSync] Cancelled sync job`, { accountId, jobId, previousState: state });
                    return {
                        success: true,
                        message: 'Sync job cancelled successfully',
                        previousState: state
                    };
                } catch (removeErr: any) {
                    // Job is locked - try moveToFailed
                    Logger.warn(`[BOMSync] Standard remove failed, trying moveToFailed`, {
                        error: removeErr.message, jobId
                    });

                    try {
                        await existingJob.moveToFailed(new Error('Cancelled by user'), '0');
                        // Try to remove again after moving to failed
                        try { await existingJob.remove(); } catch (e) { /* ignore */ }

                        Logger.info(`[BOMSync] Force-failed locked sync job`, { accountId, jobId });
                        return {
                            success: true,
                            message: 'Sync job force-cancelled (was locked)',
                            previousState: state
                        };
                    } catch (failErr: any) {
                        // Last resort: directly remove from Redis
                        Logger.warn(`[BOMSync] moveToFailed also failed, using Redis force-clean`, {
                            error: failErr.message, jobId
                        });

                        // Force remove all traces of the job from Redis
                        const queueName = QUEUES.BOM_SYNC;
                        const keysToDelete = [
                            `bull:${queueName}:${jobId}`,
                            `bull:${queueName}:${jobId}:lock`,
                            `bull:${queueName}:${jobId}:logs`,
                        ];

                        // Remove from all state sets
                        await redisClient.zrem(`bull:${queueName}:active`, jobId);
                        await redisClient.zrem(`bull:${queueName}:waiting`, jobId);
                        await redisClient.zrem(`bull:${queueName}:delayed`, jobId);
                        await redisClient.zrem(`bull:${queueName}:failed`, jobId);
                        await redisClient.zrem(`bull:${queueName}:completed`, jobId);

                        // Delete job keys
                        for (const key of keysToDelete) {
                            await redisClient.del(key);
                        }

                        Logger.info(`[BOMSync] Force-cleaned job from Redis`, { accountId, jobId });
                        return {
                            success: true,
                            message: 'Sync job force-cleaned from Redis (orphaned job)',
                            previousState: state
                        };
                    }
                }
            }

            return {
                success: true,
                message: 'No active sync job found to cancel'
            };
        } catch (err: any) {
            Logger.error('Error cancelling BOM sync', { error: err.message, accountId });
            return reply.code(500).send({
                success: false,
                error: `Failed to cancel sync job: ${err.message}`
            });
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
                        some: {
                            OR: [
                                { childProductId: { not: null } },
                                { internalProductId: { not: null } }
                            ]
                        }
                    }
                },
                include: {
                    product: {
                        select: {
                            id: true,
                            wooId: true,
                            name: true,
                            sku: true,
                            mainImage: true,
                            // Include variations so we can lookup variant-specific data
                            variations: {
                                select: {
                                    wooId: true,
                                    sku: true,
                                    images: true,
                                    rawData: true
                                }
                            }
                        }
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
                        // For variants, get variant-specific data
                        let displayName = bom.product.name;
                        let displaySku = bom.product.sku;
                        let displayImage = bom.product.mainImage;
                        let displayWooId = bom.product.wooId;

                        if (bom.variationId > 0) {
                            // Find the matching variation
                            const variation = bom.product.variations.find(v => v.wooId === bom.variationId);
                            if (variation) {
                                displayWooId = variation.wooId;
                                displaySku = variation.sku || displaySku;

                                // Get variant name from rawData or construct from attributes
                                const rawData = variation.rawData as any;
                                if (rawData?.attributes?.length > 0) {
                                    const attrStr = rawData.attributes
                                        .map((a: any) => a.option)
                                        .filter(Boolean)
                                        .join(', ');
                                    displayName = `${bom.product.name} - ${attrStr}`;
                                } else {
                                    displayName = `${bom.product.name} (Variant #${variation.wooId})`;
                                }

                                // Get variant image
                                const images = variation.images as any[];
                                if (images?.length > 0 && images[0]?.src) {
                                    displayImage = images[0].src;
                                } else if (rawData?.image?.src) {
                                    displayImage = rawData.image.src;
                                }
                            }
                        }

                        pendingChanges.push({
                            productId: bom.product.id,
                            wooId: displayWooId,
                            name: displayName,
                            sku: displaySku,
                            mainImage: displayImage,
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
