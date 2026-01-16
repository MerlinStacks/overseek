import { esClient } from '../utils/elastic';
import { prisma } from '../utils/prisma';
import { Logger } from '../utils/logger';

import { WooService, WooProductData } from './woo';

export class ProductsService {
    static async createProduct(accountId: string, data: WooProductData, userId?: string): Promise<any> {
        const wooService = await WooService.forAccount(accountId);
        const newProduct = await wooService.createProduct(data, userId);
        return newProduct;
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

        // Fetch local variation overrides (COGS, binLocation, miscCosts)
        const localVariations = await prisma.productVariation.findMany({
            where: { productId: product.id }
        });

        const mergedVariations = variationIds.map((vId: number) => {
            // Try to find full variation data from variationsData array
            const fullData = variationsData.find((v: any) => v.id === vId);
            const localVariant = localVariations.find(lv => lv.wooId === vId);

            return {
                id: vId,
                sku: fullData?.sku || '',
                price: fullData?.price || '',
                salePrice: fullData?.sale_price || '',
                stockStatus: fullData?.stock_status || 'instock',
                stockQuantity: fullData?.stock_quantity ?? null,
                weight: fullData?.weight || '',
                dimensions: {
                    length: fullData?.dimensions?.length || '',
                    width: fullData?.dimensions?.width || '',
                    height: fullData?.dimensions?.height || ''
                },
                cogs: localVariant?.cogs?.toString() || '',
                miscCosts: localVariant?.miscCosts || [],
                binLocation: localVariant?.binLocation || '',
                image: fullData?.image || null, // Single image object { src: ... }
                images: fullData?.image ? [fullData.image] : [],
                attributes: fullData?.attributes || []
            };
        });


        return {
            ...product,
            miscCosts: product.miscCosts || [],
            type: raw?.type || 'simple',
            variations: mergedVariations, // Return full objects with stock data
            variationIds: raw?.variations || [], // Keep IDs for reference
            description: raw?.description || '',
            short_description: raw?.short_description || '',
            salePrice: raw?.sale_price || '',
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

        // Fetch existing product to get current rawData
        const existing = await prisma.wooProduct.findUnique({
            where: { accountId_wooId: { accountId, wooId } }
        });

        if (!existing) {
            throw new Error(`Product with wooId ${wooId} not found`);
        }

        // Merge description into rawData (description is stored in rawData, not a separate column)
        const existingRawData = (existing.rawData as any) || {};
        const updatedRawData = {
            ...existingRawData,
            description: productData.description !== undefined ? productData.description : existingRawData.description,
            short_description: productData.short_description !== undefined ? productData.short_description : existingRawData.short_description,
            sale_price: productData.salePrice !== undefined ? productData.salePrice : existingRawData.sale_price
        };

        // Merge focusKeyword into seoData
        const existingSeoData = (existing.seoData as any) || {};
        const updatedSeoData = {
            ...existingSeoData,
            focusKeyword: productData.focusKeyword !== undefined ? productData.focusKeyword : existingSeoData.focusKeyword
        };

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
                goldPriceType: productData.goldPriceType,
                cogs: productData.cogs ? parseFloat(productData.cogs) : undefined,
                miscCosts: productData.miscCosts || undefined,
                supplierId: productData.supplierId || null,
                images: productData.images || undefined,
                rawData: updatedRawData,
                seoData: updatedSeoData
            }
        });

        // 2. Handle Variations Upsert & Sync
        if (variations && Array.isArray(variations)) {
            const { WooService } = await import('./woo');
            const wooService = await WooService.forAccount(accountId);

            // Parallelize variation updates for performance
            await Promise.all(variations.map(async (v) => {
                // Update local DB for variations
                await prisma.productVariation.upsert({
                    where: { productId_wooId: { productId: updated.id, wooId: v.id } },
                    update: {
                        cogs: v.cogs ? parseFloat(v.cogs) : undefined,
                        miscCosts: v.miscCosts || undefined,
                        binLocation: v.binLocation,
                        sku: v.sku,
                        price: v.price ? parseFloat(v.price) : undefined,
                        salePrice: v.salePrice ? parseFloat(v.salePrice) : undefined,
                        stockStatus: v.stockStatus
                    },
                    create: {
                        productId: updated.id,
                        wooId: v.id,
                        cogs: v.cogs ? parseFloat(v.cogs) : undefined,
                        miscCosts: v.miscCosts || undefined,
                        binLocation: v.binLocation,
                        sku: v.sku,
                        price: v.price ? parseFloat(v.price) : undefined,
                        salePrice: v.salePrice ? parseFloat(v.salePrice) : undefined,
                        stockStatus: v.stockStatus
                    }
                });

                // Sync to Woo (Only synced fields)
                try {
                    await wooService.updateProduct(v.id, {
                        sku: v.sku,
                        regular_price: v.price,
                        sale_price: v.salePrice,
                        stock_status: v.stockStatus
                    });
                } catch (err: any) {
                    Logger.error(`Failed to sync variation ${v.id} to WooCommerce`, { error: err.message });
                }
            }));
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
                bool: {
                    should: [
                        // Exact SKU match (highest priority)
                        { term: { 'sku.keyword': { value: query.toUpperCase(), boost: 10 } } },
                        // SKU prefix match (for partial SKU typing)
                        { prefix: { 'sku.keyword': { value: query.toUpperCase(), boost: 5 } } },
                        // Fuzzy multi-match on name, description, sku
                        {
                            multi_match: {
                                query,
                                fields: ['name^2', 'description', 'sku^3'],
                                fuzziness: 'AUTO'
                            }
                        }
                    ],
                    minimum_should_match: 1
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
                // Sort by relevance score when searching, otherwise by date
                sort: query
                    ? [{ _score: { order: 'desc' } }, { date_created: { order: 'desc' } }] as any
                    : [{ date_created: { order: 'desc' } }] as any
            });

            const hits = response.hits.hits.map(hit => ({
                id: hit._id,
                ...(hit._source as any),
                // Ensure rawData is available if needed, or map specific fields
            }));

            // Check for BOMs to prevent circular/nested BOMs
            let productsWithBomStatus = hits;
            try {
                const productIds = hits
                    .map(h => h.id)
                    .filter(id => typeof id === 'string' && id.length > 0);

                if (productIds.length > 0) {
                    const productsInfo = await prisma.wooProduct.findMany({
                        where: {
                            id: { in: productIds }
                        },
                        select: {
                            id: true,
                            cogs: true,
                            boms: {
                                select: { id: true, items: { take: 1 } },
                                take: 1
                            }
                        }
                    });

                    const productMap = new Map(productsInfo.map(p => [p.id, p]));

                    productsWithBomStatus = hits.map(p => {
                        const info = productMap.get(p.id);
                        // Only consider it a BOM if it has items
                        const hasBOM = info ? (info.boms.length > 0 && info.boms[0].items.length > 0) : false;
                        return {
                            ...p,
                            cogs: info?.cogs ? Number(info.cogs) : 0,
                            hasBOM
                        };
                    });
                }
            } catch (err) {
                Logger.warn('Failed to check BOM status for products', { error: err });
                // Fallback to products without hasBOM flag
            }

            const total = (response.hits.total as any).value || 0;

            if (total === 0) {
                Logger.info('Elasticsearch returned 0 results, attempting DB fallback', { accountId, query });
                return this.searchProductsFromDB(accountId, query, page, limit);
            }

            return {
                products: productsWithBomStatus,
                total,
                page,
                totalPages: Math.ceil(total / limit)
            };
        } catch (error) {
            Logger.error('Elasticsearch Product Search Error, falling back to DB', { error });
            return this.searchProductsFromDB(accountId, query, page, limit);
        }
    }

    private static async searchProductsFromDB(accountId: string, query: string, page: number, limit: number) {
        const skip = (page - 1) * limit;

        const where: any = { accountId };

        if (query) {
            where.OR = [
                { name: { contains: query, mode: 'insensitive' } },
                { sku: { contains: query, mode: 'insensitive' } }
            ];
        }

        try {
            const [total, products] = await Promise.all([
                prisma.wooProduct.count({ where }),
                prisma.wooProduct.findMany({
                    where,
                    skip,
                    take: limit,
                    orderBy: { createdAt: 'desc' }
                })
            ]);

            const mappedProducts = products.map(p => {
                const raw = p.rawData as any || {};

                // Map images from JSON format if needed
                let images = [];
                if (Array.isArray(p.images)) {
                    images = p.images;
                } else if (Array.isArray(raw.images)) {
                    images = raw.images;
                }

                return {
                    id: p.id,
                    wooId: p.wooId,
                    name: p.name,
                    sku: p.sku,
                    stock_status: p.stockStatus,
                    stock_quantity: raw.stock_quantity ?? null,
                    low_stock_amount: raw.low_stock_amount ?? 5,
                    price: p.price ? Number(p.price) : 0,
                    date_created: p.createdAt,
                    mainImage: p.mainImage,
                    images,
                    categories: raw.categories || [],
                    seoScore: p.seoScore || 0,
                    merchantCenterScore: p.merchantCenterScore || 0,
                    cogs: p.cogs ? Number(p.cogs) : 0,
                    // Basic variation support for list view
                    variations: [],
                    // DB fallback doesn't calculate hasBOM efficiently without extra queries, can add if needed but skipping for robustness
                    hasBOM: false
                };
            });

            return {
                products: mappedProducts,
                total,
                page,
                totalPages: Math.ceil(total / limit)
            };
        } catch (dbError) {
            Logger.error('Database Product Search Error', { error: dbError });
            return { products: [], total: 0, page, totalPages: 0 };
        }
    }
}
