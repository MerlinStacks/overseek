import { prisma } from '../../../utils/prisma';
import type { ManagedProduct } from './types';

export async function getManagedStockProducts(accountId: string): Promise<ManagedProduct[]> {
    const products = await prisma.wooProduct.findMany({
        where: { accountId },
        select: {
            id: true,
            wooId: true,
            name: true,
            sku: true,
            mainImage: true,
            stockQuantity: true,
            manageStock: true,
            rawData: true,
            supplier: { select: { leadTimeDefault: true } },
            boms: {
                select: {
                    variationId: true,
                    items: { select: { id: true }, take: 1 }
                }
            },
            variations: {
                select: {
                    id: true,
                    wooId: true,
                    sku: true,
                    stockQuantity: true,
                    manageStock: true,
                    rawData: true
                }
            }
        }
    });

    const result: ManagedProduct[] = [];

    for (const p of products) {
        const hasParentBOM = p.boms.some(bom => bom.variationId === 0 && bom.items.length > 0);
        const anyVariationHasBOM = p.variations.some(v =>
            p.boms.some(bom => bom.variationId === v.wooId && bom.items.length > 0)
        );
        const hasStockManagedVariations = p.variations.some(v => {
            const varRaw = v.rawData as { manage_stock?: boolean } | null;
            return v.manageStock || varRaw?.manage_stock;
        });

        if (!hasParentBOM && !anyVariationHasBOM && !hasStockManagedVariations) {
            const raw = p.rawData as { manage_stock?: boolean; stock_quantity?: number };
            const managesStock = p.manageStock || raw.manage_stock;
            const stockQty = p.stockQuantity ?? raw.stock_quantity;
            if (managesStock && typeof stockQty === 'number') {
                result.push({
                    id: p.id,
                    wooId: p.wooId,
                    name: p.name,
                    sku: p.sku,
                    image: p.mainImage,
                    currentStock: stockQty,
                    supplierLeadTime: p.supplier?.leadTimeDefault || null
                });
            }
        }

        if (hasParentBOM) continue;

        for (const v of p.variations) {
            const variationHasBOM = p.boms.some(bom => bom.variationId === v.wooId && bom.items.length > 0);
            if (variationHasBOM) continue;

            const varRaw = v.rawData as { manage_stock?: boolean; stock_quantity?: number } | null;
            const managesStock = v.manageStock || varRaw?.manage_stock;
            const stockQty = v.stockQuantity ?? varRaw?.stock_quantity;

            if (managesStock && typeof stockQty === 'number') {
                const varRawFull = v.rawData as { attributes?: Array<{ name: string; option: string }> } | null;
                let variationSuffix = 'Variation';
                if (varRawFull?.attributes && varRawFull.attributes.length > 0) {
                    variationSuffix = varRawFull.attributes.map(a => a.option).join(', ');
                } else if (v.sku) {
                    variationSuffix = v.sku;
                }

                result.push({
                    id: v.id,
                    wooId: v.wooId,
                    parentWooId: p.wooId,
                    name: `${p.name} - ${variationSuffix}`,
                    sku: v.sku,
                    image: p.mainImage,
                    currentStock: stockQty,
                    supplierLeadTime: p.supplier?.leadTimeDefault || null,
                    isVariation: true
                });
            }
        }
    }

    const internalProducts = await prisma.internalProduct.findMany({
        where: { accountId },
        select: { id: true, name: true, sku: true, mainImage: true, stockQuantity: true, supplier: { select: { leadTimeDefault: true } } }
    });

    for (const ip of internalProducts) {
        result.push({
            id: ip.id,
            wooId: 0,
            name: `[Internal] ${ip.name}`,
            sku: ip.sku,
            image: ip.mainImage,
            currentStock: ip.stockQuantity,
            supplierLeadTime: ip.supplier?.leadTimeDefault || null
        });
    }

    return result;
}
