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
                manageStock: fullData?.manage_stock ?? false,
                backorders: fullData?.backorders || 'no',
                weight: fullData?.weight || '',
                dimensions: {
                    length: fullData?.dimensions?.length || '',
                    width: fullData?.dimensions?.width || '',
                    height: fullData?.dimensions?.height || ''
                },
                cogs: localVariant?.cogs?.toString() || '',
                miscCosts: localVariant?.miscCosts || [],
                binLocation: localVariant?.binLocation || '',
                isGoldPriceApplied: localVariant?.isGoldPriceApplied || false,
                goldPriceType: localVariant?.goldPriceType || null,
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
            backorders: raw?.backorders || 'no',
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

        // Sync manage_stock and backorders to WooCommerce for parent product
        if (productData.manageStock !== undefined || productData.backorders !== undefined) {
            try {
                const { WooService } = await import('./woo');
                const wooService = await WooService.forAccount(accountId);
                const wooUpdateData: any = {};
                if (productData.manageStock !== undefined) wooUpdateData.manage_stock = productData.manageStock;
                if (productData.backorders !== undefined) wooUpdateData.backorders = productData.backorders;
                await wooService.updateProduct(wooId, wooUpdateData);
            } catch (err: any) {
                Logger.error('Failed to sync manage_stock/backorders to WooCommerce', { error: err.message, wooId });
            }
        }

        // 2. Handle Variations Upsert & Sync
        if (variations && Array.isArray(variations)) {
            const { WooService } = await import('./woo');
            const wooService = await WooService.forAccount(accountId);

            // Parallelize variation updates for performance
            await Promise.all(variations.map(async (v) => {
                // Guard: Skip variations without a valid WooCommerce ID
                if (!v.id || typeof v.id !== 'number' || v.id <= 0) {
                    Logger.warn(`Skipping variation with invalid ID`, { variationData: v, productWooId: wooId });
                    return;
                }

                try {
                    // Update local DB for variations
                    await prisma.productVariation.upsert({
                        where: { productId_wooId: { productId: updated.id, wooId: v.id } },
                        update: {
                            cogs: v.cogs ? parseFloat(v.cogs) : undefined,
                            miscCosts: v.miscCosts || undefined,
                            binLocation: v.binLocation,
                            isGoldPriceApplied: v.isGoldPriceApplied,
                            goldPriceType: v.goldPriceType,
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
                            isGoldPriceApplied: v.isGoldPriceApplied || false,
                            goldPriceType: v.goldPriceType || null,
                            sku: v.sku,
                            price: v.price ? parseFloat(v.price) : undefined,
                            salePrice: v.salePrice ? parseFloat(v.salePrice) : undefined,
                            stockStatus: v.stockStatus
                        }
                    });

                    // Sync to Woo (Only synced fields)
                    // Variations require the parent product ID for the WooCommerce endpoint:
                    // PUT /products/{parent_id}/variations/{variation_id}
                    await wooService.updateProductVariation(wooId, v.id, {
                        sku: v.sku,
                        regular_price: v.price,
                        sale_price: v.salePrice,
                        stock_status: v.stockStatus,
                        manage_stock: v.manageStock,
                        backorders: v.backorders
                    });
                } catch (err: any) {
                    Logger.error(`Failed to process variation ${v.id}`, { error: err.message, productWooId: wooId });
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

            // Supplement ES results with products matching variant SKU (ES doesn't index variant SKUs)
            if (query) {
                try {
                    const existingProductIds = productsWithBomStatus.map((p: any) => p.id);
                    const matchingVariants = await prisma.productVariation.findMany({
                        where: {
                            product: { accountId },
                            sku: { contains: query, mode: 'insensitive' },
                            productId: { notIn: existingProductIds }
                        },
                        select: { productId: true },
                        distinct: ['productId'],
                        take: limit
                    });

                    if (matchingVariants.length > 0) {
                        // Fetch full product details for variant-matched products
                        const additionalProducts = await prisma.wooProduct.findMany({
                            where: { id: { in: matchingVariants.map(v => v.productId) } },
                            select: {
                                id: true,
                                wooId: true,
                                name: true,
                                sku: true,
                                stockStatus: true,
                                price: true,
                                cogs: true,
                                mainImage: true,
                                images: true,
                                rawData: true,
                                boms: { select: { id: true, items: { take: 1 } }, take: 1 }
                            }
                        });

                        const mappedAdditional = additionalProducts.map(p => {
                            const raw = p.rawData as any || {};
                            const hasBOM = p.boms.length > 0 && p.boms[0].items.length > 0;
                            return {
                                id: p.id,
                                wooId: p.wooId,
                                name: p.name,
                                sku: p.sku,
                                stock_status: p.stockStatus,
                                stock_quantity: raw.stock_quantity ?? null,
                                price: p.price ? Number(p.price) : 0,
                                mainImage: p.mainImage,
                                images: p.images || raw.images || [],
                                cogs: p.cogs ? Number(p.cogs) : 0,
                                hasBOM
                            };
                        });

                        productsWithBomStatus = [...productsWithBomStatus, ...mappedAdditional];
                    }
                } catch (err) {
                    Logger.warn('Failed to supplement ES results with variant SKU matches', { error: err });
                }
            }

            // Fetch variants for variable products to enable BOM component selection
            // We check ALL products against the DB since ES may not have type field indexed yet
            try {
                const allProductIds = productsWithBomStatus
                    .map((p: any) => p.id)
                    .filter((id: string) => typeof id === 'string' && id.length > 0);

                if (allProductIds.length > 0) {
                    // First, find which products are actually variable from the DB
                    const dbProducts = await prisma.wooProduct.findMany({
                        where: { id: { in: allProductIds } },
                        select: { id: true, rawData: true }
                    });

                    const productIdsForVariants = dbProducts
                        .filter(p => {
                            const raw = p.rawData as any || {};
                            return raw.type?.includes('variable') || (raw.variations && raw.variations.length > 0);
                        })
                        .map(p => p.id);

                    if (productIdsForVariants.length > 0) {
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

                        const variantMap = new Map<string, any[]>();
                        for (const v of variants) {
                            if (!variantMap.has(v.productId)) variantMap.set(v.productId, []);
                            const rawData = v.rawData as any || {};
                            variantMap.get(v.productId)!.push({
                                ...v,
                                cogs: v.cogs ? Number(v.cogs) : 0,
                                // Extract variant attributes for display name
                                attributes: rawData.attributes || [],
                                attributeString: (rawData.attributes || [])
                                    .map((a: any) => a.option || a.value)
                                    .filter(Boolean)
                                    .join(' / ')
                            });
                        }

                        // FALLBACK: For products with no ProductVariation records, check rawData.variationsData
                        // This handles products that have been synced but don't have persistent variant records
                        const productsNeedingFallback = productIdsForVariants.filter(id => !variantMap.has(id));
                        if (productsNeedingFallback.length > 0) {
                            // Also fetch any ProductVariation records that might exist for COGS
                            const fallbackVariations = await prisma.productVariation.findMany({
                                where: { productId: { in: productsNeedingFallback } },
                                select: { productId: true, wooId: true, cogs: true }
                            });
                            const cogsLookup = new Map<string, number>();
                            for (const fv of fallbackVariations) {
                                cogsLookup.set(`${fv.productId}:${fv.wooId}`, fv.cogs ? Number(fv.cogs) : 0);
                            }

                            for (const p of dbProducts.filter(db => productsNeedingFallback.includes(db.id))) {
                                const raw = p.rawData as any || {};
                                const variationsData: any[] = raw.variationsData || [];
                                if (variationsData.length > 0) {
                                    variantMap.set(p.id, variationsData.map((v: any) => ({
                                        id: `${p.id}:${v.id}`, // Unique ID for React key
                                        productId: p.id,
                                        wooId: v.id,
                                        sku: v.sku || '',
                                        stockQuantity: v.stock_quantity ?? null,
                                        stockStatus: v.stock_status || 'instock',
                                        cogs: cogsLookup.get(`${p.id}:${v.id}`) || 0,
                                        attributes: v.attributes || [],
                                        attributeString: (v.attributes || [])
                                            .map((a: any) => a.option || a.value)
                                            .filter(Boolean)
                                            .join(' / ')
                                    })));
                                }
                            }
                        }

                        productsWithBomStatus = productsWithBomStatus.map((p: any) => ({
                            ...p,
                            searchableVariants: variantMap.get(p.id) || []
                        }));
                    }
                }
            } catch (err) {
                Logger.warn('Failed to fetch variants for products', { error: err });
                // Continue without variants - products will still be selectable
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

        // First, find products matching by name or parent SKU
        const mainWhere: any = { accountId };

        if (query) {
            mainWhere.OR = [
                { name: { contains: query, mode: 'insensitive' } },
                { sku: { contains: query, mode: 'insensitive' } }
            ];
        }

        // Also search by variant SKU - find parent product IDs for variants matching the query
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

        // Merge: products matching name/SKU OR products with matching variant SKU
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
                    type: raw.type, // Include type for variable product detection
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
                    variations: raw.variations || [],
                    hasBOM: false,
                    searchableVariants: [] // Will be populated below
                };
            });

            // Fetch variants for variable products (same logic as ES path)
            try {
                const productIdsForVariants = mappedProducts
                    .filter((p: any) => p.type?.includes('variable') || (p.variations && p.variations.length > 0))
                    .map((p: any) => p.id);

                if (productIdsForVariants.length > 0) {
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

                    const variantMap = new Map<string, any[]>();
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

                    // FALLBACK: Check rawData.variationsData for products without ProductVariation records
                    const productsNeedingFallback = productIdsForVariants.filter(id => !variantMap.has(id));
                    if (productsNeedingFallback.length > 0) {
                        // Fetch COGS from ProductVariation for fallback products
                        const fallbackVariations = await prisma.productVariation.findMany({
                            where: { productId: { in: productsNeedingFallback } },
                            select: { productId: true, wooId: true, cogs: true }
                        });
                        const cogsLookup = new Map<string, number>();
                        for (const fv of fallbackVariations) {
                            cogsLookup.set(`${fv.productId}:${fv.wooId}`, fv.cogs ? Number(fv.cogs) : 0);
                        }

                        for (const p of mappedProducts) {
                            if (!productsNeedingFallback.includes(p.id)) continue;
                            // Fetch rawData from DB since mappedProducts doesn't have variationsData
                            const product = await prisma.wooProduct.findUnique({
                                where: { id: p.id },
                                select: { rawData: true }
                            });
                            const raw = product?.rawData as any || {};
                            const variationsData: any[] = raw.variationsData || [];
                            if (variationsData.length > 0) {
                                variantMap.set(p.id, variationsData.map((v: any) => ({
                                    id: `${p.id}:${v.id}`, // Unique ID for React key
                                    productId: p.id,
                                    wooId: v.id,
                                    sku: v.sku || '',
                                    stockQuantity: v.stock_quantity ?? null,
                                    stockStatus: v.stock_status || 'instock',
                                    cogs: cogsLookup.get(`${p.id}:${v.id}`) || 0,
                                    attributes: v.attributes || [],
                                    attributeString: (v.attributes || [])
                                        .map((a: any) => a.option || a.value)
                                        .filter(Boolean)
                                        .join(' / ')
                                })));
                            }
                        }
                    }

                    mappedProducts = mappedProducts.map((p: any) => ({
                        ...p,
                        searchableVariants: variantMap.get(p.id) || []
                    }));
                }
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
