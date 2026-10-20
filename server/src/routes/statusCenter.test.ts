import Fastify from 'fastify';
import { describe, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ anomaly: vi.fn() }));
vi.mock('../middleware/auth', () => ({ requireAuthFastify: async (request: any) => { request.accountId = 'tenant-1'; } }));
vi.mock('../services/analytics/AnomalyDetection', () => ({ AnomalyDetection: { getRevenueAnomaly: mocks.anomaly } }));
vi.mock('../utils/prisma', () => ({ prisma: {
    syncLog: { count: vi.fn(async () => 0), findFirst: vi.fn(async () => null) },
    webhookDelivery: { count: vi.fn(async () => 0), findFirst: vi.fn(async () => null) },
    account: { findUnique: vi.fn(async () => null) },
} }));
vi.mock('../utils/redis', () => ({ redisClient: {} }));
vi.mock('../utils/logger', () => ({ Logger: { error: vi.fn() } }));
import routes from './statusCenter';
describe('status center revenue availability', () => {
    it('reports a warning rather than healthy when revenue analytics is unavailable', async () => {
        mocks.anomaly.mockRejectedValue(new Error('Database unavailable'));
        const app = Fastify();
        try {
            await app.register(routes);
            const response = await app.inject({ method: 'GET', url: '/' });
            expect(response.statusCode).toBe(200);
            expect(response.json().revenueAlerts).toEqual(expect.objectContaining({ status: 'warning', message: 'Revenue data unavailable' }));
            expect(mocks.anomaly).toHaveBeenCalledWith('tenant-1');
        } finally { await app.close(); }
    });
});
