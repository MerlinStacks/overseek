/**
 * Search Console API Routes — Fastify Plugin
 *
 * Exposes endpoints for fetching organic search analytics,
 * keyword recommendations, trending queries, and top pages.
 * Data comes from Google Search Console + AI analysis.
 */

import { FastifyPluginAsync } from 'fastify';
import { requireAuthFastify } from '../middleware/auth';
import { Logger } from '../utils/logger';
import { SearchConsoleService } from '../services/search-console/SearchConsoleService';
import { KeywordRecommendationService } from '../services/search-console/KeywordRecommendationService';
import { KeywordTrackingService } from '../services/search-console/KeywordTrackingService';

/**
 * Clamp and validate days query param. Prevents abuse and NaN injection.
 * Why cap at 365: Search Console API only retains 16 months of data,
 * and larger ranges are rarely useful while costing API quota.
 */
function parseDays(raw: string | undefined, fallback: number = 28): number {
    const n = parseInt(raw || String(fallback), 10);
    if (isNaN(n) || n < 1) return fallback;
    return Math.min(n, 365);
}

const searchConsoleRoutes: FastifyPluginAsync = async (fastify) => {

    /**
     * GET /api/search-console/analytics — Raw search analytics data
     * Query params: days (default 28)
     */
    fastify.get('/analytics', { preHandler: requireAuthFastify }, async (request, reply) => {
        try {
            const accountId = request.accountId;
            if (!accountId) return reply.code(400).send({ error: 'No account selected' });

            const query = request.query as { days?: string };
            const days = parseDays(query.days);

            const analytics = await SearchConsoleService.getSearchAnalytics(accountId, { days });

            return { queries: analytics, count: analytics.length };
        } catch (error: any) {
            Logger.error('Failed to fetch search analytics', { error });
            return reply.code(500).send({ error: error.message });
        }
    });

    /**
     * GET /api/search-console/pages — Top pages by organic clicks
     * Query params: days (default 28)
     */
    fastify.get('/pages', { preHandler: requireAuthFastify }, async (request, reply) => {
        try {
            const accountId = request.accountId;
            if (!accountId) return reply.code(400).send({ error: 'No account selected' });

            const query = request.query as { days?: string };
            const days = parseDays(query.days);

            const pages = await SearchConsoleService.getTopPages(accountId, days);

            return { pages, count: pages.length };
        } catch (error: any) {
            Logger.error('Failed to fetch top pages', { error });
            return reply.code(500).send({ error: error.message });
        }
    });

    /**
     * GET /api/search-console/trends — Trending/rising keywords
     */
    fastify.get('/trends', { preHandler: requireAuthFastify }, async (request, reply) => {
        try {
            const accountId = request.accountId;
            if (!accountId) return reply.code(400).send({ error: 'No account selected' });

            const trends = await KeywordRecommendationService.getTrendingKeywords(accountId);

            return { trends, count: trends.length };
        } catch (error: any) {
            Logger.error('Failed to fetch keyword trends', { error });
            return reply.code(500).send({ error: error.message });
        }
    });

    /**
     * GET /api/search-console/recommendations — AI keyword recommendations
     */
    fastify.get('/recommendations', { preHandler: requireAuthFastify }, async (request, reply) => {
        try {
            const accountId = request.accountId;
            if (!accountId) return reply.code(400).send({ error: 'No account selected' });

            const [lowHanging, gaps, aiRecs] = await Promise.all([
                KeywordRecommendationService.getLowHangingFruit(accountId),
                KeywordRecommendationService.getKeywordGaps(accountId),
                KeywordRecommendationService.getAIRecommendations(accountId)
            ]);

            return {
                lowHangingFruit: lowHanging,
                keywordGaps: gaps,
                aiRecommendations: aiRecs
            };
        } catch (error: any) {
            Logger.error('Failed to fetch keyword recommendations', { error });
            return reply.code(500).send({ error: error.message });
        }
    });

    /**
     * GET /api/search-console/low-hanging-fruit — Just low-hanging fruit keywords
     */
    fastify.get('/low-hanging-fruit', { preHandler: requireAuthFastify }, async (request, reply) => {
        try {
            const accountId = request.accountId;
            if (!accountId) return reply.code(400).send({ error: 'No account selected' });

            const opportunities = await KeywordRecommendationService.getLowHangingFruit(accountId);

            return { opportunities, count: opportunities.length };
        } catch (error: any) {
            Logger.error('Failed to fetch low-hanging fruit', { error });
            return reply.code(500).send({ error: error.message });
        }
    });

    /**
     * GET /api/search-console/keyword-gaps — Product keyword gaps
     */
    fastify.get('/keyword-gaps', { preHandler: requireAuthFastify }, async (request, reply) => {
        try {
            const accountId = request.accountId;
            if (!accountId) return reply.code(400).send({ error: 'No account selected' });

            const gaps = await KeywordRecommendationService.getKeywordGaps(accountId);

            return { gaps, count: gaps.length };
        } catch (error: any) {
            Logger.error('Failed to fetch keyword gaps', { error });
            return reply.code(500).send({ error: error.message });
        }
    });

    // ─────────────────────────────────────────────────────
    // Keyword Tracking CRUD
    // ─────────────────────────────────────────────────────

    /**
     * GET /api/search-console/tracked-keywords — List all tracked keywords
     */
    fastify.get('/tracked-keywords', { preHandler: requireAuthFastify }, async (request, reply) => {
        try {
            const accountId = request.accountId;
            if (!accountId) return reply.code(400).send({ error: 'No account selected' });

            const keywords = await KeywordTrackingService.listKeywords(accountId);

            return { keywords, count: keywords.length };
        } catch (error: any) {
            Logger.error('Failed to list tracked keywords', { error });
            return reply.code(500).send({ error: error.message });
        }
    });

    /**
     * POST /api/search-console/tracked-keywords — Add a keyword to track
     * Body: { keyword: string, targetUrl?: string }
     */
    fastify.post('/tracked-keywords', { preHandler: requireAuthFastify }, async (request, reply) => {
        try {
            const accountId = request.accountId;
            if (!accountId) return reply.code(400).send({ error: 'No account selected' });

            const { keyword, targetUrl } = request.body as { keyword: string; targetUrl?: string };
            if (!keyword?.trim()) return reply.code(400).send({ error: 'Keyword is required' });

            const tracked = await KeywordTrackingService.addKeyword(accountId, keyword, targetUrl);

            return reply.code(201).send(tracked);
        } catch (error: any) {
            // Surface business-logic errors (limit reached, validation) as 400
            const isBizError = error.message?.includes('Maximum') || error.message?.includes('must be');
            if (isBizError) {
                return reply.code(400).send({ error: error.message });
            }
            Logger.error('Failed to add tracked keyword', { error });
            return reply.code(500).send({ error: error.message });
        }
    });

    /**
     * DELETE /api/search-console/tracked-keywords/:id — Remove a keyword
     */
    fastify.delete('/tracked-keywords/:id', { preHandler: requireAuthFastify }, async (request, reply) => {
        try {
            const accountId = request.accountId;
            if (!accountId) return reply.code(400).send({ error: 'No account selected' });

            const { id } = request.params as { id: string };
            await KeywordTrackingService.deleteKeyword(accountId, id);

            return { success: true };
        } catch (error: any) {
            Logger.error('Failed to delete tracked keyword', { error });
            return reply.code(500).send({ error: error.message });
        }
    });

    /**
     * GET /api/search-console/tracked-keywords/:id/history — Rank history for a keyword
     * Query params: days (default 30)
     */
    fastify.get('/tracked-keywords/:id/history', { preHandler: requireAuthFastify }, async (request, reply) => {
        try {
            const accountId = request.accountId;
            if (!accountId) return reply.code(400).send({ error: 'No account selected' });

            const { id } = request.params as { id: string };
            const query = request.query as { days?: string };
            const days = parseDays(query.days, 30);

            const history = await KeywordTrackingService.getHistory(accountId, id, days);

            return { history, count: history.length };
        } catch (error: any) {
            Logger.error('Failed to fetch keyword history', { error });
            return reply.code(500).send({ error: error.message });
        }
    });

    /**
     * POST /api/search-console/tracked-keywords/refresh — Manually refresh all keyword positions
     */
    fastify.post('/tracked-keywords/refresh', { preHandler: requireAuthFastify }, async (request, reply) => {
        try {
            const accountId = request.accountId;
            if (!accountId) return reply.code(400).send({ error: 'No account selected' });

            const updated = await KeywordTrackingService.refreshPositions(accountId);

            return { success: true, updated };
        } catch (error: any) {
            Logger.error('Failed to refresh keyword positions', { error });
            return reply.code(500).send({ error: error.message });
        }
    });
};

export default searchConsoleRoutes;
