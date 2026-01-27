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

/**
 * Retry wrapper for database operations to handle transient DNS errors.
 * Docker's internal DNS can intermittently fail with EAI_AGAIN.
 */
async function withDbRetry<T>(
    operation: () => Promise<T>,
    options: { maxRetries?: number; delayMs?: number; context?: string } = {}
): Promise<T> {
    const { maxRetries = 3, delayMs = 500, context = 'DB operation' } = options;
    let lastError: Error | null = null;

    for (let attempt = 1; attempt <= maxRetries; attempt++) {
        try {
            return await operation();
        } catch (err: any) {
            lastError = err;
            const isRetryable = err.message?.includes('EAI_AGAIN') ||
                err.message?.includes('ECONNREFUSED') ||
                err.message?.includes('ETIMEDOUT') ||
                err.code === 'EAI_AGAIN';

            if (isRetryable && attempt < maxRetries) {
                Logger.warn(`[withDbRetry] ${context} failed (attempt ${attempt}/${maxRetries}), retrying...`, {
                    error: err.message
                });
                await new Promise(res => setTimeout(res, delayMs * attempt));
            } else {
                throw err;
            }
        }
    }

    throw lastError;
}

interface EffectiveStockResult {
    productId: string;
    wooId: number;
    effectiveStock: number;
    currentWooStock: number | null;
    needsSync: boolean;
    /** True if we couldn't fetch current stock from WooCommerce */
    couldNotFetchStock?: boolean;
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
    /** True if we updated local DB to match WooCommerce (stock already correct) */
    localDbUpdated?: boolean;
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

        // Get the product details (with retry for transient DNS errors)
        const product = await withDbRetry(
            () => prisma.wooProduct.findUnique({
                where: { id: productId },
                select: { id: true, wooId: true, name: true, rawData: true }
            }),
            { context: 'Get product for BOM sync' }
        );

        if (!product) {
            Logger.warn(`[BOMInventorySync] Product ${productId} not found`, { accountId });
            return null;
        }

        // Find the BOM for this product/variation (with retry for transient DNS errors)
        const bom = await withDbRetry(
            () => prisma.bOM.findUnique({
                where: {
                    productId_variationId: { productId, variationId }
                },
                include: {
                    items: {
                        where: {
                            OR: [
                                { childProductId: { not: null } },
                                { internalProductId: { not: null } }
                            ]
                        },
                        include: {
                            childProduct: {
                                select: { id: true, wooId: true, name: true }
                            },
                            childVariation: {
                                select: { wooId: true, sku: true, stockQuantity: true }
                            },
                            internalProduct: {
                                select: { id: true, name: true, stockQuantity: true }
                            }
                        }
                    }
                }
            }),
            { context: 'Get BOM for sync' }
        );

        // No BOM or no child product items
        if (!bom || bom.items.length === 0) {
            Logger.debug(`[BOMInventorySync] No BOM/items for product`, {
                accountId,
                productId,
                variationId,
                productName: product.name,
                bomFound: !!bom,
                itemCount: bom?.items.length ?? 0
            });
            return null;
        }

        // Get current WooCommerce stock for the target (variation or parent product)
        let currentWooStock: number | null = null;
        try {
            if (variationId > 0) {
                // For variations, fetch the specific variation's stock via the variations endpoint
                const variations = await wooService.getProductVariations(product.wooId);
                const targetVariation = variations.find((v: any) => v.id === variationId);
                currentWooStock = targetVariation?.stock_quantity ?? null;

                if (!targetVariation) {
                    Logger.warn(`[BOMInventorySync] Variation ${variationId} not found on parent product`, {
                        productId,
                        parentWooId: product.wooId,
                        variationId
                    });
                }
            } else {
                // For main products, fetch the product directly
                const wooProduct = await wooService.getProduct(product.wooId);
                currentWooStock = wooProduct.stock_quantity ?? null;
            }
        } catch (err) {
            Logger.warn(`[BOMInventorySync] Could not fetch product/variation stock`, {
                productId,
                wooId: product.wooId,
                variationId,
                error: err
            });
        }

        // Calculate effective stock based on each child component
        const components: EffectiveStockResult['components'] = [];
        let minBuildableUnits = Infinity;

        for (const bomItem of bom.items) {
            const requiredQty = Number(bomItem.quantity);
            if (requiredQty <= 0) continue;

            let childStock = 0;
            let childName = '';
            let childProductId = '';
            let childWooId = 0;

            try {
                // Handle internal product components (priority check)
                if (bomItem.internalProductId && bomItem.internalProduct) {
                    childStock = bomItem.internalProduct.stockQuantity;
                    childName = `[Internal] ${bomItem.internalProduct.name}`;
                    childProductId = bomItem.internalProductId;
                    childWooId = 0; // Internal products have no WooCommerce ID
                }
                // Handle WooCommerce product components
                else if (bomItem.childProduct) {
                    childProductId = bomItem.childProduct.id;
                    childWooId = bomItem.childProduct.wooId;
                    childName = bomItem.childProduct.name;

                    // Check if this is a variant component
                    if (bomItem.childVariationId && bomItem.childVariation) {
                        childWooId = bomItem.childVariation.wooId;
                        childName = `${childName} (Variant ${bomItem.childVariation.sku || '#' + childWooId})`;

                        // Fetch variant stock from WooCommerce via parent's variations endpoint
                        // Note: WooCommerce variations require /products/{parentId}/variations endpoint
                        try {
                            const parentWooId = bomItem.childProduct.wooId;
                            const variations = await wooService.getProductVariations(parentWooId);
                            const targetVariation = variations.find((v: any) => v.id === childWooId);
                            childStock = targetVariation?.stock_quantity ?? bomItem.childVariation.stockQuantity ?? 0;

                            if (!targetVariation) {
                                Logger.warn(`[BOMInventorySync] Variation ${childWooId} not found in parent ${parentWooId}`, { accountId });
                            }
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
                } else {
                    // No valid component, skip
                    continue;
                }

                // Calculate buildable units from this component
                const buildableUnits = Math.floor(childStock / requiredQty);

                components.push({
                    childProductId,
                    childName,
                    childWooId,
                    requiredQty,
                    childStock,
                    buildableUnits
                });

                // Track the minimum (bottleneck)
                if (buildableUnits < minBuildableUnits) {
                    minBuildableUnits = buildableUnits;
                }

            } catch (err) {
                Logger.error(`[BOMInventorySync] Failed to process component in BOM`, {
                    accountId,
                    childProductId: childProductId || bomItem.childProductId || bomItem.internalProductId,
                    childWooId,
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

        // Sync is needed if:
        // 1. We couldn't fetch current stock (null) - force sync to set it
        // 2. Or if stocks differ
        const couldNotFetchStock = currentWooStock === null;
        const needsSync = couldNotFetchStock || Number(currentWooStock) !== Number(effectiveStock);

        return {
            productId: product.id,
            wooId: product.wooId,
            effectiveStock,
            currentWooStock,
            needsSync,
            couldNotFetchStock,
            components
        };
    }

    /**
     * Fast, local-only calculation of effective stock using only database data.
     * No WooCommerce API calls - suitable for display endpoints that need speed.
     * Returns null if the product has no BOM or no child products/internal products.
     */
    static async calculateEffectiveStockLocal(
        productId: string,
        variationId: number = 0
    ): Promise<EffectiveStockResult | null> {
        // Get the product details with stock from rawData
        const product = await prisma.wooProduct.findUnique({
            where: { id: productId },
            select: { id: true, wooId: true, name: true, rawData: true, stockQuantity: true }
        });

        if (!product) {
            return null;
        }

        // Find the BOM with all child products, variations, and internal products
        const bom = await prisma.bOM.findUnique({
            where: {
                productId_variationId: { productId, variationId }
            },
            include: {
                items: {
                    where: {
                        OR: [
                            { childProductId: { not: null } },
                            { internalProductId: { not: null } }
                        ]
                    },
                    include: {
                        childProduct: {
                            select: { id: true, wooId: true, name: true, stockQuantity: true, rawData: true }
                        },
                        childVariation: {
                            select: { wooId: true, sku: true, stockQuantity: true }
                        },
                        internalProduct: {
                            select: { id: true, name: true, stockQuantity: true }
                        }
                    }
                }
            }
        });

        if (!bom || bom.items.length === 0) {
            return null;
        }

        // Get current stock from local DB
        // For variants, we need to lookup the ProductVariation stock, not the parent
        let currentWooStock: number | null = null;
        if (variationId > 0) {
            // Lookup variant stock from ProductVariation table
            const variation = await prisma.productVariation.findUnique({
                where: {
                    productId_wooId: { productId, wooId: variationId }
                },
                select: { stockQuantity: true, rawData: true }
            });
            if (variation) {
                const varRawData = variation.rawData as any;
                currentWooStock = variation.stockQuantity ?? varRawData?.stock_quantity ?? null;
            }
        } else {
            // For parent products, use the product's stock
            const rawData = product.rawData as any;
            currentWooStock = product.stockQuantity ?? rawData?.stock_quantity ?? null;
        }

        // Calculate effective stock based on each child component using local data only
        const components: EffectiveStockResult['components'] = [];
        let minBuildableUnits = Infinity;

        for (const bomItem of bom.items) {
            const requiredQty = Number(bomItem.quantity);
            if (requiredQty <= 0) continue;

            let childStock = 0;
            let childName = '';
            let childProductId = '';
            let childWooId = 0;

            // Handle internal product components (priority check)
            if (bomItem.internalProductId && bomItem.internalProduct) {
                childStock = bomItem.internalProduct.stockQuantity;
                childName = `[Internal] ${bomItem.internalProduct.name}`;
                childProductId = bomItem.internalProductId;
                childWooId = 0; // Internal products have no WooCommerce ID
            }
            // Handle WooCommerce product components
            else if (bomItem.childProduct) {
                childProductId = bomItem.childProduct.id;
                childWooId = bomItem.childProduct.wooId;
                childName = bomItem.childProduct.name;

                // Check if this is a variant component
                if (bomItem.childVariationId && bomItem.childVariation) {
                    childName = `${childName} (Variant ${bomItem.childVariation.sku || '#' + bomItem.childVariation.wooId})`;
                    childStock = bomItem.childVariation.stockQuantity ?? 0;
                } else {
                    // Standard product - use local stockQuantity or rawData
                    const childRawData = bomItem.childProduct.rawData as any;
                    childStock = bomItem.childProduct.stockQuantity ?? childRawData?.stock_quantity ?? 0;
                }
            } else {
                // No valid component, skip
                continue;
            }

            const buildableUnits = Math.floor(childStock / requiredQty);

            components.push({
                childProductId,
                childName,
                childWooId,
                requiredQty,
                childStock,
                buildableUnits
            });

            if (buildableUnits < minBuildableUnits) {
                minBuildableUnits = buildableUnits;
            }
        }

        if (components.length === 0 || minBuildableUnits === Infinity) {
            return null;
        }

        const effectiveStock = minBuildableUnits;
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

            // Update local DB to match WooCommerce, so UI won't show as "needs sync"
            try {
                if (variationId > 0) {
                    // Update variation stock in local DB
                    await prisma.productVariation.updateMany({
                        where: {
                            wooId: variationId,
                            product: { id: productId }
                        },
                        data: { stockQuantity: calculation.currentWooStock }
                    });
                } else {
                    // Update product stock in local DB
                    await prisma.wooProduct.update({
                        where: { id: productId },
                        data: { stockQuantity: calculation.currentWooStock }
                    });
                }
                Logger.debug(`[BOMInventorySync] Updated local DB stock to match WooCommerce`, {
                    productId, variationId, stock: calculation.currentWooStock
                });
            } catch (dbErr) {
                Logger.warn(`[BOMInventorySync] Failed to update local DB stock`, { error: dbErr });
            }

            return {
                success: true,
                productId: calculation.productId,
                wooId: calculation.wooId,
                previousStock: calculation.currentWooStock,
                newStock: calculation.effectiveStock,
                localDbUpdated: true
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
                    manage_stock: true,
                    stock_status: calculation.effectiveStock > 0 ? 'instock' : 'outofstock'
                });
            } else {
                // Update main product stock
                await wooService.updateProduct(calculation.wooId, {
                    stock_quantity: calculation.effectiveStock,
                    manage_stock: true,
                    stock_status: calculation.effectiveStock > 0 ? 'instock' : 'outofstock'
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
        // Find all BOMs with child product items OR internal product items for this account
        // Wrapped in retry for transient DB errors
        const bomsWithChildProducts = await withDbRetry(
            () => prisma.bOM.findMany({
                where: {
                    product: { accountId },
                    items: {
                        some: {
                            OR: [
                                { childProductId: { not: null } },
                                { internalProductId: { not: null } }
                            ]
                        }
                    }
                },
                select: {
                    productId: true,
                    variationId: true
                }
            }),
            { context: 'Find BOMs for bulk sync' }
        );

        Logger.info(`[BOMInventorySync] Starting bulk sync for ${bomsWithChildProducts.length} products`, { accountId });

        const results: SyncResult[] = [];
        let synced = 0;
        let skipped = 0;
        let failed = 0;

        for (const bom of bomsWithChildProducts) {
            // Wrap each product sync in try/catch so one failure doesn't crash the entire job
            try {
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
            } catch (err: any) {
                Logger.error(`[BOMInventorySync] Uncaught error syncing product ${bom.productId}`, {
                    accountId,
                    productId: bom.productId,
                    variationId: bom.variationId,
                    error: err.message
                });
                failed++;
                results.push({
                    success: false,
                    productId: bom.productId,
                    wooId: 0,
                    previousStock: null,
                    newStock: 0,
                    error: err.message
                });
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
