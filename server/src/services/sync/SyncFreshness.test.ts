import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { getSyncFreshness, monitorSyncFreshness, recordPurchaseFailure, recordPurchaseSignal, recordPurchasesImported } from './SyncFreshness';
import { prisma } from '../../utils/prisma';
import { Logger } from '../../utils/logger';

vi.mock('../../utils/prisma', () => ({ prisma: {
    syncState: { upsert: vi.fn(), updateMany: vi.fn(), findMany: vi.fn(), deleteMany: vi.fn() },
    wooOrder: { findMany: vi.fn(), findUnique: vi.fn() }
} }));
vi.mock('../../utils/logger', () => ({ Logger: { warn: vi.fn() } }));

describe('purchase sync freshness', () => {
    beforeEach(() => { vi.clearAllMocks(); vi.mocked(prisma.wooOrder.findUnique).mockResolvedValue(null); vi.useFakeTimers(); vi.setSystemTime(new Date('2026-11-05T12:00:00Z')); });
    afterEach(() => vi.useRealTimers());

    it('preserves first receipt time and completed state on repeat admission', async () => {
        await recordPurchaseSignal('a', 42);
        expect(prisma.syncState.upsert).toHaveBeenCalledWith({
            where: { accountId_entityType: { accountId: 'a', entityType: 'purchase-signal:42' } },
            create: { accountId: 'a', entityType: 'purchase-signal:42', lastSyncedAt: new Date(), cursor: 'PENDING' }, update: {}
        });
    });

    it('records import and failures only on outstanding signals in this account', async () => {
        await recordPurchasesImported('a', [42]);
        await recordPurchaseFailure('a', 42, false);
        await recordPurchaseFailure('a', 42, true);
        expect(prisma.syncState.updateMany).toHaveBeenNthCalledWith(1, {
            where: { accountId: 'a', entityType: { in: ['purchase-signal:42'] }, cursor: { in: ['PENDING', 'RETRYING', 'FAILED'] } }, data: { cursor: 'IMPORTED' }
        });
        expect(prisma.syncState.updateMany).toHaveBeenNthCalledWith(3, expect.objectContaining({
            where: expect.objectContaining({ accountId: 'a', cursor: { in: ['PENDING', 'RETRYING', 'FAILED'] } }), data: { cursor: 'FAILED' }
        }));
    });

    it('recognizes orders already imported by a webhook before the signal arrived', async () => {
        vi.mocked(prisma.wooOrder.findUnique).mockResolvedValue({ id: 'local-order' } as any);
        await recordPurchaseSignal('a', 42);
        expect(prisma.syncState.upsert).toHaveBeenCalledWith(expect.objectContaining({ create: expect.objectContaining({ cursor: 'IMPORTED' }) }));
    });

    it('distinguishes late/missing orders, terminal failures, and successful receipt-to-import latency', async () => {
        vi.mocked(prisma.syncState.findMany).mockResolvedValue([
            { entityType: 'purchase-signal:1', lastSyncedAt: new Date('2026-11-05T11:50:00Z'), updatedAt: new Date('2026-11-05T11:50:10Z'), cursor: 'IMPORTED' },
            { entityType: 'purchase-signal:2', lastSyncedAt: new Date('2026-11-05T11:51:00Z'), updatedAt: new Date(), cursor: 'FAILED' },
            { entityType: 'purchase-signal:3', lastSyncedAt: new Date('2026-11-05T11:59:59Z'), updatedAt: new Date(), cursor: 'PENDING' },
            { entityType: 'purchase-signal:4', lastSyncedAt: new Date('2026-11-05T11:52:00Z'), updatedAt: new Date(), cursor: 'RETRYING' }
        ] as any);
        vi.mocked(prisma.wooOrder.findMany).mockResolvedValue([{ wooId: 1 }, { wooId: 4 }] as any);
        const report = await getSyncFreshness('a');
        expect(report).toMatchObject({ signals: 4, imported: 1, pending: 3, overdue: 2, failed: 1, missing: 1, p95LatencyMs: 10000, truncated: false });
        expect(prisma.wooOrder.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: { accountId: 'a', wooId: { in: [1, 2, 3, 4] } } }));
        expect(report.recentIssues.map(row => row.orderId)).toEqual([2, 4]);
    });

    it('does not label an empty observation window as healthy', async () => {
        vi.mocked(prisma.syncState.findMany).mockResolvedValue([]);
        expect(await getSyncFreshness('a')).toMatchObject({ signals: 0, p95LatencyMs: null });
        expect(prisma.wooOrder.findMany).not.toHaveBeenCalled();
    });

    it('bounds periodic warnings and only expires monitoring keys, not sweep checkpoints', async () => {
        vi.mocked(prisma.syncState.findMany).mockResolvedValue([{ accountId: 'a', entityType: 'purchase-signal:42', cursor: 'FAILED', lastSyncedAt: new Date('2026-11-05T11:00:00Z') }] as any);
        await monitorSyncFreshness();
        expect(Logger.warn).toHaveBeenCalledWith(expect.any(String), expect.objectContaining({ code: 'PURCHASE_SYNC_OVERDUE', sampledCount: 1 }));
        expect(prisma.syncState.findMany).toHaveBeenCalledWith(expect.objectContaining({ take: 100 }));
        expect(prisma.syncState.deleteMany).toHaveBeenCalledWith({ where: { entityType: { startsWith: 'purchase-signal:' }, lastSyncedAt: { lt: new Date('2026-10-29T12:00:00Z') } } });
    });
});
