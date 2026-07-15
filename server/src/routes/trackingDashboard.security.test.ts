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

const prismaMocks = vi.hoisted(() => ({
    analyticsSession: {
        findMany: vi.fn(),
        count: vi.fn(),
    },
    automationEnrollment: {
        findMany: vi.fn(),
    },
    wooCustomer: {
        findMany: vi.fn(),
    },
}));

vi.mock('../utils/prisma', () => ({ prisma: prismaMocks }));

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

    it('returns newest carts with flow send and recovery status', async () => {
        vi.mocked(PermissionService.hasAnyPermission).mockResolvedValue(true);
        prismaMocks.analyticsSession.findMany.mockResolvedValue([{
            id: 'cart-1',
            visitorId: 'visitor-1',
            email: 'customer@example.com',
            wooCustomerId: null,
            cartValue: 125,
            cartItems: [],
            currency: 'AUD',
            createdAt: new Date('2026-07-14T10:00:00Z'),
            lastActiveAt: new Date('2026-07-14T10:05:00Z'),
            abandonedNotificationSentAt: new Date('2026-07-14T11:00:00Z'),
        } as any]);
        prismaMocks.analyticsSession.count.mockResolvedValue(1);
        prismaMocks.automationEnrollment.findMany.mockResolvedValue([{
            triggerEntityId: 'cart-1',
            conversionAt: new Date('2026-07-14T12:00:00Z'),
            convertedOrderId: '987',
            convertedRevenue: 125,
            automation: { name: 'Cart rescue' },
            runEvents: [{ createdAt: new Date('2026-07-14T11:00:00Z') }],
        } as any]);

        const res = await app.inject({
            method: 'GET',
            url: '/api/tracking/abandoned-carts',
            headers: { 'x-account-id': 'acct-1' },
        });

        expect(res.statusCode).toBe(200);
        expect(prismaMocks.analyticsSession.findMany).toHaveBeenCalledWith(expect.objectContaining({
            orderBy: { createdAt: 'desc' },
        }));
        expect(prismaMocks.automationEnrollment.findMany).toHaveBeenCalledWith(expect.objectContaining({
            where: expect.objectContaining({
                accountId: 'acct-1',
                triggerEntityType: 'CART',
                triggerEntityId: { in: ['cart-1'] },
            }),
        }));
        expect(res.json().items[0]).toMatchObject({
            status: 'Recovered',
            flowName: 'Cart rescue',
            flowSentAt: '2026-07-14T11:00:00.000Z',
            recoveredAt: '2026-07-14T12:00:00.000Z',
            recoveredOrderId: '987',
            recoveredRevenue: 125,
        });
    });
});
