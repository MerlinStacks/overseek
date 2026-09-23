/**
 * Products Service
 * 
 * CRUD operations for products. Search functionality delegated to ProductSearchService.
 */

import { prisma } from '../utils/prisma';
import { Logger } from '../utils/logger';
import { WooService, WooProductData } from './woo';
import { ProductSearchService } from './productSearch';
import type { ProductSearchFilters } from './productSearch';
import { redisClient } from '../utils/redis';
import { dirtyInboundProducts, lockDeliveryAccount } from './deliveryEstimates/intents';
import { Prisma } from '@prisma/client';
import { nativeWooCogs } from './wooCogs';

const hasValue = (value: unknown): boolean => value !== undefined && value !== null && value !== '';
const toNumberOrUndefined = (value: unknown): number | undefined => (hasValue(value) ? Number(value) : undefined);
const toNumberOrNull = (value: unknown): number | null | undefined => {
    if (value === undefined) return undefined;
    if (value === null || (typeof value === 'string' && value.trim() === '')) return null;
    return Number(value);
};

type VariationStockManagement = boolean | 'parent';
export class ProductValidationError extends Error {}
function variationStockManagement(value: unknown): VariationStockManagement | undefined {
    if (value === undefined) return undefined;
    if (typeof value === 'boolean' || value === 'parent') return value;
    throw new Error('Variation manageStock must be a boolean or parent');
}

/** Missing ownership fields deliberately do not write manageStock/rawData. */
function saveVariation(db: Pick<typeof prisma, 'productVariation'>, productId: string, v: any,
    ownership: { manageStock: boolean; rawData: Prisma.InputJsonObject } | Record<string, never> = {}) {
    const fields = {
        supplierId: v.supplierId === '' ? null : v.supplierId,
        cogs: toNumberOrNull(v.cogs), miscCosts: v.miscCosts || undefined, binLocation: v.binLocation,
        isGoldPriceApplied: v.isGoldPriceApplied, goldPriceType: v.goldPriceType,
        sku: v.sku, price: toNumberOrUndefined(v.price), salePrice: toNumberOrUndefined(v.salePrice), stockStatus: v.stockStatus,
        weight: toNumberOrUndefined(v.weight), length: toNumberOrUndefined(v.dimensions?.length),
        width: toNumberOrUndefined(v.dimensions?.width), height: toNumberOrUndefined(v.dimensions?.height),
        ...ownership,
    };
    return db.productVariation.upsert({ where: { productId_wooId: { productId, wooId: v.id } }, update: fields,
        create: { ...fields, productId, wooId: v.id, isGoldPriceApplied: v.isGoldPriceApplied || false, goldPriceType: v.goldPriceType || null },
    });
}

export class ProductsService {
    /**
     * Create a new product via WooCommerce API
     */
    static async createProduct(accountId: string, data: WooProductData, userId?: string): Promise<any> {
        const wooService = await WooService.forAccount(accountId);
        const newProduct = await wooService.createProduct(data, userId);
        return newProduct;
    }

    /**
     * Get a product by WooCommerce ID with full variation data
     */
    static async getProductByWooId(accountId: string, wooId: number) {
        const product = await prisma.wooProduct.findUnique({
            where: { accountId_wooId: { accountId, wooId } }
        });

        if (!product) return null;

        const raw = product.rawData as any;

        // Why ProductVariation table is primary: rawData.variationsData is no longer
        // populated by auto-sync (removed for OOM mitigation). The DB table is the
        // authoritative source for stock, COGS, and other locally-managed fields.
        const localVariations = await prisma.productVariation.findMany({
            where: { productId: product.id }
        });

        const mergedVariations = localVariations.map(lv => {
            const varRaw = lv.rawData as any || {};

            const weight = lv.weight?.toString() || varRaw.weight || '';
            const length = lv.length?.toString() || varRaw.dimensions?.length || '';
            const width = lv.width?.toString() || varRaw.dimensions?.width || '';
            const height = lv.height?.toString() || varRaw.dimensions?.height || '';

            return {
                id: lv.wooId,
                sku: lv.sku || varRaw.sku || '',
                price: lv.price?.toString() || varRaw.price || '',
                salePrice: lv.salePrice?.toString() || varRaw.sale_price || '',
                stockStatus: lv.stockStatus || varRaw.stock_status || 'instock',
                stockQuantity: lv.stockQuantity ?? varRaw.stock_quantity ?? null,
                manageStock: lv.manageStock ?? varRaw.manage_stock ?? false,
                backorders: varRaw.backorders || 'no',
                weight,
                dimensions: { length, width, height },
                cogs: lv.cogs != null ? lv.cogs.toString() : '',
                supplierId: lv.supplierId ?? null,
                miscCosts: lv.miscCosts || [],
                binLocation: lv.binLocation || '',
                isGoldPriceApplied: lv.isGoldPriceApplied || false,
                goldPriceType: lv.goldPriceType || null,
                image: varRaw.image || null,
                images: varRaw.image ? [varRaw.image] : [],
                attributes: varRaw.attributes || []
            };
        });

        return {
            ...product,
            miscCosts: product.miscCosts || [],
            type: raw?.type || 'simple',
            variations: mergedVariations,
            variationIds: raw?.variations || [],
            description: raw?.description || '',
            short_description: raw?.short_description || '',
            salePrice: raw?.sale_price || '',
            images: (Array.isArray(product.images) && product.images.length > 0)
                ? product.images
                : (raw?.images || []),
            manageStock: raw?.manage_stock ?? false,
            backorders: raw?.backorders || 'no',
            categories: raw?.categories || [],
            tags: raw?.tags || [],
            dimensions: {
                length: product.length?.toString() || '',
                width: product.width?.toString() || '',
                height: product.height?.toString() || ''
            }
        };
    }

    /**
     * Update product and sync to WooCommerce
     */
    static async updateProduct(accountId: string, wooId: number, data: any) {
        const { variations, ...productData } = data;
        // Validate all costs before any local writes or best-effort transport.
        try {
            nativeWooCogs(productData.cogs);
            if (Array.isArray(variations)) for (const v of variations) nativeWooCogs(v?.cogs, true);
        } catch (error) {
            throw new ProductValidationError((error as Error).message);
        }
        const taxonomyFields = ['categories', 'tags'] as const;
        const editsTaxonomy = taxonomyFields.some(field => productData[field] !== undefined);
        for (const field of taxonomyFields) {
            const terms = productData[field];
            if (terms === undefined) continue;
            if (!Array.isArray(terms) || terms.some(term => !term || !Number.isSafeInteger(term.id) || term.id <= 0)) {
                throw new ProductValidationError(`Invalid ${field} assignment`);
            }
            productData[field] = [...new Set<number>(terms.map(term => term.id))].map(id => ({ id }));
        }
        // Validate before local writes/network; do not coerce 'parent' to true.
        if (Array.isArray(variations)) for (const variation of variations) variationStockManagement(variation?.manageStock);

        const existing = await prisma.wooProduct.findUnique({
            where: { accountId_wooId: { accountId, wooId } }
        });

        if (!existing) {
            throw new Error(`Product with wooId ${wooId} not found`);
        }

        // Validate the entire request before parent writes or best-effort Woo sync.
        // Woo variation IDs must belong to this local parent and account.
        if (Array.isArray(variations) && variations.length) {
            for (const v of variations) {
                if (!v || !Number.isSafeInteger(v.id) || v.id <= 0) {
                    throw new ProductValidationError('Invalid variation ID');
                }
                if (v.supplierId !== undefined && v.supplierId !== null && typeof v.supplierId !== 'string') {
                    throw new ProductValidationError('Invalid variation supplier ID');
                }
            }
            const rows = await prisma.productVariation.findMany({
                where: { productId: existing.id, product: { accountId }, wooId: { in: variations.map(v => v.id) } },
                select: { wooId: true }
            });
            const ownedIds = new Set(rows.map(row => row.wooId));
            if (variations.some(v => !ownedIds.has(v.id))) {
                throw new ProductValidationError('Variation does not belong to this product');
            }
            const supplierIds = [...new Set<string>(variations.map(v => v.supplierId).filter(Boolean))];
            if (supplierIds.length) {
                const suppliers = await prisma.supplier.findMany({ where: { accountId, id: { in: supplierIds } }, select: { id: true } });
                const allowedIds = new Set(suppliers.map(supplier => supplier.id));
                if (supplierIds.some(id => !allowedIds.has(id))) {
                    throw new ProductValidationError('Variation supplier not found in this account');
                }
            }
        }

        // Merge description into rawData
        const existingRawData = (existing.rawData as any) || {};
        const updatedRawData = {
            ...existingRawData,
            description: productData.description !== undefined ? productData.description : existingRawData.description,
            short_description: productData.short_description !== undefined ? productData.short_description : existingRawData.short_description,
            sale_price: productData.salePrice !== undefined ? productData.salePrice : existingRawData.sale_price,
            manage_stock: productData.manageStock !== undefined ? productData.manageStock : existingRawData.manage_stock,
            backorders: productData.backorders !== undefined ? productData.backorders : existingRawData.backorders
        };

        // Merge focusKeyword into seoData
        const existingSeoData = (existing.seoData as any) || {};
        const updatedSeoData = {
            ...existingSeoData,
            focusKeyword: productData.focusKeyword !== undefined ? productData.focusKeyword : existingSeoData.focusKeyword
        };

        // Update Parent Product
        const saveParent = (db: Pick<typeof prisma, 'wooProduct'>) => db.wooProduct.update({
                where: { accountId_wooId: { accountId, wooId } },
                data: {
                    binLocation: productData.binLocation,
                    name: productData.name,
                    stockStatus: productData.stockStatus,
                    manageStock: productData.manageStock,
                    sku: productData.sku,
                    price: toNumberOrUndefined(productData.price),
                    weight: toNumberOrUndefined(productData.weight),
                    length: toNumberOrUndefined(productData.length),
                    width: toNumberOrUndefined(productData.width),
                    height: toNumberOrUndefined(productData.height),
                    isGoldPriceApplied: productData.isGoldPriceApplied,
                    goldPriceType: productData.goldPriceType,
                    cogs: toNumberOrNull(productData.cogs),
                    miscCosts: productData.miscCosts || undefined,
                    supplierId: productData.supplierId !== undefined ? productData.supplierId || null : undefined,
                    images: productData.images || undefined,
                    rawData: updatedRawData,
                    seoData: updatedSeoData
                }
            });
        let updated = productData.supplierId === undefined && productData.manageStock === undefined
            ? await saveParent(prisma)
            : await prisma.$transaction(async tx => {
            await lockDeliveryAccount(tx, accountId);
            if (productData.supplierId && !await tx.supplier.findFirst({ where: { id: productData.supplierId, accountId }, select: { id: true } })) {
                throw new Error('Supplier not found');
            }
            const current = await tx.wooProduct.findUniqueOrThrow({ where: { accountId_wooId: { accountId, wooId } }, select: { supplierId: true, manageStock: true, rawData: true } });
            const supplierChanged = productData.supplierId !== undefined && (productData.supplierId || null) !== current.supplierId;
            const stockOwnerChanged = productData.manageStock !== undefined && (productData.manageStock !== current.manageStock || productData.manageStock !== (current.rawData as any)?.manage_stock);
            const saved = await saveParent(tx);
            if (supplierChanged || stockOwnerChanged) await dirtyInboundProducts(tx, accountId, [wooId]);
            return saved;
        });

        // Sync ALL relevant product fields to WooCommerce
        const wooUpdateData: Record<string, any> = { ...nativeWooCogs(productData.cogs) };
        for (const field of taxonomyFields) {
            if (productData[field] !== undefined) wooUpdateData[field] = productData[field];
        }

        // Map OverSeek fields to WooCommerce API fields
        if (productData.name !== undefined) wooUpdateData.name = productData.name;
        if (productData.sku !== undefined) wooUpdateData.sku = productData.sku;
        if (productData.description !== undefined) wooUpdateData.description = productData.description;
        if (productData.short_description !== undefined) wooUpdateData.short_description = productData.short_description;
        if (productData.price !== undefined) wooUpdateData.regular_price = String(productData.price);
        if (productData.salePrice !== undefined) wooUpdateData.sale_price = String(productData.salePrice);
        if (productData.stockStatus !== undefined) wooUpdateData.stock_status = productData.stockStatus;
        if (productData.manageStock !== undefined) wooUpdateData.manage_stock = productData.manageStock;
        if (productData.backorders !== undefined) wooUpdateData.backorders = productData.backorders;
        if (productData.weight !== undefined) wooUpdateData.weight = String(productData.weight);

        // Handle dimensions - only include if at least one dimension is provided
        if (productData.length !== undefined || productData.width !== undefined || productData.height !== undefined) {
            wooUpdateData.dimensions = {
                length: hasValue(productData.length) ? String(productData.length) : '',
                width: hasValue(productData.width) ? String(productData.width) : '',
                height: hasValue(productData.height) ? String(productData.height) : ''
            };
        }

        // Handle images - map to WooCommerce format
        if (productData.images !== undefined && Array.isArray(productData.images)) {
            wooUpdateData.images = productData.images.map((img: any) => ({
                id: img.id,
                src: img.src || img,
                name: img.name,
                alt: img.alt
            })).filter((img: any) => img.src || img.id);
        }

        // Only call WooCommerce API if there are fields to update
        if (Object.keys(wooUpdateData).length > 0) {
            // Why: always include current stock state alongside other fields.
            // Partial updates without manage_stock/stock_quantity can cause
            // WooCommerce to reset stock management. The next ProductSync
            // would then pull stale stock back into the DB.
            wooUpdateData.manage_stock = productData.manageStock !== undefined ? productData.manageStock : existing.manageStock;
            if (existing.stockQuantity !== null) {
                wooUpdateData.stock_quantity = existing.stockQuantity;
            }

            try {
                const wooService = await WooService.forAccount(accountId);
                const wooProduct = await wooService.updateProduct(wooId, wooUpdateData);
                if (editsTaxonomy) {
                    // Woo may restore its default category when categories is cleared.
                    // Never substitute requested IDs for the canonical response objects.
                    const canonicalRawData = { ...updatedRawData };
                    for (const field of taxonomyFields) {
                        if (productData[field] === undefined) continue;
                        if (!Array.isArray(wooProduct?.[field])) {
                            throw new Error(`WooCommerce response missing ${field}`);
                        }
                        canonicalRawData[field] = wooProduct[field];
                    }
                    updated = await prisma.wooProduct.update({
                        where: { accountId_wooId: { accountId, wooId } },
                        data: { rawData: canonicalRawData },
                    });
                }
                Logger.info('Synced product to WooCommerce', { wooId, fields: Object.keys(wooUpdateData) });
            } catch (err: any) {
                Logger.error('Failed to sync product to WooCommerce', { error: err.message, wooId, fields: Object.keys(wooUpdateData) });
                if (editsTaxonomy) throw err;
            }
        }

        // Handle Variations Upsert & Sync
        if (variations && Array.isArray(variations)) {
            // Local-only edits must not require Woo credentials or send blank dimensions.
            const needsWooSync = (v: any) => ['sku', 'price', 'salePrice', 'stockStatus', 'manageStock', 'backorders', 'weight', 'dimensions']
                .some(field => v[field] !== undefined) || Object.keys(nativeWooCogs(v.cogs, true)).length > 0;
            let wooServicePromise: ReturnType<typeof WooService.forAccount> | undefined;

            // Why: process in batches of 5 instead of Promise.all to cap
            // concurrent HTTP connections. Hundred-variation products with
            // Promise.all cause memory spikes and socket exhaustion.
            const BATCH_SIZE = 5;
            for (let i = 0; i < variations.length; i += BATCH_SIZE) {
                const batch = variations.slice(i, i + BATCH_SIZE);
                const ownershipEdits = batch.filter(v => Number.isSafeInteger(v.id) && v.id > 0 && v.manageStock !== undefined);
                if (ownershipEdits.length) {
                    await prisma.$transaction(async tx => {
                        await lockDeliveryAccount(tx, accountId);
                        // One bounded lookup for the batch, never one read per variation.
                        const rows = await tx.productVariation.findMany({ where: { productId: updated.id, product: { accountId }, wooId: { in: ownershipEdits.map(v => v.id) } }, select: { wooId: true, manageStock: true, rawData: true } });
                        const current = new Map(rows.map(row => [row.wooId, row]));
                        let dirty = false;
                        for (const v of ownershipEdits) {
                            const value = variationStockManagement(v.manageStock)!;
                            const before = current.get(v.id);
                            const raw = before?.rawData && typeof before.rawData === 'object' && !Array.isArray(before.rawData) ? before.rawData as Prisma.InputJsonObject : {};
                            // Woo's variation REST schema permits boolean/string. The
                            // local Boolean means independent management; raw preserves
                            // the 'parent' inheritance marker. False also inherits when
                            // the actual parent manages stock (resolved by the builder).
                            const ownership = { manageStock: value === true, rawData: { ...raw, manage_stock: value } };
                            dirty ||= !before || before.manageStock !== ownership.manageStock || raw.manage_stock !== value;
                            await saveVariation(tx, updated.id, v, ownership);
                            current.set(v.id, { wooId: v.id, ...ownership } as typeof rows[number]);
                        }
                        if (dirty) await dirtyInboundProducts(tx, accountId, [wooId]);
                    });
                }
                await Promise.all(batch.map(async (v) => {
                    if (!Number.isSafeInteger(v.id) || v.id <= 0) {
                        Logger.warn(`Skipping variation with invalid ID`, { variationData: v, productWooId: wooId });
                        return;
                    }

                    // Keep database failures outside the best-effort transport catch:
                    // an unsaved supplier override must never be reported as success.
                    // Ownership-bearing upserts already committed with their dirty intent.
                    if (v.manageStock === undefined) await saveVariation(prisma, updated.id, v);
                    if (!needsWooSync(v)) return;

                    try {
                        const wooService = await (wooServicePromise ??= WooService.forAccount(accountId));
                        // Sync to WooCommerce
                        await wooService.updateProductVariation(wooId, v.id, {
                            ...nativeWooCogs(v.cogs, true),
                            sku: v.sku,
                            regular_price: v.price,
                            sale_price: v.salePrice,
                            stock_status: v.stockStatus,
                            manage_stock: v.manageStock,
                            backorders: v.backorders,
                            ...(v.weight !== undefined ? { weight: v.weight } : {}),
                            ...(v.dimensions !== undefined ? { dimensions: {
                                length: v.dimensions?.length || '',
                                width: v.dimensions?.width || '',
                                height: v.dimensions?.height || ''
                            } } : {})
                        });

                        // Clear any previous 404 tracking on success
                        const notFoundKey = `variation:404:${updated.id}:${v.id}`;
                        await redisClient.del(notFoundKey);
                    } catch (err: any) {
                        const status = err?.response?.status;

                        if (status === 404) {
                            // Why: delayed delete — only purge after 1 hour of sustained 404s.
                            // This prevents accidental deletion during short WooCommerce
                            // maintenance windows while cleaning up genuinely deleted variations.
                            await this.handleVariation404(updated.id, v.id, wooId);
                        } else {
                            Logger.error(`Failed to process variation ${v.id}`, {
                                error: err.message,
                                productWooId: wooId,
                                status,
                                responseData: err?.response?.data,
                            });
                        }
                    }
                }));
            }
        }

        return updated;
    }

    /**
     * Handle a WooCommerce 404 for a variation with delayed deletion.
     *
     * Why delayed: a transient 404 during WooCommerce maintenance should not
     * destroy the local record. We record the first 404 timestamp in Redis
     * (TTL 24h). Only after 1 hour of sustained 404s do we delete.
     */
    private static async handleVariation404(productId: string, variationWooId: number, parentWooId: number) {
        const GRACE_PERIOD_MS = 60 * 60 * 1000; // 1 hour
        const redisKey = `variation:404:${productId}:${variationWooId}`;

        try {
            const firstSeen = await redisClient.get(redisKey);

            if (!firstSeen) {
                // First 404 — record timestamp, wait for next cycle
                await redisClient.setex(redisKey, 86400, Date.now().toString());
                Logger.warn(`Variation ${variationWooId} returned 404, tracking for delayed delete`, {
                    productWooId: parentWooId,
                    variationWooId
                });
                return;
            }

            const elapsed = Date.now() - parseInt(firstSeen, 10);
            if (elapsed < GRACE_PERIOD_MS) {
                // Still within grace period — skip silently
                return;
            }

            // Grace period exceeded — variation is genuinely deleted in WooCommerce
            await prisma.productVariation.deleteMany({
                where: { productId, wooId: variationWooId }
            });
            await redisClient.del(redisKey);

            Logger.info(`Deleted local variation ${variationWooId} after sustained 404`, {
                productWooId: parentWooId,
                variationWooId,
                elapsedMs: elapsed
            });
        } catch (error) {
            Logger.error(`Failed to handle variation 404 cleanup`, {
                error,
                productWooId: parentWooId,
                variationWooId
            });
        }
    }

    /**
     * Search products (delegates ES/filtered database routing to ProductSearchService)
     */
    static async searchProducts(
        accountId: string,
        query: string = '',
        page: number = 1,
        limit: number = 20,
        sortField: 'name' | 'price' | null = null,
        sortDirection: 'asc' | 'desc' = 'asc',
        filters: ProductSearchFilters = {}
    ) {
        return ProductSearchService.searchProducts(accountId, query, page, limit, sortField, sortDirection, filters);
    }
}
