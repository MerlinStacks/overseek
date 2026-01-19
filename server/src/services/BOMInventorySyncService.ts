/**
 * BOM Inventory Sync Service
 * 
 * Calculates effective inventory for parent products based on child component stock
 * and syncs the result to WooCommerce.
 * 
 * When products are linked via BOM, the parent's available inventory is limited by
 * the bottleneck child component: MIN(child stock / required qty per unit).
 */

import { WooService } from './woo';
import { Logger } from '../utils/logger';
import { prisma } from '../utils/prisma';
import { StockValidationService } from './StockValidationService';

interface EffectiveStockResult {
    productId: string;
    wooId: number;
    effectiveStock: number;
    currentWooStock: number | null;
    needsSync: boolean;
    components: {
        childProductId: string;
        childName: string;
        childWooId: number;
        requiredQty: number;
        childStock: number;
        buildableUnits: number;
    }[];
}

interface SyncResult {
    success: boolean;
    productId: string;
    wooId: number;
    previousStock: number | null;
    newStock: number;
    error?: string;
}

export class BOMInventorySyncService {
    /**
     * Calculate the effective stock (max buildable units) for a product based on its BOM.
     * Returns null if the product has no BOM or no child products.
     */
    static async calculateEffectiveStock(
        accountId: string,
        productId: string,
        variationId: number = 0
    ): Promise<EffectiveStockResult | null> {
        const wooService = await WooService.forAccount(accountId);

        // Get the product details
        const product = await prisma.wooProduct.findUnique({
            where: { id: productId },
            select: { id: true, wooId: true, name: true, rawData: true }
        });

        if (!product) {
            Logger.warn(`[BOMInventorySync] Product ${productId} not found`, { accountId });
            return null;
        }

        // Find the BOM for this product/variation
        const bom = await prisma.bOM.findUnique({
            where: {
                productId_variationId: { productId, variationId }
            },
            include: {
                items: {
                    where: { childProductId: { not: null } },
                    include: {
                        childProduct: {
                            select: { id: true, wooId: true, name: true }
                        },
                        childVariation: {
                            select: { wooId: true, sku: true, stockQuantity: true }
                        }
                    }
                }
            }
        });

        // No BOM or no child product items
        if (!bom || bom.items.length === 0) {
            return null;
        }

        // Get current WooCommerce stock for parent product
        let currentWooStock: number | null = null;
        try {
            const wooProduct = await wooService.getProduct(product.wooId);
            currentWooStock = wooProduct.stock_quantity ?? null;
        } catch (err) {
            Logger.warn(`[BOMInventorySync] Could not fetch parent product stock`, {
                productId,
                wooId: product.wooId,
                error: err
            });
        }

        // Calculate effective stock based on each child component
        const components: EffectiveStockResult['components'] = [];
        let minBuildableUnits = Infinity;

        for (const bomItem of bom.items) {
            if (!bomItem.childProduct) continue;

            const requiredQty = Number(bomItem.quantity);
            if (requiredQty <= 0) continue;

            try {
                let childStock = 0;
                let childWooId = bomItem.childProduct.wooId;
                let childName = bomItem.childProduct.name;

                // Check if this is a variant component
                if (bomItem.childVariationId && bomItem.childVariation) {
                    childWooId = bomItem.childVariation.wooId;
                    childName = `${childName} (Variant ${bomItem.childVariation.sku || '#' + childWooId})`;

                    // Fetch variant stock from WooCommerce, fallback to local data
                    try {
                        const variant = await wooService.getProduct(childWooId);
                        childStock = variant.stock_quantity ?? 0;
                    } catch {
                        // Fallback to local data if live fetch fails
                        childStock = bomItem.childVariation.stockQuantity ?? 0;
                    }
                } else {
                    // Standard product component
                    try {
                        const childWooProduct = await wooService.getProduct(childWooId);
                        childStock = childWooProduct.stock_quantity ?? 0;
                    } catch {
                        // Fallback to local stockQuantity from DB if WooCommerce API fails
                        const localProduct = await prisma.wooProduct.findUnique({
                            where: { id: bomItem.childProduct.id },
                            select: { stockQuantity: true }
                        });
                        childStock = localProduct?.stockQuantity ?? 0;
                        Logger.warn(`[BOMInventorySync] Using local stock for child product`, {
                            accountId,
                            childWooId,
                            localStock: childStock
                        });
                    }
                }

                // Calculate buildable units from this component
                const buildableUnits = Math.floor(childStock / requiredQty);

                components.push({
                    childProductId: bomItem.childProduct.id,
                    childName: bomItem.childProduct.name,
                    childWooId: bomItem.childProduct.wooId,
                    requiredQty,
                    childStock,
                    buildableUnits
                });

                // Track the minimum (bottleneck)
                if (buildableUnits < minBuildableUnits) {
                    minBuildableUnits = buildableUnits;
                }

            } catch (err) {
                Logger.error(`[BOMInventorySync] Failed to process child product in BOM`, {
                    accountId,
                    childProductId: bomItem.childProduct.id,
                    childWooId: bomItem.childProduct.wooId,
                    error: err
                });
                // Continue processing other components instead of failing entirely
                continue;
            }
        }

        // If no valid components found
        if (components.length === 0 || minBuildableUnits === Infinity) {
            return null;
        }

        const effectiveStock = minBuildableUnits;
        // Only sync if stocks differ. Handle null case: if we can't fetch current stock, skip sync.
        const needsSync = currentWooStock !== null && Number(currentWooStock) !== Number(effectiveStock);

        return {
            productId: product.id,
            wooId: product.wooId,
            effectiveStock,
            currentWooStock,
            needsSync,
            components
        };
    }

    /**
     * Sync a single product's inventory to WooCommerce based on BOM calculation.
     */
    static async syncProductToWoo(
        accountId: string,
        productId: string,
        variationId: number = 0
    ): Promise<SyncResult> {
        const calculation = await this.calculateEffectiveStock(accountId, productId, variationId);

        if (!calculation) {
            return {
                success: false,
                productId,
                wooId: 0,
                previousStock: null,
                newStock: 0,
                error: 'Product has no BOM or calculation failed'
            };
        }

        if (!calculation.needsSync) {
            Logger.info(`[BOMInventorySync] Product ${productId} already in sync (stock: ${calculation.effectiveStock})`, { accountId });
            return {
                success: true,
                productId: calculation.productId,
                wooId: calculation.wooId,
                previousStock: calculation.currentWooStock,
                newStock: calculation.effectiveStock
            };
        }

        try {
            const wooService = await WooService.forAccount(accountId);

            // For variations (variationId > 0), we need to update via the variation endpoint
            // For main products (variationId = 0), update the product directly
            if (variationId > 0) {
                // Get the parent product's wooId to construct the variation endpoint
                const parentProduct = await prisma.wooProduct.findUnique({
                    where: { id: productId },
                    select: { wooId: true }
                });

                if (!parentProduct) {
                    throw new Error('Parent product not found');
                }

                // Update variation stock via WooCommerce variations API
                await wooService.updateProductVariation(parentProduct.wooId, variationId, {
                    stock_quantity: calculation.effectiveStock,
                    manage_stock: true
                });
            } else {
                // Update main product stock
                await wooService.updateProduct(calculation.wooId, {
                    stock_quantity: calculation.effectiveStock,
                    manage_stock: true
                });
            }

            // Log the stock change for audit trail
            await StockValidationService.logStockChange(
                accountId,
                calculation.productId,
                'SYSTEM_BOM',
                calculation.currentWooStock ?? 0,
                calculation.effectiveStock,
                'PASSED',
                {
                    trigger: 'BOM_INVENTORY_SYNC',
                    variationId,
                    components: calculation.components.map(c => ({
                        childWooId: c.childWooId,
                        requiredQty: c.requiredQty,
                        childStock: c.childStock,
                        buildableUnits: c.buildableUnits
                    }))
                }
            );

            Logger.info(`[BOMInventorySync] Synced product ${productId} to WooCommerce. Stock: ${calculation.currentWooStock} → ${calculation.effectiveStock}`, { accountId });

            return {
                success: true,
                productId: calculation.productId,
                wooId: calculation.wooId,
                previousStock: calculation.currentWooStock,
                newStock: calculation.effectiveStock
            };

        } catch (err: any) {
            Logger.error(`[BOMInventorySync] Failed to sync product to WooCommerce`, {
                accountId,
                productId,
                wooId: calculation.wooId,
                error: err.message
            });

            return {
                success: false,
                productId: calculation.productId,
                wooId: calculation.wooId,
                previousStock: calculation.currentWooStock,
                newStock: calculation.effectiveStock,
                error: err.message
            };
        }
    }

    /**
     * Sync all BOM parent products for an account to WooCommerce.
     */
    static async syncAllBOMProducts(accountId: string): Promise<{
        total: number;
        synced: number;
        skipped: number;
        failed: number;
        results: SyncResult[];
    }> {
        // Find all BOMs with child product items for this account
        const bomsWithChildProducts = await prisma.bOM.findMany({
            where: {
                product: { accountId },
                items: {
                    some: { childProductId: { not: null } }
                }
            },
            select: {
                productId: true,
                variationId: true
            }
        });

        const results: SyncResult[] = [];
        let synced = 0;
        let skipped = 0;
        let failed = 0;

        for (const bom of bomsWithChildProducts) {
            const result = await this.syncProductToWoo(accountId, bom.productId, bom.variationId);
            results.push(result);

            if (result.success) {
                if (result.previousStock === result.newStock) {
                    skipped++;
                } else {
                    synced++;
                }
            } else {
                failed++;
            }
        }

        Logger.info(`[BOMInventorySync] Bulk sync complete`, {
            accountId,
            total: bomsWithChildProducts.length,
            synced,
            skipped,
            failed
        });

        return {
            total: bomsWithChildProducts.length,
            synced,
            skipped,
            failed,
            results
        };
    }
}
