import { beforeEach, describe, expect, it, vi } from 'vitest';
import { OrderSync } from '../OrderSync';
import { prisma } from '../../../utils/prisma';
import { WooService } from '../../woo';
import { EventBus } from '../../events';

vi.mock('../../../utils/prisma', () => ({
    prisma: {
        $queryRaw: vi.fn(),
        $executeRawUnsafe: vi.fn(),
        wooOrder: {
            count: vi.fn(),
            findMany: vi.fn(),
            upsert: vi.fn(),
            deleteMany: vi.fn(),
        },
        wooCustomer: {
            updateMany: vi.fn(),
            findMany: vi.fn(),
        },
        syncState: {
            findUnique: vi.fn(),
        },
    },
    Prisma: {
        sql: vi.fn(),
        join: vi.fn(),
    },
}));

vi.mock('../../../utils/logger', () => ({
    Logger: {
        info: vi.fn(),
        warn: vi.fn(),
        debug: vi.fn(),
        error: vi.fn(),
    },
}));

vi.mock('../../search/IndexingService', () => ({
    IndexingService: {
        bulkIndexOrders: vi.fn(),
        deleteOrder: vi.fn(),
        bulkIndexCustomers: vi.fn(),
    },
}));

vi.mock('../../OrderTaggingService', () => ({
    OrderTaggingService: {
        extractTagsForOrders: vi.fn().mockResolvedValue(new Map()),
        extractTagsFromOrder: vi.fn().mockResolvedValue([]),
        getTagMappings: vi.fn().mockResolvedValue([]),
    },
}));

vi.mock('../../events', () => ({
    EventBus: {
        emit: vi.fn(),
    },
    EVENTS: {
        ORDER: {
            CREATED: 'order.created',
            STATUS_CHANGED: 'order.status_changed',
            PAID: 'order.paid',
            COMPLETED: 'order.completed',
            FIRST: 'order.first',
            SYNCED: 'order.synced',
        },
    },
}));

vi.mock('../../../utils/elastic', () => ({
    esClient: {
        indices: {
            refresh: vi.fn(),
        },
    },
}));

describe('OrderSync meta persistence', () => {
    const accountId = 'acc_meta';
    const syncId = 'sync_meta';
    const mockWoo = {
        getOrders: vi.fn(),
    } as unknown as WooService;

    beforeEach(() => {
        vi.clearAllMocks();
        (prisma.syncState.findUnique as any).mockResolvedValue(null);
        (prisma.wooOrder.findMany as any).mockResolvedValue([]);
        (prisma.wooOrder.count as any).mockResolvedValue(0);
        (prisma.wooOrder.deleteMany as any).mockResolvedValue({ count: 0 });
        (prisma.wooCustomer.updateMany as any).mockResolvedValue({ count: 0 });
        (prisma.wooCustomer.findMany as any).mockResolvedValue([]);
        (prisma.$queryRaw as any).mockResolvedValue([]);
    });

    it('preserves line breaks and emojis in line item meta_data rawData', async () => {
        const orderWithMeta = {
            id: 9001,
            number: '9001',
            status: 'processing',
            currency: 'AUD',
            total: '25.00',
            customer_id: 0,
            billing: { email: 'test@example.com' },
            line_items: [
                {
                    id: 1,
                    product_id: 200,
                    quantity: 1,
                    name: 'Custom item',
                    meta_data: [
                        {
                            id: 99,
                            key: 'engraving_text',
                            value: 'Line 1\nLine 2 🫶🏼 cafe 你好',
                            display_key: 'Engraving',
                            display_value: 'Line 1\nLine 2 🫶🏼 cafe 你好',
                        },
                    ],
                },
            ],
            date_created_gmt: '2026-01-01T00:00:00Z',
            date_modified_gmt: '2026-01-01T00:00:00Z',
        };

        mockWoo.getOrders = vi
            .fn()
            .mockResolvedValueOnce({ data: [orderWithMeta], totalPages: 1, total: 1 });

        (prisma.wooOrder.upsert as any).mockImplementation(async ({ create, update }: any) => ({
            ...create,
            ...update,
        }));

        const sync = new OrderSync();
        await (sync as any).sync(mockWoo, accountId, true, undefined, syncId);

        expect(prisma.wooOrder.upsert).toHaveBeenCalledTimes(1);
        const upsertArg = (prisma.wooOrder.upsert as any).mock.calls[0][0];
        const persistedMeta = upsertArg.update.rawData.line_items[0].meta_data[0].value;

        expect(persistedMeta).toBe('Line 1\nLine 2 🫶🏼 cafe 你好');
        expect(persistedMeta.includes('\n')).toBe(true);
        expect(persistedMeta.includes('🫶🏼')).toBe(true);
    });

    it('does not emit lifecycle events during an initial baseline import', async () => {
        const historicalOrder = {
            id: 9002,
            number: '9002',
            status: 'processing',
            currency: 'AUD',
            total: '50.00',
            customer_id: 0,
            billing: { email: 'historical@example.com' },
            line_items: [],
            date_created_gmt: '2024-01-01T00:00:00Z',
            date_modified_gmt: '2024-01-01T00:00:00Z'
        };
        mockWoo.getOrders = vi.fn().mockResolvedValue({
            data: [historicalOrder],
            totalPages: 1,
            total: 1
        });
        (prisma.wooOrder.upsert as any).mockResolvedValue({});

        const sync = new OrderSync();
        await (sync as any).sync(mockWoo, accountId, true, undefined, syncId);

        expect(EventBus.emit).not.toHaveBeenCalled();
    });
});
