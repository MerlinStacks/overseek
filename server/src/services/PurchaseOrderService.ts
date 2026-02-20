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
        // Guard: RECEIVED POs are immutable — revert to DRAFT first
        const existing = await prisma.purchaseOrder.findFirst({
            where: { id: poId, accountId },
            select: { status: true }
        });
        if (existing?.status === 'RECEIVED' && data.status !== 'DRAFT' && data.status !== 'ORDERED') {
            throw new Error('Cannot edit a RECEIVED Purchase Order. Revert to DRAFT or ORDERED first.');
        }

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
    async getInboundInventory(accountId: string, productId: string, variationWooId?: number): Promise<number> {
        const where: any = {
            productId,
            purchaseOrder: {
                accountId,
                status: 'ORDERED'
            }
        };
        // When a specific variation is requested, narrow to that variation only
        if (variationWooId !== undefined) {
            where.variationWooId = variationWooId;
        }

        const aggregations = await prisma.purchaseOrderItem.aggregate({
            where,
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

        if (!po) {
            throw new Error('Purchase Order not found');
        }

        const errors: string[] = [];
        const updatedProductIds: string[] = [];
        let updated = 0;

        // Collect WooCommerce sync tasks to run in background after response
        const wooSyncTasks: Array<() => Promise<void>> = [];

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
                        // Atomic increment prevents race with concurrent BOM consumption
                        const updated = await prisma.productVariation.update({
                            where: { id: variation.id },
                            data: {
                                stockQuantity: { increment: item.quantity },
                                manageStock: true
                            },
                            select: { stockQuantity: true }
                        });
                        const newStock = updated.stockQuantity ?? 0;

                        // Update stockStatus based on resulting stock
                        await prisma.productVariation.update({
                            where: { id: variation.id },
                            data: { stockStatus: newStock > 0 ? 'instock' : 'outofstock' }
                        });

                        Logger.info('Stock received for variation', {
                            productId: product.id,
                            variationWooId: item.variationWooId,
                            previousStock: (variation.stockQuantity ?? 0),
                            addedQuantity: item.quantity,
                            newStock
                        });

                        // Queue WooCommerce sync for background
                        if (wooService) {
                            const woo = wooService;
                            const pWooId = product.wooId;
                            const vWooId = item.variationWooId;
                            const stock = newStock;
                            wooSyncTasks.push(async () => {
                                try {
                                    await woo.updateProductVariation(pWooId, vWooId, {
                                        manage_stock: true,
                                        stock_quantity: stock
                                    });
                                } catch (wooErr) {
                                    Logger.warn('Failed to sync variation stock to WooCommerce', {
                                        error: wooErr, productWooId: pWooId, variationWooId: vWooId
                                    });
                                }
                            });
                        }
                    } else {
                        // Variation not found locally — this is an error, not safe to fall through to parent
                        Logger.error('Variation not found locally for stock receive', {
                            productId: product.id,
                            variationWooId: item.variationWooId
                        });
                        errors.push(`${item.name}: Variation ${item.variationWooId} not found locally — sync products first`);
                        continue;
                    }
                } else {
                    // Simple product stock update
                    // Variable products must have variationWooId specified — skip with error
                    const productRaw = product.rawData as any;
                    const isVariable = productRaw?.type?.includes('variable') || productRaw?.variations?.length > 0;
                    if (isVariable) {
                        errors.push(`${product.name}: Cannot set stock on variable parent — specify a variation`);
                        continue;
                    }

                    const previousStock = product.stockQuantity ?? 0;

                    // Atomic increment prevents race with concurrent BOM consumption
                    const updated = await prisma.wooProduct.update({
                        where: { id: product.id },
                        data: {
                            stockQuantity: { increment: item.quantity },
                            manageStock: true
                        },
                        select: { stockQuantity: true }
                    });
                    const newStock = updated.stockQuantity ?? 0;

                    // Update stockStatus based on resulting stock
                    await prisma.wooProduct.update({
                        where: { id: product.id },
                        data: { stockStatus: newStock > 0 ? 'instock' : 'outofstock' }
                    });

                    Logger.info('Stock received for product', {
                        productId: product.id,
                        wooId: product.wooId,
                        previousStock,
                        addedQuantity: item.quantity,
                        newStock
                    });

                    // Queue WooCommerce sync for background
                    if (wooService) {
                        const woo = wooService;
                        const pWooId = product.wooId;
                        const stock = newStock;
                        wooSyncTasks.push(async () => {
                            try {
                                await woo.updateProduct(pWooId, {
                                    manage_stock: true,
                                    stock_quantity: stock
                                });
                            } catch (wooErr) {
                                Logger.warn('Failed to sync received stock to WooCommerce', {
                                    error: wooErr, productWooId: pWooId
                                });
                            }
                        });
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

        // Fire-and-forget: WooCommerce sync + BOM cascade run in background
        // Why: WooCommerce API calls take ~2s each — with 24 items that exceeds
        // the Nginx 60s timeout. DB updates (above) are already committed.
        if (wooSyncTasks.length > 0 || updatedProductIds.length > 0) {
            const bgAccountId = accountId;
            const bgPoId = poId;
            const bgProductIds = [...updatedProductIds];
            const bgTasks = [...wooSyncTasks];

            setImmediate(() => {
                (async () => {
                    // Sync stock to WooCommerce sequentially to avoid rate limits
                    for (const task of bgTasks) {
                        await task();
                    }
                    Logger.info('WooCommerce stock sync completed for PO receive', {
                        poId: bgPoId, syncedItems: bgTasks.length
                    });

                    // Cascade BOM sync
                    for (const productId of bgProductIds) {
                        try {
                            await BOMConsumptionService.cascadeSyncAffectedProducts(bgAccountId, productId);
                        } catch (syncErr) {
                            Logger.warn('Cascade BOM sync failed for component', {
                                productId, error: (syncErr as Error).message
                            });
                        }
                    }
                })().catch(err => {
                    Logger.error('Background WooCommerce sync failed', { poId: bgPoId, error: err });
                });
            });
        }

        return { updated, errors, updatedProductIds };
    }

    /**
     * Unreceive stock from a Purchase Order.
     * Reverses stock changes when a PO transitions away from RECEIVED.
     */
    async unreceiveStock(accountId: string, poId: string): Promise<{ updated: number; errors: string[]; updatedProductIds: string[] }> {
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

        if (!po) {
            throw new Error('Purchase Order not found');
        }

        const errors: string[] = [];
        const updatedProductIds: string[] = [];
        let updated = 0;

        // Collect WooCommerce sync tasks to run in background after response
        const wooSyncTasks: Array<() => Promise<void>> = [];

        let wooService: WooService | null = null;
        try {
            wooService = await WooService.forAccount(accountId);
        } catch (err) {
            Logger.warn('Unable to connect to WooCommerce for stock unreceive', { error: err, accountId });
        }

        for (const item of po.items) {
            if (!item.productId || !item.product) continue;

            const hasBOM = item.product.boms?.some(bom => bom.items.length > 0) ?? false;
            if (hasBOM) continue;

            try {
                const product = item.product;

                if (item.variationWooId) {
                    // Reverse variation stock
                    const variation = await prisma.productVariation.findUnique({
                        where: { productId_wooId: { productId: product.id, wooId: item.variationWooId } }
                    });

                    if (variation) {
                        // Atomic decrement prevents race with concurrent stock changes
                        const updated = await prisma.productVariation.update({
                            where: { id: variation.id },
                            data: { stockQuantity: { decrement: item.quantity } },
                            select: { stockQuantity: true }
                        });
                        const newStock = Math.max(0, updated.stockQuantity ?? 0);

                        await prisma.productVariation.update({
                            where: { id: variation.id },
                            data: { stockStatus: newStock > 0 ? 'instock' : 'outofstock' }
                        });

                        // Queue WooCommerce sync for background
                        if (wooService) {
                            const woo = wooService;
                            const pWooId = product.wooId;
                            const vWooId = item.variationWooId;
                            const stock = newStock;
                            wooSyncTasks.push(async () => {
                                try {
                                    await woo.updateProductVariation(pWooId, vWooId, {
                                        stock_quantity: stock
                                    });
                                } catch (wooErr) {
                                    Logger.warn('Failed to sync variation unreceive to WooCommerce', {
                                        error: wooErr, productWooId: pWooId, variationWooId: vWooId
                                    });
                                }
                            });
                        }
                    }
                } else {
                    // Simple product stock reversal
                    // Variable products must have variationWooId specified — skip
                    const productRaw = product.rawData as any;
                    const isVariable = productRaw?.type?.includes('variable') || productRaw?.variations?.length > 0;
                    if (isVariable) {
                        errors.push(`${product.name}: Cannot reverse stock on variable parent — specify a variation`);
                        continue;
                    }

                    const updated = await prisma.wooProduct.update({
                        where: { id: product.id },
                        data: { stockQuantity: { decrement: item.quantity } },
                        select: { stockQuantity: true }
                    });
                    const newStock = Math.max(0, updated.stockQuantity ?? 0);

                    await prisma.wooProduct.update({
                        where: { id: product.id },
                        data: { stockStatus: newStock > 0 ? 'instock' : 'outofstock' }
                    });

                    // Queue WooCommerce sync for background
                    if (wooService) {
                        const woo = wooService;
                        const pWooId = product.wooId;
                        const stock = newStock;
                        wooSyncTasks.push(async () => {
                            try {
                                await woo.updateProduct(pWooId, {
                                    stock_quantity: stock
                                });
                            } catch (wooErr) {
                                Logger.warn('Failed to sync unreceive stock to WooCommerce', {
                                    error: wooErr, productWooId: pWooId
                                });
                            }
                        });
                    }
                }

                updated++;
                updatedProductIds.push(product.id);

                Logger.info('Stock unreceived for item', {
                    productId: product.id,
                    itemName: item.name,
                    quantity: item.quantity,
                    variationWooId: item.variationWooId
                });
            } catch (err) {
                const errorMsg = `Failed to unreceive stock for "${item.name}": ${(err as Error).message}`;
                Logger.error('Error unreceiving stock for PO item', { error: err, itemId: item.id });
                errors.push(errorMsg);
            }
        }

        // Fire-and-forget: WooCommerce sync + BOM cascade run in background
        if (wooSyncTasks.length > 0 || updatedProductIds.length > 0) {
            const bgAccountId = accountId;
            const bgPoId = poId;
            const bgProductIds = [...updatedProductIds];
            const bgTasks = [...wooSyncTasks];

            setImmediate(() => {
                (async () => {
                    for (const task of bgTasks) {
                        await task();
                    }
                    Logger.info('WooCommerce stock sync completed for PO unreceive', {
                        poId: bgPoId, syncedItems: bgTasks.length
                    });

                    for (const productId of bgProductIds) {
                        try {
                            await BOMConsumptionService.cascadeSyncAffectedProducts(bgAccountId, productId);
                        } catch (syncErr) {
                            Logger.warn('Cascade BOM sync failed during unreceive', {
                                productId, error: (syncErr as Error).message
                            });
                        }
                    }
                })().catch(err => {
                    Logger.error('Background WooCommerce unreceive sync failed', { poId: bgPoId, error: err });
                });
            });
        }

        return { updated, errors, updatedProductIds };
    }
}
