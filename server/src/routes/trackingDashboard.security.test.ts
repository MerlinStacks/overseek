import Fastify from 'fastify';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../middleware/auth', () => ({
    requireAuthFastify: vi.fn(async (request: any) => {
        request.user = { id: 'user-1' };
        request.accountId = request.headers['x-account-id'];
    }),
}));

vi.mock('../services/PermissionService', () => ({
    PermissionService: {
        hasAnyPermission: vi.fn(),
    },
}));

vi.mock('../services/TrackingService', () => ({
    TrackingService: {
        getStats: vi.fn(),
        getFunnel: vi.fn(),
        getRevenue: vi.fn(),
        getAttribution: vi.fn(),
        getAbandonmentRate: vi.fn(),
        getSearches: vi.fn(),
        getExitPages: vi.fn(),
        getCohorts: vi.fn(),
        getLTV: vi.fn(),
        getLiveVisitors: vi.fn(),
        getLiveCarts: vi.fn(),
        getSessionHistory: vi.fn(),
    },
}));

vi.mock('../services/tracking', () => ({
    getVisitorCount24h: vi.fn(),
}));

vi.mock('../services/analytics/CartAbandonmentService', () => ({
    getCartAbandonmentStats: vi.fn(),
}));

vi.mock('../utils/prisma', () => ({ prisma: {} }));

import trackingDashboardRoutes from './trackingDashboard';
import { PermissionService } from '../services/PermissionService';
import { TrackingService } from '../services/TrackingService';

describe('tracking dashboard permissions and date windows', () => {
    let app: ReturnType<typeof Fastify>;

    beforeEach(async () => {
        app = Fastify();
        await app.register(trackingDashboardRoutes, { prefix: '/api/tracking' });
        await app.ready();
    });

    afterEach(async () => {
        await app.close();
        vi.clearAllMocks();
    });

    it('denies tracking analytics without analytics or finance permission', async () => {
        vi.mocked(PermissionService.hasAnyPermission).mockResolvedValue(false);

        const res = await app.inject({
            method: 'GET',
            url: '/api/tracking/stats',
            headers: { 'x-account-id': 'acct-1' },
        });

        expect(res.statusCode).toBe(403);
        expect(TrackingService.getStats).not.toHaveBeenCalled();
    });

    it('forwards explicit start and end dates to tracking metrics', async () => {
        vi.mocked(PermissionService.hasAnyPermission).mockResolvedValue(true);
        vi.mocked(TrackingService.getStats).mockResolvedValue({ ok: true } as any);

        const res = await app.inject({
            method: 'GET',
            url: '/api/tracking/stats?startDate=2026-01-02&endDate=2026-01-04',
            headers: { 'x-account-id': 'acct-1', 'x-timezone': 'UTC' },
        });

        expect(res.statusCode).toBe(200);
        expect(TrackingService.getStats).toHaveBeenCalledWith(
            'acct-1',
            3,
            'UTC',
            {
                startDate: new Date('2026-01-02T00:00:00.000Z'),
                endDate: new Date('2026-01-04T23:59:59.999Z'),
            }
        );
    });
});
