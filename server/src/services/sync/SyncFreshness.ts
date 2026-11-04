import { prisma } from '../../utils/prisma';
import { Logger } from '../../utils/logger';
import { parseWooOrderId } from '../../utils/orderIds';

const PREFIX = 'purchase-signal:';
const RETENTION_MS = 7 * 86400000;
export const PURCHASE_SYNC_OVERDUE_MS = 2 * 60 * 1000;
const SAMPLE_LIMIT = 1000;
const outstanding = ['PENDING', 'RETRYING', 'FAILED'];

/** SyncState also stores bounded recovery/observability keys; these are not sweep checkpoints. */
export async function recordPurchaseSignal(accountId: string, orderId: number): Promise<void> {
    const receivedAt = new Date();
    // A webhook may have won the race before the purchase signal arrived.
    const present = await prisma.wooOrder.findUnique({
        where: { accountId_wooId: { accountId, wooId: orderId } }, select: { id: true }
    });
    await prisma.syncState.upsert({
        where: { accountId_entityType: { accountId, entityType: `${PREFIX}${orderId}` } },
        create: { accountId, entityType: `${PREFIX}${orderId}`, lastSyncedAt: receivedAt, cursor: present ? 'IMPORTED' : 'PENDING' },
        update: {} // Retries must not reset the receipt time or an already imported result.
    });
}

export async function recordPurchasesImported(accountId: string, orderIds: number[]): Promise<void> {
    if (!orderIds.length) return;
    await prisma.syncState.updateMany({
        where: { accountId, entityType: { in: orderIds.map(id => `${PREFIX}${id}`) }, cursor: { in: outstanding } },
        data: { cursor: 'IMPORTED' }
    });
}

export async function recordPurchaseFailure(accountId: string, orderId: number, terminal: boolean): Promise<void> {
    await prisma.syncState.updateMany({
        where: { accountId, entityType: `${PREFIX}${orderId}`, cursor: { in: outstanding } },
        data: { cursor: terminal ? 'FAILED' : 'RETRYING' }
    });
}

export async function getSyncFreshness(accountId: string) {
    const now = Date.now();
    const rows = await prisma.syncState.findMany({
        where: { accountId, entityType: { startsWith: PREFIX }, lastSyncedAt: { gte: new Date(now - 86400000) } },
        orderBy: { lastSyncedAt: 'desc' }, take: SAMPLE_LIMIT + 1,
        select: { entityType: true, lastSyncedAt: true, cursor: true, updatedAt: true }
    });
    const samples = rows.slice(0, SAMPLE_LIMIT);
    const ids = samples.map(row => parseWooOrderId(row.entityType.slice(PREFIX.length))).filter((id): id is number => id !== null);
    const orders = ids.length ? await prisma.wooOrder.findMany({
        where: { accountId, wooId: { in: ids } }, select: { wooId: true }
    }) : [];
    const present = new Set(orders.map(order => order.wooId));
    const details = samples.map(row => ({
        orderId: Number(row.entityType.slice(PREFIX.length)),
        receivedAt: row.lastSyncedAt!.toISOString(),
        importedAt: row.cursor === 'IMPORTED' ? row.updatedAt.toISOString() : null,
        status: row.cursor,
        presentLocally: present.has(Number(row.entityType.slice(PREFIX.length))),
        ageMs: Math.max(0, now - row.lastSyncedAt!.getTime()),
        latencyMs: row.cursor === 'IMPORTED' ? Math.max(0, row.updatedAt.getTime() - row.lastSyncedAt!.getTime()) : null
    }));
    const latencies = details.flatMap(row => row.latencyMs === null ? [] : [row.latencyMs]).sort((a, b) => a - b);
    const unresolved = details.filter(row => row.status !== 'IMPORTED');
    return {
        windowHours: 24, sampleLimit: SAMPLE_LIMIT, truncated: rows.length > SAMPLE_LIMIT,
        signals: details.length, imported: latencies.length,
        pending: unresolved.length, failed: unresolved.filter(row => row.status === 'FAILED').length,
        overdue: unresolved.filter(row => row.ageMs >= PURCHASE_SYNC_OVERDUE_MS).length,
        missing: details.filter(row => !row.presentLocally && row.ageMs >= PURCHASE_SYNC_OVERDUE_MS).length,
        p95LatencyMs: latencies.length ? latencies[Math.ceil(latencies.length * 0.95) - 1] : null,
        overdueThresholdMs: PURCHASE_SYNC_OVERDUE_MS,
        recentIssues: details.filter(row => row.status === 'FAILED' || (row.ageMs >= PURCHASE_SYNC_OVERDUE_MS && (!row.presentLocally || row.status !== 'IMPORTED'))).slice(0, 50)
    };
}

/** Bounded periodic diagnostics, independent of whether anybody opens Settings. */
export async function monitorSyncFreshness(): Promise<void> {
    const cutoff = new Date(Date.now() - PURCHASE_SYNC_OVERDUE_MS);
    const rows = await prisma.syncState.findMany({
        where: { entityType: { startsWith: PREFIX }, cursor: { in: outstanding }, lastSyncedAt: { lte: cutoff, gte: new Date(Date.now() - RETENTION_MS) } },
        orderBy: { lastSyncedAt: 'asc' }, take: 100,
        select: { accountId: true, entityType: true, cursor: true, lastSyncedAt: true }
    });
    if (rows.length) Logger.warn('Purchase-triggered order imports are overdue', {
        code: 'PURCHASE_SYNC_OVERDUE', sampledCount: rows.length,
        signals: rows.map(row => ({ accountId: row.accountId, orderId: row.entityType.slice(PREFIX.length), status: row.cursor, receivedAt: row.lastSyncedAt }))
    });
    await prisma.syncState.deleteMany({
        where: { entityType: { startsWith: PREFIX }, lastSyncedAt: { lt: new Date(Date.now() - RETENTION_MS) } }
    });
}
