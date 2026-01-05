import { esClient } from '../utils/elastic';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

export class ProductsService {
    static async getProductByWooId(accountId: string, wooId: number) {
        const product = await prisma.wooProduct.findUnique({
            where: { accountId_wooId: { accountId, wooId } }
        });

        if (!product) return null;

        // Extract metadata from rawData if available
        const raw = product.rawData as any;
        console.log('[DEBUG] rawData keys:', Object.keys(raw || {})); // Debug extraction
        return {
            ...product,
            type: raw?.type || 'simple',
            variations: raw?.variations || [],
            description: raw?.description || '',
            short_description: raw?.short_description || '',
            // Fallback for when images column is empty (legacy sync)
            images: (Array.isArray(product.images) && product.images.length > 0) ? product.images : (raw?.images || [])
        };
    }

    static async updateProduct(accountId: string, wooId: number, data: any) {
        return prisma.wooProduct.update({
            where: { accountId_wooId: { accountId, wooId } },
            data: {
                binLocation: data.binLocation,
                name: data.name,
                stockStatus: data.stockStatus,
                sku: data.sku,
                price: data.price ? parseFloat(data.price) : undefined,
                weight: data.weight ? parseFloat(data.weight) : undefined,
                length: data.length ? parseFloat(data.length) : undefined,
                width: data.width ? parseFloat(data.width) : undefined,
                height: data.height ? parseFloat(data.height) : undefined,
                // @ts-ignore - TS2353: Persistent Docker build error masking this field
                isGoldPriceApplied: data.isGoldPriceApplied,
                cogs: data.cogs ? parseFloat(data.cogs) : undefined, // NEW
                supplierId: data.supplierId || null,                 // NEW
                images: data.images || undefined,                    // NEW
                // Merging into rawData for fields not yet in top-level schema
                rawData: {
                    update: {
                        sale_price: data.salePrice,
                        description: data.description,
                        short_description: data.short_description
                    }
                }
            }
        });
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
                body: {
                    query: {
                        bool: { must }
                    },
                    from,
                    size: limit,
                    sort: [{ date_created: { order: 'desc' } }]
                }
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
            console.error('Elasticsearch Product Search Error:', error);
            // Return empty result on error (or if index doesn't exist yet)
            return { products: [], total: 0, page, totalPages: 0 };
        }
    }
}
