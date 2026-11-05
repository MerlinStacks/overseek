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
import type { Prisma } from '@prisma/client';
import { JobLeaseLostError } from './queue/JobLease';
import { bomManifestSchema, targetKey, MAX_BOM_SYNC_TARGETS, type BOMSyncTarget, type BOMSyncCheckpoint } from './bom/BOMSyncCheckpoint';
import { describeBOMFailure } from './bom/BOMFailureReason';
import { assertBOMRepairStockInputs } from './bom/BOMRepairStockGuard';

/** Shared local stock inputs for single-product reads and bulk previews. */
export const localBOMItems = {
    where: {
        isActive: true,
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
            select: { wooId: true, sku: true, stockQuantity: true, rawData: true }
        },
        internalProduct: {
            select: { id: true, name: true, stockQuantity: true }
        }
    }
} satisfies Prisma.BOM$itemsArgs;

type LocalBOM = Prisma.BOMGetPayload<{ include: { items: typeof localBOMItems } }>;
type LocalStock = { stockQuantity: number | null; rawData: Prisma.JsonValue };
type LocalProduct = LocalStock & { id: string; wooId: number };

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
    liveAllowsBackorders?: boolean;
    liveStockStatus?: string;
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
    writeUncertain?: boolean;
}

function allowsBackorders(rawData: any): boolean {
    if (!rawData || typeof rawData !== 'object') return false;
    const backorders = String(rawData.backorders ?? '').toLowerCase();
    return backorders === 'yes' || backorders === 'notify' || rawData.backorders_allowed === true;
}

function getStockStatusForQuantity(quantity: number, allowBackorders: boolean): 'instock' | 'outofstock' | 'onbackorder' {
    if (quantity > 0) return 'instock';
    if (allowBackorders) return 'onbackorder';
    return 'outofstock';
}

function repairTargetMirror(raw: Prisma.JsonValue | undefined, live: Record<string, unknown>): Prisma.InputJsonObject {
    const mirror: Record<string, Prisma.JsonValue> = raw && typeof raw === 'object' && !Array.isArray(raw) ? { ...raw } : {};
    mirror.manage_stock = true;
    mirror.stock_quantity = live.stock_quantity as number;
    for (const field of ['type', 'stock_status', 'backorders']) if (typeof live[field] === 'string') mirror[field] = live[field];
    if (typeof live.backorders_allowed === 'boolean') mirror.backorders_allowed = live.backorders_allowed;
    return mirror;
}

function getWooErrorStatus(error: any): number | undefined {
    return error?.response?.status ?? error?.status;
}

function getWooErrorCode(error: any): string | undefined {
    return error?.response?.data?.code ?? error?.code;
}

function getWooErrorMessage(error: any): string {
    return error?.response?.data?.message ?? error?.message ?? 'Unknown WooCommerce error';
}

function isMissingWooProduct(error: any): boolean {
    return getWooErrorStatus(error) === 404 && getWooErrorCode(error) === 'woocommerce_rest_product_invalid_id';
}

export class BOMInventorySyncService {
    /**
     * Calculate the effective stock (max buildable units) for a product based on its BOM.
     * Returns null if the product has no BOM or no child products.
     */
    static async calculateEffectiveStock(
        accountId: string,
        productId: string,
        variationId: number = 0,
        requireLiveStock = false,
        repairMode = false
    ): Promise<EffectiveStockResult | null> {
        const wooService = await WooService.forAccount(accountId);

        // Get the product details (with retry for transient DNS errors)
        const product = await withDbRetry(
            () => prisma.wooProduct.findFirst({
                where: { id: productId, accountId },
                select: { id: true, wooId: true, name: true, rawData: true }
            }),
            { context: 'Get product for BOM sync' }
        );

        if (!product) {
            Logger.warn(`[BOMInventorySync] Product ${productId} not found`, { accountId });
            return null;
        }
        if ((product.rawData as any)?.status === 'trash') return null;

        // Find the BOM for this product/variation (with retry for transient DNS errors)
        const bom = await withDbRetry(
            () => prisma.bOM.findUnique({
                where: {
                    productId_variationId: { productId, variationId }
                },
                include: {
                    items: {
                        where: {
                            isActive: true,
                            OR: [
                                { childProductId: { not: null } },
                                { internalProductId: { not: null } }
                            ]
                        },
                        include: {
                            childProduct: {
                                select: { id: true, wooId: true, name: true, accountId: true, status: true, rawData: true }
                            },
                            childVariation: {
                                select: { wooId: true, sku: true, stockQuantity: true, productId: true, rawData: true }
                            },
                            internalProduct: {
                                select: { id: true, name: true, stockQuantity: true, accountId: true }
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

        // In-memory cache for variation fetches within this single calculation.
        // Avoids re-fetching /products/{parentId}/variations for every BOM item
        // that shares the same parent product.
        const variationCache = new Map<number, any[] | null>();
        const receiptProductCache = new Map<number, Promise<any>>();
        const repairVariationCache = new Map<string, Promise<any>>();
        const getRepairVariation = (parentId: number, variantId: number) => {
            const key = `${parentId}:${variantId}`;
            if (!repairVariationCache.has(key)) repairVariationCache.set(key, wooService.getProductVariation(parentId, variantId));
            return repairVariationCache.get(key)!;
        };
        const getLiveProduct = (wooId: number): Promise<any> => {
            if (!requireLiveStock) return wooService.getProduct(wooId);
            if (!receiptProductCache.has(wooId)) receiptProductCache.set(wooId, wooService.getProduct(wooId, { bypassCache: true }));
            return receiptProductCache.get(wooId)!;
        };

        /**
         * Helper: fetch variations with per-call caching.
         * Returns null when the API call fails (503/timeout), so callers
         * can fall back to local DB data instead of treating it as "no variations."
         */
        const getCachedVariations = async (parentWooId: number): Promise<any[] | null> => {
            if (variationCache.has(parentWooId)) return variationCache.get(parentWooId)!;
            try {
                const variations = requireLiveStock ? await wooService.getProductVariations(parentWooId, { bypassCache: true }) : await wooService.getProductVariations(parentWooId);
                variationCache.set(parentWooId, variations);
                return variations;
            } catch (error) {
                if (requireLiveStock) throw error;
                variationCache.set(parentWooId, null);
                return null;
            }
        };

        // Get current WooCommerce stock for the target (variation or parent product)
        let currentWooStock: number | null = null;
        let liveAllowsBackorders: boolean | undefined;
        let liveStockStatus: string | undefined;
        try {
            if (variationId > 0) {
                // For variations, fetch the specific variation's stock via the variations endpoint
                const variations = repairMode ? [await getRepairVariation(product.wooId, variationId)] : await getCachedVariations(product.wooId);
                if (variations) {
                    const targetVariation = variations.find((v: any) => v.id === variationId);
                    if (repairMode && (!targetVariation || targetVariation.manage_stock !== true || !Number.isSafeInteger(targetVariation.stock_quantity))) {
                        throw new Error('BOM_REPAIR_TARGET_INVALID: target variation is missing or does not manage its own stock');
                    }
                    if (repairMode && targetVariation.parent_id !== undefined && targetVariation.parent_id !== product.wooId) throw new Error('BOM_REPAIR_TARGET_INVALID: live variation parent mismatch');
                    if (repairMode) { liveAllowsBackorders = allowsBackorders(targetVariation); liveStockStatus = targetVariation.stock_status; }
                    if (repairMode) {
                        const local = await prisma.productVariation.findUnique({ where: { productId_wooId: { productId, wooId: variationId } }, select: { rawData: true } });
                        if (!local) throw new Error('BOM_REPAIR_TARGET_INVALID: variation mapping is missing locally');
                        await prisma.productVariation.updateMany({ where: { wooId: variationId, product: { id: productId, accountId } },
                            data: { stockQuantity: targetVariation.stock_quantity, rawData: repairTargetMirror(local.rawData, targetVariation) } });
                    }
                    currentWooStock = targetVariation?.stock_quantity ?? null;

                    if (!targetVariation) {
                        // Variation was deleted in WooCommerce — log at info (hidden in production)
                        Logger.info(`[BOMInventorySync] Target variation ${variationId} no longer exists on parent ${product.wooId}`, {
                            productId,
                            parentWooId: product.wooId,
                            variationId
                        });
                    }
                } else {
                    // API failed — fall back to local DB stock
                    Logger.warn(`[BOMInventorySync] API unavailable, using local stock for target variation`, {
                        productId, variationId
                    });
                    const localVariation = await prisma.productVariation.findUnique({
                        where: { productId_wooId: { productId, wooId: variationId } },
                        select: { stockQuantity: true }
                    });
                    currentWooStock = localVariation?.stockQuantity ?? null;
                }
            } else {
                // For main products, fetch the product directly
                const wooProduct = await getLiveProduct(product.wooId);
                if (repairMode && (wooProduct.id !== product.wooId || wooProduct.type !== 'simple' || wooProduct.manage_stock !== true || !Number.isSafeInteger(wooProduct.stock_quantity))) {
                    throw new Error('BOM_REPAIR_TARGET_INVALID: use a stock-managed simple product or an explicitly stock-managed variation');
                }
                if (repairMode) { liveAllowsBackorders = allowsBackorders(wooProduct); liveStockStatus = wooProduct.stock_status; }
                if (repairMode) await prisma.wooProduct.update({ where: { id: productId },
                    data: { stockQuantity: wooProduct.stock_quantity, rawData: repairTargetMirror(product.rawData, wooProduct) } });
                currentWooStock = wooProduct.stock_quantity ?? null;
            }
        } catch (err: any) {
            if (requireLiveStock) throw err;
            if (variationId === 0 && isMissingWooProduct(err)) {
                Logger.warn(`[BOMInventorySync] Product no longer exists in WooCommerce - deactivating BOM items`, {
                    accountId,
                    productId,
                    wooId: product.wooId,
                    variationId,
                    status: getWooErrorStatus(err),
                    code: getWooErrorCode(err),
                    message: getWooErrorMessage(err)
                });

                await prisma.bOMItem.updateMany({
                    where: {
                        bom: { productId, variationId },
                        isActive: true
                    },
                    data: {
                        isActive: false,
                        deactivatedReason: 'PARENT_PRODUCT_404'
                    }
                });

                return null;
            }

            Logger.warn(`[BOMInventorySync] Could not fetch product/variation stock`, {
                productId,
                wooId: product.wooId,
                variationId,
                status: getWooErrorStatus(err),
                code: getWooErrorCode(err),
                message: getWooErrorMessage(err)
            });
        }

        // Pre-fetch all child product and variation stock needed by this BOM in a single pass.
        // Why: the items loop below issues a findUnique/findUnique per item for fallback stock
        // and local-vs-live comparison — an N+1 pattern over the number of BOM components.
        const childProductIds = bom.items
            .filter(i => i.childProductId != null)
            .map(i => i.childProductId!);

        const childVariationPairs = bom.items
            .filter(i => i.childVariationId != null && i.childProduct != null)
            .map(i => ({ productId: i.childProduct!.id, wooId: i.childVariation!.wooId }));

        const [prefetchedProducts, prefetchedVariations] = await Promise.all([
            childProductIds.length > 0
                ? prisma.wooProduct.findMany({
                    where: { id: { in: childProductIds } },
                    select: { id: true, stockQuantity: true }
                })
                : [],
            childVariationPairs.length > 0
                ? prisma.productVariation.findMany({
                    where: {
                        OR: childVariationPairs.map(p => ({
                            productId: p.productId,
                            wooId: p.wooId
                        }))
                    },
                    select: { id: true, productId: true, wooId: true, stockQuantity: true }
                })
                : []
        ]);

        const localProductStockMap = new Map(
            (prefetchedProducts as Array<{ id: string; stockQuantity: number | null }>)
                .map(p => [p.id, p.stockQuantity])
        );
        const localVariationStockMap = new Map(
            (prefetchedVariations as Array<{ productId: string; wooId: number; stockQuantity: number | null }>)
                .map(v => [`${v.productId}:${v.wooId}`, v.stockQuantity])
        );

        // Calculate effective stock based on each child component
        const components: EffectiveStockResult['components'] = [];
        let minBuildableUnits = Infinity;

        for (const bomItem of bom.items) {
            // Supplier catalogue rows contribute cost only and do not constrain stock.
            if (bomItem.supplierItemId && !bomItem.childProductId && !bomItem.internalProductId) continue;
            const waste = Number(bomItem.wasteFactor) || 0;
            const requiredQty = Number(bomItem.quantity) * (1 + waste);
            if (repairMode && (!Number.isFinite(Number(bomItem.wasteFactor ?? 0)) || waste < 0 || !Number.isFinite(requiredQty) || requiredQty <= 0)) throw new Error('BOM_REPAIR_COMPONENT_INVALID: invalid component quantity or waste factor');
            if (repairMode && ((bomItem.internalProductId && bomItem.childProductId) || (bomItem.childVariationId && !bomItem.childVariation)
                || (bomItem.internalProductId && !bomItem.internalProduct) || (bomItem.childProductId && !bomItem.childProduct))) throw new Error('BOM_REPAIR_COMPONENT_INVALID: missing or ambiguous component mapping');
            if (requiredQty <= 0) continue;

            let childStock: number;
            let childName: string;
            let childProductId = '';
            let childWooId = 0;

            try {
                // Handle internal product components (priority check)
                if (bomItem.internalProductId && bomItem.internalProduct) {
                    if (requireLiveStock && bomItem.internalProduct.accountId !== accountId) throw new Error('Cross-account internal BOM component');
                    childStock = bomItem.internalProduct.stockQuantity;
                    childName = `[Internal] ${bomItem.internalProduct.name}`;
                    childProductId = bomItem.internalProductId;
                    childWooId = 0; // Internal products have no WooCommerce ID
                }
                // Handle WooCommerce product components
                else if (bomItem.childProduct) {
                    if (requireLiveStock && bomItem.childProduct.accountId !== accountId) throw new Error('Cross-account Woo BOM component');
                    childProductId = bomItem.childProduct.id;
                    childWooId = bomItem.childProduct.wooId;
                    childName = bomItem.childProduct.name;

                    // Check if this is a variant component
                    if (bomItem.childProduct.status === 'trash') {
                        if (repairMode) throw new Error('BOM_REPAIR_COMPONENT_INVALID: component is in the trash');
                        childStock = 0;
                    } else if (bomItem.childVariationId && bomItem.childVariation) {
                        if (requireLiveStock && bomItem.childVariation.productId !== bomItem.childProduct.id) throw new Error('BOM component variation parent mismatch');
                        childWooId = bomItem.childVariation.wooId;
                        childName = `${childName} (Variant ${bomItem.childVariation.sku || '#' + childWooId})`;

                        // Fetch variant stock from WooCommerce via parent's variations endpoint.
                        // Uses in-memory cache so we only call the API once per parent.
                        const parentWooId = bomItem.childProduct.wooId;
                        const variations = repairMode ? [await getRepairVariation(parentWooId, childWooId)] : await getCachedVariations(parentWooId);

                        if (variations) {
                            const targetVariation = variations.find((v: any) => v.id === childWooId);
                            if (requireLiveStock && !targetVariation) throw new Error(`BOM component variation ${childWooId} is missing in Woo`);
                            if (repairMode && targetVariation?.parent_id !== undefined && targetVariation.parent_id !== parentWooId) throw new Error('BOM_REPAIR_COMPONENT_INVALID: live variation parent mismatch');
                            childStock = targetVariation?.stock_quantity ?? bomItem.childVariation.stockQuantity ?? 0;
                            if (requireLiveStock) {
                                if (targetVariation.manage_stock !== true) {
                                    const parent = await getLiveProduct(parentWooId);
                                    if (repairMode && parent.id !== parentWooId) throw new Error('BOM_REPAIR_COMPONENT_INVALID: live stock owner identity mismatch');
                                    if (parent.manage_stock !== true) throw new Error(`BOM component ${parentWooId}/${childWooId} has no native managed owner`);
                                    childStock = parent.stock_quantity;
                                    // Strict receipt cascades pool inherited siblings by physical owner.
                                    childWooId = parentWooId;
                                    if (repairMode) await prisma.wooProduct.update({ where: { id: bomItem.childProduct.id }, data: {
                                        stockQuantity: parent.stock_quantity,
                                        rawData: { ...((bomItem.childProduct.rawData as Record<string, Prisma.JsonValue>) ?? {}), manage_stock: true, stock_quantity: parent.stock_quantity }
                                    } });
                                } else childStock = targetVariation.stock_quantity;
                                if (typeof childStock !== 'number' || !Number.isFinite(childStock)) throw new Error('Live BOM component stock unavailable');
                            }

                            if (!targetVariation) {
                                // Variation deleted in WooCommerce — deactivate BOM item to stop recurring errors
                                await prisma.bOMItem.update({
                                    where: { id: bomItem.id },
                                    data: {
                                        isActive: false,
                                        deactivatedReason: 'VARIATION_DELETED_IN_WOO'
                                    }
                                });
                                Logger.info(`[BOMInventorySync] Deactivated BOM item — variation ${childWooId} no longer exists on parent ${parentWooId}`, {
                                    accountId,
                                    bomItemId: bomItem.id,
                                    childWooId,
                                    parentWooId
                                });
                                continue;
                            } else {
                                // Update local DB with live stock so UI calculations match
                                const liveStock = targetVariation.stock_quantity;
                                if (repairMode || (!requireLiveStock && liveStock !== null && liveStock !== undefined && liveStock !== bomItem.childVariation.stockQuantity)) {
                                    await prisma.productVariation.updateMany({
                                        where: {
                                            wooId: bomItem.childVariation.wooId,
                                            product: { id: bomItem.childProduct.id }
                                        },
                                        data: { stockQuantity: liveStock, ...(repairMode ? { rawData: {
                                            ...((bomItem.childVariation.rawData as Record<string, Prisma.JsonValue>) ?? {}),
                                            stock_quantity: liveStock, manage_stock: targetVariation.manage_stock
                                        } } : {}) }
                                    });
                                }
                            }
                        } else {
                            // API unavailable (503/timeout) — fall back to pre-fetched local Map
                            childStock = localVariationStockMap.get(`${bomItem.childProduct.id}:${childWooId}`) ?? bomItem.childVariation.stockQuantity ?? 0;
                            Logger.debug(`[BOMInventorySync] API unavailable, using local stock for variation`, {
                                accountId, childWooId, parentWooId, localStock: childStock
                            });
                        }
                    } else {
                        // Standard product component
                        try {
                            const childWooProduct = await getLiveProduct(childWooId);
                            if (repairMode && childWooProduct.id !== childWooId) throw new Error('BOM_REPAIR_COMPONENT_INVALID: live component identity mismatch');
                            if (requireLiveStock && (childWooProduct.manage_stock !== true || typeof childWooProduct.stock_quantity !== 'number' || !Number.isFinite(childWooProduct.stock_quantity))) throw new Error(`Live managed BOM component stock unavailable: ${childWooId}`);
                            childStock = childWooProduct.stock_quantity ?? 0;

                            // Update local DB with live stock so UI calculations match.
                            // Use pre-fetched Map for local stock — no per-item findUnique.
                            const liveStock = childWooProduct.stock_quantity;
                            const localStock = localProductStockMap.get(bomItem.childProduct.id) ?? null;

                            if ((!requireLiveStock || repairMode) && liveStock !== null && liveStock !== undefined && liveStock !== localStock) {
                                await prisma.wooProduct.update({
                                    where: { id: bomItem.childProduct.id },
                                    data: { stockQuantity: liveStock }
                                });
                            }
                        } catch (fetchErr: any) {
                            if (requireLiveStock) throw fetchErr;
                            // Detect 404 — product was deleted in WooCommerce
                            const status = fetchErr?.response?.status ?? fetchErr?.status;
                            if (status === 404) {
                                await prisma.bOMItem.update({
                                    where: { id: bomItem.id },
                                    data: {
                                        isActive: false,
                                        deactivatedReason: 'PRODUCT_404'
                                    }
                                });
                                Logger.info(`[BOMInventorySync] Deactivated BOM item — child product ${childWooId} returned 404`, {
                                    accountId,
                                    bomItemId: bomItem.id,
                                    childWooId
                                });
                                continue;
                            }
                            // Non-404 failure — fall back to pre-fetched local Map
                            childStock = localProductStockMap.get(bomItem.childProduct.id) ?? 0;
                            Logger.warn(`[BOMInventorySync] Using local stock for child product`, {
                                accountId,
                                childWooId,
                                localStock: childStock
                            });
                        }
                    }
                } else {
                    // No valid component, skip
                    if (repairMode) throw new Error('BOM_REPAIR_COMPONENT_INVALID: component mapping is missing');
                    continue;
                }

                if (repairMode && (!Number.isSafeInteger(childStock) || Math.abs(childStock) > 2147483647)) throw new Error('BOM_REPAIR_COMPONENT_INVALID: component stock is unknown or outside supported bounds');
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
                if (requireLiveStock) throw err;
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

        // Duplicate rows for the same stock leaf are cumulative requirements,
        // not independent bottlenecks.
        const aggregatedComponents = new Map<string, EffectiveStockResult['components'][number]>();
        for (const component of components) {
            const key = `${component.childProductId}:${component.childWooId}`;
            const existing = aggregatedComponents.get(key);
            if (existing) {
                existing.requiredQty += component.requiredQty;
                existing.buildableUnits = Math.floor(existing.childStock / existing.requiredQty);
            } else {
                aggregatedComponents.set(key, { ...component });
            }
        }
        components.splice(0, components.length, ...aggregatedComponents.values());
        minBuildableUnits = components.reduce(
            (minimum, component) => Math.min(minimum, component.buildableUnits),
            Infinity
        );

        // If no valid components found
        if (components.length === 0 || minBuildableUnits === Infinity) {
            Logger.warn(`[BOMInventorySync] BOM has no valid components - returning null`, {
                accountId,
                productId,
                variationId,
                productName: product.name,
                bomItemCount: bom.items.length,
                validComponentCount: components.length,
                bomItemDetails: bom.items.map(item => ({
                    childProductId: item.childProductId,
                    internalProductId: item.internalProductId,
                    childVariationId: item.childVariationId,
                    quantity: item.quantity,
                    hasChildProduct: !!item.childProduct,
                    hasInternalProduct: !!item.internalProduct
                }))
            });
            return null;
        }

        const effectiveStock = minBuildableUnits;
        if (repairMode && (!Number.isSafeInteger(effectiveStock) || Math.abs(effectiveStock) > 2147483647)) throw new Error('BOM_REPAIR_COMPONENT_INVALID: calculated stock is outside supported bounds');

        // Sync is needed if:
        // 1. We couldn't fetch current stock (null) - force sync to set it
        // 2. Or if stocks differ
        const couldNotFetchStock = currentWooStock === null;
        const needsSync = couldNotFetchStock || Number(currentWooStock) !== Number(effectiveStock)
            || (repairMode && typeof liveStockStatus === 'string' && liveStockStatus !== getStockStatusForQuantity(effectiveStock, liveAllowsBackorders === true));

        return {
            productId: product.id,
            wooId: product.wooId,
            effectiveStock,
            currentWooStock,
            needsSync,
            couldNotFetchStock,
            ...(repairMode ? { liveAllowsBackorders, liveStockStatus } : {}),
            components
        };
    }

    /**
     * Fast, local-only calculation of effective stock using only database data.
     * No WooCommerce API calls - suitable for display endpoints that need speed.
     * Returns null if the product has no BOM or no child products/internal products.
     */
    static async calculateEffectiveStockLocal(
        accountId: string,
        productId: string,
        variationId: number = 0
    ): Promise<EffectiveStockResult | null> {
        // Get the product details with stock from rawData
        const product = await prisma.wooProduct.findFirst({
            where: { id: productId, accountId },
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
                items: localBOMItems
            }
        });

        if (!bom || bom.items.length === 0) {
            return null;
        }

        const variation = variationId > 0
            ? await prisma.productVariation.findUnique({
                where: {
                    productId_wooId: { productId, wooId: variationId }
                },
                select: { stockQuantity: true, rawData: true }
            })
            : null;

        return this.calculateEffectiveStockFromLocalData(product, bom, variation);
    }

    /** Pure calculation; callers must load the product/BOM within the account scope. */
    static calculateEffectiveStockFromLocalData(
        product: LocalProduct,
        bom: LocalBOM,
        variation: LocalStock | null = null
    ): EffectiveStockResult | null {
        if ((product.rawData as any)?.status === 'trash') return null;
        const target = bom.variationId > 0 ? variation : product;
        const rawData = target?.rawData as any;
        const currentWooStock = target?.stockQuantity ?? rawData?.stock_quantity ?? null;

        // Calculate effective stock based on each child component using local data only
        const components: EffectiveStockResult['components'] = [];
        let minBuildableUnits = Infinity;

        for (const bomItem of bom.items) {
            if (bomItem.supplierItemId && !bomItem.childProductId && !bomItem.internalProductId) continue;
            const waste = Number(bomItem.wasteFactor) || 0;
            const requiredQty = Number(bomItem.quantity) * (1 + waste);
            if (requiredQty <= 0) continue;

            let childStock: number;
            let childName: string;
            let childProductId: string;
            let childWooId: number;

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
                if ((bomItem.childProduct.rawData as any)?.status === 'trash') {
                    childStock = 0;
                } else if (bomItem.childVariationId && bomItem.childVariation) {
                    childName = `${childName} (Variant ${bomItem.childVariation.sku || '#' + bomItem.childVariation.wooId})`;
                    const variationRaw = bomItem.childVariation.rawData as any;
                    const parentRaw = bomItem.childProduct.rawData as any;
                    const inherited = (variationRaw?.manage_stock === false || variationRaw?.manage_stock === 'parent') && parentRaw?.manage_stock === true;
                    childWooId = inherited ? bomItem.childProduct.wooId : bomItem.childVariation.wooId;
                    childStock = inherited ? bomItem.childProduct.stockQuantity ?? parentRaw?.stock_quantity ?? 0 : bomItem.childVariation.stockQuantity ?? 0;
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

        const aggregatedComponents = new Map<string, EffectiveStockResult['components'][number]>();
        for (const component of components) {
            const key = `${component.childProductId}:${component.childWooId}`;
            const existing = aggregatedComponents.get(key);
            if (existing) {
                existing.requiredQty += component.requiredQty;
                existing.buildableUnits = Math.floor(existing.childStock / existing.requiredQty);
            } else {
                aggregatedComponents.set(key, { ...component });
            }
        }
        components.splice(0, components.length, ...aggregatedComponents.values());
        minBuildableUnits = components.reduce(
            (minimum, component) => Math.min(minimum, component.buildableUnits),
            Infinity
        );

        if (components.length === 0 || minBuildableUnits === Infinity) {
            return null;
        }

        const effectiveStock = minBuildableUnits;
        const needsSync = currentWooStock === null || Number(currentWooStock) !== Number(effectiveStock);

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
        variationId: number = 0,
        options?: { requireLiveStock?: boolean; beforeWrite?: () => Promise<void>; repairMode?: boolean }
    ): Promise<SyncResult> {
        if (options?.repairMode && !options.requireLiveStock) options = { ...options, requireLiveStock: true };
        const calculation = options?.requireLiveStock
            ? options.repairMode
                ? await this.calculateEffectiveStock(accountId, productId, variationId, true, true)
                : await this.calculateEffectiveStock(accountId, productId, variationId, true)
            : await this.calculateEffectiveStock(accountId, productId, variationId);

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

        await options?.beforeWrite?.();
        const assertRepairInputs = async (observed: EffectiveStockResult) => {
            if (options?.repairMode) await assertBOMRepairStockInputs(accountId,
                [variationId || observed.wooId, ...observed.components.map(component => component.childWooId)]);
        };
        await assertRepairInputs(calculation);
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
                if (options?.requireLiveStock) throw dbErr;
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

        let writeUncertain = false;
        try {
            const wooService = await WooService.forAccount(accountId);

            // For variations (variationId > 0), we need to update via the variation endpoint
            // For main products (variationId = 0), update the product directly
            if (variationId > 0) {
                // Get the parent product's wooId to construct the variation endpoint
                const parentProduct = await prisma.wooProduct.findFirst({
                    where: { id: productId, accountId },
                    select: { wooId: true }
                });

                if (!parentProduct) {
                    throw new Error('Parent product not found');
                }

                const variationRecord = await prisma.productVariation.findUnique({
                    where: { productId_wooId: { productId, wooId: variationId } },
                    select: { rawData: true }
                });
                const allowBackorders = options?.repairMode ? calculation.liveAllowsBackorders === true : allowsBackorders(variationRecord?.rawData);

                // Update variation stock via WooCommerce variations API
                await options?.beforeWrite?.();
                await assertRepairInputs(calculation);
                writeUncertain = true;
                const acknowledged = await wooService.updateProductVariation(parentProduct.wooId, variationId, {
                    stock_quantity: calculation.effectiveStock,
                    manage_stock: true,
                    stock_status: getStockStatusForQuantity(calculation.effectiveStock, allowBackorders)
                });
                if (options?.requireLiveStock && (acknowledged?.stock_quantity !== calculation.effectiveStock || acknowledged?.manage_stock !== true)) throw new Error('BOM variation stock write was not acknowledged');
                writeUncertain = false;
            } else {
                // Guard: do not set manage_stock on variable parent products
                const productRecord = await prisma.wooProduct.findFirst({
                    where: { id: productId, accountId },
                    select: { rawData: true }
                });
                const productRaw = productRecord?.rawData as any;
                const isVariable = productRaw?.type?.includes('variable') || productRaw?.variations?.length > 0;
                const allowBackorders = options?.repairMode ? calculation.liveAllowsBackorders === true : allowsBackorders(productRaw);

                if (isVariable && !options?.repairMode) {
                    Logger.warn(`[BOMInventorySync] Refusing to set manage_stock on variable parent product`, {
                        accountId, productId, wooId: calculation.wooId
                    });
                    return {
                        success: false,
                        productId: calculation.productId,
                        wooId: calculation.wooId,
                        previousStock: calculation.currentWooStock,
                        newStock: calculation.effectiveStock,
                        error: 'Cannot set manage_stock on variable parent — use a variation BOM instead'
                    };
                }

                // Update main product stock
                await options?.beforeWrite?.();
                await assertRepairInputs(calculation);
                writeUncertain = true;
                const acknowledged = await wooService.updateProduct(calculation.wooId, {
                    stock_quantity: calculation.effectiveStock,
                    manage_stock: true,
                    stock_status: getStockStatusForQuantity(calculation.effectiveStock, allowBackorders)
                });
                if (options?.requireLiveStock && (acknowledged?.stock_quantity !== calculation.effectiveStock || acknowledged?.manage_stock !== true)) throw new Error('BOM product stock write was not acknowledged');
                writeUncertain = false;
            }

            if (options?.repairMode) {
                await options.beforeWrite?.();
                const verified = await this.calculateEffectiveStock(accountId, productId, variationId, true, true);
                if (!verified || verified.needsSync || verified.currentWooStock !== calculation.effectiveStock) {
                    throw new Error('BOM_REPAIR_VERIFY_FAILED: stock or components changed during repair; refresh and retry this product');
                }
                await assertRepairInputs(verified);
                if (variationId > 0) {
                    await prisma.productVariation.updateMany({ where: { wooId: variationId, product: { id: productId, accountId } }, data: { stockQuantity: verified.currentWooStock } });
                } else {
                    await prisma.wooProduct.update({ where: { id: productId }, data: { stockQuantity: verified.currentWooStock } });
                }
            }

            // Log the stock change for audit trail
            await StockValidationService.logStockChange(
                accountId,
                calculation.productId,
                'SYSTEM_BOM',
                calculation.currentWooStock ?? null,
                calculation.effectiveStock,
                options?.requireLiveStock ? 'PASSED' : 'SKIPPED',
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
            // Distinguish 404 (deleted product) from transient failures
            if (err instanceof JobLeaseLostError) throw err;
            const status = getWooErrorStatus(err);
            const is404 = status === 404 || err.message?.includes('404');

            // Durable cascades must retain the graph on transport failure. If a
            // 404 deactivates the edges, the next retry silently sees no work.
            if (is404 && !options?.requireLiveStock) {
                Logger.warn(`[BOMInventorySync] Product ${productId} (wooId ${calculation.wooId}) no longer exists in WooCommerce — deactivating BOM items`, {
                    accountId,
                    productId,
                    wooId: calculation.wooId
                });

                // Deactivate all active BOM items for this product so the hourly
                // sync stops retrying a product that no longer exists in Woo.
                try {
                    await prisma.bOMItem.updateMany({
                        where: {
                            bom: { productId, variationId },
                            isActive: true
                        },
                        data: {
                            isActive: false,
                            deactivatedReason: 'PARENT_PRODUCT_404'
                        }
                    });
                } catch (deactivateErr) {
                    Logger.error('[BOMInventorySync] Failed to deactivate BOM items after 404', {
                        productId, error: deactivateErr
                    });
                }
            } else {
                Logger.error(`[BOMInventorySync] Failed to sync product to WooCommerce`, {
                    accountId,
                    productId,
                    wooId: calculation.wooId,
                    error: err.message
                });
            }

            return {
                success: false,
                productId: calculation.productId,
                wooId: calculation.wooId,
                previousStock: calculation.currentWooStock,
                newStock: calculation.effectiveStock,
                error: err.message,
                ...(options?.repairMode ? { writeUncertain } : {})
            };
        }
    }

    /**
     * Sync all BOM parent products for an account to WooCommerce.
     */
    static async syncAllBOMProducts(
        accountId: string,
        job: { id?: string | number; queueName?: string; data: Record<string, unknown>; updateData: (data: Record<string, unknown>) => Promise<void>; updateProgress: (progress: Record<string, unknown>) => Promise<void> } | null = null,
        options?: { assertLease: () => Promise<void>; targets?: BOMSyncTarget[] }
    ): Promise<{
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
                            isActive: true,
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
                },
                take: MAX_BOM_SYNC_TARGETS + 1
            }),
            { context: 'Find BOMs for bulk sync' }
        );

        if (bomsWithChildProducts.length > MAX_BOM_SYNC_TARGETS) throw new Error('BOM sync exceeds the checkpoint target limit');
        const allowed = options?.targets ? new Set(options.targets.map(targetKey)) : null;
        const targets = bomsWithChildProducts.filter(bom => !allowed || allowed.has(targetKey(bom)))
            .sort((a, b) => targetKey(a).localeCompare(targetKey(b)));
        if (targets.length > MAX_BOM_SYNC_TARGETS) throw new Error('BOM sync exceeds the checkpoint target limit');
        const manifest = bomManifestSchema.parse({ version: 1, targets });
        if (job) {
            // A processor must never replay an existing occurrence after a crash.
            if (job.data.bomManifest) throw new Error('Existing BOM execution requires reconciliation, not replay');
            await options?.assertLease();
            await job.updateData({ ...job.data, bomManifest: manifest });
        }
        const checkpoint: BOMSyncCheckpoint = { version: 1, nextIndex: 0, inFlightIndex: null, uncertainIndexes: [] };
        const total = targets.length;
        Logger.info(`[BOMInventorySync] Starting bulk sync for ${total} products`, { accountId });

        // Track counters and bounded failure summaries, not full SyncResult[].
        // Unbounded result accumulation previously contributed to OOM (exit 137).
        let processed = 0;
        let synced = 0;
        let skipped = 0;
        let failed = 0;
        // Bounded, credential-free explanations alongside durable target indexes.
        const productFailures: { index: number; reason: string }[] = [];

        if (job) {
            await job.updateProgress({ current: 0, total, synced: 0, skipped: 0, failed: 0, checkpoint: { ...checkpoint } });
        }

        for (const bom of targets) {
            // A worker can keep executing after losing its BullMQ lock. Stop at
            // each boundary and recheck immediately before any provider write.
            await options?.assertLease();
            if (job) {
                const { SyncCancellationService } = await import('./sync/SyncCancellationService');
                await SyncCancellationService.assertNotRequested(job);
                checkpoint.inFlightIndex = processed;
                // Persist BEFORE any calculation/write; an interrupted target is
                // uncertain even if the request never reached WooCommerce.
                await job.updateProgress({ current: processed, total, synced, skipped, failed, productFailures: [...productFailures], checkpoint: { ...checkpoint, uncertainIndexes: [...checkpoint.uncertainIndexes] } });
                await options?.assertLease();
            }
            // Wrap each product sync in try/catch so one failure doesn't crash the entire job
            try {
                const result = await this.syncProductToWoo(accountId, bom.productId, bom.variationId,
                    options ? { beforeWrite: options.assertLease, requireLiveStock: Boolean(options.targets) } : undefined);

                if (result.success) {
                    if (result.previousStock === result.newStock) {
                        skipped++;
                    } else {
                        synced++;
                    }
                } else {
                    failed++;
                    checkpoint.uncertainIndexes.push(processed);
                    if (productFailures.length < 100) productFailures.push({ index: processed, reason: describeBOMFailure(result.error) });
                }
            } catch (err: any) {
                if (err instanceof JobLeaseLostError) throw err;
                Logger.error(`[BOMInventorySync] Uncaught error syncing product ${bom.productId}`, {
                    accountId,
                    productId: bom.productId,
                    variationId: bom.variationId,
                    error: err.message
                });
                failed++;
                checkpoint.uncertainIndexes.push(processed);
                if (productFailures.length < 100) productFailures.push({ index: processed, reason: describeBOMFailure(err.message) });
            }

            processed++;
            checkpoint.nextIndex = processed;
            checkpoint.inFlightIndex = null;
            if (job) {
                await job.updateProgress({
                    current: processed,
                    total,
                    synced,
                    skipped,
                    failed,
                    productFailures: [...productFailures],
                    checkpoint: { ...checkpoint, uncertainIndexes: [...checkpoint.uncertainIndexes] }
                });
            }
        }

        Logger.info(`[BOMInventorySync] Bulk sync complete`, {
            accountId,
            total,
            synced,
            skipped,
            failed
        });

        return {
            total,
            synced,
            skipped,
            failed,
            results: []
        };
    }
}
