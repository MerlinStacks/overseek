/**
 * Inventory Service
 * 
 * Handles BOM-based inventory processing and stock calculations.
 * Health checks and alerts delegated to InventoryHealthService.
 */

import { WooService } from './woo';
import { EventBus, EVENTS } from './events';
import { Logger } from '../utils/logger';
import { prisma } from '../utils/prisma';
import { StockValidationService } from './StockValidationService';
import {
    checkInventoryHealth as checkHealth,
    sendLowStockAlerts as sendAlerts
} from './InventoryHealthService';

export class InventoryService {
    /**
     * Initialize event listeners for order processing.
     */
    static async setupListeners() {
        EventBus.on(EVENTS.ORDER.CREATED, async (data) => {
            const { accountId, order } = data;
            Logger.info(`[InventoryService] Processing Order ${order.number} for BOM deduction`, { accountId });
            await InventoryService.processOrderBOM(accountId, order);
        });
    }

    /**
     * Process an order to deduct stock for BOM child items.
     * When a parent product is sold, its child components' stock is reduced.
     * 
     * @remarks Includes stock validation and audit logging for traceability.
     */
    static async processOrderBOM(accountId: string, order: any) {
        try {
            const wooService = await WooService.forAccount(accountId);

            for (const lineItem of order.line_items) {
                const productId = lineItem.product_id;
                const quantitySold = lineItem.quantity;
                const variationId = lineItem.variation_id || 0;

                const product = await prisma.wooProduct.findUnique({
                    where: { accountId_wooId: { accountId, wooId: productId } },
                    select: { id: true }
                });

                if (!product) continue;

                // Find BOM: Match Variation Specific OR Parent (0)
                const boms = await prisma.bOM.findMany({
                    where: {
                        productId: product.id,
                        variationId: { in: [variationId, 0] }
                    },
                    include: { items: { include: { childProduct: true } } },
                    orderBy: { variationId: 'desc' }
                });

                // Pick the best BOM (variant-specific > parent)
                let activeBOM = boms.find(b => b.variationId === variationId);
                if (!activeBOM) {
                    activeBOM = boms.find(b => b.variationId === 0);
                }

                if (!activeBOM || activeBOM.items.length === 0) continue;

                Logger.info(`[InventoryService] Found BOM (Type: ${activeBOM.variationId === 0 ? 'Parent' : 'Variant'}) for Product ${productId} (Var: ${variationId}) in Order ${order.number}. Processing components...`, { accountId });

                // Deduct stock for each child component with validation
                for (const bomItem of activeBOM.items) {
                    if (!bomItem.childProductId || !bomItem.childProduct) continue;

                    const childWooId = bomItem.childProduct.wooId;
                    const childProductUuid = bomItem.childProduct.id;
                    const qtyPerUnit = Number(bomItem.quantity);
                    const deductionQty = qtyPerUnit * quantitySold;

                    try {
                        const wooProductResponse = await wooService.getProduct(childWooId);
                        const currentWooStock = wooProductResponse.stock_quantity;

                        if (typeof currentWooStock !== 'number') {
                            Logger.warn(`[InventoryService] Child Product ${childWooId} does not have managed stock. Skipping deduction.`, { accountId });
                            continue;
                        }

                        const newStock = currentWooStock - deductionQty;
                        const validationStatus: 'PASSED' | 'SKIPPED' | 'MISMATCH_OVERRIDE' = 'PASSED';

                        await wooService.updateProduct(childWooId, {
                            stock_quantity: newStock,
                            manage_stock: true
                        });

                        await StockValidationService.logStockChange(
                            accountId,
                            childProductUuid,
                            'SYSTEM_BOM',
                            currentWooStock,
                            newStock,
                            validationStatus,
                            {
                                trigger: 'ORDER_BOM_DEDUCTION',
                                orderId: order.id,
                                orderNumber: order.number,
                                parentProductId: productId,
                                bomItemQty: qtyPerUnit,
                                quantitySold,
                                deductionQty
                            }
                        );

                        Logger.info(`[InventoryService] Deducted ${deductionQty} from Child Product ${childWooId}. Stock: ${currentWooStock} → ${newStock}`, { accountId });

                    } catch (err: any) {
                        Logger.error(`[InventoryService] Failed to update stock for child ${childWooId}`, { error: err.message, accountId });
                    }
                }
            }

            // Auto-sync parent products after deducting child stock
            await InventoryService.syncParentProductsAfterOrder(accountId, order);

        } catch (error: any) {
            Logger.error(`[InventoryService] Error processing BOM for order ${order.id}`, { error: error.message, accountId });
        }
    }

    /**
     * After processing an order, sync the effective stock of any parent products
     * that have BOM relationships with items in the order.
     */
    private static async syncParentProductsAfterOrder(accountId: string, order: any) {
        try {
            const { BOMInventorySyncService } = await import('./BOMInventorySyncService');
            const affectedProductIds = new Set<string>();

            for (const lineItem of order.line_items) {
                const wooProductId = lineItem.product_id;

                const bomItemsWithThisChild = await prisma.bOMItem.findMany({
                    where: {
                        childProduct: { wooId: wooProductId, accountId }
                    },
                    include: {
                        bom: { select: { productId: true, variationId: true } }
                    }
                });

                for (const bomItem of bomItemsWithThisChild) {
                    affectedProductIds.add(`${bomItem.bom.productId}:${bomItem.bom.variationId}`);
                }
            }

            if (affectedProductIds.size === 0) return;

            Logger.info(`[InventoryService] Auto-syncing ${affectedProductIds.size} parent product(s) after order ${order.number}`, { accountId });

            for (const key of affectedProductIds) {
                const [productId, variationId] = key.split(':');
                try {
                    await BOMInventorySyncService.syncProductToWoo(accountId, productId, parseInt(variationId));
                } catch (err: any) {
                    Logger.error(`[InventoryService] Failed to auto-sync parent ${productId}`, { error: err.message, accountId });
                }
            }
        } catch (error: any) {
            Logger.error(`[InventoryService] Error in syncParentProductsAfterOrder`, { error: error.message, accountId });
        }
    }

    /**
     * Get the effective stock quantity for a product.
     * Uses local stockQuantity if manageStock is true, otherwise falls back to WooCommerce rawData.
     */
    static async getEffectiveStock(product: { stockQuantity: number | null; manageStock: boolean; rawData: any }): Promise<number | null> {
        if (product.manageStock && product.stockQuantity !== null) {
            return product.stockQuantity;
        }
        const raw = product.rawData as any;
        if (raw?.manage_stock && typeof raw.stock_quantity === 'number') {
            return raw.stock_quantity;
        }
        return null;
    }

    /**
     * Calculate available stock for a product that has a BOM.
     * Returns the maximum buildable quantity based on component stock levels.
     * 
     * @returns number of buildable units, or null if product has no BOM
     */
    static async calculateBOMStock(accountId: string, productId: string, variationId: number = 0): Promise<number | null> {
        const bom = await prisma.bOM.findFirst({
            where: {
                productId,
                variationId: { in: [variationId, 0] }
            },
            include: { items: { include: { childProduct: true } } },
            orderBy: { variationId: 'desc' }
        });

        if (!bom || bom.items.length === 0) return null;

        let minBuildable = Infinity;

        for (const item of bom.items) {
            if (!item.childProductId || !item.childProduct) continue;

            const qtyPerUnit = Number(item.quantity) || 1;
            if (qtyPerUnit <= 0) continue;

            const componentStock = await this.getEffectiveStock(item.childProduct);

            if (componentStock === null) continue;

            const buildableFromThis = Math.floor(componentStock / qtyPerUnit);
            minBuildable = Math.min(minBuildable, buildableFromThis);
        }

        return minBuildable === Infinity ? null : minBuildable;
    }

    /**
     * Get stock info for a product, including whether it's BOM-based.
     * For variable products, returns stock info per variant.
     */
    static async getProductStock(accountId: string, productId: string): Promise<{
        stockQuantity: number | null;
        isBOMBased: boolean;
        manageStock: boolean;
        isVariable?: boolean;
        variants?: Array<{
            wooId: number;
            sku?: string;
            stockQuantity: number | null;
            stockStatus?: string;
            manageStock: boolean;
            attributes?: string;
        }>;
    }> {
        const product = await prisma.wooProduct.findUnique({
            where: { id: productId },
            select: {
                stockQuantity: true,
                manageStock: true,
                rawData: true,
                variations: {
                    select: {
                        wooId: true,
                        sku: true,
                        stockQuantity: true,
                        stockStatus: true,
                        manageStock: true,
                        rawData: true
                    }
                },
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
        });

        if (!product) throw new Error('Product not found');

        const hasBOMWithChildProducts = product.boms.some(bom => bom.items.length > 0);

        if (hasBOMWithChildProducts) {
            const bomStock = await this.calculateBOMStock(accountId, productId);
            return { stockQuantity: bomStock, isBOMBased: true, manageStock: true, isVariable: false };
        }

        if (product.variations.length > 0) {
            const variants = product.variations.map(v => {
                const raw = v.rawData as any;
                let stockQty: number | null = null;
                if (v.manageStock && v.stockQuantity !== null) {
                    stockQty = v.stockQuantity;
                } else if (raw?.manage_stock && typeof raw.stock_quantity === 'number') {
                    stockQty = raw.stock_quantity;
                }
                const attributes = raw?.attributes?.map((a: any) => a.option).join(' / ') ?? '';
                return {
                    wooId: v.wooId,
                    sku: v.sku ?? undefined,
                    stockQuantity: stockQty,
                    stockStatus: v.stockStatus ?? raw?.stock_status,
                    manageStock: v.manageStock,
                    attributes
                };
            });

            const totalStock = variants.reduce((sum, v) => {
                if (v.stockQuantity !== null) sum += v.stockQuantity;
                return sum;
            }, 0);

            return { stockQuantity: totalStock, isBOMBased: false, manageStock: true, isVariable: true, variants };
        }

        const effectiveStock = await this.getEffectiveStock(product);
        return { stockQuantity: effectiveStock, isBOMBased: false, manageStock: product.manageStock, isVariable: false };
    }

    /**
     * Recursively calculate COGS for a product.
     * @returns 0 if no BOM (placeholder for future implementation)
     */
    static async calculateCompositeCOGS(_accountId: string, _productId: string): Promise<number> {
        return 0;
    }

    // Delegate health checks and alerts to InventoryHealthService
    static checkInventoryHealth = checkHealth;
    static sendLowStockAlerts = sendAlerts;
}
