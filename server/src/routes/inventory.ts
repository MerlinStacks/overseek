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

// Modular sub-routes (extracted for maintainability)
import { supplierRoutes } from './inventory/suppliers';
import { bomSyncRoutes } from './inventory/bomSync';

const poService = new PurchaseOrderService();
const picklistService = new PicklistService();

const inventoryRoutes: FastifyPluginAsync = async (fastify) => {
    fastify.addHook('preHandler', requireAuthFastify);

    // Register modular sub-routes
    await fastify.register(supplierRoutes);
    await fastify.register(bomSyncRoutes);


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
                            childVariation: true, // Include variant details for name/COGS
                            internalProduct: true // Include internal product details
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
