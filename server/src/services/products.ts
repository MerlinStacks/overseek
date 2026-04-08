/**
 * Products Service
 * 
 * CRUD operations for products. Search functionality delegated to ProductSearchService.
 */

import { prisma } from '../utils/prisma';
import { Logger } from '../utils/logger';
import { WooService, WooProductData } from './woo';
import { ProductSearchService } from './productSearch';
import { redisClient } from '../utils/redis';

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
                cogs: lv.cogs?.toString() || '',
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

        const existing = await prisma.wooProduct.findUnique({
            where: { accountId_wooId: { accountId, wooId } }
        });

        if (!existing) {
            throw new Error(`Product with wooId ${wooId} not found`);
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
        const updated = await prisma.wooProduct.update({
            where: { accountId_wooId: { accountId, wooId } },
            data: {
                binLocation: productData.binLocation,
                name: productData.name,
                stockStatus: productData.stockStatus,
                manageStock: productData.manageStock,
                sku: productData.sku,
                price: productData.price ? parseFloat(productData.price) : undefined,
                weight: productData.weight ? parseFloat(productData.weight) : undefined,
                length: productData.length ? parseFloat(productData.length) : undefined,
                width: productData.width ? parseFloat(productData.width) : undefined,
                height: productData.height ? parseFloat(productData.height) : undefined,
                isGoldPriceApplied: productData.isGoldPriceApplied,
                goldPriceType: productData.goldPriceType,
                cogs: productData.cogs !== undefined
                    ? (productData.cogs ? parseFloat(productData.cogs) : null)
                    : undefined,
                miscCosts: productData.miscCosts || undefined,
                supplierId: productData.supplierId || null,
                images: productData.images || undefined,
                rawData: updatedRawData,
                seoData: updatedSeoData
            }
        });

        // Sync ALL relevant product fields to WooCommerce
        const wooUpdateData: Record<string, any> = {};

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
                length: productData.length ? String(productData.length) : '',
                width: productData.width ? String(productData.width) : '',
                height: productData.height ? String(productData.height) : ''
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
            wooUpdateData.manage_stock = existing.manageStock;
            if (existing.stockQuantity !== null) {
                wooUpdateData.stock_quantity = existing.stockQuantity;
            }

            try {
                const wooService = await WooService.forAccount(accountId);
                await wooService.updateProduct(wooId, wooUpdateData);
                Logger.info('Synced product to WooCommerce', { wooId, fields: Object.keys(wooUpdateData) });
            } catch (err: any) {
                Logger.error('Failed to sync product to WooCommerce', { error: err.message, wooId, fields: Object.keys(wooUpdateData) });
            }
        }

        // Handle Variations Upsert & Sync
        if (variations && Array.isArray(variations)) {
            const wooService = await WooService.forAccount(accountId);

            // Why: process in batches of 5 instead of Promise.all to cap
            // concurrent HTTP connections. Hundred-variation products with
            // Promise.all cause memory spikes and socket exhaustion.
            const BATCH_SIZE = 5;
            for (let i = 0; i < variations.length; i += BATCH_SIZE) {
                const batch = variations.slice(i, i + BATCH_SIZE);
                await Promise.all(batch.map(async (v) => {
                    if (!v.id || typeof v.id !== 'number' || v.id <= 0) {
                        Logger.warn(`Skipping variation with invalid ID`, { variationData: v, productWooId: wooId });
                        return;
                    }

                    try {
                        // Update local DB
                        await prisma.productVariation.upsert({
                            where: { productId_wooId: { productId: updated.id, wooId: v.id } },
                            update: {
                                cogs: v.cogs !== undefined ? (v.cogs ? parseFloat(v.cogs) : null) : undefined,
                                miscCosts: v.miscCosts || undefined,
                                binLocation: v.binLocation,
                                isGoldPriceApplied: v.isGoldPriceApplied,
                                goldPriceType: v.goldPriceType,
                                sku: v.sku,
                                price: v.price ? parseFloat(v.price) : undefined,
                                salePrice: v.salePrice ? parseFloat(v.salePrice) : undefined,
                                stockStatus: v.stockStatus,
                                weight: v.weight ? parseFloat(v.weight) : undefined,
                                length: v.dimensions?.length ? parseFloat(v.dimensions.length) : undefined,
                                width: v.dimensions?.width ? parseFloat(v.dimensions.width) : undefined,
                                height: v.dimensions?.height ? parseFloat(v.dimensions.height) : undefined
                            },
                            create: {
                                productId: updated.id,
                                wooId: v.id,
                                cogs: v.cogs !== undefined ? (v.cogs ? parseFloat(v.cogs) : null) : undefined,
                                miscCosts: v.miscCosts || undefined,
                                binLocation: v.binLocation,
                                isGoldPriceApplied: v.isGoldPriceApplied || false,
                                goldPriceType: v.goldPriceType || null,
                                sku: v.sku,
                                price: v.price ? parseFloat(v.price) : undefined,
                                salePrice: v.salePrice ? parseFloat(v.salePrice) : undefined,
                                stockStatus: v.stockStatus,
                                weight: v.weight ? parseFloat(v.weight) : undefined,
                                length: v.dimensions?.length ? parseFloat(v.dimensions.length) : undefined,
                                width: v.dimensions?.width ? parseFloat(v.dimensions.width) : undefined,
                                height: v.dimensions?.height ? parseFloat(v.dimensions.height) : undefined
                            }
                        });

                        // Sync to WooCommerce
                        await wooService.updateProductVariation(wooId, v.id, {
                            sku: v.sku,
                            regular_price: v.price,
                            sale_price: v.salePrice,
                            stock_status: v.stockStatus,
                            manage_stock: v.manageStock,
                            backorders: v.backorders,
                            weight: v.weight || '',
                            dimensions: {
                                length: v.dimensions?.length || '',
                                width: v.dimensions?.width || '',
                                height: v.dimensions?.height || ''
                            }
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
     * Search products in Elasticsearch (delegates to ProductSearchService)
     */
    static async searchProducts(accountId: string, query: string = '', page: number = 1, limit: number = 20) {
        return ProductSearchService.searchProducts(accountId, query, page, limit);
    }
}
