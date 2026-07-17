import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { BaseSync } from '../BaseSync';

const mockPrisma = vi.hoisted(() => ({
    syncLog: {
        create: vi.fn(),
        update: vi.fn(),
    },
    syncState: {
        upsert: vi.fn(),
    },
    account: {
        updateMany: vi.fn(),
    },
}));

vi.mock('../../../utils/prisma', () => ({ prisma: mockPrisma }));

vi.mock('../../woo', () => ({
    WooService: {
        forAccount: vi.fn().mockResolvedValue({}),
    },
}));

vi.mock('../../../utils/logger', () => ({
    Logger: {
        info: vi.fn(),
        warn: vi.fn(),
        error: vi.fn(),
    },
}));

vi.mock('../../events', () => ({
    EventBus: { emit: vi.fn() },
    EVENTS: { SYNC: { FAILURE_THRESHOLD: 'sync.failure_threshold' } },
}));

class TestSync extends BaseSync {
    protected entityType = 'orders';

    protected async sync() {
        return { itemsProcessed: 1 };
    }
}

class CheckpointSync extends BaseSync {
    protected entityType = 'products';
    incrementalSeen: boolean | undefined;

    protected async sync(_woo: unknown, _accountId: string, incremental: boolean) {
        this.incrementalSeen = incremental;
        vi.setSystemTime(new Date('2026-07-17T10:10:00.000Z'));
        return { itemsProcessed: 1 };
    }
}

describe('BaseSync', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mockPrisma.syncLog.create.mockResolvedValue({ id: 'log-1' });
        mockPrisma.syncLog.update.mockResolvedValue({});
        mockPrisma.syncState.upsert.mockResolvedValue({});
        mockPrisma.account.updateMany.mockResolvedValue({ count: 1 });
    });

    afterEach(() => {
        vi.useRealTimers();
    });

    it('clears stale WooCommerce reconnect flag after a successful sync', async () => {
        await new TestSync().perform({ accountId: 'account-1', incremental: true });

        expect(mockPrisma.account.updateMany).toHaveBeenCalledWith({
            where: { id: 'account-1', wooNeedsReconnect: true },
            data: { wooNeedsReconnect: false },
        });
    });

    it('defaults legacy jobs to incremental and checkpoints the sync start time', async () => {
        vi.useFakeTimers();
        vi.setSystemTime(new Date('2026-07-17T10:00:00.000Z'));
        const sync = new CheckpointSync();

        await sync.perform({ accountId: 'account-1' });

        expect(sync.incrementalSeen).toBe(true);
        expect(mockPrisma.syncState.upsert).toHaveBeenCalledWith({
            where: {
                accountId_entityType: { accountId: 'account-1', entityType: 'products' }
            },
            update: {
                lastSyncedAt: new Date('2026-07-17T10:00:00.000Z'),
                updatedAt: new Date('2026-07-17T10:10:00.000Z')
            },
            create: {
                accountId: 'account-1',
                entityType: 'products',
                lastSyncedAt: new Date('2026-07-17T10:00:00.000Z')
            }
        });
    });
});
