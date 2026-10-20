import { beforeEach, describe, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ findMany: vi.fn() }));
vi.mock('../../utils/prisma', () => ({ prisma: { analyticsEvent: { findMany: mocks.findMany } } }));
import { getCartAbandonmentStats } from './CartAbandonmentService';
const start = new Date('2026-01-01T00:00:00Z');
const end = new Date('2026-01-02T00:00:00Z');
function event(type: string, payload: unknown, seconds = 0, sessionId = 'session-1') {
    return { id: `event-${seconds}-${type}`, sessionId, type, payload, createdAt: new Date(start.getTime() + seconds * 1000) };
}
beforeEach(() => { mocks.findMany.mockReset(); mocks.findMany.mockResolvedValue([]); });
const stats = () => getCartAbandonmentStats('tenant-1', start, end);
describe('cart abandonment analytics', () => {
    it('returns stable empty results and scopes bounded, ordered queries to the account', async () => {
        expect(await stats()).toEqual({ period: '2026-01-01 to 2026-01-02', totalAddToCarts: 0, totalPurchases: 0, totalRemoves: 0,
            overallAbandonmentRate: 0, topAbandonedProducts: [], quickRemoveProducts: [] });
        expect(mocks.findMany).toHaveBeenCalledWith(expect.objectContaining({
            where: { session: { accountId: 'tenant-1' }, type: { in: ['add_to_cart', 'remove_from_cart', 'purchase'] }, createdAt: { gte: start, lte: end } },
            take: 1000, orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
        }));
    });
    it('matches variation purchases to parent-product adds and counts product events, not quantities', async () => {
        mocks.findMany.mockResolvedValue([
            event('add_to_cart', { productId: 10, variationId: 11, quantity: 5, name: 'Mug' }, 1),
            event('add_to_cart', { productId: '10', variationId: 12 }, 2),
            event('add_to_cart', { productId: 10 }, 3),
            event('purchase', { items: [{ id: 11, productId: 10, quantity: 3 }, { id: 12, productId: 10 }] }, 4),
        ]);
        const result = await stats();
        expect(result.totalPurchases).toBe(1);
        expect(result.overallAbandonmentRate).toBe(66.7);
        expect(result.topAbandonedProducts).toEqual([expect.objectContaining({ productId: 10, addToCartCount: 3, purchaseCount: 1, abandonmentRate: 66.7 })]);
    });
    it('supports legacy purchase IDs and ignores malformed items and product IDs', async () => {
        mocks.findMany.mockResolvedValue([
            event('add_to_cart', { productId: -1 }), event('add_to_cart', { productId: {} }),
            event('purchase', { items: [null, false, {}, { id: 10 }, { id: '11' }] }),
            event('purchase', { items: 'invalid' }), event('add_to_cart', null),
        ]);
        const result = await stats();
        expect(result.totalAddToCarts).toBe(0);
        expect(result.totalPurchases).toBe(2);
        expect(result.overallAbandonmentRate).toBe(0);
    });
    it('never reports a negative rate when purchases outnumber in-window adds', async () => {
        mocks.findMany.mockResolvedValue([
            ...[1, 2, 3].map(second => event('add_to_cart', { productId: 10 }, second)),
            ...[4, 5, 6, 7].map(second => event('purchase', { items: [{ productId: 10 }] }, second)),
        ]);
        const result = await stats();
        expect(result.overallAbandonmentRate).toBe(0);
        expect(result.topAbandonedProducts[0].abandonmentRate).toBe(0);
        expect(result.totalPurchases).toBe(4);
    });
    it('matches quick removals only within the same session and consumes an add once', async () => {
        mocks.findMany.mockResolvedValue([
            event('add_to_cart', { productId: 10 }, 0),
            event('remove_from_cart', { productId: 10 }, 30, 'other-session'),
            event('remove_from_cart', { productId: 10 }, 60),
            event('remove_from_cart', { productId: 10 }, 61),
            event('add_to_cart', { productId: 20 }, 100),
            event('remove_from_cart', { productId: 20 }, 400), // Exactly five minutes is not quick.
        ]);
        const result = await stats();
        expect(result.totalRemoves).toBe(4);
        expect(result.quickRemoveProducts).toEqual([expect.objectContaining({ productId: 10, quickRemoveCount: 1 })]);
    });
    it('does not count a post-purchase removal against an old add', async () => {
        mocks.findMany.mockResolvedValue([event('add_to_cart', { productId: 10 }),
            event('purchase', { items: [{ productId: 10 }] }, 1), event('remove_from_cart', { productId: 10 }, 2)]);
        expect((await stats()).quickRemoveProducts).toEqual([]);
    });
    it('paginates without losing add/remove state at batch boundaries', async () => {
        const page = Array.from({ length: 1000 }, (_, i) => ({ ...event('add_to_cart', { productId: 10 }), id: `event-${String(i).padStart(4, '0')}` }));
        mocks.findMany.mockResolvedValueOnce(page).mockResolvedValueOnce([event('remove_from_cart', { productId: 10 }, 1)]);
        const result = await stats();
        expect(result.totalAddToCarts).toBe(1000);
        expect(result.quickRemoveProducts[0].quickRemoveCount).toBe(1);
        expect(mocks.findMany).toHaveBeenNthCalledWith(2, expect.objectContaining({ cursor: { id: 'event-0999' }, skip: 1, take: 1000 }));
    });
    it('propagates query failures instead of returning partial statistics', async () => {
        mocks.findMany.mockRejectedValue(new Error('Database unavailable'));
        await expect(stats()).rejects.toThrow('Database unavailable');
    });
    it('rejects invalid date ranges before querying', async () => {
        await expect(getCartAbandonmentStats('tenant-1', end, start)).rejects.toThrow('date range');
        expect(mocks.findMany).not.toHaveBeenCalled();
    });
});
