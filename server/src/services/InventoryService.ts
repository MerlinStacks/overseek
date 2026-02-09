/**
 * Inventory Service
 * 
 * Handles stock calculations and health checks.
 * BOM order processing is handled by BOMConsumptionService via workers.
 */

import { Logger } from '../utils/logger';
import { prisma } from '../utils/prisma';
import {
    checkInventoryHealth as checkHealth,
    sendLowStockAlerts as sendAlerts
} from './InventoryHealthService';

export class InventoryService {
    // Order BOM processing is handled exclusively by BOMConsumptionService
    // via the worker event listener (EVENTS.ORDER.SYNCED) in workers/index.ts.
    // That path provides locking, idempotency guards, rollback, and cascade sync.

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
