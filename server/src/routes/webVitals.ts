/**
 * Web Vitals Dashboard Routes - Fastify Plugin
 * Authenticated endpoints for querying real user performance data.
 */

import { FastifyPluginAsync } from 'fastify';
import { requireAuthFastify } from '../middleware/auth';
import { Logger } from '../utils/logger';
import * as WebVitalsService from '../services/tracking/WebVitalsService';

const webVitalsRoutes: FastifyPluginAsync = async (fastify) => {
    fastify.addHook('preHandler', requireAuthFastify);

    /**
     * GET /api/web-vitals/summary
     * Returns p75, p90, rating, and distribution per metric.
     */
    fastify.get('/summary', async (request, reply) => {
        const accountId = request.accountId!;
        const query = request.query as { days?: string; pageType?: string };
        const days = Math.min(parseInt(query.days || '30', 10), 90);
        const pageType = query.pageType || 'all';

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
        const query = request.query as { metric?: string; days?: string };
        const days = Math.min(parseInt(query.days || '30', 10), 90);

        const validMetrics = WebVitalsService.VITAL_METRICS as readonly string[];
        const metric = validMetrics.includes(query.metric || '') ? query.metric as WebVitalsService.VitalMetric : 'LCP';

        try {
            const timeline = await WebVitalsService.getVitalsTimeline(accountId, metric, days);
            return { timeline, metric, days };
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
        const query = request.query as { days?: string; metric?: string; limit?: string };
        const days = Math.min(parseInt(query.days || '30', 10), 90);
        const limit = Math.min(parseInt(query.limit || '20', 10), 50);

        const validMetrics = WebVitalsService.VITAL_METRICS as readonly string[];
        const metric = validMetrics.includes(query.metric || '') ? query.metric as WebVitalsService.VitalMetric : 'LCP';

        try {
            const pages = await WebVitalsService.getVitalsByPage(accountId, days, metric, limit);
            return { pages, metric, days };
        } catch (error) {
            Logger.error('[WebVitals] Pages error', { error, accountId });
            return reply.code(500).send({ error: 'Failed to fetch page vitals' });
        }
    });
};

export default webVitalsRoutes;
