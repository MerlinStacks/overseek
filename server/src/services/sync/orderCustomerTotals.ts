import type { Prisma } from '@prisma/client';
import { prisma } from '../../utils/prisma';
import { esClient } from '../../utils/elastic';
import { retryWithBackoff } from '../../utils/retryWithBackoff';

export type OrderCustomerAssociation = { wooCustomerId: number | null; billingEmail: string | null };
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
    const emails = [...new Set(associations.flatMap(o => o.wooCustomerId == null && o.billingEmail ? [o.billingEmail] : []))];
    if (!wooIds.length && !emails.length && !customerIds.length) return;

    // Keep NUMERIC arithmetic in PostgreSQL. Registered orders never fall back to email.
    // Only touch changed totals so the incremental updatedAt retry window can drain.
    await tx.$executeRaw`
        WITH totals AS (
            SELECT c."id", COUNT(o."id")::int AS count, COALESCE(SUM(o."total"), 0) AS spent
            FROM "WooCustomer" c
            LEFT JOIN "WooOrder" o ON o."accountId" = c."accountId" AND (
                o."wooCustomerId" = c."wooId"
                OR (o."wooCustomerId" IS NULL AND o."billingEmail" = c."email")
            )
            WHERE c."accountId" = ${accountId} AND (
                c."wooId" = ANY(${wooIds}::int[]) OR c."email" = ANY(${emails}::text[])
                OR c."id" = ANY(${customerIds}::text[])
            )
            GROUP BY c."id"
        )
        UPDATE "WooCustomer" c SET "ordersCount" = t.count, "totalSpent" = t.spent, "updatedAt" = NOW()
        FROM totals t WHERE c."id" = t."id" AND c."accountId" = ${accountId}
        AND (c."ordersCount" IS DISTINCT FROM t.count OR c."totalSpent" IS DISTINCT FROM t.spent)
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

/** updatedAt is the durable retry set, including old associations lost by a prior attempt. */
export async function reindexCustomerTotals(accountId: string, since?: Date): Promise<void> {
    let cursor: string | undefined;
    while (true) {
        // Keep reads and ES writes ordered with other OrderSync batches for this account.
        const page = await withOrderTotalsTransaction(accountId, async tx => {
            const customers = await tx.wooCustomer.findMany({
                where: { accountId, ...(since ? { updatedAt: { gte: since } } : {}), ...(cursor ? { id: { gt: cursor } } : {}) },
                select: { id: true, wooId: true, email: true, firstName: true, lastName: true,
                    totalSpent: true, ordersCount: true, createdAt: true },
                orderBy: { id: 'asc' }, take: BATCH_SIZE
            });
            if (!customers.length) return null;
            // Bound network time below the transaction timeout; the next sync retries failures.
            const result = await esClient.bulk({
                refresh: false,
                operations: customers.flatMap(c => [
                    { update: { _index: 'customers', _id: `${accountId}_${c.wooId}` } },
                    {
                        doc: { totalSpent: Number(c.totalSpent), ordersCount: c.ordersCount },
                        // Match bulkIndexCustomers' public schema without replacing richer existing documents.
                        upsert: { accountId, id: c.wooId, email: c.email, firstName: c.firstName,
                            lastName: c.lastName, totalSpent: Number(c.totalSpent), ordersCount: c.ordersCount,
                            dateCreated: c.createdAt.toISOString() }
                    }
                ])
            }, { requestTimeout: 10000, maxRetries: 0 });
            if (result.errors) throw new Error('Failed to index customer totals; checkpoint was not advanced.');
            return { cursor: customers[customers.length - 1].id, count: customers.length };
        });
        if (!page) break;
        cursor = page.cursor;
        if (page.count < BATCH_SIZE) break;
    }
}
