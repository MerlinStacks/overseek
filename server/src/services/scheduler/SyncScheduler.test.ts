import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
    queueAdd: vi.fn(),
    runSync: vi.fn(),
    accountFindMany: vi.fn(),
    accountFindUnique: vi.fn(),
    syncLogFindMany: vi.fn(),
    syncLogFindFirst: vi.fn(),
    scheduleUpsert: vi.fn(),
    scheduleFindMany: vi.fn(),
    scheduleUpdateMany: vi.fn()
}));

vi.mock('../queue/QueueFactory', () => ({
    QueueFactory: {
        createQueue: vi.fn(() => ({ add: mocks.queueAdd }))
    }
}));

vi.mock('../../utils/prisma', () => ({
    prisma: {
        account: {
            findMany: mocks.accountFindMany,
            findUnique: mocks.accountFindUnique
        },
        syncLog: {
            findMany: mocks.syncLogFindMany,
            findFirst: mocks.syncLogFindFirst
        },
        syncSchedule: {
            upsert: mocks.scheduleUpsert,
            findMany: mocks.scheduleFindMany,
            updateMany: mocks.scheduleUpdateMany
        }
    }
}));

vi.mock('../sync', () => ({
    SyncService: class {
        runSync = mocks.runSync;
    }
}));

vi.mock('../../utils/logger', () => ({
    Logger: {
        info: vi.fn(),
        warn: vi.fn(),
        error: vi.fn()
    }
}));

import { SyncScheduler } from './SyncScheduler';
import { Logger } from '../../utils/logger';

describe('SyncScheduler entity circuit breakers', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mocks.runSync.mockReset(); mocks.runSync.mockResolvedValue(undefined);
        mocks.accountFindMany.mockResolvedValue([{ id: 'account-1' }]);
        mocks.accountFindUnique.mockResolvedValue({ wooNeedsReconnect: false });
        mocks.syncLogFindFirst.mockResolvedValue(null);
        mocks.syncLogFindMany.mockResolvedValue([]);
        mocks.scheduleUpsert.mockResolvedValue({});
        mocks.scheduleFindMany.mockResolvedValue([
            { id: 'orders', entityType: 'orders', enabled: true, intervalMinutes: 1, nextRunAt: new Date(0) },
            { id: 'products', entityType: 'products', enabled: true, intervalMinutes: 5, nextRunAt: new Date(0) },
            { id: 'customers', entityType: 'customers', enabled: true, intervalMinutes: 5, nextRunAt: new Date(0) },
            { id: 'reviews', entityType: 'reviews', enabled: true, intervalMinutes: 5, nextRunAt: new Date(0) },
            { id: 'pages', entityType: 'pages', enabled: true, intervalMinutes: 15, nextRunAt: new Date(0) },
            { id: 'blog-posts', entityType: 'blog-posts', enabled: true, intervalMinutes: 15, nextRunAt: new Date(0) }
        ]);
        mocks.scheduleUpdateMany.mockResolvedValue({ count: 1 });
    });

    it('blocks only the failing entity and continues healthy sync types', async () => {
        mocks.syncLogFindMany.mockImplementation(({ where }: any) => {
            if (where.entityType === 'products') {
                return Promise.resolve([
                    { status: 'FAILED', errorMessage: 'bad variation' },
                    { status: 'FAILED', errorMessage: 'bad variation' },
                    { status: 'FAILED', errorMessage: 'bad variation' }
                ]);
            }
            return Promise.resolve([]);
        });

        await SyncScheduler.dispatchToAllAccounts();

        expect(mocks.runSync).toHaveBeenCalledOnce();
        expect(mocks.runSync).toHaveBeenCalledWith('account-1', {
            incremental: true,
            types: ['orders', 'customers', 'reviews', 'pages', 'blog-posts']
        });
        expect(mocks.syncLogFindMany).toHaveBeenCalledWith(expect.objectContaining({
            where: expect.objectContaining({ entityType: 'products' })
        }));
    });

    it('does not dispatch paused or future schedules', async () => {
        mocks.scheduleFindMany.mockResolvedValue([
            { id: 'orders', entityType: 'orders', enabled: false, intervalMinutes: 1, nextRunAt: new Date(0) },
            { id: 'products', entityType: 'products', enabled: true, intervalMinutes: 5, nextRunAt: new Date(Date.now() + 60_000) }
        ]);

        await SyncScheduler.dispatchToAllAccounts();

        expect(mocks.runSync).not.toHaveBeenCalled();
        expect(mocks.scheduleUpdateMany).not.toHaveBeenCalled();
    });
    it('advances healthy schedules and defers only blocked BOM checks without claiming successful BOM dispatch', async () => {
        const schedules = [
            { id: 'orders', entityType: 'orders', enabled: true, intervalMinutes: 1, nextRunAt: new Date(0) },
            { id: 'bom', entityType: 'bom', enabled: true, intervalMinutes: 15, nextRunAt: new Date(0) },
        ];
        mocks.scheduleFindMany.mockResolvedValue(schedules);
        mocks.scheduleUpdateMany.mockImplementation(async ({ where, data }) => {
            const row = schedules.find(schedule => schedule.id === where.id && schedule.nextRunAt.getTime() === where.nextRunAt.getTime());
            if (!row) return { count: 0 };
            Object.assign(row, data); return { count: 1 };
        });
        mocks.runSync.mockImplementation(async (_accountId, { types }) => {
            if (types.includes('bom')) throw Object.assign(new Error('reconcile'), { code: 'BOM_SYNC_RECONCILIATION_REQUIRED', jobId: 'old-bom' });
        });
        await SyncScheduler.dispatchToAllAccounts();
        expect(mocks.runSync).toHaveBeenNthCalledWith(1, 'account-1', { types: ['orders'], incremental: true });
        expect(mocks.runSync).toHaveBeenNthCalledWith(2, 'account-1', { types: ['bom'], incremental: true });
        expect(schedules[0]).toHaveProperty('lastScheduledAt', expect.any(Date));
        expect(schedules[1]).not.toHaveProperty('lastScheduledAt');
        expect(schedules[1].nextRunAt.getTime()).toBeGreaterThan(Date.now());
        await SyncScheduler.dispatchFastOrderSync();
        expect(mocks.runSync).toHaveBeenCalledTimes(2);
        expect(Logger.warn).toHaveBeenCalledExactlyOnceWith('Orchestrator: BOM sync deferred pending reconciliation', expect.objectContaining({ accountId: 'account-1', code: 'BOM_SYNC_RECONCILIATION_REQUIRED', jobId: 'old-bom' }));
        expect(Logger.error).not.toHaveBeenCalled();
    });
    it('coalesces overlapping fast/full passes in this process', async () => {
        let finish!: () => void;
        mocks.runSync.mockReturnValueOnce(new Promise<void>(resolve => { finish = resolve; }));
        const first = SyncScheduler.dispatchToAllAccounts(), second = SyncScheduler.dispatchToAllAccounts();
        expect(first).toBe(second);
        await vi.waitFor(() => expect(mocks.runSync).toHaveBeenCalledOnce());
        finish(); await Promise.all([first, second]);
        expect(mocks.accountFindMany).toHaveBeenCalledOnce();
    });
    it('does not mask unexpected queue failures or falsely advance a failed BOM dispatch', async () => {
        mocks.scheduleFindMany.mockResolvedValue([{ id: 'bom', entityType: 'bom', enabled: true, intervalMinutes: 15, nextRunAt: new Date(0) }]);
        mocks.runSync.mockRejectedValue(new Error('Redis unavailable'));
        await SyncScheduler.dispatchToAllAccounts();
        expect(mocks.scheduleUpdateMany).not.toHaveBeenCalled();
        expect(Logger.error).toHaveBeenCalledWith(expect.stringContaining('Failed to dispatch'), { error: 'Redis unavailable' });
        expect(Logger.warn).not.toHaveBeenCalled();
    });
    it('does not overwrite edited schedules or duplicate a deferral warning after another process advanced the row', async () => {
        mocks.scheduleFindMany.mockResolvedValue([{ id: 'bom', entityType: 'bom', enabled: true, intervalMinutes: 15, nextRunAt: new Date(0) }]);
        mocks.scheduleUpdateMany.mockResolvedValue({ count: 0 });
        mocks.runSync.mockRejectedValue(Object.assign(new Error('reconcile'), { code: 'BOM_SYNC_RECONCILIATION_REQUIRED' }));
        await SyncScheduler.dispatchToAllAccounts();
        expect(mocks.scheduleUpdateMany).toHaveBeenCalledWith(expect.objectContaining({ where: { id: 'bom', accountId: 'account-1', enabled: true, intervalMinutes: 15, nextRunAt: new Date(0) } }));
        expect(Logger.warn).not.toHaveBeenCalled();
    });
});
