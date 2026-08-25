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

describe('SyncScheduler entity circuit breakers', () => {
    beforeEach(() => {
        vi.clearAllMocks();
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
});
