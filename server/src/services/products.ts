import { esClient } from '../utils/elastic';
import { prisma } from '../utils/prisma';
import { Logger } from '../utils/logger';

export class ProductsService {
    static async createProduct(accountId: string, data: any) {
        const { variations, ...productData } = data;

        // Basic creation logic - creates a "pending" product in our DB
        // In a real scenario, this might call Woo API first to get an ID, 
        // or we generate a temporary ID and sync later.
        // For now, let's assume we can create it in Woo immediately or use a placeholder approach.
        // Since we need a WooID, we should probably call Woo first.

        const { WooService } = await import('./woo');
        const wooService = await WooService.forAccount(accountId);

        // 1. Create in WooCommerce
        const wooProduct = await wooService.createProduct({
            name: productData.name || 'New Product',
            type: 'simple',
            status: 'draft', // Create as draft by default
            ...productData
        });

        if (!wooProduct || !wooProduct.id) {
            throw new Error('Failed to create product in WooCommerce');
        }

        // 2. Create in local DB
        const created = await prisma.wooProduct.create({
            data: {
                accountId,
                wooId: wooProduct.id,
                name: wooProduct.name,
                sku: wooProduct.sku || '',
                stockStatus: wooProduct.status || 'instock',
                permalink: wooProduct.permalink || '',
                price: wooProduct.price ? parseFloat(wooProduct.price) : null,
                rawData: wooProduct as any
            }
        });

        return created;
    }

    static async getProductByWooId(accountId: string, wooId: number) {
        const product = await prisma.wooProduct.findUnique({
            where: { accountId_wooId: { accountId, wooId } },
            include: { variations: true }
        });

        if (!product) return null;

        // Extract metadata from rawData if available
        const raw = product.rawData as any;
        Logger.debug('rawData keys', { keys: Object.keys(raw || {}) });

        // Merge DB variations with rawData variations (IDs)
        // Ideally DB variations are the source of truth for local fields
        const variationIds: number[] = raw?.variations || [];

        const mergedVariations = variationIds.map(vId => {
            const local = product.variations.find(v => v.wooId === vId);
            return {
                id: vId,
                // Fallback to minimal data if not in DB yet (will be synced on edit or full sync)
                sku: local?.sku || '',
                price: local?.price?.toString() || '',
                salePrice: local?.salePrice?.toString() || '',
                stockStatus: local?.stockStatus || 'instock',
                cogs: local?.cogs?.toString() || '',
                binLocation: local?.binLocation || '',
                images: local?.images || []
            };
        });

        return {
            ...product,
            type: raw?.type || 'simple',
            variations: mergedVariations, // Return full objects, not just IDs
            variationIds: raw?.variations || [], // Keep IDs for reference
            description: raw?.description || '',
            short_description: raw?.short_description || '',
            // Fallback for when images column is empty (legacy sync)
            images: (Array.isArray(product.images) && product.images.length > 0) ? product.images : (raw?.images || []),
            // WooCommerce inventory & taxonomy fields
            manageStock: raw?.manage_stock ?? false,
            categories: raw?.categories || [],
            tags: raw?.tags || [],
            // Dimensions object for frontend compatibility
            dimensions: {
                length: product.length?.toString() || '',
                width: product.width?.toString() || '',
                height: product.height?.toString() || ''
            }
        };
    }

    static async updateProduct(accountId: string, wooId: number, data: any) {
        const { variations, ...productData } = data;

        // 1. Update Parent Product
        const updated = await prisma.wooProduct.update({
            where: { accountId_wooId: { accountId, wooId } },
            data: {
                binLocation: productData.binLocation,
                name: productData.name,
                stockStatus: productData.stockStatus,
                sku: productData.sku,
                price: productData.price ? parseFloat(productData.price) : undefined,
                weight: productData.weight ? parseFloat(productData.weight) : undefined,
                length: productData.length ? parseFloat(productData.length) : undefined,
                width: productData.width ? parseFloat(productData.width) : undefined,
                height: productData.height ? parseFloat(productData.height) : undefined,
                isGoldPriceApplied: productData.isGoldPriceApplied,
                cogs: productData.cogs ? parseFloat(productData.cogs) : undefined,
                supplierId: productData.supplierId || null,
                images: productData.images || undefined,
                rawData: {
                    update: {
                        sale_price: productData.salePrice,
                        description: productData.description,
                        short_description: productData.short_description
                    }
                }
            }
        });

        // 2. Handle Variations Upsert & Sync
        if (variations && Array.isArray(variations)) {
            const { WooService } = await import('./woo');
            const wooService = await WooService.forAccount(accountId);

            for (const v of variations) {
                // Upsert local
                await prisma.productVariation.upsert({
                    where: {
                        productId_wooId: {
                            productId: updated.id,
                            wooId: v.id
                        }
                    },
                    update: {
                        sku: v.sku,
                        price: v.price ? parseFloat(v.price) : undefined,
                        salePrice: v.salePrice ? parseFloat(v.salePrice) : undefined,
                        cogs: v.cogs ? parseFloat(v.cogs) : undefined,
                        binLocation: v.binLocation,
                        stockStatus: v.stockStatus,
                        images: v.images || undefined
                    },
                    create: {
                        productId: updated.id,
                        wooId: v.id,
                        sku: v.sku,
                        price: v.price ? parseFloat(v.price) : undefined,
                        salePrice: v.salePrice ? parseFloat(v.salePrice) : undefined,
                        cogs: v.cogs ? parseFloat(v.cogs) : undefined,
                        binLocation: v.binLocation,
                        stockStatus: v.stockStatus,
                        images: v.images || undefined
                    }
                });

                // Sync to Woo (Only synced fields)
                // We only sync if changed? For now, sync on save.
                try {
                    await wooService.updateProduct(v.id, {
                        sku: v.sku,
                        regular_price: v.price, // Woo maps regular_price, sale_price needed too?
                        sale_price: v.salePrice,
                        stock_status: v.stockStatus
                        // Variation images in Woo are complex, skipping sync for images for now unless requested
                    });
                } catch (err: any) {
                    Logger.error(`Failed to sync variation ${v.id} to WooCommerce`, { error: err.message });
                }
            }
        }

        return updated;
    }
    /**
     * Search products in Elasticsearch
     */
    static async searchProducts(accountId: string, query: string = '', page: number = 1, limit: number = 20) {
        const from = (page - 1) * limit;

        const must: any[] = [
            { term: { accountId } }
        ];

        if (query) {
            must.push({
                multi_match: {
                    query,
                    fields: ['name^2', 'description', 'sku'],
                    fuzziness: 'AUTO'
                }
            });
        }

        try {
            const response = await esClient.search({
                index: 'products',
                query: {
                    bool: { must }
                },
                from,
                size: limit,
                sort: [{ date_created: { order: 'desc' } } as any]
            });

            const hits = response.hits.hits.map(hit => ({
                id: hit._id,
                ...(hit._source as any),
                // Ensure rawData is available if needed, or map specific fields
            }));

            const total = (response.hits.total as any).value || 0;

            return {
                products: hits,
                total,
                page,
                totalPages: Math.ceil(total / limit)
            };
        } catch (error) {
            Logger.error('Elasticsearch Product Search Error', { error });
            // Return empty result on error (or if index doesn't exist yet)
            return { products: [], total: 0, page, totalPages: 0 };
        }
    }
}
