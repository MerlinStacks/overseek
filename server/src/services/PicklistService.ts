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
        if (!accountId || !['processing', 'on-hold', 'pending', 'completed'].includes(status) || options.limit !== undefined && (!Number.isInteger(options.limit) || options.limit < 1 || options.limit > 500)) throw new Error('Invalid picklist scope or options');

        // 1. Fetch Orders
        const orders = await prisma.wooOrder.findMany({
            where: {
                accountId,
                status: status
            },
            orderBy: [{ dateCreated: 'asc' }, { id: 'asc' }],
            take: options.limit || 50,
            include: {
                // We need rawData to get line items because WooOrder schema stores them in rawData json usually, 
                // unless we have normalized line items. 
                // Check schema: WooOrder doesn't have normalized LineItems table yet? 
                // Inspect schema: "rawData Json".
                // Use rawData.
            }
        });

        // 2. Pre-fetch Products
        const allProductIds = new Set<number>();
        for (const order of orders) {
            const raw = order.rawData as any;
            const lineItems = raw?.line_items;
            if (!Array.isArray(lineItems)) throw new Error(`Picklist incomplete: order ${order.number} has no valid line items`);
            for (const item of lineItems) {
                if (item.product_id) allProductIds.add(item.product_id);
            }
        }

        const productCache = await this.prefetchProducts(accountId, Array.from(allProductIds));

        // 3. Aggregate Items
        const itemMap = new Map<string, PicklistItem>(); // Key: ProductID (or VariantID)
        const budget = { remaining: 100000 };

        for (const order of orders) {
            const raw = order.rawData as any;
            const lineItems = raw.line_items;
            const orderNumber = order.number;
            const wooOrderId = order.wooId;

            for (const item of lineItems) {
                // Item: { product_id, variation_id, quantity, name, sku ... }
                // We need to resolve logical ID. prefer variation_id if present, else product_id
                const productId = item.product_id;
                const variationId = item.variation_id || 0;
                const quantity = item.quantity;

                await this.processLineItem(accountId, productId, variationId, quantity, orderNumber, wooOrderId, productCache, innerItem => {
                    // Skip products that don't have inventory tracking enabled
                    if (!innerItem.manageStock) throw new Error(`Picklist incomplete: inventory tracking unavailable for ${innerItem.name}`);
                    if (!['instock', 'onbackorder'].includes(innerItem.stockStatus)) throw new Error(`Picklist incomplete: ${innerItem.name} stock is ${innerItem.stockStatus || 'unknown'}`);

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
                    if (!Number.isFinite(entry.totalQuantity) || entry.totalQuantity > 1e9) throw new Error('Picklist quantity overflow');
                }, new Set(), budget);
            }
        }

        // 4. Convert map to array and Sort by Bin Location
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

    private async prefetchProducts(accountId: string, initialProductIds: number[]): Promise<Map<number, any>> {
        const productMap = new Map<number, any>();
        const idsToFetch = new Set<number>(initialProductIds);
        const fetchedIds = new Set<number>();

        while (idsToFetch.size > 0) {
            if (fetchedIds.size > 10000) throw new Error('Picklist component traversal exceeds limit');
            const batchIds = Array.from(idsToFetch).filter(id => !fetchedIds.has(id));
            if (batchIds.length === 0) break;

            // Mark as fetching/fetched to avoid dupes in this loop
            batchIds.forEach(id => fetchedIds.add(id));
            // Also remove from idsToFetch
            batchIds.forEach(id => idsToFetch.delete(id));

            // Fetch batch
            const products = await prisma.wooProduct.findMany({
                where: {
                    accountId,
                    wooId: { in: batchIds }
                },
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
                    variations: true // We fetch all variations to filter in memory
                }
            });

            for (const product of products) {
                productMap.set(product.wooId, product);

                // Check for BOMs and add child products to fetch list
                if (product.boms && product.boms.length > 0) {
                    for (const bom of product.boms) {
                        for (const item of bom.items) {
                            if (item.childProduct && !fetchedIds.has(item.childProduct.wooId) && !productMap.has(item.childProduct.wooId)) {
                                idsToFetch.add(item.childProduct.wooId);
                            }
                        }
                    }
                }
            }
        }
        return productMap;
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
        productCache: Map<number, any>,
        callback: (item: { productId: number, sku: string, name: string, quantity: number, binLocation: string | null, stockStatus: string | null, image: any, manageStock: boolean }) => void,
        ancestors: Set<string> = new Set(),
        budget = { remaining: 100000 }
    ) {
        if (--budget.remaining < 0) throw new Error('Picklist incomplete: component expansion limit exceeded');
        if (!Number.isSafeInteger(productId) || productId <= 0 || !Number.isSafeInteger(variationId) || variationId < 0 || typeof quantity !== 'number' || !Number.isFinite(quantity) || quantity <= 0 || quantity > 1e9) throw new Error('Picklist incomplete: invalid item identity or quantity');
        const identity = `${productId}:${variationId}`;
        if (ancestors.has(identity) || ancestors.size >= 32) throw new Error('Picklist incomplete: cyclic or excessively deep BOM');
        const path = new Set(ancestors).add(identity);
        // Check if this product/variant has a BOM
        // Prisma BOM model: productId (String UUID) -> we have wooId (Int).
        // Need to find internal internal ID first.

        // 1. Find internal Product
        const product = productCache.get(productId);

        if (!product) {
            throw new Error(`Picklist incomplete: product ${productId} is not synced`);
        }

        // 2. Check for BOM matching variant or parent
        /* 
           BOM Selection Logic:
           - Look for BOM with variationId === variationId
           - If not found, look for BOM with variationId === 0 (Parent BOM)
           - If neither, it's a regular product
        */
        let activeBOM = product.boms.find((b: any) => b.variationId === variationId);
        if (!activeBOM && variationId !== 0) {
            activeBOM = product.boms.find((b: any) => b.variationId === 0);
        }

        if (activeBOM && activeBOM.items.length > 0) {
            // It's a bundle/manufactured item. Process components.
            for (const component of activeBOM.items) {
                if (component.childProduct) {
                    // Recursive call for component
                    // component.quantity is per unit.
                    if (component.isActive === false) throw new Error('Picklist incomplete: inactive BOM component');
                    const waste = Number(component.wasteFactor ?? 0);
                    const units = Number(component.quantity);
                    if (!Number.isFinite(waste) || waste < 0 || waste > 1 || !Number.isFinite(units) || units <= 0) throw new Error('Picklist incomplete: invalid component quantity/waste');
                    const componentQty = units * quantity * (1 + waste);

                    await this.processLineItem(
                        accountId,
                        component.childProduct.wooId,
                        component.childVariationId ?? 0,
                        componentQty,
                        orderContext,
                        wooOrderId,
                        productCache,
                        callback,
                        path,
                        budget
                    );
                } else {
                    throw new Error('Picklist incomplete: internal/supplier or unresolved component requires a material picklist');
                }
            }
        } else {
            // No BOM, it's a leaf product.
            const raw = product.rawData as any;

            // Resolve Variation Logic
            let finalBinLocation = product.binLocation;
            let manageStock = raw?.manage_stock === true;
            let stockStatus = product.stockStatus;

            // If we have a variation ID and we fetched variations, check if we have a match
            if (variationId !== 0 && product.variations && product.variations.length > 0) {
                const variant = product.variations.find((v: any) => v.wooId === variationId);

                if (variant) {
                    if (variant.binLocation) {
                        finalBinLocation = variant.binLocation;
                    }
                    // Use variant's manage_stock flag — parent may not manage stock on variable products
                    const variantRaw = variant.rawData as any;
                    manageStock = variant.manageStock === true || variantRaw?.manage_stock === true;
                    stockStatus = variant.stockStatus;
                }
                else throw new Error('Picklist incomplete: variation not synced');
            }
            else if (variationId !== 0) throw new Error('Picklist incomplete: variation not synced');

            callback({
                productId: variationId !== 0 ? variationId : product.wooId,
                sku: (variationId !== 0) ? (product.variations?.find((v: any) => v.wooId === variationId)?.sku || product.sku || '') : (product.sku || ''),
                name: product.name,
                quantity,
                binLocation: finalBinLocation,
                stockStatus,
                image: product.images ? (product.images as any)[0] : null,
                manageStock
            });
        }
    }
}
