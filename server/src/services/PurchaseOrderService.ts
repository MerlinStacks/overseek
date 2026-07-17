import { prisma } from '../utils/prisma';
import { WooService } from './woo';
import { Logger } from '../utils/logger';
import { BOMConsumptionService } from './BOMConsumptionService';

const VALID_PO_STATUSES = new Set(['DRAFT', 'ORDERED', 'RECEIVED', 'CANCELLED']);

/** Max retries for WooCommerce API calls in background sync */
const WOO_MAX_RETRIES = 3;
/** Base delay (ms) for exponential backoff — doubles each retry */
const WOO_BASE_DELAY_MS = 2000;

/**
 * Retry wrapper for WooCommerce API calls.
 * Why: WooCommerce may throttle with 429 or return transient 5xx errors.
 * Uses exponential backoff: 2s → 4s → 8s.
 */
async function wooRetry(fn: () => Promise<void>, label: string): Promise<void> {
    for (let attempt = 1; attempt <= WOO_MAX_RETRIES; attempt++) {
        try {
            await fn();
            return;
        } catch (err: any) {
            const status = err?.response?.status ?? err?.status ?? 0;
            const isRetryable = status === 429 || status >= 500;
            if (!isRetryable || attempt === WOO_MAX_RETRIES) {
                Logger.warn(`WooCommerce sync failed after ${attempt} attempt(s): ${label}`, {
                    error: err?.message ?? err, status
                });
                return; // Swallow — background sync must not throw
            }
            const delay = WOO_BASE_DELAY_MS * Math.pow(2, attempt - 1);
            Logger.info(`WooCommerce rate-limited/transient error, retrying in ${delay}ms: ${label}`, { attempt, status });
            await new Promise(r => setTimeout(r, delay));
        }
    }
}

export class PurchaseOrderService {

    private async validateOwnershipForPOInputs(
        accountId: string,
        supplierId?: string,
        items?: Array<{ productId?: string; supplierItemId?: string }>
    ): Promise<void> {
        if (supplierId) {
            const supplier = await prisma.supplier.findFirst({
                where: { id: supplierId, accountId },
                select: { id: true }
            });
            if (!supplier) throw new Error('Supplier not found');
        }

        if (!items || items.length === 0) return;

        const productIds = [...new Set(items.map(i => i.productId).filter(Boolean) as string[])];
        const supplierItemIds = [...new Set(items.map(i => i.supplierItemId).filter(Boolean) as string[])];

        const [validProducts, validSupplierItems] = await Promise.all([
            productIds.length > 0
                ? prisma.wooProduct.findMany({ where: { id: { in: productIds }, accountId }, select: { id: true } })
                : [],
            supplierItemIds.length > 0
                ? prisma.supplierItem.findMany({ where: { id: { in: supplierItemIds }, supplier: { accountId } }, select: { id: true } })
                : []
        ]);

        const validProductSet = new Set(validProducts.map(p => p.id));
        const validSupplierItemSet = new Set(validSupplierItems.map(s => s.id));

        const invalidItem = items.find(item =>
            (item.productId && !validProductSet.has(item.productId)) ||
            (item.supplierItemId && !validSupplierItemSet.has(item.supplierItemId))
        );

        if (invalidItem) {
            throw new Error('One or more PO items are invalid for this account');
        }
    }

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
        status?: string;
    }) {
        if (data.status !== undefined && !VALID_PO_STATUSES.has(data.status)) {
            throw new Error('Invalid Purchase Order status');
        }

        await this.validateOwnershipForPOInputs(accountId, data.supplierId, data.items);

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
                status: data.status || 'DRAFT',
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
        if (data.status !== undefined && !VALID_PO_STATUSES.has(data.status)) {
            throw new Error('Invalid Purchase Order status');
        }

        // Guard: RECEIVED POs restrict status and item updates
        const existing = await prisma.purchaseOrder.findFirst({
            where: { id: poId, accountId },
            select: { status: true }
        });
        if (existing?.status === 'RECEIVED') {
            if (data.status && data.status !== 'RECEIVED' && data.status !== 'DRAFT' && data.status !== 'ORDERED') {
                throw new Error('Cannot edit a RECEIVED Purchase Order status to anything other than DRAFT or ORDERED. Revert first.');
            }
            if (data.items && data.items.length > 0 && data.status !== 'DRAFT' && data.status !== 'ORDERED') {
                throw new Error('Cannot edit items on a RECEIVED Purchase Order. Revert to DRAFT or ORDERED first.');
            }
        }

        await this.validateOwnershipForPOInputs(accountId, data.supplierId, data.items);

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
        if (data.items !== undefined) {
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
            // Bug fix: scope to accountId to prevent cross-account writes
            return prisma.$transaction(async (tx) => {
                // Verify ownership before mutating
                const owned = await tx.purchaseOrder.findFirst({
                    where: { id: poId, accountId },
                    select: { id: true }
                });
                if (!owned) throw new Error('Purchase Order not found or access denied');

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
     * Delete a Purchase Order that is still in DRAFT status.
     * Why guard on DRAFT: ORDERED/RECEIVED POs may have stock applied or
     * supplier acknowledgements — deleting them would leave orphan state.
     */
    async deletePurchaseOrder(accountId: string, poId: string): Promise<void> {
        const existing = await prisma.purchaseOrder.findFirst({
            where: { id: poId, accountId },
            select: { status: true }
        });

        if (!existing) {
            throw new Error('Purchase Order not found');
        }

        if (existing.status !== 'DRAFT') {
            throw new Error('Only DRAFT Purchase Orders can be deleted');
        }

        // Why: PurchaseOrderItem has onDelete: Cascade — Prisma deletes items automatically
        await prisma.purchaseOrder.delete({ where: { id: poId } });
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
        const transactionResult = await prisma.$transaction(async tx => {
            await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`purchase-order:${accountId}:${poId}`}, 0))`;

            const po = await tx.purchaseOrder.findFirst({
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

            if (!po) throw new Error('Purchase Order not found');
            if (po.status === 'RECEIVED') {
                return {
                    skipped: true as const,
                    updated: 0,
                    errors: ['PO is already RECEIVED — stock not applied again'],
                    updatedProductIds: [],
                    syncTargets: []
                };
            }

            const errors: string[] = [];
            const updatedProductIds: string[] = [];
            const syncTargets: Array<{ productWooId: number; variationWooId?: number; stock: number }> = [];
            let updated = 0;
            const variationWooIds = po.items
                .filter(i => i.variationWooId != null && i.product != null)
                .map(i => ({ productId: i.product!.id, wooId: i.variationWooId! }));
            const variationRows = variationWooIds.length > 0
                ? await tx.productVariation.findMany({
                    where: { OR: variationWooIds.map(v => ({ productId: v.productId, wooId: v.wooId })) }
                })
                : [];
            const variationMap = new Map(variationRows.map(v => [`${v.productId}:${v.wooId}`, v]));

            for (const item of po.items) {
                if (!item.productId || !item.product) continue;
                const product = item.product;
                const hasBOM = product.boms?.some(bom => bom.items.length > 0) ?? false;
                if (hasBOM) {
                    Logger.warn('Skipped stock update for BOM product', { productId: product.id, productName: product.name });
                    errors.push(`${product.name} is a BOM product - stock not updated`);
                    continue;
                }

                let newStock: number;
                if (item.variationWooId != null) {
                    const variation = variationMap.get(`${product.id}:${item.variationWooId}`);
                    if (!variation) {
                        Logger.error('Variation not found locally for stock receive', {
                            productId: product.id,
                            variationWooId: item.variationWooId
                        });
                        errors.push(`${item.name}: Variation ${item.variationWooId} not found locally — sync products first`);
                        continue;
                    }
                    const rows = await tx.$queryRaw<Array<{ stock_quantity: number }>>`
                        UPDATE "ProductVariation"
                        SET "stockQuantity" = COALESCE("stockQuantity", 0) + ${item.quantity},
                            "manageStock" = true,
                            "stockStatus" = CASE WHEN COALESCE("stockQuantity", 0) + ${item.quantity} > 0
                                                 THEN 'instock' ELSE 'outofstock' END
                        WHERE "id" = ${variation.id}
                        RETURNING "stockQuantity" AS stock_quantity
                    `;
                    if (!rows[0]) throw new Error(`Variation ${item.variationWooId} disappeared during stock receive`);
                    newStock = rows[0].stock_quantity;
                    syncTargets.push({ productWooId: product.wooId, variationWooId: item.variationWooId, stock: newStock });
                } else {
                    const productRaw = product.rawData as any;
                    const isVariable = productRaw?.type?.includes('variable') || productRaw?.variations?.length > 0;
                    if (isVariable) {
                        errors.push(`${product.name}: Cannot set stock on variable parent — specify a variation`);
                        continue;
                    }
                    const rows = await tx.$queryRaw<Array<{ stock_quantity: number }>>`
                        UPDATE "WooProduct"
                        SET "stockQuantity" = COALESCE("stockQuantity", 0) + ${item.quantity},
                            "manageStock" = true,
                            "stockStatus" = CASE WHEN COALESCE("stockQuantity", 0) + ${item.quantity} > 0
                                                 THEN 'instock' ELSE 'outofstock' END
                        WHERE "id" = ${product.id}
                        RETURNING "stockQuantity" AS stock_quantity
                    `;
                    if (!rows[0]) throw new Error(`Product ${product.id} disappeared during stock receive`);
                    newStock = rows[0].stock_quantity;
                    syncTargets.push({ productWooId: product.wooId, stock: newStock });
                }

                updated++;
                updatedProductIds.push(product.id);
                Logger.info('Stock received for PO item', {
                    productId: product.id,
                    itemName: item.name,
                    quantity: item.quantity,
                    variationWooId: item.variationWooId,
                    newStock
                });
            }

            await tx.purchaseOrder.update({ where: { id: poId }, data: { status: 'RECEIVED' } });
            return { skipped: false as const, updated, errors, updatedProductIds, syncTargets };
        });

        if (transactionResult.skipped) {
            Logger.warn('receiveStock called on already-RECEIVED PO, skipping', { poId });
            return transactionResult;
        }

        const { updated, errors, updatedProductIds, syncTargets } = transactionResult;
        const wooSyncTasks: Array<() => Promise<void>> = [];
        let wooService: WooService | null = null;
        try {
            wooService = await WooService.forAccount(accountId);
        } catch (err) {
            Logger.warn('Unable to connect to WooCommerce for stock sync', { error: err, accountId });
        }
        if (wooService) {
            for (const target of syncTargets) {
                const woo = wooService;
                wooSyncTasks.push(() => target.variationWooId != null
                    ? wooRetry(() => woo.updateProductVariation(target.productWooId, target.variationWooId!, {
                        manage_stock: true,
                        stock_quantity: target.stock
                    }), `receive variation ${target.variationWooId} on product ${target.productWooId}`)
                    : wooRetry(() => woo.updateProduct(target.productWooId, {
                        manage_stock: true,
                        stock_quantity: target.stock
                    }), `receive product ${target.productWooId}`));
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
        const transactionResult = await prisma.$transaction(async tx => {
            await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`purchase-order:${accountId}:${poId}`}, 0))`;

            const po = await tx.purchaseOrder.findFirst({
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
            if (po?.status !== 'RECEIVED') {
                return {
                    skipped: true as const,
                    status: po?.status,
                    updated: 0,
                    errors: ['PO is not RECEIVED — nothing to unreceive'],
                    updatedProductIds: [],
                    syncTargets: []
                };
            }

            const errors: string[] = [];
            const updatedProductIds: string[] = [];
            const syncTargets: Array<{ productWooId: number; variationWooId?: number; stock: number }> = [];
            let updated = 0;
            const variationWooIds = po.items
                .filter(i => i.variationWooId != null && i.product != null)
                .map(i => ({ productId: i.product!.id, wooId: i.variationWooId! }));
            const variationRows = variationWooIds.length > 0
                ? await tx.productVariation.findMany({
                    where: { OR: variationWooIds.map(v => ({ productId: v.productId, wooId: v.wooId })) }
                })
                : [];
            const variationMap = new Map(variationRows.map(v => [`${v.productId}:${v.wooId}`, v]));

            for (const item of po.items) {
                if (!item.productId || !item.product) continue;
                const product = item.product;
                if (product.boms?.some(bom => bom.items.length > 0)) continue;

                let newStock: number;
                if (item.variationWooId != null) {
                    const variation = variationMap.get(`${product.id}:${item.variationWooId}`);
                    if (!variation) {
                        errors.push(`${item.name}: Variation ${item.variationWooId} not found locally — sync products first`);
                        continue;
                    }
                    const rows = await tx.$queryRaw<Array<{ stock_quantity: number }>>`
                        UPDATE "ProductVariation"
                        SET "stockQuantity" = COALESCE("stockQuantity", 0) - ${item.quantity},
                            "stockStatus" = CASE WHEN COALESCE("stockQuantity", 0) - ${item.quantity} > 0
                                                 THEN 'instock' ELSE 'outofstock' END
                        WHERE "id" = ${variation.id}
                        RETURNING "stockQuantity" AS stock_quantity
                    `;
                    if (!rows[0]) throw new Error(`Variation ${item.variationWooId} disappeared during stock unreceive`);
                    newStock = rows[0].stock_quantity;
                    syncTargets.push({ productWooId: product.wooId, variationWooId: item.variationWooId, stock: newStock });
                } else {
                    const productRaw = product.rawData as any;
                    const isVariable = productRaw?.type?.includes('variable') || productRaw?.variations?.length > 0;
                    if (isVariable) {
                        errors.push(`${product.name}: Cannot reverse stock on variable parent — specify a variation`);
                        continue;
                    }
                    const rows = await tx.$queryRaw<Array<{ stock_quantity: number }>>`
                        UPDATE "WooProduct"
                        SET "stockQuantity" = COALESCE("stockQuantity", 0) - ${item.quantity},
                            "stockStatus" = CASE WHEN COALESCE("stockQuantity", 0) - ${item.quantity} > 0
                                                 THEN 'instock' ELSE 'outofstock' END
                        WHERE "id" = ${product.id}
                        RETURNING "stockQuantity" AS stock_quantity
                    `;
                    if (!rows[0]) throw new Error(`Product ${product.id} disappeared during stock unreceive`);
                    newStock = rows[0].stock_quantity;
                    syncTargets.push({ productWooId: product.wooId, stock: newStock });
                }

                updated++;
                updatedProductIds.push(product.id);
                Logger.info('Stock unreceived for item', {
                    productId: product.id,
                    itemName: item.name,
                    quantity: item.quantity,
                    variationWooId: item.variationWooId,
                    newStock
                });
            }

            await tx.purchaseOrder.update({ where: { id: poId }, data: { status: 'ORDERED' } });
            return { skipped: false as const, status: po.status, updated, errors, updatedProductIds, syncTargets };
        });

        if (transactionResult.skipped) {
            Logger.warn('unreceiveStock called on non-RECEIVED PO, skipping', { poId, status: transactionResult.status });
            return transactionResult;
        }

        const { updated, errors, updatedProductIds, syncTargets } = transactionResult;
        const wooSyncTasks: Array<() => Promise<void>> = [];
        let wooService: WooService | null = null;
        try {
            wooService = await WooService.forAccount(accountId);
        } catch (err) {
            Logger.warn('Unable to connect to WooCommerce for stock unreceive', { error: err, accountId });
        }
        if (wooService) {
            for (const target of syncTargets) {
                const woo = wooService;
                wooSyncTasks.push(() => target.variationWooId != null
                    ? wooRetry(() => woo.updateProductVariation(target.productWooId, target.variationWooId!, {
                        stock_quantity: target.stock
                    }), `unreceive variation ${target.variationWooId} on product ${target.productWooId}`)
                    : wooRetry(() => woo.updateProduct(target.productWooId, {
                        stock_quantity: target.stock
                    }), `unreceive product ${target.productWooId}`));
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

        Logger.info('PO status transitioned to ORDERED after unreceive', { poId, updated, errorCount: errors.length });

        return { updated, errors, updatedProductIds };
    }
}
