/**
 * Products Service
 * 
 * CRUD operations for products. Search functionality delegated to ProductSearchService.
 */

import { prisma } from '../utils/prisma';
import { Logger } from '../utils/logger';
import { WooService, WooProductData } from './woo';
import { ProductSearchService } from './productSearch';

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
        Logger.debug('rawData keys', { keys: Object.keys(raw || {}) });

        const variationIds: number[] = raw?.variations || [];
        const variationsData: any[] = raw?.variationsData || [];

        // Fetch local variation overrides (COGS, binLocation, miscCosts)
        const localVariations = await prisma.productVariation.findMany({
            where: { productId: product.id }
        });

        const mergedVariations = variationIds.map((vId: number) => {
            const fullData = variationsData.find((v: any) => v.id === vId);
            const localVariant = localVariations.find(lv => lv.wooId === vId);

            const weight = localVariant?.weight?.toString() || fullData?.weight || '';
            const length = localVariant?.length?.toString() || fullData?.dimensions?.length || '';
            const width = localVariant?.width?.toString() || fullData?.dimensions?.width || '';
            const height = localVariant?.height?.toString() || fullData?.dimensions?.height || '';

            return {
                id: vId,
                sku: fullData?.sku || '',
                price: fullData?.price || '',
                salePrice: fullData?.sale_price || '',
                stockStatus: fullData?.stock_status || 'instock',
                stockQuantity: fullData?.stock_quantity ?? null,
                manageStock: fullData?.manage_stock ?? false,
                backorders: fullData?.backorders || 'no',
                weight,
                dimensions: { length, width, height },
                cogs: localVariant?.cogs?.toString() || '',
                miscCosts: localVariant?.miscCosts || [],
                binLocation: localVariant?.binLocation || '',
                isGoldPriceApplied: localVariant?.isGoldPriceApplied || false,
                goldPriceType: localVariant?.goldPriceType || null,
                image: fullData?.image || null,
                images: fullData?.image ? [fullData.image] : [],
                attributes: fullData?.attributes || []
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

        // Sync manage_stock and backorders to WooCommerce
        if (productData.manageStock !== undefined || productData.backorders !== undefined) {
            try {
                const wooService = await WooService.forAccount(accountId);
                const wooUpdateData: any = {};
                if (productData.manageStock !== undefined) wooUpdateData.manage_stock = productData.manageStock;
                if (productData.backorders !== undefined) wooUpdateData.backorders = productData.backorders;
                await wooService.updateProduct(wooId, wooUpdateData);
            } catch (err: any) {
                Logger.error('Failed to sync manage_stock/backorders to WooCommerce', { error: err.message, wooId });
            }
        }

        // Handle Variations Upsert & Sync
        if (variations && Array.isArray(variations)) {
            const wooService = await WooService.forAccount(accountId);

            await Promise.all(variations.map(async (v) => {
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
                } catch (err: any) {
                    Logger.error(`Failed to process variation ${v.id}`, { error: err.message, productWooId: wooId });
                }
            }));
        }

        return updated;
    }

    /**
     * Search products in Elasticsearch (delegates to ProductSearchService)
     */
    static async searchProducts(accountId: string, query: string = '', page: number = 1, limit: number = 20) {
        return ProductSearchService.searchProducts(accountId, query, page, limit);
    }
}
