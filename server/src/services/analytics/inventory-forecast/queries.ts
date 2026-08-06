import { prisma } from '../../../utils/prisma';
import type { ManagedProduct, OrderedInventory, OrderedInventoryItem } from './types';

const supplierLeadTimesSelect = {
    leadTimeDefault: true,
    leadTimeMin: true,
    leadTimeMax: true
} as const;

function getSupplierLeadTime(supplier: {
    leadTimeDefault: number | null;
    leadTimeMin: number | null;
    leadTimeMax: number | null;
} | null): number | null {
    // Prefer the configured planning value, then the conservative end of the range.
    return supplier?.leadTimeDefault ?? supplier?.leadTimeMax ?? supplier?.leadTimeMin ?? null;
}

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
            supplier: { select: supplierLeadTimesSelect },
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
        const parentStatus = (p.rawData as { status?: string } | null)?.status;
        if (parentStatus === 'trash') continue;

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
                    productId: p.id,
                    wooId: p.wooId,
                    name: p.name,
                    sku: p.sku,
                    image: p.mainImage,
                    currentStock: stockQty,
                    supplierLeadTime: getSupplierLeadTime(p.supplier),
                    supplierLeadTimeMin: p.supplier?.leadTimeMin ?? null,
                    supplierLeadTimeMax: p.supplier?.leadTimeMax ?? null
                });
            }
        }

        if (hasParentBOM) continue;

        for (const v of p.variations) {
            const variationStatus = (v.rawData as { status?: string } | null)?.status;
            if (variationStatus === 'trash') continue;

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
                    productId: p.id,
                    wooId: v.wooId,
                    parentWooId: p.wooId,
                    name: `${p.name} - ${variationSuffix}`,
                    sku: v.sku,
                    image: p.mainImage,
                    currentStock: stockQty,
                    supplierLeadTime: getSupplierLeadTime(p.supplier),
                    supplierLeadTimeMin: p.supplier?.leadTimeMin ?? null,
                    supplierLeadTimeMax: p.supplier?.leadTimeMax ?? null,
                    isVariation: true
                });
            }
        }
    }

    const internalProducts = await prisma.internalProduct.findMany({
        where: { accountId },
        select: { id: true, name: true, sku: true, mainImage: true, stockQuantity: true, supplier: { select: supplierLeadTimesSelect } }
    });

    for (const ip of internalProducts) {
        result.push({
            id: ip.id,
            productId: ip.id,
            wooId: 0,
            name: `[Internal] ${ip.name}`,
            sku: ip.sku,
            image: ip.mainImage,
            currentStock: ip.stockQuantity,
            supplierLeadTime: getSupplierLeadTime(ip.supplier),
            supplierLeadTimeMin: ip.supplier?.leadTimeMin ?? null,
            supplierLeadTimeMax: ip.supplier?.leadTimeMax ?? null
        });
    }

    return result;
}

/**
 * Loads committed inbound stock in one query. DRAFT, RECEIVED and CANCELLED
 * orders are intentionally excluded. PO lines without a linked product cannot
 * be matched safely to a forecast and are ignored.
 */
export async function getOrderedInventory(accountId: string): Promise<OrderedInventory> {
    const items = await prisma.purchaseOrderItem.findMany({
        where: {
            productId: { not: null },
            purchaseOrder: { accountId, status: 'ORDERED' }
        },
        select: {
            productId: true,
            variationWooId: true,
            quantity: true,
            purchaseOrder: { select: { expectedDate: true, orderDate: true, createdAt: true } }
        }
    });

    const byProduct = new Map<string, OrderedInventoryItem[]>();
    const byVariation = new Map<string, OrderedInventoryItem[]>();

    for (const item of items) {
        if (!item.productId) continue;
        const orderedItem: OrderedInventoryItem = {
            quantity: item.quantity,
            expectedDate: item.purchaseOrder.expectedDate,
            orderDate: item.purchaseOrder.orderDate,
            createdAt: item.purchaseOrder.createdAt
        };
        if (item.variationWooId != null) {
            const key = `${item.productId}:${item.variationWooId}`;
            byVariation.set(key, [...(byVariation.get(key) || []), orderedItem]);
        } else {
            byProduct.set(item.productId, [...(byProduct.get(item.productId) || []), orderedItem]);
        }
    }

    return { byProduct, byVariation };
}
