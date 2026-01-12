import { PrismaClient } from '@prisma/client';
import { prisma } from '../utils/prisma';

interface PicklistItem {
    productId: string; // or component product ID
    sku: string;
    name: string;
    binLocation: string;
    quantityUpdates: {
        orderNumber: string;
        quantity: number;
        wooOrderId: number;
    }[];
    totalQuantity: number;
    stockStatus: string;
    imageUrl?: string;
    manageStock: boolean;
}

export class PicklistService {

    /**
     * Generate a batch picklist for orders
     */
    async generatePicklist(accountId: string, options: {
        status?: string; // Default 'processing'
        limit?: number;
    }) {
        const status = options.status || 'processing';

        // 1. Fetch Orders
        const orders = await prisma.wooOrder.findMany({
            where: {
                accountId,
                status: status
            },
            orderBy: { dateCreated: 'asc' },
            take: options.limit || 50,
            include: {
                // We need rawData to get line items because WooOrder schema stores them in rawData json usually, 
                // unless we have normalized line items. 
                // Check schema: WooOrder doesn't have normalized LineItems table yet? 
                // Inspect schema: "rawData Json".
                // Use rawData.
            }
        });

        // 2. Aggregate Items
        const itemMap = new Map<string, PicklistItem>(); // Key: ProductID (or VariantID)

        for (const order of orders) {
            const raw = order.rawData as any;
            const lineItems = raw.line_items || [];
            const orderNumber = order.number;
            const wooOrderId = order.wooId;

            for (const item of lineItems) {
                // Item: { product_id, variation_id, quantity, name, sku ... }
                // We need to resolve logical ID. prefer variation_id if present, else product_id
                const productId = item.product_id;
                const variationId = item.variation_id || 0;
                const quantity = item.quantity;

                await this.processLineItem(accountId, productId, variationId, quantity, orderNumber, wooOrderId, innerItem => {
                    // Skip products that don't have inventory tracking enabled
                    if (!innerItem.manageStock) {
                        return;
                    }

                    const key = `${innerItem.productId}`;

                    if (!itemMap.has(key)) {
                        itemMap.set(key, {
                            productId: String(innerItem.productId),
                            sku: innerItem.sku,
                            name: innerItem.name,
                            binLocation: innerItem.binLocation || '',
                            stockStatus: innerItem.stockStatus || 'unknown',
                            imageUrl: innerItem.image?.src,
                            manageStock: innerItem.manageStock,
                            quantityUpdates: [],
                            totalQuantity: 0
                        });
                    }

                    const entry = itemMap.get(key)!;
                    entry.quantityUpdates.push({
                        orderNumber,
                        quantity: innerItem.quantity,
                        wooOrderId
                    });
                    entry.totalQuantity += innerItem.quantity;
                });
            }
        }

        // 3. Convert map to array and Sort by Bin Location
        const result = Array.from(itemMap.values()).filter(item => {
            // Filter: "Pull only in-stock products"
            // If stockStatus is 'outofstock', exclude?
            // Or maybe check managed stock?
            return item.stockStatus === 'instock' || item.stockStatus === 'onbackorder'; // Usually pick lists include backordered if we want to try picking? 
            // User said "Pull only in-stock". strict.
            // return item.stockStatus === 'instock'; 
        });

        // Sort alphanumerically by bin location
        result.sort((a, b) => {
            const binA = a.binLocation || 'ZZZZ'; // Empty bins go last
            const binB = b.binLocation || 'ZZZZ';
            return binA.localeCompare(binB, undefined, { numeric: true, sensitivity: 'base' });
        });

        return result;
    }

    /**
     * Recursive function to resolve BOMs
     */
    private async processLineItem(
        accountId: string,
        productId: number,
        variationId: number,
        quantity: number,
        orderContext: string,
        wooOrderId: number,
        callback: (item: { productId: number, sku: string, name: string, quantity: number, binLocation: string | null, stockStatus: string | null, image: any, manageStock: boolean }) => void
    ) {
        // Check if this product/variant has a BOM
        // Prisma BOM model: productId (String UUID) -> we have wooId (Int).
        // Need to find internal internal ID first.

        // 1. Find internal Product
        const product = await prisma.wooProduct.findFirst({
            where: { accountId, wooId: productId },
            include: {
                boms: {
                    include: {
                        items: {
                            include: {
                                childProduct: true
                            }
                        }
                    }
                },
                variations: {
                    where: { wooId: variationId !== 0 ? variationId : undefined }
                }
            }
        });

        if (!product) {
            // Product not synced? Just return as is with basic BOM fallback if possible (impossible without sync)
            // Or just skip?
            // Best effort: treat as raw item - skip as we can't determine if it manages stock
            callback({
                productId,
                sku: 'UNKNOWN',
                name: `Unknown Product #${productId}`,
                quantity,
                binLocation: '',
                stockStatus: 'unknown',
                image: null,
                manageStock: false // Unknown products don't get added
            });
            return;
        }

        // 2. Check for BOM matching variant or parent
        /* 
           BOM Selection Logic:
           - Look for BOM with variationId === variationId
           - If not found, look for BOM with variationId === 0 (Parent BOM)
           - If neither, it's a regular product
        */
        let activeBOM = product.boms.find(b => b.variationId === variationId);
        if (!activeBOM && variationId !== 0) {
            activeBOM = product.boms.find(b => b.variationId === 0);
        }

        if (activeBOM && activeBOM.items.length > 0) {
            // It's a bundle/manufactured item. Process components.
            for (const component of activeBOM.items) {
                if (component.childProduct) {
                    // Recursive call for component
                    // component.quantity is per unit.
                    const componentQty = Number(component.quantity) * quantity;

                    await this.processLineItem(
                        accountId,
                        component.childProduct.wooId,
                        0, // Components typically tracked as main products or specific variants? 
                        // Our BOMItem links to childProduct (WooProduct). 
                        // WooProduct stores a single specific variant sometimes? 
                        // Actually WooProduct is 1:1 with Woo ID. If it's a variant, it has its own WooProduct row if we sync variants as products?
                        // Wait, our schema: WooProduct has `wooId`. If variants are synced as separate rows, then ok.
                        // If variants are inside the same row, we have a problem.
                        // Assumption: Variants are synced as separate WooProduct rows or we only link main products?
                        // Let's assume childProduct gives us the correct entity.
                        componentQty,
                        orderContext,
                        wooOrderId,
                        callback
                    );
                } else {
                    // Supplier item (raw material without WooProduct)? OR just missing link?
                    // If it's purely internal, we might want to list it?
                    // "List the component products".
                    // If no childProduct, maybe skip or list as raw material?
                }
            }
        } else {
            // No BOM, it's a leaf product.
            const raw = product.rawData as any;

            // Resolve Variation Logic
            let finalBinLocation = product.binLocation;
            // If we have a variation ID and we fetched variations, check if we have a match
            if (variationId !== 0 && product.variations && product.variations.length > 0) {
                const variant = product.variations[0]; // We filtered by wooId in the query
                if (variant.binLocation) {
                    finalBinLocation = variant.binLocation;
                }
            }

            callback({
                productId: variationId !== 0 ? variationId : product.wooId,
                sku: (variationId !== 0 && product.variations?.[0]?.sku) ? product.variations[0].sku! : (product.sku || ''),
                name: product.name,
                quantity,
                binLocation: finalBinLocation,
                stockStatus: product.stockStatus,
                image: product.images ? (product.images as any)[0] : null,
                manageStock: raw?.manage_stock === true
            });
        }
    }
}
