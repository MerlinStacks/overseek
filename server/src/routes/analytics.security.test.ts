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
vi.mock('../services/ads', () => ({ AdsService: { getAdAccounts: vi.fn(), getMetaInsights: vi.fn(), getGoogleInsights: vi.fn() } }));
vi.mock('../services/AnalyticsService', () => ({
    AnalyticsService: {
        getChannelBreakdown: vi.fn(),
    },
}));
vi.mock('../services/analytics/CLVService', () => ({ clvService: {} }));
vi.mock('../services/analytics/AOVService', () => ({ aovService: { getAOVTrend: vi.fn(), getAOVComparison: vi.fn() } }));
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
import { aovService } from '../services/analytics/AOVService';
import { AdsService } from '../services/ads';

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

    it('passes requested dates to both ad providers and refuses partial totals', async () => {
        vi.mocked(PermissionService.hasAnyPermission).mockResolvedValue(true);
        vi.mocked(AdsService.getAdAccounts).mockResolvedValue([{ id: 'meta', platform: 'META' }, { id: 'google', platform: 'GOOGLE' }] as any);
        const range = { startDate: '2026-10-01', endDate: '2026-10-17' };
        const metric = { accountId: 'meta', spend: 10, roas: 2, clicks: 4, impressions: 10, currency: 'EUR', date_start: range.startDate, date_stop: range.endDate };
        vi.mocked(AdsService.getMetaInsights).mockResolvedValue(metric); vi.mocked(AdsService.getGoogleInsights).mockResolvedValue(null);
        const response = await app.inject({ url: '/api/analytics/ads-summary?startDate=2026-10-01&endDate=2026-10-17', headers: { 'x-account-id': 'acct-1' } });
        expect(response.statusCode).toBe(500); expect(response.json()).not.toHaveProperty('spend');
        expect(AdsService.getMetaInsights).toHaveBeenCalledWith('meta', range); expect(AdsService.getGoogleInsights).toHaveBeenCalledWith('google', range);
        vi.mocked(AdsService.getGoogleInsights).mockResolvedValue({ ...metric, accountId: 'google' });
        const complete = await app.inject({ url: '/api/analytics/ads-summary?startDate=2026-10-01&endDate=2026-10-17', headers: { 'x-account-id': 'acct-1' } });
        expect(complete.json()).toMatchObject({ hasData: true, spend: 20, roas: 2, currency: 'EUR', period: range });
    });

    it('rejects invalid dates before contacting ad services', async () => {
        vi.mocked(PermissionService.hasAnyPermission).mockResolvedValue(true);
        const response = await app.inject({ url: '/api/analytics/ads-summary?startDate=2026-02-31&endDate=2026-10-17', headers: { 'x-account-id': 'acct-1' } });
        expect(response.statusCode).toBe(400); expect(AdsService.getAdAccounts).not.toHaveBeenCalled();
    });

    it.each([-1, 1, 7, 30, 90, 365])('preserves AOV preset %i and timezone on both endpoints', async days => {
        vi.mocked(PermissionService.hasAnyPermission).mockResolvedValue(true);
        vi.mocked(aovService.getAOVTrend).mockResolvedValue([]);
        vi.mocked(aovService.getAOVComparison).mockResolvedValue({} as any);
        for (const path of ['aov-trend', 'aov-trend/comparison']) {
            const res = await app.inject({
                method: 'GET', url: `/api/analytics/${path}?days=${days}`,
                headers: { 'x-account-id': 'acct-1', 'x-timezone': 'Pacific/Auckland' }
            });
            expect(res.statusCode).toBe(200);
        }
        expect(aovService.getAOVTrend).toHaveBeenCalledWith('acct-1', days, 'Pacific/Auckland');
        expect(aovService.getAOVComparison).toHaveBeenCalledWith('acct-1', days, 'Pacific/Auckland');
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
