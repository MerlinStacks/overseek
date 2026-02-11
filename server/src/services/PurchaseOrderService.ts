import { PrismaClient, PurchaseOrder, PurchaseOrderItem } from '@prisma/client';
import { prisma } from '../utils/prisma';
import { WooService } from './woo';
import { Logger } from '../utils/logger';
import { BOMConsumptionService } from './BOMConsumptionService';

export class PurchaseOrderService {

    /**
     * List Purchase Orders for an account with optional status filtering
     */
    async listPurchaseOrders(accountId: string, status?: string) {
        return prisma.purchaseOrder.findMany({
            where: {
                accountId,
                ...(status ? { status } : {})
            },
            include: {
                supplier: true,
                items: true
            },
            orderBy: { createdAt: 'desc' }
        });
    }

    /**
     * Get a single Purchase Order by ID
     */
    async getPurchaseOrder(accountId: string, poId: string) {
        return prisma.purchaseOrder.findFirst({
            where: { id: poId, accountId },
            include: {
                supplier: true,
                items: {
                    include: {
                        product: true,
                        supplierItem: true
                    }
                }
            }
        });
    }

    /**
     * Create a new Purchase Order
     */
    async createPurchaseOrder(accountId: string, data: {
        supplierId: string;
        items: {
            productId?: string;
            supplierItemId?: string;
            variationWooId?: number | null;
            quantity: number;
            unitCost: number;
            name: string;
            sku?: string;
        }[];
        notes?: string;
        orderDate?: string;
        expectedDate?: string;
        trackingNumber?: string;
        trackingLink?: string;
    }) {
        // Calculate totals
        let totalAmount = 0;
        const itemsToCreate = data.items.map(item => {
            const lineTotal = item.quantity * item.unitCost;
            totalAmount += lineTotal;
            return {
                productId: item.productId,
                supplierItemId: item.supplierItemId,
                variationWooId: item.variationWooId || null,
                quantity: item.quantity,
                unitCost: item.unitCost,
                totalCost: lineTotal,
                name: item.name,
                sku: item.sku
            };
        });

        return prisma.purchaseOrder.create({
            data: {
                accountId,
                supplierId: data.supplierId,
                status: 'DRAFT',
                notes: data.notes,
                orderDate: data.orderDate ? new Date(data.orderDate) : null,
                expectedDate: data.expectedDate ? new Date(data.expectedDate) : null,
                trackingNumber: data.trackingNumber || null,
                trackingLink: data.trackingLink || null,
                totalAmount,
                items: {
                    create: itemsToCreate
                }
            }
        });
    }

    /**
     * Update a Purchase Order (Status, Fields, AND Items)
     */
    async updatePurchaseOrder(accountId: string, poId: string, data: {
        status?: string;
        supplierId?: string;
        notes?: string;
        orderDate?: string;
        expectedDate?: string;
        trackingNumber?: string;
        trackingLink?: string;
        items?: {
            productId?: string;
            supplierItemId?: string;
            variationWooId?: number | null;
            quantity: number;
            unitCost: number;
            name: string;
            sku?: string;
        }[];
    }) {
        // Build update payload dynamically
        const updateData: Record<string, unknown> = {};

        if (data.status !== undefined) updateData.status = data.status;
        if (data.supplierId !== undefined) updateData.supplierId = data.supplierId;
        if (data.notes !== undefined) updateData.notes = data.notes;
        if (data.orderDate !== undefined) updateData.orderDate = data.orderDate ? new Date(data.orderDate) : null;
        if (data.expectedDate !== undefined) updateData.expectedDate = data.expectedDate ? new Date(data.expectedDate) : null;
        if (data.trackingNumber !== undefined) updateData.trackingNumber = data.trackingNumber || null;
        if (data.trackingLink !== undefined) updateData.trackingLink = data.trackingLink || null;

        // If items are provided, recalculate totalAmount and replace items
        if (data.items && data.items.length > 0) {
            let totalAmount = 0;
            const itemsToCreate = data.items.map(item => {
                const lineTotal = item.quantity * item.unitCost;
                totalAmount += lineTotal;
                return {
                    productId: item.productId || null,
                    supplierItemId: item.supplierItemId || null,
                    variationWooId: item.variationWooId || null,
                    quantity: item.quantity,
                    unitCost: item.unitCost,
                    totalCost: lineTotal,
                    name: item.name,
                    sku: item.sku || null
                };
            });

            updateData.totalAmount = totalAmount;

            // Transaction to delete old items and create new ones
            return prisma.$transaction(async (tx) => {
                // Delete existing items
                await tx.purchaseOrderItem.deleteMany({
                    where: { purchaseOrderId: poId }
                });

                // Update PO and create new items
                return tx.purchaseOrder.update({
                    where: { id: poId },
                    data: {
                        ...updateData,
                        items: {
                            create: itemsToCreate
                        }
                    }
                });
            });
        }

        // No items update, just update fields
        return prisma.purchaseOrder.updateMany({
            where: { id: poId, accountId },
            data: updateData
        });
    }

    /**
     * Calculate Inbound Inventory Quantity for a specific Product
     * Sums quantity from POs with status 'ORDERED'
     */
    async getInboundInventory(accountId: string, productId: string): Promise<number> {
        const aggregations = await prisma.purchaseOrderItem.aggregate({
            where: {
                productId,
                purchaseOrder: {
                    accountId,
                    status: 'ORDERED'
                }
            },
            _sum: {
                quantity: true
            }
        });

        return aggregations._sum.quantity || 0;
    }

    /**
     * Receive stock from a Purchase Order.
     * Increments stockQuantity on linked products/variants and syncs to WooCommerce.
     */
    async receiveStock(accountId: string, poId: string): Promise<{ updated: number; errors: string[]; updatedProductIds: string[] }> {
        const po = await prisma.purchaseOrder.findFirst({
            where: { id: poId, accountId },
            include: {
                items: {
                    include: {
                        product: {
                            include: {
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

        if (!po) {
            throw new Error('Purchase Order not found');
        }

        const errors: string[] = [];
        const updatedProductIds: string[] = [];
        let updated = 0;

        // Get WooService for syncing
        let wooService: WooService | null = null;
        try {
            wooService = await WooService.forAccount(accountId);
        } catch (err) {
            Logger.warn('Unable to connect to WooCommerce for stock sync', { error: err, accountId });
        }

        for (const item of po.items) {
            if (!item.productId || !item.product) {
                continue; // Skip items without linked product
            }

            // Skip BOM products - their stock is derived from components
            const hasBOM = item.product.boms?.some(bom => bom.items.length > 0) ?? false;
            if (hasBOM) {
                Logger.warn('Skipped stock update for BOM product', { productId: item.product.id, productName: item.product.name });
                errors.push(`${item.product.name} is a BOM product - stock not updated`);
                continue;
            }

            try {
                const product = item.product;

                // Check if this item targets a specific variation
                if (item.variationWooId) {
                    // Find the local ProductVariation record
                    const variation = await prisma.productVariation.findUnique({
                        where: { productId_wooId: { productId: product.id, wooId: item.variationWooId } }
                    });

                    if (variation) {
                        const currentStock = variation.stockQuantity ?? 0;
                        const newStock = currentStock + item.quantity;

                        // Update local variation stock
                        await prisma.productVariation.update({
                            where: { id: variation.id },
                            data: {
                                stockQuantity: newStock,
                                manageStock: true,
                                stockStatus: newStock > 0 ? 'instock' : 'outofstock'
                            }
                        });

                        Logger.info('Stock received for variation', {
                            productId: product.id,
                            variationWooId: item.variationWooId,
                            previousStock: currentStock,
                            addedQuantity: item.quantity,
                            newStock
                        });

                        // Sync variation to WooCommerce
                        if (wooService) {
                            try {
                                await wooService.updateProductVariation(product.wooId, item.variationWooId, {
                                    manage_stock: true,
                                    stock_quantity: newStock
                                });
                            } catch (wooErr) {
                                Logger.warn('Failed to sync variation stock to WooCommerce', {
                                    error: wooErr,
                                    productWooId: product.wooId,
                                    variationWooId: item.variationWooId
                                });
                                errors.push(`WooCommerce variation sync failed for ${item.name}: ${(wooErr as Error).message}`);
                            }
                        }
                    } else {
                        Logger.warn('Variation not found locally, falling back to parent product', {
                            productId: product.id,
                            variationWooId: item.variationWooId
                        });
                        // Fall through to parent product update below
                        const currentStock = product.stockQuantity ?? 0;
                        const newStock = currentStock + item.quantity;
                        await prisma.wooProduct.update({
                            where: { id: product.id },
                            data: { stockQuantity: newStock, manageStock: true, stockStatus: newStock > 0 ? 'instock' : 'outofstock' }
                        });
                        if (wooService) {
                            try {
                                await wooService.updateProduct(product.wooId, { manage_stock: true, stock_quantity: newStock });
                            } catch (wooErr) {
                                errors.push(`WooCommerce sync failed for ${product.name}: ${(wooErr as Error).message}`);
                            }
                        }
                    }
                } else {
                    // Simple/parent product — existing behavior
                    const currentStock = product.stockQuantity ?? 0;
                    const newStock = currentStock + item.quantity;

                    await prisma.wooProduct.update({
                        where: { id: product.id },
                        data: {
                            stockQuantity: newStock,
                            manageStock: true,
                            stockStatus: newStock > 0 ? 'instock' : 'outofstock'
                        }
                    });

                    Logger.info('Stock received for product', {
                        productId: product.id,
                        wooId: product.wooId,
                        previousStock: currentStock,
                        addedQuantity: item.quantity,
                        newStock
                    });

                    // Sync to WooCommerce
                    if (wooService) {
                        try {
                            await wooService.updateProduct(product.wooId, {
                                manage_stock: true,
                                stock_quantity: newStock
                            });
                        } catch (wooErr) {
                            Logger.warn('Failed to sync received stock to WooCommerce', {
                                error: wooErr,
                                productWooId: product.wooId
                            });
                            errors.push(`WooCommerce sync failed for ${product.name}: ${(wooErr as Error).message}`);
                        }
                    }
                }

                updated++;

                // Track this product for cascade BOM sync + ES re-index
                updatedProductIds.push(product.id);
            } catch (err) {
                const errorMsg = `Failed to update stock for item "${item.name}": ${(err as Error).message}`;
                Logger.error('Error receiving stock for PO item', { error: err, itemId: item.id });
                errors.push(errorMsg);
            }
        }

        // Cascade sync: Update all BOM parent products that use the received components
        // This ensures derived stock levels are recalculated immediately
        if (updatedProductIds.length > 0) {
            Logger.info('Triggering cascade BOM sync for received components', {
                poId,
                componentCount: updatedProductIds.length
            });

            for (const productId of updatedProductIds) {
                try {
                    await BOMConsumptionService.cascadeSyncAffectedProducts(accountId, productId);
                } catch (syncErr) {
                    Logger.warn('Cascade BOM sync failed for component', {
                        productId,
                        error: (syncErr as Error).message
                    });
                    // Non-blocking: don't add to errors array as stock was still received
                }
            }
        }

        return { updated, errors, updatedProductIds };
    }
}
