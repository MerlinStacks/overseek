import type { Prisma } from '@prisma/client';
import { prisma } from '../../utils/prisma';
import { retryWithBackoff } from '../../utils/retryWithBackoff';
import { queueContactKeys } from '../ContactProjection';

export type OrderCustomerAssociation = { wooCustomerId: number | null; billingEmail: string | null; wooId?: number };
const BATCH_SIZE = 500;

/** Serialize order mutations and rebuild batches before taking their read snapshots. */
export function withOrderTotalsTransaction<T>(accountId: string, work: (tx: Prisma.TransactionClient) => Promise<T>): Promise<T> {
    return retryWithBackoff(() => prisma.$transaction(async tx => {
        await tx.$queryRaw`SELECT 1 AS locked FROM pg_advisory_xact_lock(hashtextextended(${`order-totals:${accountId}`}, 0))`;
        return work(tx);
    }, { timeout: 60000 }), {
        context: 'OrderSync:customerTotals',
        baseDelayMs: 100,
        retryOn: error => ['P2034', '40001', '40P01'].includes(error?.code)
            || ['40001', '40P01'].includes(error?.meta?.code)
    });
}

/** One set-based write, including customers whose last matching order disappeared. */
export async function updateCustomerTotals(
    tx: Prisma.TransactionClient, accountId: string,
    associations: OrderCustomerAssociation[], customerIds: string[] = []
): Promise<void> {
    const wooIds = [...new Set(associations.flatMap(o => o.wooCustomerId != null ? [o.wooCustomerId] : []))];
    const emails = [...new Set(associations.flatMap(o => o.wooCustomerId == null && o.billingEmail?.trim() ? [o.billingEmail.trim().toLowerCase()] : []))];
    const anonymousKeys = associations.filter(o => o.wooCustomerId == null && !o.billingEmail?.trim() && o.wooId != null)
        .map(o => `order:${o.wooId}`);
    if (anonymousKeys.length) {
        const anonymous = await tx.wooCustomer.findMany({ where: { accountId,
            OR: anonymousKeys.map(key => ({ rawData: { path: ['materializationKey'], equals: key } }))
        }, select: { id: true } });
        customerIds = [...new Set([...customerIds, ...anonymous.map(c => c.id)])];
    }
    if (!wooIds.length && !emails.length && !customerIds.length) return;

    // Keep NUMERIC arithmetic in PostgreSQL. Registered orders never fall back to email.
    // Only touch changed totals so the incremental updatedAt retry window can drain.
    await tx.$executeRaw`
        WITH totals AS (
            SELECT c."id", COUNT(o."id")::int AS count, COALESCE(SUM(o."total"), 0) AS spent
            FROM "WooCustomer" c
            LEFT JOIN "WooOrder" o ON o."accountId" = c."accountId" AND (
                o."wooCustomerId" = c."wooId"
                OR (o."wooCustomerId" IS NULL AND NULLIF(TRIM(o."billingEmail"), '') IS NOT NULL
                    AND LOWER(TRIM(o."billingEmail")) = LOWER(TRIM(c."email")))
                OR (o."wooCustomerId" IS NULL AND NULLIF(TRIM(o."billingEmail"), '') IS NULL
                    AND c."rawData"->>'materializationKey' = 'order:' || o."wooId"::text)
            )
            WHERE c."accountId" = ${accountId} AND (
                c."wooId" = ANY(${wooIds}::int[]) OR LOWER(TRIM(c."email")) = ANY(${emails}::text[])
                OR c."id" = ANY(${customerIds}::text[])
            )
            GROUP BY c."id"
        ), changed AS (
            UPDATE "WooCustomer" c SET "ordersCount" = t.count, "totalSpent" = t.spent, "updatedAt" = NOW()
            FROM totals t WHERE c."id" = t."id" AND c."accountId" = ${accountId}
            AND (c."ordersCount" IS DISTINCT FROM t.count OR c."totalSpent" IS DISTINCT FROM t.spent)
            RETURNING c."accountId", c."wooId"
        )
        INSERT INTO "SyncState" ("id", "accountId", "entityType", "cursor", "updatedAt")
        SELECT gen_random_uuid()::text, "accountId", 'contact-projection:' || "wooId"::text, gen_random_uuid()::text, NOW()
        FROM changed
        ON CONFLICT ("accountId", "entityType") DO UPDATE SET "cursor" = EXCLUDED."cursor", "updatedAt" = EXCLUDED."updatedAt"
    `;
}

/** Recovery is restartable; no account-wide reset or account-sized result arrays. */
export async function recalculateCustomerTotals(accountId: string, since?: Date): Promise<void> {
    let cursor: string | undefined;
    while (true) {
        const ids: string[] = await withOrderTotalsTransaction(accountId, async tx => {
            const customers = await tx.wooCustomer.findMany({
                where: { accountId, ...(since ? { updatedAt: { gte: since } } : {}), ...(cursor ? { id: { gt: cursor } } : {}) },
                select: { id: true }, orderBy: { id: 'asc' }, take: BATCH_SIZE
            });
            const ids = customers.map(c => c.id);
            await updateCustomerTotals(tx, accountId, [], ids);
            return ids;
        });
        if (!ids.length) break;
        cursor = ids[ids.length - 1];
        if (ids.length < BATCH_SIZE) break;
    }
    await reindexCustomerTotals(accountId, since);
}

/** updatedAt recovery records durable projection intent; ES is handled independently. */
export async function reindexCustomerTotals(accountId: string, since?: Date): Promise<void> {
    let cursor: string | undefined;
    while (true) {
        // Snapshot and projection intent are committed together with the account lock.
        const page = await withOrderTotalsTransaction(accountId, async tx => {
            const customers = await tx.wooCustomer.findMany({
                where: { accountId, ...(since ? { updatedAt: { gte: since } } : {}), ...(cursor ? { id: { gt: cursor } } : {}) },
                orderBy: { id: 'asc' }, take: BATCH_SIZE
            });
            if (!customers.length) return null;
            await queueContactKeys(tx, accountId, customers.map(c => c.wooId));
            return { cursor: customers[customers.length - 1].id, count: customers.length };
        });
        if (!page) break;
        cursor = page.cursor;
        if (page.count < BATCH_SIZE) break;
    }
}
