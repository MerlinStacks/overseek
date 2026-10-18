import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SegmentService } from './SegmentService';

const mocks = vi.hoisted(() => ({ segment: vi.fn(), query: vi.fn(), customers: vi.fn(), count: vi.fn() }));
vi.mock('../utils/prisma', () => ({ prisma: {
    customerSegment: { findFirst: mocks.segment }, $queryRaw: mocks.query,
    wooCustomer: { findMany: mocks.customers, count: mocks.count }
} }));

describe('Rolling segment evaluation', () => {
    const service = new SegmentService();
    beforeEach(() => {
        vi.resetAllMocks();
        vi.useFakeTimers();
        vi.setSystemTime(new Date('2026-10-18T12:00:00Z'));
        mocks.query.mockResolvedValue([{ id: 'customer' }]);
        mocks.customers.mockResolvedValue([]);
        mocks.count.mockResolvedValue(1);
    });
    afterEach(() => vi.useRealTimers());

    function segment(field: string, type = 'AND') {
        mocks.segment.mockResolvedValue({ id: 'segment', criteria: { type, rules: [{ field, operator: 'within', value: '7' }] } });
    }

    it('scopes purchase matching to the account and successful order statuses, with a rolling cutoff', async () => {
        segment('purchasedWithinDays');
        await service.getSegmentCount('tenant', 'segment');
        const sql = mocks.query.mock.calls[0][0];
        expect(sql.text).toContain("o.status IN ('processing', 'completed')");
        expect(sql.text).toContain('o."accountId" = c."accountId"');
        expect(sql.text).toContain('lower(trim(o."billingEmail"))');
        expect(sql.values).toContain('tenant');
        expect(sql.values).toContainEqual(new Date('2026-10-11T12:00:00Z'));
        expect(mocks.count).toHaveBeenCalledWith({ where: { accountId: 'tenant', AND: [{ id: { in: ['customer'] } }] } });
    });

    it('excludes later purchases from inactive, non-empty carts', async () => {
        segment('abandonedCartWithinDays', 'OR');
        await service.getSegmentCount('tenant', 'segment');
        const sql = mocks.query.mock.calls[0][0];
        expect(sql.text).toContain('s."cartValue" > 0');
        expect(sql.text).toContain('s."accountId" = c."accountId"');
        expect(sql.text).toContain('o."dateCreated" >= s."lastActiveAt"');
        expect(sql.text).toContain("e.type = 'purchase'");
        expect(sql.values).toContainEqual(new Date('2026-10-18T11:30:00Z'));
        expect(mocks.count.mock.calls[0][0].where.OR).toEqual([{ id: { in: ['customer'] } }]);
    });

    it('uses NOT EXISTS for recent-purchase exclusions', async () => {
        segment('notPurchasedWithinDays');
        await service.getSegmentCount('tenant', 'segment');
        expect(mocks.query.mock.calls[0][0].text).toContain('NOT EXISTS');
    });

    it('recalculates date windows on every evaluation', async () => {
        segment('purchasedWithinDays');
        await service.getSegmentCount('tenant', 'segment');
        vi.advanceTimersByTime(86400000);
        await service.getSegmentCount('tenant', 'segment');
        expect(mocks.query.mock.calls[1][0].values).toContainEqual(new Date('2026-10-12T12:00:00Z'));
    });

    it('allows an empty export for removing all previously uploaded members', async () => {
        segment('purchasedWithinDays');
        expect(await service.getExportableCustomers('tenant', 'segment', true)).toMatchObject({ totalCount: 0, emails: [] });
    });

    it.each(['emailClickedWithinDays', 'emailOpenedWithinDays', 'notEmailClickedWithinDays', 'notEmailOpenedWithinDays'])('evaluates %s with tenant-isolated event timestamps', async field => {
        segment(field);
        await service.getSegmentCount('tenant', 'segment');
        const sql = mocks.query.mock.calls[0][0];
        expect(sql.text).toContain('l."accountId" = c."accountId"');
        expect(sql.values).toContain(field.includes('Clicked') ? 'CLICK' : 'OPEN');
        expect(sql.values).toContainEqual(new Date('2026-10-11T12:00:00Z'));
        expect(sql.text.includes('NOT EXISTS')).toBe(field.startsWith('not'));
    });
});
