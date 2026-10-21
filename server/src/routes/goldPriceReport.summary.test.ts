import Fastify from 'fastify';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
vi.mock('../middleware/auth', () => ({ requireAuthFastify: vi.fn(async () => {}) }));
vi.mock('../utils/prisma', () => ({ prisma: { account: { findUnique: vi.fn() }, wooProduct: { count: vi.fn(), findMany: vi.fn() }, productVariation: { count: vi.fn(), findMany: vi.fn() } } }));
import { prisma } from '../utils/prisma';
import routes from './goldPriceReport';
describe('sampled gold price summaries', () => {
    let app: ReturnType<typeof Fastify>;
    beforeEach(async () => {
        vi.resetAllMocks(); app = Fastify(); await app.register(routes, { prefix: '/api/reports' });
        vi.mocked(prisma.wooProduct.count).mockResolvedValue(80); vi.mocked(prisma.productVariation.count).mockResolvedValue(20);
        vi.mocked(prisma.account.findUnique).mockResolvedValue({ goldPrice18ct: 20, goldPrice9ct: null } as never);
        vi.mocked(prisma.wooProduct.findMany).mockResolvedValue([
            { name: 'Known', price: 100, weight: 2, goldPriceType: '18ct', miscCosts: [] },
            { name: 'Missing weight', price: 100, weight: null, goldPriceType: '18ct', miscCosts: [] },
            { name: 'Missing rate', price: 100, weight: 2, goldPriceType: '9ct', miscCosts: [] },
        ] as never);
        vi.mocked(prisma.productVariation.findMany).mockResolvedValue([]);
    });
    afterEach(async () => { await app.close(); });
    it('reports sample size and unavailable margins without fabricating free gold costs', async () => {
        const response = await app.inject({ url: '/api/reports/gold-price/summary', headers: { 'x-account-id': 'a' } });
        expect(response.statusCode).toBe(200); expect(response.json()).toEqual({ totalCount: 100, productCount: 80, variationCount: 20, sampledCount: 3, unavailableCount: 2, lowestMarginItems: [{ name: 'Known', margin: 60 }] });
        expect(prisma.wooProduct.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: { accountId: 'a', isGoldPriceApplied: true }, orderBy: { id: 'asc' }, take: 20 }));
        expect(prisma.productVariation.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: { product: { accountId: 'a' }, isGoldPriceApplied: true }, orderBy: { id: 'asc' }, take: 20 }));
    });
});
