import { beforeEach, describe, expect, it, vi } from 'vitest';
import { OrderSync } from '../OrderSync';
import { prisma } from '../../../utils/prisma';
import { WooService } from '../../woo';
import { EventBus } from '../../events';
import { esClient } from '../../../utils/elastic';
import { materializeContact } from '../../ContactMaterialization';

vi.mock('../../ContactMaterialization', async importOriginal => ({
    ...await importOriginal<typeof import('../../ContactMaterialization')>(),
    materializeContact: vi.fn().mockResolvedValue({ id: 'contact' })
}));

vi.mock('../../../utils/prisma', () => ({
    prisma: {
        $queryRaw: vi.fn(),
        $transaction: vi.fn(),
        $executeRaw: vi.fn(),
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
        bulk: vi.fn(),
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
        (prisma.$transaction as any).mockImplementation(async (work: any) => work(prisma));
        (prisma.syncState.findUnique as any).mockResolvedValue(null);
        (prisma.wooOrder.findMany as any).mockResolvedValue([]);
        (prisma.wooOrder.count as any).mockResolvedValue(0);
        (prisma.wooOrder.deleteMany as any).mockResolvedValue({ count: 0 });
        (prisma.wooCustomer.updateMany as any).mockResolvedValue({ count: 0 });
        (prisma.wooCustomer.findMany as any).mockResolvedValue([]);
        (prisma.$queryRaw as any).mockResolvedValue([]);
        (esClient.bulk as any).mockResolvedValue({ errors: false, items: [] });
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

    const incoming = { id: 9100, number: '9100', status: 'refunded', currency: 'AUD', total: '20.00',
        customer_id: 0, billing: { email: 'NEW@example.com' }, line_items: [],
        date_created_gmt: '2024-01-01T00:00:00Z', date_modified_gmt: '2026-01-01T00:00:00Z' };

    it('repairs old registered and new guest totals in the persistence transaction', async () => {
        (prisma.syncState.findUnique as any).mockResolvedValue({ lastSyncedAt: new Date() });
        (prisma.wooOrder.findMany as any).mockResolvedValueOnce([
            { wooId: 9100, status: 'refunded', wooCustomerId: 42, billingEmail: 'old@example.com' }
        ]);
        mockWoo.getOrders = vi.fn().mockResolvedValue({ data: [incoming], totalPages: 1, total: 1 });
        await (new OrderSync() as any).sync(mockWoo, accountId, true);
        expect(prisma.$executeRaw).toHaveBeenCalledWith(expect.anything(), accountId, [42], ['new@example.com'], ['contact'], accountId);
        expect(materializeContact).toHaveBeenCalledWith(prisma, accountId, expect.objectContaining({ source: 'ORDER', email: 'new@example.com' }));
        expect(prisma.$transaction).toHaveBeenCalledTimes(3);
        expect(prisma.wooCustomer.updateMany).not.toHaveBeenCalled();
    });

    it('does not emit or index a page whose aggregate write fails', async () => {
        mockWoo.getOrders = vi.fn().mockResolvedValue({ data: [incoming], totalPages: 1, total: 1 });
        (prisma.$executeRaw as any).mockRejectedValueOnce(new Error('totals failed'));
        await expect((new OrderSync() as any).sync(mockWoo, accountId, true)).rejects.toThrow('totals failed');
        expect(EventBus.emit).not.toHaveBeenCalled();
        expect(esClient.bulk).not.toHaveBeenCalled();
    });

    it('uses actual deleted associations and never deletes unselected stale orders', async () => {
        const stale = { id: 'stale-1', wooId: 99, wooCustomerId: null, billingEmail: 'deleted@example.com' };
        mockWoo.getOrders = vi.fn().mockResolvedValue({ data: [incoming], totalPages: 1, total: 1 });
        (prisma.wooOrder.findMany as any).mockResolvedValueOnce([]).mockResolvedValueOnce([stale]);
        (prisma.wooOrder.count as any).mockResolvedValueOnce(1).mockResolvedValueOnce(20);
        (prisma.$queryRaw as any).mockImplementation(async (sql: TemplateStringsArray) =>
            sql.join('').includes('DELETE FROM') ? [stale] : []);
        const result = await (new OrderSync() as any).sync(mockWoo, accountId, false);
        expect(result.itemsDeleted).toBe(1);
        expect(prisma.$executeRaw).toHaveBeenCalledWith(expect.anything(), accountId, [], ['deleted@example.com'], [], accountId);
        expect(prisma.wooOrder.deleteMany).not.toHaveBeenCalled();
        expect(esClient.bulk).toHaveBeenCalledWith({ refresh: false, operations: [
            { delete: { _index: 'orders', _id: `${accountId}_99` } }
        ] }, { requestTimeout: 10000, maxRetries: 0 });
    });

    it('paginates reconciliation past deleted cursor rows with bounded bulk requests', async () => {
        const stale = Array.from({ length: 501 }, (_, i) => ({ id: `stale-${String(i).padStart(4, '0')}`,
            wooId: i, wooCustomerId: i + 1, billingEmail: null }));
        mockWoo.getOrders = vi.fn().mockResolvedValue({ data: [incoming], totalPages: 1, total: 1 });
        (prisma.wooOrder.findMany as any).mockResolvedValueOnce([])
            .mockResolvedValueOnce(stale.slice(0, 500)).mockResolvedValueOnce(stale.slice(500));
        (prisma.wooOrder.count as any).mockResolvedValueOnce(501).mockResolvedValueOnce(2000);
        (prisma.$queryRaw as any).mockImplementation(async (sql: TemplateStringsArray, ...values: any[]) =>
            sql.join('').includes('DELETE FROM') ? stale.filter(o => values[1].includes(o.id)) : []);
        const result = await (new OrderSync() as any).sync(mockWoo, accountId, false);
        expect(result.itemsDeleted).toBe(501);
        expect((prisma.wooOrder.findMany as any).mock.calls[2][0]).toMatchObject({
            where: { accountId, id: { gt: 'stale-0499' } }, take: 500
        });
        expect((prisma.wooOrder.findMany as any).mock.calls[2][0]).not.toHaveProperty('cursor');
        expect((esClient.bulk as any).mock.calls.map(([args]: any[]) => args.operations.length)).toEqual([500, 1]);
    });

    it('aborts the deletion transaction when ES cannot acknowledge the retry set', async () => {
        const stale = { id: 'stale', wooId: 99, wooCustomerId: 2, billingEmail: null };
        mockWoo.getOrders = vi.fn().mockResolvedValue({ data: [incoming], totalPages: 1, total: 1 });
        (prisma.wooOrder.findMany as any).mockResolvedValueOnce([]).mockResolvedValueOnce([stale]);
        (prisma.wooOrder.count as any).mockResolvedValueOnce(1).mockResolvedValueOnce(20);
        (prisma.$queryRaw as any).mockImplementation(async (sql: TemplateStringsArray) =>
            sql.join('').includes('DELETE FROM') ? [stale] : []);
        (esClient.bulk as any).mockResolvedValueOnce({ errors: true, items: [{ delete: { status: 503, error: {} } }] });
        await expect((new OrderSync() as any).sync(mockWoo, accountId, false)).rejects.toThrow('Failed to delete reconciled orders');
    });

    it('preserves the count-first deletion safety cap', async () => {
        mockWoo.getOrders = vi.fn().mockResolvedValue({ data: [incoming], totalPages: 1, total: 1 });
        (prisma.wooOrder.count as any).mockResolvedValueOnce(31).mockResolvedValueOnce(100);
        await (new OrderSync() as any).sync(mockWoo, accountId, false);
        expect(prisma.wooOrder.findMany).toHaveBeenCalledTimes(1);
        expect(esClient.bulk).not.toHaveBeenCalled();
    });
});
