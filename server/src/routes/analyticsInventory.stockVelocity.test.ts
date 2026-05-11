import Fastify from 'fastify';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../utils/prisma', () => ({
    prisma: {
        $queryRaw: vi.fn(),
    },
}));

vi.mock('../utils/elastic', () => ({
    esClient: {
        search: vi.fn(),
    },
}));

import analyticsInventoryRoutes from './analyticsInventory';
import { prisma } from '../utils/prisma';
import { esClient } from '../utils/elastic';

describe('analytics inventory stock velocity', () => {
    let app: ReturnType<typeof Fastify>;

    beforeEach(async () => {
        app = Fastify();
        app.addHook('onRequest', async (request) => {
            (request as any).accountId = 'acct-1';
        });
        await app.register(analyticsInventoryRoutes, { prefix: '/api/analytics/inventory' });
        await app.ready();
    });

    afterEach(async () => {
        await app.close();
        vi.clearAllMocks();
    });

    it('uses variation-level trailing 30d sales for variant rows', async () => {
        vi.mocked(prisma.$queryRaw)
            .mockResolvedValueOnce([
                {
                    id: 'prod-1',
                    wooId: 101,
                    name: 'Simple Product',
                    sku: 'SIMPLE-1',
                    mainImage: null,
                    price: '19.99',
                    stock_quantity: 50,
                },
            ] as any)
            .mockResolvedValueOnce([
                {
                    id: 'var-1',
                    wooId: 501,
                    sku: 'VAR-RED-M',
                    stock_quantity: 12,
                    name: 'Variable Tee',
                    mainImage: null,
                    parentWooId: 201,
                },
            ] as any);

        vi.mocked(esClient.search).mockResolvedValue({
            aggregations: {
                products: {
                    by_product: {
                        buckets: [
                            { key: 101, total_qty: { value: 20 } },
                            { key: 201, total_qty: { value: 40 } },
                        ],
                    },
                    by_variation: {
                        buckets: [
                            { key: 501, total_qty: { value: 3 } },
                        ],
                    },
                },
            },
        } as any);

        const res = await app.inject({
            method: 'GET',
            url: '/api/analytics/inventory/stock-velocity',
        });

        expect(res.statusCode).toBe(200);

        const body = res.json() as Array<{ id: string; soldLast30d: number; dailyVelocity: number }>;
        const simple = body.find(item => item.id === 'prod-1');
        const variant = body.find(item => item.id === 'var-1');

        expect(simple?.soldLast30d).toBe(20);
        expect(simple?.dailyVelocity).toBeCloseTo(20 / 30, 2);

        expect(variant?.soldLast30d).toBe(3);
        expect(variant?.dailyVelocity).toBeCloseTo(3 / 30, 2);
    });

    it('treats variant sales as zero when variationId is missing or 0', async () => {
        vi.mocked(prisma.$queryRaw)
            .mockResolvedValueOnce([] as any)
            .mockResolvedValueOnce([
                {
                    id: 'var-2',
                    wooId: 777,
                    sku: 'VAR-BLUE-L',
                    stock_quantity: 8,
                    name: 'Variable Hoodie',
                    mainImage: null,
                    parentWooId: 301,
                },
            ] as any);

        vi.mocked(esClient.search).mockResolvedValue({
            aggregations: {
                products: {
                    by_product: {
                        buckets: [{ key: 301, total_qty: { value: 14 } }],
                    },
                    by_variation: {
                        buckets: [{ key: 0, total_qty: { value: 9 } }],
                    },
                },
            },
        } as any);

        const res = await app.inject({
            method: 'GET',
            url: '/api/analytics/inventory/stock-velocity',
        });

        expect(res.statusCode).toBe(200);

        const body = res.json() as Array<{ id: string; soldLast30d: number; dailyVelocity: number }>;
        const variant = body.find(item => item.id === 'var-2');

        expect(variant?.soldLast30d).toBe(0);
        expect(variant?.dailyVelocity).toBe(0);
    });
});
