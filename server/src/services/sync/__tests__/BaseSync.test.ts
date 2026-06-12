import { beforeEach, describe, expect, it, vi } from 'vitest';
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

describe('BaseSync', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mockPrisma.syncLog.create.mockResolvedValue({ id: 'log-1' });
        mockPrisma.syncLog.update.mockResolvedValue({});
        mockPrisma.syncState.upsert.mockResolvedValue({});
        mockPrisma.account.updateMany.mockResolvedValue({ count: 1 });
    });

    it('clears stale WooCommerce reconnect flag after a successful sync', async () => {
        await new TestSync().perform({ accountId: 'account-1', incremental: true });

        expect(mockPrisma.account.updateMany).toHaveBeenCalledWith({
            where: { id: 'account-1', wooNeedsReconnect: true },
            data: { wooNeedsReconnect: false },
        });
    });
});
