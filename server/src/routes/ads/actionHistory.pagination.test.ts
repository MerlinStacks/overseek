import Fastify from 'fastify';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
const m = vi.hoisted(() => ({ findMany: vi.fn(), count: vi.fn() }));
vi.mock('../../services/ads', () => ({ AdsService: {} }));
vi.mock('../../utils/prisma', () => ({ prisma: { adActionLog: { findMany: m.findMany, count: m.count } } }));
vi.mock('../../utils/logger', () => ({ Logger: { error: vi.fn() } }));
import { adsActionsRoutes } from './actions';
let app: ReturnType<typeof Fastify>;
beforeEach(async () => { vi.clearAllMocks(); m.findMany.mockResolvedValue([]); m.count.mockResolvedValue(0); app = Fastify(); app.decorateRequest('accountId', 'account-a'); await app.register(adsActionsRoutes); });
afterEach(async () => { await app.close(); });
it.each(['page=12junk', 'page=10001', 'page=1.5', 'limit=101', 'page=9007199254740993'])('rejects invalid action-history queries before database work: %s', async query => {
    const response = await app.inject({ method: 'GET', url: `/action-history?${query}` }); expect(response.statusCode).toBe(400); expect(m.findMany).not.toHaveBeenCalled();
});
it('bounds the derived offset and keeps reads account scoped', async () => {
    const response = await app.inject({ method: 'GET', url: '/action-history?page=10000&limit=100' }); expect(response.statusCode).toBe(200);
    expect(m.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: { accountId: 'account-a' }, skip: 999900, take: 100 }));
});
