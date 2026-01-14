import { esClient } from '../utils/elastic';
import { prisma } from '../utils/prisma';
import { Logger } from '../utils/logger';

export class ProductsService {
    static async createProduct(accountId: string, data: any): Promise<never> {
        // TODO: Implement product creation via WooCommerce API
        // WooService.createProduct method needs to be added first
        throw new Error('Product creation not yet implemented. Please create products in WooCommerce directly.');
    }

    static async getProductByWooId(accountId: string, wooId: number) {
        const product = await prisma.wooProduct.findUnique({
            where: { accountId_wooId: { accountId, wooId } }
        });

        if (!product) return null;

        // Extract metadata from rawData if available
        const raw = product.rawData as any;
        Logger.debug('rawData keys', { keys: Object.keys(raw || {}) });

        // Merge DB variations with rawData variations (IDs)
        const variationIds: number[] = raw?.variations || [];

        // Check if we have full variation data from sync
        const variationsData: any[] = raw?.variationsData || [];

        const mergedVariations = variationIds.map((vId: number) => {
            // Try to find full variation data from variationsData array
            const fullData = variationsData.find((v: any) => v.id === vId);

            return {
                id: vId,
                sku: fullData?.sku || '',
                price: fullData?.price || '',
                salePrice: fullData?.sale_price || '',
                stockStatus: fullData?.stock_status || 'instock',
                stockQuantity: fullData?.stock_quantity ?? null,
                cogs: '',
                binLocation: '',
                image: fullData?.image || null, // Single image object { src: ... }
                images: fullData?.image ? [fullData.image] : [],
                attributes: fullData?.attributes || []
            };
        });


        return {
            ...product,
            type: raw?.type || 'simple',
            variations: mergedVariations, // Return full objects with stock data
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
                images: productData.images || undefined
            }
        });

        // 2. Handle Variations Upsert & Sync
        if (variations && Array.isArray(variations)) {
            const { WooService } = await import('./woo');
            const wooService = await WooService.forAccount(accountId);

            for (const v of variations) {
                // Note: ProductVariation model not in schema, skipping local upsert
                // Only sync to WooCommerce

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
