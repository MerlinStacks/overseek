import { prisma } from '../../../utils/prisma';
import { Logger } from '../../../utils/logger';
import { getHistoricalSales } from './sales';
import type { BOMComponentMapping } from './types';

export async function getBOMComponentMappings(
    accountId: string,
    productIds: string[],
    variationWooIds: number[],
    products: Array<{ id: string; wooId: number; isVariation?: boolean }>
): Promise<BOMComponentMapping[]> {
    if (productIds.length === 0 && variationWooIds.length === 0) return [];

    const orConditions: Array<Record<string, unknown>> = [];
    if (productIds.length > 0) {
        orConditions.push({ childProductId: { in: productIds } });
        orConditions.push({ internalProductId: { in: productIds } });
    }
    if (variationWooIds.length > 0) {
        orConditions.push({ childVariationId: { in: variationWooIds } });
    }

    const bomItems = await prisma.bOMItem.findMany({
        where: { OR: orConditions },
        select: {
            childProductId: true,
            childVariationId: true,
            internalProductId: true,
            quantity: true,
            wasteFactor: true,
            bom: {
                select: {
                    productId: true,
                    variationId: true,
                    product: { select: { accountId: true, wooId: true } }
                }
            }
        }
    });

    const accountBomItems = bomItems.filter(item => item.bom.product.accountId === accountId);

    Logger.debug('[InventoryForecastService] getBOMComponentMappings query', {
        accountId,
        productIdsSearched: productIds.length,
        variationWooIdsSearched: variationWooIds.length,
        bomItemsFound: bomItems.length,
        accountBomItemsAfterFilter: accountBomItems.length
    });

    const variationWooIdToId = new Map<number, string>();
    for (const p of products) {
        if (p.isVariation && p.wooId > 0) variationWooIdToId.set(p.wooId, p.id);
    }

    const mappingsByComponent = new Map<string, BOMComponentMapping>();

    for (const item of accountBomItems) {
        let componentId: string | null = null;
        let componentWooId = 0;

        if (item.childVariationId && variationWooIdToId.has(item.childVariationId)) {
            componentId = variationWooIdToId.get(item.childVariationId)!;
            componentWooId = item.childVariationId;
        } else if (item.childProductId) {
            componentId = item.childProductId;
            const component = await prisma.wooProduct.findUnique({ where: { id: componentId }, select: { wooId: true } });
            componentWooId = component?.wooId || 0;
        } else if (item.internalProductId) {
            componentId = item.internalProductId;
        }

        if (!componentId) continue;

        if (!mappingsByComponent.has(componentId)) {
            mappingsByComponent.set(componentId, {
                componentProductId: componentId,
                componentWooId,
                parentMappings: []
            });
        }

        mappingsByComponent.get(componentId)!.parentMappings.push({
            parentProductId: item.bom.productId,
            parentWooId: item.bom.product.wooId,
            parentVariationId: item.bom.variationId,
            quantity: Number(item.quantity),
            wasteFactor: Number(item.wasteFactor)
        });
    }

    return Array.from(mappingsByComponent.values());
}

export async function calculateBOMDerivedDemand(
    accountId: string,
    bomMappings: BOMComponentMapping[],
    days: number
): Promise<Map<string, number>> {
    const derivedDemand = new Map<string, number>();
    if (bomMappings.length === 0) return derivedDemand;

    const parentWooIds = new Set<number>();
    const parentVariationWooIds = new Set<number>();

    for (const mapping of bomMappings) {
        for (const parent of mapping.parentMappings) {
            if (parent.parentVariationId > 0) {
                parentVariationWooIds.add(parent.parentVariationId);
            } else {
                parentWooIds.add(parent.parentWooId);
            }
        }
    }

    const parentSales = await getHistoricalSales(
        accountId,
        Array.from(parentWooIds),
        Array.from(parentVariationWooIds),
        days
    );

    for (const mapping of bomMappings) {
        let totalDerivedDemand = 0;
        for (const parent of mapping.parentMappings) {
            const parentLookupId = parent.parentVariationId > 0 ? parent.parentVariationId : parent.parentWooId;
            const parentSalesData = parentSales.get(parentLookupId) || [];
            const totalParentSold = parentSalesData.reduce((sum, sale) => sum + sale.quantity, 0);
            const avgDailyParentSales = days > 0 ? totalParentSold / days : 0;
            const effectiveQuantity = parent.quantity * (1 + parent.wasteFactor);
            totalDerivedDemand += avgDailyParentSales * effectiveQuantity;
        }
        if (totalDerivedDemand > 0) {
            derivedDemand.set(mapping.componentProductId, totalDerivedDemand);
        }
    }

    return derivedDemand;
}
