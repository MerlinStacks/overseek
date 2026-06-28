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

vi.mock('../services/analytics/acquisition', () => ({ AcquisitionAnalytics: {} }));

vi.mock('../services/analytics/sales', () => ({ SalesAnalytics: {} }));
vi.mock('../services/analytics/behaviour', () => ({ BehaviourAnalytics: {} }));
vi.mock('../services/analytics/customer', () => ({ CustomerAnalytics: {} }));
vi.mock('../services/analytics/roadblock', () => ({ RoadblockAnalytics: {} }));
vi.mock('../services/analytics/ProductRankingService', () => ({ ProductRankingService: {} }));
vi.mock('../services/ads', () => ({ AdsService: {} }));
vi.mock('../services/AnalyticsService', () => ({
    AnalyticsService: {
        getChannelBreakdown: vi.fn(),
    },
}));
vi.mock('../services/analytics/CLVService', () => ({ clvService: {} }));
vi.mock('../services/analytics/AOVService', () => ({ aovService: {} }));
vi.mock('../services/analytics/cro', () => ({ CROAnalytics: {} }));
vi.mock('../services/analytics/geography', () => ({ GeographyAnalytics: {} }));
vi.mock('../services/analytics/abtesting', () => ({ abTestingService: {} }));
vi.mock('../services/analytics/AnomalyDetection', () => ({ AnomalyDetection: {} }));
vi.mock('../utils/prisma', () => ({ prisma: {} }));
vi.mock('../utils/cache', () => ({
    cacheAside: vi.fn((_key: string, loader: () => unknown) => loader()),
    CacheNamespace: { ANALYTICS: 'analytics' },
    CacheTTL: { SHORT: 60, MEDIUM: 300 },
}));
vi.mock('./analyticsReports', () => ({ default: async () => undefined }));
vi.mock('./analyticsInventory', () => ({ default: async () => undefined }));
vi.mock('./cohorts', () => ({ default: async () => undefined }));

import analyticsRoutes from './analytics';
import { PermissionService } from '../services/PermissionService';
import { AnalyticsService } from '../services/AnalyticsService';

describe('analytics route permissions', () => {
    let app: ReturnType<typeof Fastify>;

    beforeEach(async () => {
        app = Fastify();
        await app.register(analyticsRoutes, { prefix: '/api/analytics' });
        await app.ready();
    });

    afterEach(async () => {
        await app.close();
        vi.clearAllMocks();
    });

    it('denies analytics endpoints before invoking handlers when permission is missing', async () => {
        vi.mocked(PermissionService.hasAnyPermission).mockResolvedValue(false);

        const res = await app.inject({
            method: 'GET',
            url: '/api/analytics/channels',
            headers: { 'x-account-id': 'acct-1' },
        });

        expect(res.statusCode).toBe(403);
        expect(AnalyticsService.getChannelBreakdown).not.toHaveBeenCalled();
    });
});
