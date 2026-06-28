/**
 * Web Vitals Dashboard Routes - Fastify Plugin
 * Authenticated endpoints for querying real user performance data.
 */

import { FastifyPluginAsync } from 'fastify';
import { requireAuthFastify } from '../middleware/auth';
import { Logger } from '../utils/logger';
import * as WebVitalsService from '../services/tracking/WebVitalsService';
import { PermissionService } from '../services/PermissionService';

const webVitalsRoutes: FastifyPluginAsync = async (fastify) => {
    fastify.addHook('preHandler', requireAuthFastify);
    fastify.addHook('preHandler', async (request, reply) => {
        const accountId = request.accountId;
        const userId = request.user?.id;
        if (!accountId || !userId) {
            await reply.code(400).send({ error: 'Account ID required' });
            return reply;
        }

        const canView = await PermissionService.hasAnyPermission(userId, accountId, ['view_finance', 'view_analytics']);
        if (!canView) {
            await reply.code(403).send({ error: 'You do not have permission to view performance analytics' });
            return reply;
        }
    });

    const parseDays = (value: string | undefined) => {
        const parsed = parseInt(value || '30', 10);
        return Number.isFinite(parsed) && parsed > 0 ? Math.min(parsed, 90) : 30;
    };

    const parseLimit = (value: string | undefined) => {
        const parsed = parseInt(value || '20', 10);
        return Number.isFinite(parsed) && parsed > 0 ? Math.min(parsed, 50) : 20;
    };

    const parsePageType = (value: string | undefined) => {
        const validPageTypes = new Set(['all', 'product', 'category', 'cart', 'checkout', 'home', 'other']);
        return validPageTypes.has(value || '') ? value! : 'all';
    };

    /**
     * GET /api/web-vitals/summary
     * Returns p75, p90, rating, and distribution per metric.
     */
    fastify.get('/summary', async (request, reply) => {
        const accountId = request.accountId!;
        const query = request.query as { days?: string; pageType?: string };
        const days = parseDays(query.days);
        const pageType = parsePageType(query.pageType);

        try {
            const summaries = await WebVitalsService.getVitalsSummary(accountId, days, pageType);
            return { summaries, days, pageType };
        } catch (error) {
            Logger.error('[WebVitals] Summary error', { error, accountId });
            return reply.code(500).send({ error: 'Failed to fetch vitals summary' });
        }
    });

    /**
     * GET /api/web-vitals/timeline
     * Returns daily p75 trend for a single metric.
     */
    fastify.get('/timeline', async (request, reply) => {
        const accountId = request.accountId!;
        const query = request.query as { metric?: string; days?: string; pageType?: string };
        const days = parseDays(query.days);
        const pageType = parsePageType(query.pageType);

        const validMetrics = WebVitalsService.VITAL_METRICS as readonly string[];
        const metric = validMetrics.includes(query.metric || '') ? query.metric as WebVitalsService.VitalMetric : 'LCP';

        try {
            const timeline = await WebVitalsService.getVitalsTimeline(accountId, metric, days, pageType);
            return { timeline, metric, days, pageType };
        } catch (error) {
            Logger.error('[WebVitals] Timeline error', { error, accountId });
            return reply.code(500).send({ error: 'Failed to fetch vitals timeline' });
        }
    });

    /**
     * GET /api/web-vitals/pages
     * Returns per-URL p75 breakdown sorted by worst perf.
     */
    fastify.get('/pages', async (request, reply) => {
        const accountId = request.accountId!;
        const query = request.query as { days?: string; metric?: string; limit?: string; pageType?: string };
        const days = parseDays(query.days);
        const limit = parseLimit(query.limit);
        const pageType = parsePageType(query.pageType);

        const validMetrics = WebVitalsService.VITAL_METRICS as readonly string[];
        const metric = validMetrics.includes(query.metric || '') ? query.metric as WebVitalsService.VitalMetric : 'LCP';

        try {
            const pages = await WebVitalsService.getVitalsByPage(accountId, days, metric, limit, pageType);
            return { pages, metric, days, pageType };
        } catch (error) {
            Logger.error('[WebVitals] Pages error', { error, accountId });
            return reply.code(500).send({ error: 'Failed to fetch page vitals' });
        }
    });
};

export default webVitalsRoutes;
