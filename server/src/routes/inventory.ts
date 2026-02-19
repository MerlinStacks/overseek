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

                // Re-index affected products in Elasticsearch so inventory screen reflects changes
                for (const productId of result.updatedProductIds) {
                    try {
                        const product = await prisma.wooProduct.findUnique({
                            where: { id: productId },
                            include: { variations: true }
                        });
                        if (product) {
                            await IndexingService.indexProduct(accountId, {
                                ...product,
                                variations: product.variations.map(v => ({
                                    ...v,
                                    id: v.wooId, // ES expects numeric WooCommerce ID, not Prisma UUID
                                }))
                            });
                        }
                    } catch (indexErr) {
                        Logger.warn('Failed to re-index product after PO receive', {
                            productId, error: (indexErr as Error).message
                        });
                    }
                }

                // Invalidate product list cache so next fetch returns fresh data
                await invalidateCache('products', accountId);
            }

            // If status changed FROM RECEIVED to something else, reverse the stock
            if (status && status !== 'RECEIVED' && !wasNotReceived) {
                const result = await poService.unreceiveStock(accountId, id);
                Logger.info('Stock unreceived from PO', { poId: id, ...result });

                // Re-index affected products
                for (const productId of result.updatedProductIds) {
                    try {
                        const product = await prisma.wooProduct.findUnique({
                            where: { id: productId },
                            include: { variations: true }
                        });
                        if (product) {
                            await IndexingService.indexProduct(accountId, {
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

                await invalidateCache('products', accountId);
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
    // Why fire-and-forget: this operation processes every RECEIVED PO, re-indexes all
    // products, and triggers BOM syncs. On stores with many POs this exceeds the Nginx
    // proxy_read_timeout (60s), resulting in a 504 that aborts the HTTP response but
    // also kills the in-flight async work. Responding with 202 immediately lets the
    // work complete regardless of gateway timeouts.
    fastify.post('/reprocess-received-pos', async (request, reply) => {
        const accountId = request.accountId!;

        // Count POs upfront so we can tell the caller what to expect
        const poCount = await prisma.purchaseOrder.count({
            where: { accountId, status: 'RECEIVED' }
        });

        if (poCount === 0) {
            return { success: true, message: 'No RECEIVED POs found', processed: 0 };
        }

        // Respond immediately — work continues in background
        reply.code(202).send({
            success: true,
            message: `Processing ${poCount} RECEIVED POs in background. Check server logs for "Reprocess completed".`
        });

        // Background processing (detached from request lifecycle)
        // Why the outer .catch(): setImmediate ignores the promise returned by
        // an async callback, so any rejection would be silently swallowed.
        setImmediate(() => {
            (async () => {
                Logger.info('[Reprocess] Starting background PO reprocessing', { accountId, poCount });

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
                                                    where: { childProductId: { not: null } },
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

                let variationsBackfilled = 0;

                // 1. UNRECEIVE: Subtract old stock from parent products + backfill variationWooId
                for (const po of receivedPOs) {
                    for (const item of po.items) {
                        if (!item.productId || !item.product) continue;

                        const hasBOM = item.product.boms?.some(bom => bom.items.length > 0) ?? false;
                        if (hasBOM) continue;

                        await prisma.wooProduct.update({
                            where: { id: item.product.id },
                            data: { stockQuantity: { decrement: item.quantity } }
                        });

                        if (!item.variationWooId && item.sku && item.product.variations.length > 0) {
                            const matchedVariation = item.product.variations.find(v => v.sku === item.sku);
                            if (matchedVariation) {
                                await prisma.purchaseOrderItem.update({
                                    where: { id: item.id },
                                    data: { variationWooId: matchedVariation.wooId }
                                });
                                variationsBackfilled++;
                                Logger.info(`[Reprocess] Backfilled variationWooId=${matchedVariation.wooId} for SKU="${item.sku}"`);
                            }
                        }
                    }

                    await prisma.purchaseOrder.update({
                        where: { id: po.id },
                        data: { status: 'DRAFT' }
                    });
                }

                // 2. RE-RECEIVE: Apply stock correctly using variant-aware receiveStock
                const receiveErrors: string[] = [];

                for (const po of receivedPOs) {
                    try {
                        const result = await poService.receiveStock(accountId, po.id);
                        Logger.info(`[Reprocess] Re-received PO ${po.orderNumber || po.id}: ${result.updated} items`, { accountId });
                        if (result.errors.length > 0) {
                            receiveErrors.push(...result.errors);
                        }
                    } catch (err) {
                        receiveErrors.push(`Failed to re-receive PO ${po.orderNumber || po.id}: ${(err as Error).message}`);
                    }

                    await prisma.purchaseOrder.update({
                        where: { id: po.id },
                        data: { status: 'RECEIVED' }
                    });
                }

                // 3. Re-index ALL products in ES
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

                Logger.info('[Reprocess] Reprocess completed', {
                    accountId,
                    totalPOs: receivedPOs.length,
                    variationsBackfilled,
                    reindexed,
                    receiveErrors: receiveErrors.length
                });
            })().catch(error => {
                Logger.error('[Reprocess] Background reprocessing failed', { accountId, error });
            });
        });
    });
};

export default inventoryRoutes;
