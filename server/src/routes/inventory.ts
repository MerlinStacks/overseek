/**
 * Inventory Route - Fastify Plugin
 */

import { FastifyPluginAsync } from 'fastify';
import { prisma } from '../utils/prisma';
import { Logger } from '../utils/logger';
import { requireAuthFastify } from '../middleware/auth';
import { PurchaseOrderService } from '../services/PurchaseOrderService';
import { PicklistService } from '../services/PicklistService';
import { InventoryService } from '../services/InventoryService';
import { BOMInventorySyncService } from '../services/BOMInventorySyncService';
import { IndexingService } from '../services/search/IndexingService';
import { invalidateCache } from '../utils/cache';

// Modular sub-routes (extracted for maintainability)
import { supplierRoutes } from './inventory/suppliers';
import { bomSyncRoutes } from './inventory/bomSync';
import { bomManagementRoutes } from './inventory/bomManagement';

/** In-memory progress tracker for long-running reprocess operations */
const reprocessProgress = new Map<string, {
    status: 'running' | 'completed' | 'failed';
    startedAt: string;
    completedAt?: string;
    totalPOs: number;
    processed: number;
    variationsBackfilled: number;
    errors: string[];
}>();

const poService = new PurchaseOrderService();
const picklistService = new PicklistService();

const inventoryRoutes: FastifyPluginAsync = async (fastify) => {
    fastify.addHook('preHandler', requireAuthFastify);

    // Register modular sub-routes
    await fastify.register(supplierRoutes);
    await fastify.register(bomSyncRoutes);
    await fastify.register(bomManagementRoutes);


    // GET /settings
    fastify.get('/settings', async (request, reply) => {
        const accountId = request.accountId;
        try {
            const settings = await prisma.inventorySettings.findUnique({
                where: { accountId }
            });
            return settings || {};
        } catch (error) {
            return reply.code(500).send({ error: 'Failed to fetch settings' });
        }
    });

    // POST /settings
    fastify.post<{ Body: { isEnabled?: boolean; lowStockThresholdDays?: number; alertEmails?: string[] } }>('/settings', async (request, reply) => {
        const accountId = request.accountId!;
        const { isEnabled, lowStockThresholdDays, alertEmails } = request.body;
        try {
            const settings = await prisma.inventorySettings.upsert({
                where: { accountId },
                create: { accountId, isEnabled, lowStockThresholdDays, alertEmails },
                update: { isEnabled, lowStockThresholdDays, alertEmails }
            });
            return settings;
        } catch (error) {
            return reply.code(500).send({ error: 'Failed to save settings' });
        }
    });

    // GET /health
    fastify.get('/health', async (request, reply) => {
        const accountId = request.accountId;
        try {
            const risks = await InventoryService.checkInventoryHealth(accountId!);
            return risks;
        } catch (error) {
            Logger.error('Error', { error });
            return reply.code(500).send({ error: 'Failed to check inventory health' });
        }
    });

    fastify.get<{ Params: { productId: string } }>('/products/:productId/bom', async (request, reply) => {
        const { productId } = request.params;
        const query = request.query as { variationId?: string };
        const variationId = parseInt(query.variationId || '0', 10);

        try {
            const bom = await prisma.bOM.findUnique({
                where: {
                    productId_variationId: { productId, variationId }
                },
                include: {
                    items: {
                        include: {
                            supplierItem: { include: { supplier: true } },
                            childProduct: true,
                            childVariation: true,
                            internalProduct: true
                        }
                    }
                }
            });

            if (!bom || !bom.items || bom.items.length === 0) {
                return { items: [] };
            }

            // Log items for debugging missing relations
            for (const item of bom.items) {
                if (item.internalProductId && !item.internalProduct) {
                    Logger.warn('BOM item has internalProductId but internalProduct relation is null', {
                        bomItemId: item.id,
                        internalProductId: item.internalProductId
                    });
                }
                if (item.childProductId && item.childVariationId && !item.childVariation) {
                    Logger.debug('BOM item has childVariationId but childVariation relation is null', {
                        bomItemId: item.id,
                        childProductId: item.childProductId,
                        childVariationId: item.childVariationId
                    });
                }
            }

            /**
             * Hydrate missing internalProduct data.
             * This handles orphaned references where the internal product exists but the relation didn't resolve.
             */
            const internalItemsNeedingHydration = bom.items.filter(
                item => item.internalProductId && !item.internalProduct
            );

            /**
             * Hydrate missing childVariation data from parent product's rawData.variationsData.
             */
            const variantItemsNeedingHydration = bom.items.filter(
                item => item.childProductId && item.childVariationId && !item.childVariation
            );

            let enrichedItems: any[] = [...bom.items];

            // Hydrate internal products
            if (internalItemsNeedingHydration.length > 0) {
                const internalProductIds = [...new Set(internalItemsNeedingHydration.map(item => item.internalProductId!))];

                const internalProducts = await prisma.internalProduct.findMany({
                    where: { id: { in: internalProductIds } }
                });

                const internalProductMap = new Map(internalProducts.map(p => [p.id, p]));

                enrichedItems = enrichedItems.map(item => {
                    if (!item.internalProductId || item.internalProduct) return item;

                    const internalProduct = internalProductMap.get(item.internalProductId);
                    if (internalProduct) {
                        Logger.info('Hydrated missing internalProduct relation', {
                            bomItemId: item.id,
                            internalProductId: item.internalProductId,
                            internalProductName: internalProduct.name
                        });
                        return { ...item, internalProduct };
                    }

                    Logger.warn('Internal product not found for BOM item', {
                        bomItemId: item.id,
                        internalProductId: item.internalProductId
                    });
                    return item;
                });
            }

            // Hydrate variants
            if (variantItemsNeedingHydration.length > 0) {
                const parentProductIds = [...new Set(variantItemsNeedingHydration.map(item => item.childProductId!))];

                const parentProducts = await prisma.wooProduct.findMany({
                    where: { id: { in: parentProductIds } },
                    select: { id: true, name: true, rawData: true }
                });

                const parentMap = new Map(parentProducts.map(p => [p.id, p]));

                const variationKeys = variantItemsNeedingHydration.map(item => ({
                    productId: item.childProductId!,
                    wooId: item.childVariationId!
                }));

                const existingVariations = await prisma.productVariation.findMany({
                    where: {
                        OR: variationKeys.map(k => ({
                            productId: k.productId,
                            wooId: k.wooId
                        }))
                    }
                });

                const variationLookup = new Map(
                    existingVariations.map(v => [`${v.productId}:${v.wooId}`, v])
                );

                enrichedItems = enrichedItems.map(item => {
                    if (item.childVariation) return item;
                    if (!item.childProductId || !item.childVariationId) return item;

                    const lookupKey = `${item.childProductId}:${item.childVariationId}`;

                    const dbVariation = variationLookup.get(lookupKey);
                    if (dbVariation) {
                        return { ...item, childVariation: dbVariation };
                    }

                    // No ProductVariation record found for this BOM item's childVariationId.
                    // This can happen if the variation was never synced. Log it so we know.
                    const parentProduct = parentMap.get(item.childProductId);
                    Logger.warn('BOM item references a variation with no ProductVariation record', {
                        bomItemId: item.id,
                        childProductId: item.childProductId,
                        childVariationId: item.childVariationId,
                        parentProductName: parentProduct?.name
                    });
                    return item;
                });
            }

            return { ...bom, items: enrichedItems };
        } catch (error) {
            Logger.error('Error fetching BOM', { error, productId, variationId });
            return reply.code(500).send({ error: 'Failed to fetch BOM' });
        }
    });

    /**
     * GET /products/:productId/bom/effective-stock
     * Returns the calculated effective stock for a product's BOM using local data only.
     */
    fastify.get<{ Params: { productId: string } }>('/products/:productId/bom/effective-stock', async (request, reply) => {
        const { productId } = request.params;
        const query = request.query as { variationId?: string };
        const variationId = parseInt(query.variationId || '0', 10);

        try {
            const calculation = await BOMInventorySyncService.calculateEffectiveStockLocal(
                productId,
                variationId
            );

            if (!calculation) {
                return { effectiveStock: null, currentWooStock: null };
            }

            return {
                effectiveStock: calculation.effectiveStock,
                currentWooStock: calculation.currentWooStock,
                needsSync: calculation.needsSync,
                components: calculation.components
            };
        } catch (error) {
            Logger.error('Error calculating effective stock', { error, productId, variationId });
            return reply.code(500).send({ error: 'Failed to calculate effective stock' });
        }
    });

    fastify.post<{ Params: { productId: string } }>('/products/:productId/bom', async (request, reply) => {
        const { productId } = request.params;
        const { items, variationId = 0 } = request.body as any;

        try {
            const bom = await prisma.bOM.upsert({
                where: {
                    productId_variationId: { productId, variationId: Number(variationId) }
                },
                create: { productId, variationId: Number(variationId) },
                update: {}
            });

            // Prepare items, ensuring undefined/null values are handled correctly
            // We use a transaction with individual creates to ensure better error handling and UUID generation
            await prisma.$transaction(async (tx) => {
                await tx.bOMItem.deleteMany({ where: { bomId: bom.id } });

                for (const item of items) {
                    // Prevent self-linking
                    if (item.childProductId === productId) {
                        continue;
                    }

                    await tx.bOMItem.create({
                        data: {
                            bomId: bom.id,
                            supplierItemId: item.supplierItemId || null,
                            childProductId: item.childProductId || null,
                            childVariationId: item.childVariationId || (item.variationId ? Number(item.variationId) : null), // Support both formats
                            internalProductId: item.internalProductId || null, // Support internal products as components
                            quantity: Number(item.quantity),
                            wasteFactor: Number(item.wasteFactor || 0)
                        }
                    });
                }
            });

            const updated = await prisma.bOM.findUnique({
                where: { id: bom.id },
                include: {
                    items: {
                        include: {
                            supplierItem: { include: { supplier: true } },
                            childProduct: true,
                            childVariation: true, // Include variant details
                            internalProduct: true // Include internal product details
                        }
                    }
                }
            });

            // Calculate total COGS from BOM
            let totalCogs = 0;
            const hasBOMItems = updated && updated.items && updated.items.length > 0;

            if (hasBOMItems) {
                totalCogs = updated.items.reduce((sum, item) => {
                    // Priority: Variant COGS > Child Product COGS > Supplier Item cost
                    let unitCost = 0;
                    if (item.childVariation?.cogs) {
                        unitCost = Number(item.childVariation.cogs);
                    } else if (item.childProduct?.cogs) {
                        unitCost = Number(item.childProduct.cogs);
                    } else if (item.supplierItem?.cost) {
                        unitCost = Number(item.supplierItem.cost);
                    }

                    const quantity = Number(item.quantity);
                    const waste = Number(item.wasteFactor);

                    return sum + (unitCost * quantity * (1 + waste));
                }, 0);
            }

            // Only update COGS from BOM if there are actually BOM items
            // This preserves manually-entered COGS for products without BOM
            if (hasBOMItems) {
                if (variationId === 0) {
                    // Update Main Product
                    await prisma.wooProduct.update({
                        where: { id: productId },
                        data: { cogs: totalCogs }
                    });
                } else {
                    // Update specific Variation
                    await prisma.productVariation.updateMany({
                        where: {
                            productId: productId,
                            wooId: Number(variationId)
                        },
                        data: { cogs: totalCogs }
                    });
                }
            }

            return updated;
        } catch (error) {
            Logger.error('Error', { error });
            return reply.code(500).send({ error: 'Failed to save BOM' });
        }
    });

    fastify.get('/purchase-orders', async (request, reply) => {
        const accountId = request.accountId!;
        const { status } = request.query as { status?: string };
        try {
            const orders = await poService.listPurchaseOrders(accountId, status);
            return orders;
        } catch (error) {
            return reply.code(500).send({ error: 'Failed to fetch POs' });
        }
    });

    fastify.get<{ Params: { id: string } }>('/purchase-orders/:id', async (request, reply) => {
        const accountId = request.accountId!;
        const { id } = request.params;
        try {
            const po = await poService.getPurchaseOrder(accountId, id);
            if (!po) return reply.code(404).send({ error: 'PO not found' });
            return po;
        } catch (error) {
            return reply.code(500).send({ error: 'Failed to fetch PO' });
        }
    });

    fastify.post('/purchase-orders', async (request, reply) => {
        const accountId = request.accountId!;
        try {
            const po = await poService.createPurchaseOrder(accountId, request.body as any);
            return po;
        } catch (error) {
            Logger.error('Error', { error });
            return reply.code(500).send({ error: 'Failed to create PO' });
        }
    });

    fastify.put<{ Params: { id: string } }>('/purchase-orders/:id', async (request, reply) => {
        const accountId = request.accountId!;
        const { id } = request.params;
        const { status } = request.body as { status?: string };

        try {
            // Check if transitioning to RECEIVED
            const existingPO = await poService.getPurchaseOrder(accountId, id);
            const wasNotReceived = existingPO?.status !== 'RECEIVED';

            await poService.updatePurchaseOrder(accountId, id, request.body as any);

            // If status changed to RECEIVED, increment stock for linked products
            if (status === 'RECEIVED' && wasNotReceived) {
                const result = await poService.receiveStock(accountId, id);
                Logger.info('Stock received from PO', { poId: id, ...result });

                // Fire-and-forget: ES re-indexing runs in background
                const bgProductIds = [...result.updatedProductIds];
                const bgAccountId = accountId;
                setImmediate(() => {
                    (async () => {
                        for (const productId of bgProductIds) {
                            try {
                                const product = await prisma.wooProduct.findUnique({
                                    where: { id: productId },
                                    include: { variations: true }
                                });
                                if (product) {
                                    await IndexingService.indexProduct(bgAccountId, {
                                        ...product,
                                        variations: product.variations.map(v => ({
                                            ...v,
                                            id: v.wooId,
                                        }))
                                    });
                                }
                            } catch (indexErr) {
                                Logger.warn('Failed to re-index product after PO receive', {
                                    productId, error: (indexErr as Error).message
                                });
                            }
                        }
                        await invalidateCache('products', bgAccountId);
                    })().catch(err => Logger.error('Background ES re-index failed', { error: err }));
                });
            }

            // If status changed FROM RECEIVED to something else, reverse the stock
            if (status && status !== 'RECEIVED' && !wasNotReceived) {
                const result = await poService.unreceiveStock(accountId, id);
                Logger.info('Stock unreceived from PO', { poId: id, ...result });

                // Fire-and-forget: ES re-indexing runs in background
                const bgProductIds = [...result.updatedProductIds];
                const bgAccountId = accountId;
                setImmediate(() => {
                    (async () => {
                        for (const productId of bgProductIds) {
                            try {
                                const product = await prisma.wooProduct.findUnique({
                                    where: { id: productId },
                                    include: { variations: true }
                                });
                                if (product) {
                                    await IndexingService.indexProduct(bgAccountId, {
                                        ...product,
                                        variations: product.variations.map(v => ({
                                            ...v,
                                            id: v.wooId,
                                        }))
                                    });
                                }
                            } catch (indexErr) {
                                Logger.warn('Failed to re-index product after PO unreceive', {
                                    productId, error: (indexErr as Error).message
                                });
                            }
                        }
                        await invalidateCache('products', bgAccountId);
                    })().catch(err => Logger.error('Background ES re-index failed', { error: err }));
                });
            }

            const updated = await poService.getPurchaseOrder(accountId, id);
            return updated;
        } catch (error) {
            Logger.error('Error updating PO', { error, poId: id });
            return reply.code(500).send({ error: 'Failed to update PO' });
        }
    });

    fastify.get('/picklist', async (request, reply) => {
        const accountId = request.accountId!;
        const { status, limit } = request.query as { status?: string; limit?: string };
        try {
            const picklist = await picklistService.generatePicklist(accountId, {
                status,
                limit: limit ? Number(limit) : undefined
            });
            return picklist;
        } catch (error) {
            Logger.error('Error', { error });
            return reply.code(500).send({ error: 'Failed to generate picklist' });
        }
    });
    // POST /repair-received-pos - One-time repair: re-index ALL products in ES
    // Does NOT modify stock — only fixes Elasticsearch index so inventory screen shows correct data
    // Covers PO-linked products, BOM parents, variants, and everything else
    fastify.post('/repair-received-pos', async (request, reply) => {
        const accountId = request.accountId!;

        try {
            // Fetch ALL products for this account with their variations
            const products = await prisma.wooProduct.findMany({
                where: { accountId },
                include: { variations: true }
            });

            if (products.length === 0) {
                return { success: true, message: 'No products to repair', reindexed: 0 };
            }

            // Re-index each product in Elasticsearch
            let reindexed = 0;
            const errors: string[] = [];
            for (const product of products) {
                try {
                    await IndexingService.indexProduct(accountId, {
                        ...product,
                        variations: product.variations.map(v => ({
                            ...v,
                            id: v.wooId, // ES expects numeric WooCommerce ID, not Prisma UUID
                        }))
                    });
                    reindexed++;
                } catch (err) {
                    errors.push(`Failed to re-index ${product.name}: ${(err as Error).message}`);
                }
            }

            // Invalidate cache
            await invalidateCache('products', accountId);

            Logger.info('Repair completed: re-indexed all products', {
                accountId,
                totalProducts: products.length,
                reindexed,
                errors: errors.length
            });

            return {
                success: true,
                totalProducts: products.length,
                reindexed,
                errors: errors.length > 0 ? errors : undefined
            };
        } catch (error) {
            Logger.error('Error repairing products', { error });
            return reply.code(500).send({ error: 'Failed to repair products' });
        }
    });

    // POST /reprocess-received-pos - One-time fix: unreceive, backfill variationWooId, re-receive
    // Processes each PO atomically with crash recovery — on failure, restores original status
    fastify.post('/reprocess-received-pos', async (request, reply) => {
        const accountId = request.accountId!;

        // Prevent concurrent reprocessing for the same account
        const existing = reprocessProgress.get(accountId);
        if (existing?.status === 'running') {
            return reply.code(409).send({
                success: false,
                message: 'Reprocessing already in progress',
                progress: existing
            });
        }

        const poCount = await prisma.purchaseOrder.count({
            where: { accountId, status: 'RECEIVED' }
        });

        if (poCount === 0) {
            return { success: true, message: 'No RECEIVED POs found', processed: 0 };
        }

        // Initialize progress tracker
        reprocessProgress.set(accountId, {
            status: 'running',
            startedAt: new Date().toISOString(),
            totalPOs: poCount,
            processed: 0,
            variationsBackfilled: 0,
            errors: []
        });

        reply.code(202).send({
            success: true,
            message: `Processing ${poCount} RECEIVED POs in background. Poll GET /reprocess-status for progress.`
        });

        // Background processing (detached from request lifecycle)
        setImmediate(() => {
            (async () => {
                Logger.info('[Reprocess] Starting background PO reprocessing', { accountId, poCount });
                const progress = reprocessProgress.get(accountId)!;

                const receivedPOs = await prisma.purchaseOrder.findMany({
                    where: { accountId, status: 'RECEIVED' },
                    include: {
                        items: {
                            include: {
                                product: {
                                    include: {
                                        variations: true,
                                        boms: {
                                            select: {
                                                id: true,
                                                items: {
                                                    where: {
                                                        OR: [
                                                            { childProductId: { not: null } },
                                                            { internalProductId: { not: null } }
                                                        ]
                                                    },
                                                    select: { id: true }
                                                }
                                            }
                                        }
                                    }
                                }
                            }
                        }
                    }
                });

                // Process each PO atomically — unreceive, backfill, re-receive, restore
                for (const po of receivedPOs) {
                    const poLabel = po.orderNumber || po.id.slice(0, 8);
                    try {
                        // Step 1: Unreceive stock
                        await poService.unreceiveStock(accountId, po.id);
                        Logger.info(`[Reprocess] Unreceived PO ${poLabel}`, { accountId });

                        // Step 2: Backfill missing variationWooId by matching SKU
                        for (const item of po.items) {
                            if (!item.productId || !item.product) continue;
                            if (item.variationWooId) continue;
                            if (!item.sku || item.product.variations.length === 0) continue;

                            const matchedVariation = item.product.variations.find(v => v.sku === item.sku);
                            if (matchedVariation) {
                                await prisma.purchaseOrderItem.update({
                                    where: { id: item.id },
                                    data: { variationWooId: matchedVariation.wooId }
                                });
                                progress.variationsBackfilled++;
                                Logger.info(`[Reprocess] Backfilled variationWooId=${matchedVariation.wooId} for SKU="${item.sku}"`);
                            }
                        }

                        // Step 3: Set to DRAFT so receiveStock can process it
                        await prisma.purchaseOrder.update({
                            where: { id: po.id },
                            data: { status: 'DRAFT' }
                        });

                        // Step 4: Re-receive stock with backfilled variation links
                        const result = await poService.receiveStock(accountId, po.id);
                        if (result.errors.length > 0) {
                            progress.errors.push(...result.errors.map(e => `PO ${poLabel}: ${e}`));
                        }

                        // Step 5: Restore RECEIVED status
                        await prisma.purchaseOrder.update({
                            where: { id: po.id },
                            data: { status: 'RECEIVED' }
                        });

                        Logger.info(`[Reprocess] Completed PO ${poLabel}: ${result.updated} items`, { accountId });
                    } catch (err) {
                        // Crash recovery: restore RECEIVED status so PO isn't stuck in DRAFT
                        Logger.error(`[Reprocess] Failed processing PO ${poLabel}, restoring status`, {
                            error: (err as Error).message
                        });
                        progress.errors.push(`PO ${poLabel} failed: ${(err as Error).message}`);
                        try {
                            await prisma.purchaseOrder.update({
                                where: { id: po.id },
                                data: { status: 'RECEIVED' }
                            });
                        } catch (restoreErr) {
                            Logger.error(`[Reprocess] CRITICAL: Could not restore PO ${poLabel} status`, {
                                error: (restoreErr as Error).message
                            });
                        }
                    }
                    progress.processed++;
                }

                // Re-index ALL products in ES
                const products = await prisma.wooProduct.findMany({
                    where: { accountId },
                    include: { variations: true }
                });

                let reindexed = 0;
                for (const product of products) {
                    try {
                        await IndexingService.indexProduct(accountId, {
                            ...product,
                            variations: product.variations.map(v => ({
                                ...v,
                                id: v.wooId,
                            }))
                        });
                        reindexed++;
                    } catch (_) { /* non-critical */ }
                }

                await invalidateCache('products', accountId);

                // Update progress tracker
                progress.status = progress.errors.length > 0 ? 'failed' : 'completed';
                progress.completedAt = new Date().toISOString();

                Logger.info('[Reprocess] Reprocess completed', {
                    accountId,
                    totalPOs: receivedPOs.length,
                    variationsBackfilled: progress.variationsBackfilled,
                    reindexed,
                    errors: progress.errors.length
                });

                // Clean up progress after 10 minutes
                setTimeout(() => reprocessProgress.delete(accountId), 10 * 60 * 1000);
            })().catch(error => {
                Logger.error('[Reprocess] Background reprocessing failed', { accountId, error });
                const progress = reprocessProgress.get(accountId);
                if (progress) {
                    progress.status = 'failed';
                    progress.completedAt = new Date().toISOString();
                    progress.errors.push(`Fatal: ${(error as Error).message}`);
                }
            });
        });
    });

    // GET /reprocess-status - Check progress of background PO reprocessing
    fastify.get('/reprocess-status', async (request) => {
        const accountId = request.accountId!;
        const progress = reprocessProgress.get(accountId);
        if (!progress) {
            return { status: 'idle', message: 'No reprocess operation running or recently completed' };
        }
        return progress;
    });
};

export default inventoryRoutes;
