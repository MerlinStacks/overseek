import { beforeEach, describe, expect, it, vi } from 'vitest';
import { prisma } from '../../utils/prisma';
import { esClient } from '../../utils/elastic';
import { recalculateCustomerTotals, reindexCustomerTotals, updateCustomerTotals, withOrderTotalsTransaction } from './orderCustomerTotals';

vi.mock('../../utils/prisma', () => ({ prisma: {
    $transaction: vi.fn(), $queryRaw: vi.fn(), $executeRaw: vi.fn(),
    syncState: { upsert: vi.fn() },
    wooCustomer: { findMany: vi.fn(), updateMany: vi.fn() }
} }));
vi.mock('../../utils/elastic', () => ({ esClient: { bulk: vi.fn() } }));
vi.mock('../../utils/logger', () => ({ Logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));

const customer = (id: string, count = 0) => ({ id, wooId: Number(id), email: 'guest@example.com',
    firstName: 'Guest', lastName: null, ordersCount: count, totalSpent: '0.00', createdAt: new Date('2026-01-01') });

describe('OrderSync customer aggregates', () => {
    beforeEach(() => {
        vi.resetAllMocks();
        vi.mocked(prisma.$transaction).mockImplementation(async (work: any) => work(prisma));
        vi.mocked(prisma.wooCustomer.findMany).mockResolvedValue([]);
        vi.mocked(esClient.bulk).mockResolvedValue({ errors: false, items: [] } as any);
    });

    it('targets both old and new associations and uses email only for guests', async () => {
        await updateCustomerTotals(prisma as any, 'tenant', [
            { wooCustomerId: 10, billingEmail: 'not-a-fallback@example.com' },
            { wooCustomerId: null, billingEmail: 'old@example.com' },
            { wooCustomerId: 20, billingEmail: 'registered@example.com' },
            { wooCustomerId: null, billingEmail: 'new@example.com' },
            { wooCustomerId: 10, billingEmail: null }
        ]);
        const [sql, ...values] = vi.mocked(prisma.$executeRaw).mock.calls[0];
        expect(values).toEqual(['tenant', [10, 20], ['old@example.com', 'new@example.com'], [], 'tenant']);
        const text = (sql as TemplateStringsArray).join('?');
        expect(text).toContain('LEFT JOIN "WooOrder"');
        expect(text).toContain('COUNT(o."id")');
        expect(text).toContain('COALESCE(SUM(o."total"), 0)');
        expect(text).not.toContain('status');
        expect(prisma.wooCustomer.updateMany).not.toHaveBeenCalled();
    });

    it('does no SQL for orders without a customer identity', async () => {
        await updateCustomerTotals(prisma as any, 'tenant', [{ wooCustomerId: null, billingEmail: null }]);
        expect(prisma.$executeRaw).not.toHaveBeenCalled();
    });

    it('locks before reading or mutating and propagates failures for rollback', async () => {
        const failure = new Error('aggregate failed');
        await expect(withOrderTotalsTransaction('tenant', async () => {
            expect(prisma.$queryRaw).toHaveBeenCalledWith(expect.anything(), 'order-totals:tenant');
            throw failure;
        })).rejects.toBe(failure);
    });

    it('rebuilds and reindexes bounded pages including zero-order customers', async () => {
        const first = Array.from({ length: 500 }, (_, i) => customer(String(i + 1).padStart(4, '0')));
        const last = [customer('0501')];
        vi.mocked(prisma.wooCustomer.findMany)
            .mockResolvedValueOnce(first as any).mockResolvedValueOnce(last as any)
            .mockResolvedValueOnce(first as any).mockResolvedValueOnce(last as any);
        await recalculateCustomerTotals('tenant');
        expect(prisma.$executeRaw).toHaveBeenCalledTimes(2);
        expect(prisma.wooCustomer.findMany).toHaveBeenCalledTimes(4);
        for (const [args] of vi.mocked(prisma.wooCustomer.findMany).mock.calls) {
            expect(args).toMatchObject({ where: { accountId: 'tenant' }, take: 500, orderBy: { id: 'asc' } });
            expect(args).not.toHaveProperty('cursor');
        }
        expect(vi.mocked(prisma.wooCustomer.findMany).mock.calls[1][0]?.where).toEqual({ accountId: 'tenant', id: { gt: '0500' } });
        expect(esClient.bulk).not.toHaveBeenCalled();
        expect(prisma.syncState.upsert).toHaveBeenCalledTimes(501);
        expect(prisma.syncState.upsert).toHaveBeenLastCalledWith(expect.objectContaining({
            create: expect.objectContaining({ accountId: 'tenant', entityType: 'contact-projection:501' })
        }));
    });

    it('records recently changed customers for independent ES recovery, even while ES is down', async () => {
        const since = new Date('2026-01-01');
        vi.mocked(prisma.wooCustomer.findMany).mockResolvedValueOnce([customer('1')] as any);
        vi.mocked(esClient.bulk).mockResolvedValueOnce({ errors: true } as any);
        await reindexCustomerTotals('tenant', since);
        expect(prisma.wooCustomer.findMany).toHaveBeenCalledWith(expect.objectContaining({
            where: { accountId: 'tenant', updatedAt: { gte: since } }
        }));
        expect(esClient.bulk).not.toHaveBeenCalled();
        expect(prisma.syncState.upsert).toHaveBeenCalled();
    });

    it('stops recovery on database failure without indexing incomplete results', async () => {
        vi.mocked(prisma.wooCustomer.findMany).mockResolvedValueOnce([customer('1')] as any);
        vi.mocked(prisma.$executeRaw).mockRejectedValueOnce(new Error('database unavailable'));
        await expect(recalculateCustomerTotals('tenant')).rejects.toThrow('database unavailable');
        expect(esClient.bulk).not.toHaveBeenCalled();
    });

    it('repairs customer-only changes without expanding to the whole account', async () => {
        const since = new Date('2026-01-01');
        vi.mocked(prisma.wooCustomer.findMany).mockResolvedValueOnce([customer('1')] as any);
        await recalculateCustomerTotals('tenant', since);
        expect(prisma.$executeRaw).toHaveBeenCalledWith(expect.anything(), 'tenant', [], [], ['1'], 'tenant');
        for (const [args] of vi.mocked(prisma.wooCustomer.findMany).mock.calls) {
            expect(args?.where).toMatchObject({ accountId: 'tenant', updatedAt: { gte: since } });
        }
    });
});
