import { AuditService } from '../AuditService';
import { prisma } from '../../utils/prisma';
import { Logger } from '../../utils/logger';
import { getProductReadiness } from './validation';
import { markApprovedGenerationsStale } from './staleness';

type SuspensionReason = 'OUT_OF_STOCK' | 'NO_PRICE_TIERS' | null;

export function automaticSuspensionChange(
    placement: { isSuspended: boolean; suspensionReason?: SuspensionReason; restoreAllowed?: boolean },
    readiness: { inStock: boolean; hasPriceTiers: boolean },
) {
    const reason: SuspensionReason = !readiness.inStock ? 'OUT_OF_STOCK' : !readiness.hasPriceTiers ? 'NO_PRICE_TIERS' : null;
    if (reason) return placement.isSuspended && placement.suspensionReason === reason ? null : { isSuspended: true, suspensionReason: reason };
    if (placement.isSuspended && placement.restoreAllowed !== false
        && (placement.suspensionReason === 'OUT_OF_STOCK' || placement.suspensionReason === 'NO_PRICE_TIERS')) {
        return { isSuspended: false, suspensionReason: null };
    }
    return null;
}

export async function reconcileEligibility(accountId: string) {
    const summary = await (prisma as any).$transaction(async (tx: any) => {
        const placements = await tx.wholesaleCatalogProduct.findMany({
            where: { accountId },
            include: { product: { include: { variations: { select: { stockStatus: true } }, wholesaleProfile: { include: { priceTiers: { select: { id: true } } } } } } },
        });
        const restored: string[] = [];
        const suspended: string[] = [];
        const affectedCatalogs = new Set<string>();
        for (const placement of placements) {
            const change = automaticSuspensionChange(placement, getProductReadiness(placement.product));
            if (!change) continue;
            const restoring = !change.isSuspended;
            await tx.wholesaleCatalogProduct.update({ where: { id: placement.id }, data: {
                ...change,
                suspendedAt: restoring ? null : new Date(),
            } });
            (restoring ? restored : suspended).push(placement.productId);
            affectedCatalogs.add(placement.catalogId);
        }
        for (const catalogId of affectedCatalogs) {
            await markApprovedGenerationsStale(accountId, {
                code: 'PRODUCT_ELIGIBILITY_CHANGED', resourceType: 'WHOLESALE_CATALOG', resourceId: catalogId,
            }, catalogId, tx);
        }
        return { restored, suspended, affectedCatalogs: [...affectedCatalogs] };
    });

    if (summary.restored.length) {
        try {
            await AuditService.log(accountId, null, 'WHOLESALE_PRODUCTS_AUTO_RESTORED', 'WHOLESALE_CATALOG', accountId, summary);
            await (prisma as any).notification.create({ data: {
                accountId,
                title: 'Wholesale products restored',
                message: `${summary.restored.length} wholesale catalog product placement(s) became eligible and were restored.`,
                type: 'SUCCESS',
                link: '/wholesale-catalog',
            } });
        } catch (error) {
            Logger.warn('[WholesaleEligibility] Restoration audit or notification failed', { accountId, error });
        }
    }
    return summary;
}
