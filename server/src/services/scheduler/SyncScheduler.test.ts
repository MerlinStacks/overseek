import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
    queueAdd: vi.fn(),
    runSync: vi.fn(),
    accountFindMany: vi.fn(),
    accountFindUnique: vi.fn(),
    syncLogFindMany: vi.fn(),
    syncLogFindFirst: vi.fn()
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
});
