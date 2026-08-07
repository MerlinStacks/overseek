import { prisma } from '../../utils/prisma';

export interface StaleReason { code: string; resourceType: string; resourceId?: string; changedAt: string }

export async function markApprovedGenerationsStale(
    accountId: string,
    reason: Omit<StaleReason, 'changedAt'>,
    catalogId?: string,
    tx: any = prisma as any,
) {
    const changedAt = new Date();
    const generations = await tx.wholesaleCatalogGeneration.findMany({
        where: { accountId, ...(catalogId ? { catalogId } : {}), status: 'APPROVED', staleAt: null },
        select: { id: true, staleReasons: true },
    });
    for (const generation of generations) {
        const previous = Array.isArray(generation.staleReasons) ? generation.staleReasons : [];
        await tx.wholesaleCatalogGeneration.update({
            where: { id: generation.id },
            data: { staleAt: changedAt, staleReasons: [...previous, { ...reason, changedAt: changedAt.toISOString() }] },
        });
    }
}
