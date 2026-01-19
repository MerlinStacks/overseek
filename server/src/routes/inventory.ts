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

const poService = new PurchaseOrderService();
const picklistService = new PicklistService();

const inventoryRoutes: FastifyPluginAsync = async (fastify) => {
    fastify.addHook('preHandler', requireAuthFastify);

    // --- Settings & Alerts ---

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

    // --- Suppliers ---

    fastify.get('/suppliers', async (request, reply) => {
        const accountId = request.accountId;
        if (!accountId) return reply.code(400).send({ error: 'No account' });

        try {
            const suppliers = await prisma.supplier.findMany({
                where: { accountId },
                include: { items: true },
                orderBy: { name: 'asc' }
            });
            return suppliers;
        } catch (error) {
            return reply.code(500).send({ error: 'Failed to fetch suppliers' });
        }
    });

    fastify.post('/suppliers', async (request, reply) => {
        const accountId = request.accountId;
        if (!accountId) return reply.code(400).send({ error: 'No account' });

        try {
            const { name, contactName, email, phone, currency, leadTimeDefault, leadTimeMin, leadTimeMax, paymentTerms } = request.body as any;
            const supplier = await prisma.supplier.create({
                data: {
                    accountId,
                    name,
                    contactName,
                    email,
                    phone,
                    currency: currency || 'USD',
                    leadTimeDefault: leadTimeDefault ? parseInt(leadTimeDefault) : null,
                    leadTimeMin: leadTimeMin ? parseInt(leadTimeMin) : null,
                    leadTimeMax: leadTimeMax ? parseInt(leadTimeMax) : null,
                    paymentTerms
                }
            });
            return supplier;
        } catch (error) {
            return reply.code(500).send({ error: 'Failed to create supplier' });
        }
    });

    fastify.put<{ Params: { id: string } }>('/suppliers/:id', async (request, reply) => {
        const accountId = request.accountId;
        const { id } = request.params;
        if (!accountId) return reply.code(400).send({ error: 'No account' });

        try {
            // Verify supplier belongs to account
            const existing = await prisma.supplier.findFirst({
                where: { id, accountId }
            });
            if (!existing) return reply.code(404).send({ error: 'Supplier not found' });

            const { name, contactName, email, phone, currency, leadTimeDefault, leadTimeMin, leadTimeMax, paymentTerms } = request.body as any;
            const supplier = await prisma.supplier.update({
                where: { id },
                data: {
                    name,
                    contactName,
                    email,
                    phone,
                    currency: currency || 'USD',
                    leadTimeDefault: leadTimeDefault ? parseInt(leadTimeDefault) : null,
                    leadTimeMin: leadTimeMin ? parseInt(leadTimeMin) : null,
                    leadTimeMax: leadTimeMax ? parseInt(leadTimeMax) : null,
                    paymentTerms
                }
            });
            return supplier;
        } catch (error) {
            Logger.error('Error updating supplier', { error });
            return reply.code(500).send({ error: 'Failed to update supplier' });
        }
    });

    fastify.delete<{ Params: { id: string } }>('/suppliers/:id', async (request, reply) => {
        const accountId = request.accountId;
        const { id } = request.params;
        if (!accountId) return reply.code(400).send({ error: 'No account' });

        try {
            // Verify supplier belongs to account
            const existing = await prisma.supplier.findFirst({
                where: { id, accountId }
            });
            if (!existing) return reply.code(404).send({ error: 'Supplier not found' });

            await prisma.supplier.delete({ where: { id } });
            return { success: true };
        } catch (error) {
            Logger.error('Error deleting supplier', { error });
            return reply.code(500).send({ error: 'Failed to delete supplier' });
        }
    });

    fastify.post<{ Params: { id: string } }>('/suppliers/:id/items', async (request, reply) => {
        const { id } = request.params;
        try {
            const { name, sku, cost, leadTime, moq } = request.body as any;
            const item = await prisma.supplierItem.create({
                data: {
                    supplierId: id,
                    name,
                    sku,
                    cost: parseFloat(cost),
                    leadTime: leadTime ? parseInt(leadTime) : null,
                    moq: moq ? parseInt(moq) : 1
                }
            });
            return item;
        } catch (error) {
            return reply.code(500).send({ error: 'Failed to add item' });
        }
    });

    // --- BOM ---

    fastify.get<{ Params: { productId: string } }>('/products/:productId/bom', async (request, reply) => {
        const { productId } = request.params;
        const query = request.query as { variationId?: string };
        const variationId = parseInt(query.variationId || '0');

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
                            childVariation: true // Include variant details for name/COGS
                        }
                    }
                }
            });
            return bom || { items: [] };
        } catch (error) {
            Logger.error('Error', { error });
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
        const variationId = parseInt(query.variationId || '0');

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
                            childVariation: true // Include variant details
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

    // --- BOM Inventory Sync ---

    /**
     * POST /products/:productId/bom/sync
     * Sync a single product's inventory to WooCommerce based on BOM calculation.
     */
    fastify.post<{ Params: { productId: string } }>('/products/:productId/bom/sync', async (request, reply) => {
        const accountId = request.accountId!;
        const { productId } = request.params;
        const body = request.body as { variationId?: number };
        const variationId = body.variationId ?? 0;

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
     * Dispatches to queue for background processing with job tracking.
     */
    fastify.post('/bom/sync-all', async (request, reply) => {
        const accountId = request.accountId!;

        // Dynamic import to avoid circular dependencies
        const { QueueFactory, QUEUES } = await import('../services/queue/QueueFactory');

        // Count pending BOMs to give user an idea of scope
        const bomCount = await prisma.bOM.count({
            where: {
                product: { accountId },
                items: {
                    some: { childProductId: { not: null } }
                }
            }
        });

        // Dispatch to queue with deduplication
        const queue = QueueFactory.getQueue(QUEUES.BOM_SYNC);
        const jobId = `bom_sync_${accountId.replace(/:/g, '_')}`;

        // Check if already running
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
            // Remove completed/failed job to allow re-run
            try { await existingJob.remove(); } catch (e) { /* ignore */ }
        }

        // Add job to queue
        await queue.add(QUEUES.BOM_SYNC, { accountId }, {
            jobId,
            priority: 10, // High priority for manual trigger
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
     * GET /bom/pending-changes
     * Returns all BOM products with current vs effective stock comparison.
     * Used by the BOM sync dashboard to show which products need syncing.
     */
    fastify.get('/bom/pending-changes', async (request, reply) => {
        const accountId = request.accountId!;

        try {
            // Find all BOMs with child product items for this account
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

            // Sort: needs sync first, then by name
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
     * POST /products/:productId/bom/sync
     * Syncs a single product's effective BOM stock to WooCommerce.
     */
    fastify.post<{ Params: { productId: string } }>('/products/:productId/bom/sync', async (request, reply) => {
        const accountId = request.accountId!;
        const { productId } = request.params;
        const query = request.query as { variationId?: string };
        const variationId = parseInt(query.variationId || '0');

        try {
            const result = await BOMInventorySyncService.syncProductToWoo(accountId, productId, variationId);

            if (result.success) {
                return {
                    status: 'success',
                    productId: result.productId,
                    previousStock: result.previousStock,
                    newStock: result.newStock
                };
            } else {
                return reply.code(400).send({
                    status: 'failed',
                    error: result.error
                });
            }
        } catch (error) {
            Logger.error('Error syncing BOM product to WooCommerce', { error, productId, variationId });
            return reply.code(500).send({ error: 'Failed to sync product' });
        }
    });

    /**
     * POST /bom/sync-all
     * Syncs all BOM products for the account to WooCommerce.
     */
    fastify.post('/bom/sync-all', async (request, reply) => {
        const accountId = request.accountId!;

        try {
            Logger.info(`[BOMSync] Starting sync-all for account`, { accountId });

            const result = await BOMInventorySyncService.syncAllBOMProducts(accountId);

            Logger.info(`[BOMSync] sync-all complete`, {
                accountId,
                total: result.total,
                synced: result.synced,
                failed: result.failed
            });

            return {
                status: 'completed',
                total: result.total,
                synced: result.synced,
                skipped: result.skipped,
                failed: result.failed
            };
        } catch (error) {
            Logger.error('Error syncing all BOM products', { error, accountId });
            return reply.code(500).send({ error: 'Failed to sync all products' });
        }
    });

    /**
     * GET /bom/sync-history
     * Returns recent BOM sync logs from AuditLog where source = 'SYSTEM_BOM'.
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

            // Enrich with product names
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

    // --- Purchase Orders ---

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
        try {
            await poService.updatePurchaseOrder(accountId, id, request.body as any);
            const updated = await poService.getPurchaseOrder(accountId, id);
            return updated;
        } catch (error) {
            return reply.code(500).send({ error: 'Failed to update PO' });
        }
    });

    // --- Picklist ---

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
};

export default inventoryRoutes;
