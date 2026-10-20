import { Prisma } from '@prisma/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ account: vi.fn(), sessions: vi.fn(), events: vi.fn() }));
vi.mock('../../utils/prisma', () => ({ prisma: { account: { findUnique: mocks.account }, analyticsSession: { findMany: mocks.sessions }, analyticsEvent: { findMany: mocks.events } } }));
import { calculatePurchaseIntent, getCohorts, getLTV } from './CohortLTVService';
const purchase = (id: string, orderId: number | null, total: unknown, identity: Record<string, unknown> = { customerId: 1, email: 'alice@example.com' }) => ({
    id, orderId, payload: { total, currency: 'USD', ...identity }, session: { wooCustomerId: 1, email: 'alice@example.com' },
});
beforeEach(() => {
    vi.resetAllMocks(); vi.useFakeTimers(); vi.setSystemTime(new Date('2026-10-20T12:00:00Z'));
    mocks.account.mockResolvedValue({ timezone: 'UTC', currency: 'USD' });
    mocks.sessions.mockResolvedValue([]); mocks.events.mockResolvedValue([]);
});
afterEach(() => { vi.useRealTimers(); });
describe('cohort retention', () => {
    it('counts only observed weeks, not every week through last activity', async () => {
        mocks.sessions.mockResolvedValue([{ id: 's1', visitorId: 'v1', createdAt: new Date('2026-09-28T12:00:00Z'), lastActiveAt: new Date('2026-10-19T12:00:00Z') }]);
        const result = await getCohorts('tenant-1');
        expect(result.cohorts).toEqual([{ week: '2026-09-28', totalVisitors: 1, retention: [
            { week: 0, count: 1, rate: 100 }, { week: 1, count: 0, rate: 0 }, { week: 2, count: 0, rate: 0 }, { week: 3, count: 1, rate: 100 },
        ] }]);
    });
    it('uses real event timestamps for intermediate activity and deduplicates repeated activity in a week', async () => {
        mocks.sessions.mockResolvedValue([{ id: 's1', visitorId: 'v1', createdAt: new Date('2026-09-28'), lastActiveAt: new Date('2026-10-19') }]);
        mocks.events.mockResolvedValue([{ id: 'e1', sessionId: 's1', occurredAt: new Date('2026-10-06') }, { id: 'e2', sessionId: 's1', occurredAt: new Date('2026-10-07') }]);
        const result = await getCohorts('tenant-1');
        expect(result.cohorts[0].retention[1]).toEqual({ week: 1, count: 1, rate: 100 });
        expect(result.cohorts[0].retention[2].count).toBe(0);
        expect(mocks.events).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ session: { accountId: 'tenant-1' }, sessionId: { in: ['s1'] } }), take: 1000 }));
    });
    it('uses store-local cohort dates and does not fabricate future retention weeks', async () => {
        mocks.account.mockResolvedValue({ timezone: 'Australia/Sydney' });
        mocks.sessions.mockResolvedValue([{ id: 's1', visitorId: 'v1', createdAt: new Date('2026-10-18T14:00:00Z'), lastActiveAt: new Date('2026-10-20T10:00:00Z') }]);
        const result = await getCohorts('tenant-1');
        expect(result.cohorts[0].week).toBe('2026-10-19');
        expect(result.cohorts[0].retention).toHaveLength(1);
    });
    it('pages session reads rather than loading every visitor at once', async () => {
        const page = Array.from({ length: 1000 }, (_, i) => ({ id: `s-${i}`, visitorId: `v-${i}`, createdAt: new Date('2026-10-19'), lastActiveAt: new Date('2026-10-19') }));
        mocks.sessions.mockResolvedValueOnce(page).mockResolvedValueOnce([]);
        expect((await getCohorts('tenant-1')).cohorts[0].totalVisitors).toBe(1000);
        expect(mocks.sessions).toHaveBeenNthCalledWith(2, expect.objectContaining({ take: 1000, cursor: { id: 's-999' }, skip: 1 }));
    });
});
describe('identified-customer LTV', () => {
    it('parses numeric totals, deduplicates order events and merges unambiguous email/ID identities', async () => {
        mocks.events.mockResolvedValue([
            purchase('e1', 10, '20.50', { customerId: 0, email: ' Alice@Example.com ' }),
            purchase('e2', 10, 20.5), purchase('e3', 11, 30),
        ]);
        const result = await getLTV('tenant-1');
        expect(result.avgLTV).toBe(50.5);
        expect(result.totalCustomers).toBe(1);
        expect(result.repeatRate).toBe(100);
        expect(result.topCustomers).toEqual([{ customerId: '1', ltv: 50.5, orders: 2 }]);
        expect(result.duplicatePurchaseEvents).toBe(1);
    });
    it('does not collapse unidentified buyers into an anonymous customer or reuse mutable session identity', async () => {
        mocks.events.mockResolvedValue([purchase('e1', 1, 10, { customerId: 0, email: '' }), purchase('e2', 2, 20, { customerId: 0, email: '' })]);
        const result = await getLTV('tenant-1');
        expect(result.totalCustomers).toBe(0);
        expect(result.repeatCustomers).toBe(0);
        expect(result.excludedUnidentifiedEvents).toBe(2);
    });
    it('does not merge two customer IDs just because they share an email', async () => {
        mocks.events.mockResolvedValue([purchase('e1', 1, 10), purchase('e2', 2, 20, { customerId: 2, email: 'alice@example.com' })]);
        expect((await getLTV('tenant-1')).totalCustomers).toBe(2);
    });
    it('keeps other currencies separate from the store-currency headline metric', async () => {
        mocks.events.mockResolvedValue([purchase('e1', 1, 10), purchase('e2', 2, 100, { customerId: 2, email: 'bob@example.com', currency: 'AUD' })]);
        const result = await getLTV('tenant-1');
        expect(result.currency).toBe('USD');
        expect(result.avgLTV).toBe(10);
        expect(result.byCurrency.AUD.avgLTV).toBe(100);
        expect(result.identifiedOnly).toBe(true);
    });
    it('excludes malformed totals and discloses purchases lacking order IDs', async () => {
        mocks.events.mockResolvedValue([purchase('e1', 1, 'invalid'), purchase('e2', 2, -1), purchase('e3', 3, Infinity), purchase('e4', null, 0)]);
        const result = await getLTV('tenant-1');
        expect(result.excludedInvalidEvents).toBe(3);
        expect(result.purchasesWithoutOrderId).toBe(1);
        expect(result.totalCustomers).toBe(1);
        expect(result.avgLTV).toBe(0);
    });
    it('requires tenant context and propagates query failures instead of reporting zero LTV', async () => {
        await expect(getLTV('')).rejects.toThrow('Account ID required');
        mocks.events.mockRejectedValue(new Error('Database unavailable'));
        await expect(getLTV('tenant-1')).rejects.toThrow('Database unavailable');
    });
});
describe('purchase intent heuristic', () => {
    it('preserves the original valid-input weights including Prisma Decimal cart values', () => {
        expect(calculatePurchaseIntent({ totalVisits: 10, cartValue: new Prisma.Decimal(200), isReturning: true, currentPath: '/checkout' })).toBe(100);
        expect(calculatePurchaseIntent({ totalVisits: 1, cartValue: 50 })).toBe(37);
    });
    it.each([null, {}, { totalVisits: -1, cartValue: -100 }, { totalVisits: Infinity, cartValue: NaN }, { totalVisits: 'bad', currentPath: {} }])('returns a bounded finite score for malformed input: %j', session => {
        const result = calculatePurchaseIntent(session);
        expect(Number.isFinite(result)).toBe(true); expect(result).toBeGreaterThanOrEqual(0); expect(result).toBeLessThanOrEqual(100);
    });
    it('does not count unrelated checkout substrings or string booleans as intent signals', () => {
        expect(calculatePurchaseIntent({ isReturning: 'false', currentPath: '/articles/checkout-guide' })).toBe(0);
    });
});
