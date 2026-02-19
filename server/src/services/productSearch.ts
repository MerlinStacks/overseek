/**
 * Product Search Service
 * 
 * Handles product search with Elasticsearch primary and database fallback.
 * Includes variant search, BOM status, and attribute matching.
 * Extracted from products.ts for maintainability.
 */

import { esClient } from '../utils/elastic';
import { prisma } from '../utils/prisma';
import { Logger } from '../utils/logger';

export interface SearchResult {
    products: any[];
    total: number;
    page: number;
    totalPages: number;
}

/**
 * Fetches searchable variants for a set of products
 * Used by both ES and DB search paths to avoid duplication
 */
async function fetchVariantsForProducts(productIds: string[]): Promise<Map<string, any[]>> {
    const variantMap = new Map<string, any[]>();
    if (productIds.length === 0) return variantMap;

    // First, find which products are actually variable from the DB
    const dbProducts = await prisma.wooProduct.findMany({
        where: { id: { in: productIds } },
        select: { id: true, rawData: true }
    });

    const productIdsForVariants = dbProducts
        .filter(p => {
            const raw = p.rawData as any || {};
            return raw.type?.includes('variable') || (raw.variations && raw.variations.length > 0);
        })
        .map(p => p.id);

    if (productIdsForVariants.length === 0) return variantMap;

    // Fetch from ProductVariation table
    const variants = await prisma.productVariation.findMany({
        where: { productId: { in: productIdsForVariants } },
        select: {
            id: true,
            productId: true,
            wooId: true,
            sku: true,
            stockQuantity: true,
            stockStatus: true,
            cogs: true,
            rawData: true
        }
    });

    for (const v of variants) {
        if (!variantMap.has(v.productId)) variantMap.set(v.productId, []);
        const rawData = v.rawData as any || {};
        variantMap.get(v.productId)!.push({
            ...v,
            cogs: v.cogs ? Number(v.cogs) : 0,
            attributes: rawData.attributes || [],
            attributeString: (rawData.attributes || [])
                .map((a: any) => a.option || a.value)
                .filter(Boolean)
                .join(' / ')
        });
    }


    return variantMap;
}

/**
 * Supplements ES results with products matching variant SKU or attributes
 */
async function supplementWithVariantMatches(
    accountId: string,
    query: string,
    existingProducts: any[],
    limit: number
): Promise<any[]> {
    const existingProductIds = existingProducts.map((p: any) => p.id);
    const searchWords = query.toLowerCase().trim().split(/\s+/).filter(w => w.length >= 2);

    // Find by variant SKU
    const skuMatches = await prisma.productVariation.findMany({
        where: {
            product: { accountId },
            sku: { contains: query, mode: 'insensitive' },
            productId: { notIn: existingProductIds }
        },
        select: { productId: true },
        distinct: ['productId'],
        take: limit
    });

    // Search variant attributes in rawData
    let attributeMatchProductIds: string[] = [];
    if (searchWords.length > 0 && existingProductIds.length < limit) {
        const candidateVariants = await prisma.productVariation.findMany({
            where: {
                product: { accountId },
                productId: { notIn: existingProductIds }
            },
            select: { productId: true, rawData: true },
            take: 500
        });

        const matchingProductIds = new Set<string>();
        for (const v of candidateVariants) {
            const rawData = v.rawData as any || {};
            const attributes = rawData.attributes || [];
            const attrString = attributes
                .map((a: any) => `${a.option || ''} ${a.value || ''}`)
                .join(' ')
                .toLowerCase();

            const matchCount = searchWords.filter(w => attrString.includes(w)).length;
            if (matchCount > 0) {
                matchingProductIds.add(v.productId);
            }
        }
        attributeMatchProductIds = Array.from(matchingProductIds);
    }

    // Combine SKU and attribute matches
    const allMatchedProductIds = [
        ...new Set([
            ...skuMatches.map(v => v.productId),
            ...attributeMatchProductIds
        ])
    ].filter(id => !existingProductIds.includes(id)).slice(0, limit);

    if (allMatchedProductIds.length === 0) return [];

    // Fetch full product details
    const additionalProducts = await prisma.wooProduct.findMany({
        where: { id: { in: allMatchedProductIds } },
        select: {
            id: true,
            wooId: true,
            name: true,
            sku: true,
            stockStatus: true,
            stockQuantity: true,
            price: true,
            cogs: true,
            mainImage: true,
            images: true,
            rawData: true,
            boms: { select: { id: true, items: { take: 1 } }, take: 1 }
        }
    });

    return additionalProducts.map(p => {
        const raw = p.rawData as any || {};
        const hasBOM = p.boms.length > 0 && p.boms[0].items.length > 0;
        return {
            id: p.id,
            wooId: p.wooId,
            name: p.name,
            sku: p.sku,
            stock_status: p.stockStatus,
            stock_quantity: p.stockQuantity ?? null,
            price: p.price ? Number(p.price) : 0,
            mainImage: p.mainImage,
            images: p.images || raw.images || [],
            cogs: p.cogs ? Number(p.cogs) : 0,
            hasBOM
        };
    });
}

/**
 * Enriches products with BOM status from database
 */
async function enrichWithBomStatus(products: any[]): Promise<any[]> {
    const productIds = products
        .map(h => h.id)
        .filter(id => typeof id === 'string' && id.length > 0);

    if (productIds.length === 0) return products;

    const productsInfo = await prisma.wooProduct.findMany({
        where: { id: { in: productIds } },
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

    return products.map(p => {
        const info = productMap.get(p.id);
        const hasBOM = info ? (info.boms.length > 0 && info.boms[0].items.length > 0) : false;
        return {
            ...p,
            cogs: info?.cogs ? Number(info.cogs) : 0,
            hasBOM
        };
    });
}

export class ProductSearchService {
    /**
     * Search products using Elasticsearch with database fallback
     */
    static async searchProducts(
        accountId: string,
        query: string = '',
        page: number = 1,
        limit: number = 20
    ): Promise<SearchResult> {
        const from = (page - 1) * limit;

        const must: any[] = [{ term: { accountId } }];

        if (query) {
            must.push({
                bool: {
                    should: [
                        { term: { 'sku.keyword': { value: query.toUpperCase(), boost: 10 } } },
                        { prefix: { 'sku.keyword': { value: query.toUpperCase(), boost: 5 } } },
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
                query: { bool: { must } },
                from,
                size: limit,
                sort: query
                    ? [{ _score: { order: 'desc' } }, { date_created: { order: 'desc' } }] as any
                    : [{ date_created: { order: 'desc' } }] as any
            });

            const hits = response.hits.hits.map(hit => ({
                id: hit._id,
                ...(hit._source as any),
            }));

            const total = (response.hits.total as any).value || 0;

            if (total === 0) {
                Logger.info('Elasticsearch returned 0 results, attempting DB fallback', { accountId, query });
                return this.searchProductsFromDB(accountId, query, page, limit);
            }

            // Enrich with BOM status
            let products = await enrichWithBomStatus(hits);

            // Supplement with variant matches
            if (query) {
                try {
                    const additional = await supplementWithVariantMatches(accountId, query, products, limit);
                    products = [...products, ...additional];
                } catch (err) {
                    Logger.warn('Failed to supplement ES results with variant matches', { error: err });
                }
            }

            // Fetch variants for variable products
            try {
                const productIds = products.map((p: any) => p.id).filter(id => typeof id === 'string');
                const variantMap = await fetchVariantsForProducts(productIds);
                products = products.map((p: any) => ({
                    ...p,
                    searchableVariants: variantMap.get(p.id) || []
                }));
            } catch (err) {
                Logger.warn('Failed to fetch variants for products', { error: err });
            }

            return {
                products,
                total,
                page,
                totalPages: Math.ceil(total / limit)
            };
        } catch (error) {
            Logger.error('Elasticsearch Product Search Error, falling back to DB', { error });
            return this.searchProductsFromDB(accountId, query, page, limit);
        }
    }

    /**
     * Database fallback search when Elasticsearch is unavailable
     */
    static async searchProductsFromDB(
        accountId: string,
        query: string,
        page: number,
        limit: number
    ): Promise<SearchResult> {
        const skip = (page - 1) * limit;

        // Search by variant SKU
        let variantMatchedProductIds: string[] = [];
        if (query) {
            try {
                const matchingVariants = await prisma.productVariation.findMany({
                    where: {
                        product: { accountId },
                        sku: { contains: query, mode: 'insensitive' }
                    },
                    select: { productId: true },
                    distinct: ['productId']
                });
                variantMatchedProductIds = matchingVariants.map(v => v.productId);
            } catch (err) {
                Logger.warn('Failed to search variants by SKU', { error: err });
            }
        }

        // Build WHERE clause
        const finalWhere: any = { accountId };
        if (query) {
            finalWhere.OR = [
                { name: { contains: query, mode: 'insensitive' } },
                { sku: { contains: query, mode: 'insensitive' } },
                ...(variantMatchedProductIds.length > 0 ? [{ id: { in: variantMatchedProductIds } }] : [])
            ];
        }

        try {
            const [total, products] = await Promise.all([
                prisma.wooProduct.count({ where: finalWhere }),
                prisma.wooProduct.findMany({
                    where: finalWhere,
                    skip,
                    take: limit,
                    orderBy: { createdAt: 'desc' },
                    select: {
                        id: true,
                        wooId: true,
                        name: true,
                        sku: true,
                        stockStatus: true,
                        stockQuantity: true,
                        price: true,
                        cogs: true,
                        mainImage: true,
                        images: true,
                        seoScore: true,
                        merchantCenterScore: true,
                        rawData: true,
                        createdAt: true
                    }
                })
            ]);

            let mappedProducts = products.map(p => {
                const raw = p.rawData as any || {};
                let images = Array.isArray(p.images) ? p.images :
                    Array.isArray(raw.images) ? raw.images : [];

                return {
                    id: p.id,
                    wooId: p.wooId,
                    name: p.name,
                    sku: p.sku,
                    type: raw.type,
                    stock_status: p.stockStatus,
                    stock_quantity: p.stockQuantity ?? null,
                    low_stock_amount: raw.low_stock_amount ?? 5,
                    price: p.price ? Number(p.price) : 0,
                    date_created: p.createdAt,
                    mainImage: p.mainImage,
                    images,
                    categories: raw.categories || [],
                    seoScore: p.seoScore || 0,
                    merchantCenterScore: p.merchantCenterScore || 0,
                    cogs: p.cogs ? Number(p.cogs) : 0,
                    variations: raw.variations || [],
                    hasBOM: false,
                    searchableVariants: []
                };
            });

            // Fetch variants
            try {
                const productIds = mappedProducts.map(p => p.id);
                const variantMap = await fetchVariantsForProducts(productIds);
                mappedProducts = mappedProducts.map((p: any) => ({
                    ...p,
                    searchableVariants: variantMap.get(p.id) || []
                }));
            } catch (variantErr) {
                Logger.warn('Failed to fetch variants in DB fallback', { error: variantErr });
            }

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
