import { Prisma } from '@prisma/client';
import { getOrderDeliveryEstimateSnapshot } from '@overseek/core';

/** Called after upsert in the same transaction by both sync and webhooks. */
export async function importOrderSnapshot(
    tx: Prisma.TransactionClient, accountId: string, wooId: number,
    metadata: unknown, persisted: Prisma.JsonValue | null | undefined
): Promise<Prisma.JsonValue | null> {
    // Trust only Woo metadata at ingestion, never a payload's persisted-field lookalike.
    const snapshot = getOrderDeliveryEstimateSnapshot({ meta_data: metadata });
    if (!snapshot || persisted != null) return persisted ?? null;
    await tx.wooOrder.updateMany({
        where: { accountId, wooId, deliveryEstimateSnapshot: { equals: Prisma.DbNull } },
        data: { deliveryEstimateSnapshot: snapshot }
    });
    // A concurrent import may win. Publish the stored promise, not this candidate.
    const winner = await tx.wooOrder.findUnique({
        where: { accountId_wooId: { accountId, wooId } },
        select: { deliveryEstimateSnapshot: true }
    });
    return winner?.deliveryEstimateSnapshot ?? null;
}
