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

vi.mock('../services/tracking/WebVitalsService', () => ({
    VITAL_METRICS: ['LCP', 'CLS', 'INP'],
    getVitalsSummary: vi.fn(),
    getVitalsTimeline: vi.fn(),
    getVitalsByPage: vi.fn(),
}));

import webVitalsRoutes from './webVitals';
import { PermissionService } from '../services/PermissionService';
import * as WebVitalsService from '../services/tracking/WebVitalsService';

describe('web vitals route permissions and filters', () => {
    let app: ReturnType<typeof Fastify>;

    beforeEach(async () => {
        app = Fastify();
        await app.register(webVitalsRoutes, { prefix: '/api/web-vitals' });
        await app.ready();
    });

    afterEach(async () => {
        await app.close();
        vi.clearAllMocks();
    });

    it('denies web vitals endpoints before invoking handlers when permission is missing', async () => {
        vi.mocked(PermissionService.hasAnyPermission).mockResolvedValue(false);

        const res = await app.inject({
            method: 'GET',
            url: '/api/web-vitals/timeline?metric=LCP&pageType=product',
            headers: { 'x-account-id': 'acct-1' },
        });

        expect(res.statusCode).toBe(403);
        expect(WebVitalsService.getVitalsTimeline).not.toHaveBeenCalled();
    });

    it('forwards pageType to timeline and page breakdown queries', async () => {
        vi.mocked(PermissionService.hasAnyPermission).mockResolvedValue(true);
        vi.mocked(WebVitalsService.getVitalsTimeline).mockResolvedValue([] as any);
        vi.mocked(WebVitalsService.getVitalsByPage).mockResolvedValue([] as any);

        const timelineRes = await app.inject({
            method: 'GET',
            url: '/api/web-vitals/timeline?metric=LCP&days=14&pageType=product',
            headers: { 'x-account-id': 'acct-1' },
        });
        const pagesRes = await app.inject({
            method: 'GET',
            url: '/api/web-vitals/pages?metric=INP&days=7&limit=5&pageType=checkout',
            headers: { 'x-account-id': 'acct-1' },
        });

        expect(timelineRes.statusCode).toBe(200);
        expect(pagesRes.statusCode).toBe(200);
        expect(WebVitalsService.getVitalsTimeline).toHaveBeenCalledWith('acct-1', 'LCP', 14, 'product');
        expect(WebVitalsService.getVitalsByPage).toHaveBeenCalledWith('acct-1', 7, 'INP', 5, 'checkout');
    });
});
