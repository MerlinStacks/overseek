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
import { KeywordGroupService } from '../services/search-console/KeywordGroupService';
import { CompetitorAnalysisService } from '../services/search-console/CompetitorAnalysisService';
import { KeywordRevenueService } from '../services/search-console/KeywordRevenueService';
import { CannibalizationService } from '../services/search-console/CannibalizationService';
import { ContentBriefService } from '../services/search-console/ContentBriefService';
import { SeoDigestService } from '../services/search-console/SeoDigestService';

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
     * POST /api/search-console/tracked-keywords/bulk — Bulk import keywords
     * Body: { keywords: string[], targetUrl?: string }
     */
    fastify.post('/tracked-keywords/bulk', { preHandler: requireAuthFastify }, async (request, reply) => {
        try {
            const accountId = request.accountId;
            if (!accountId) return reply.code(400).send({ error: 'No account selected' });

            const { keywords, targetUrl } = request.body as { keywords: string[]; targetUrl?: string };
            if (!keywords?.length) return reply.code(400).send({ error: 'Keywords array is required' });
            if (keywords.length > 500) return reply.code(400).send({ error: 'Maximum 500 keywords per import' });

            const result = await KeywordTrackingService.addKeywordsBulk(accountId, keywords, targetUrl);

            return result;
        } catch (error: any) {
            Logger.error('Failed to bulk import keywords', { error });
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

    // ─────────────────────────────────────────────────────
    // Keyword Groups
    // ─────────────────────────────────────────────────────

    /**
     * GET /api/search-console/keyword-groups — List all groups with metrics
     */
    fastify.get('/keyword-groups', { preHandler: requireAuthFastify }, async (request, reply) => {
        try {
            const accountId = request.accountId;
            if (!accountId) return reply.code(400).send({ error: 'No account selected' });

            const groups = await KeywordGroupService.listGroups(accountId);
            return { groups, count: groups.length };
        } catch (error: any) {
            Logger.error('Failed to list keyword groups', { error });
            return reply.code(500).send({ error: error.message });
        }
    });

    /**
     * POST /api/search-console/keyword-groups — Create a group
     * Body: { name: string, color?: string }
     */
    fastify.post('/keyword-groups', { preHandler: requireAuthFastify }, async (request, reply) => {
        try {
            const accountId = request.accountId;
            if (!accountId) return reply.code(400).send({ error: 'No account selected' });

            const { name, color } = request.body as { name: string; color?: string };
            if (!name?.trim()) return reply.code(400).send({ error: 'Group name is required' });

            const group = await KeywordGroupService.createGroup(accountId, name, color);
            return reply.code(201).send(group);
        } catch (error: any) {
            const isBizError = error.message?.includes('Maximum') || error.message?.includes('must be');
            if (isBizError) return reply.code(400).send({ error: error.message });
            Logger.error('Failed to create keyword group', { error });
            return reply.code(500).send({ error: error.message });
        }
    });

    /**
     * PUT /api/search-console/keyword-groups/:id — Update a group
     * Body: { name?: string, color?: string }
     */
    fastify.put('/keyword-groups/:id', { preHandler: requireAuthFastify }, async (request, reply) => {
        try {
            const accountId = request.accountId;
            if (!accountId) return reply.code(400).send({ error: 'No account selected' });

            const { id } = request.params as { id: string };
            const body = request.body as { name?: string; color?: string };
            const group = await KeywordGroupService.updateGroup(accountId, id, body);
            return group;
        } catch (error: any) {
            Logger.error('Failed to update keyword group', { error });
            return reply.code(500).send({ error: error.message });
        }
    });

    /**
     * DELETE /api/search-console/keyword-groups/:id — Delete a group
     */
    fastify.delete('/keyword-groups/:id', { preHandler: requireAuthFastify }, async (request, reply) => {
        try {
            const accountId = request.accountId;
            if (!accountId) return reply.code(400).send({ error: 'No account selected' });

            const { id } = request.params as { id: string };
            await KeywordGroupService.deleteGroup(accountId, id);
            return { success: true };
        } catch (error: any) {
            Logger.error('Failed to delete keyword group', { error });
            return reply.code(500).send({ error: error.message });
        }
    });

    /**
     * POST /api/search-console/keyword-groups/assign — Assign keyword(s) to a group
     * Body: { keywordIds: string[], groupId: string | null }
     */
    fastify.post('/keyword-groups/assign', { preHandler: requireAuthFastify }, async (request, reply) => {
        try {
            const accountId = request.accountId;
            if (!accountId) return reply.code(400).send({ error: 'No account selected' });

            const { keywordIds, groupId } = request.body as { keywordIds: string[]; groupId: string | null };
            if (!keywordIds?.length) return reply.code(400).send({ error: 'keywordIds array is required' });

            const updated = await KeywordGroupService.bulkAssign(accountId, keywordIds, groupId);
            return { success: true, updated };
        } catch (error: any) {
            Logger.error('Failed to assign keywords to group', { error });
            return reply.code(500).send({ error: error.message });
        }
    });

    // ─────────────────────────────────────────────────────
    // Competitor Analysis
    // ─────────────────────────────────────────────────────

    /**
     * GET /api/search-console/competitors — List competitor domains
     */
    fastify.get('/competitors', { preHandler: requireAuthFastify }, async (request, reply) => {
        try {
            const accountId = request.accountId;
            if (!accountId) return reply.code(400).send({ error: 'No account selected' });

            const competitors = await CompetitorAnalysisService.listCompetitors(accountId);
            return { competitors, count: competitors.length };
        } catch (error: any) {
            Logger.error('Failed to list competitors', { error });
            return reply.code(500).send({ error: error.message });
        }
    });

    /**
     * POST /api/search-console/competitors — Add a competitor domain
     * Body: { domain: string }
     */
    fastify.post('/competitors', { preHandler: requireAuthFastify }, async (request, reply) => {
        try {
            const accountId = request.accountId;
            if (!accountId) return reply.code(400).send({ error: 'No account selected' });

            const { domain } = request.body as { domain: string };
            if (!domain?.trim()) return reply.code(400).send({ error: 'Domain is required' });

            const competitor = await CompetitorAnalysisService.addCompetitor(accountId, domain);
            return reply.code(201).send(competitor);
        } catch (error: any) {
            const isBizError = error.message?.includes('Maximum') || error.message?.includes('Invalid');
            if (isBizError) return reply.code(400).send({ error: error.message });
            Logger.error('Failed to add competitor', { error });
            return reply.code(500).send({ error: error.message });
        }
    });

    /**
     * DELETE /api/search-console/competitors/:id — Remove a competitor domain
     */
    fastify.delete('/competitors/:id', { preHandler: requireAuthFastify }, async (request, reply) => {
        try {
            const accountId = request.accountId;
            if (!accountId) return reply.code(400).send({ error: 'No account selected' });

            const { id } = request.params as { id: string };
            await CompetitorAnalysisService.removeCompetitor(accountId, id);
            return { success: true };
        } catch (error: any) {
            Logger.error('Failed to remove competitor', { error });
            return reply.code(500).send({ error: error.message });
        }
    });

    /**
     * GET /api/search-console/competitor-analysis — Run gap analysis
     */
    fastify.get('/competitor-analysis', { preHandler: requireAuthFastify }, async (request, reply) => {
        try {
            const accountId = request.accountId;
            if (!accountId) return reply.code(400).send({ error: 'No account selected' });

            const query = request.query as { domain?: string };
            const analysis = await CompetitorAnalysisService.analyzeCompetitor(accountId, query.domain);
            return analysis;
        } catch (error: any) {
            Logger.error('Failed to run competitor analysis', { error });
            return reply.code(500).send({ error: error.message });
        }
    });

    // ─────────────────────────────────────────────────────
    // Revenue Attribution
    // ─────────────────────────────────────────────────────

    /**
     * GET /api/search-console/keyword-revenue — Revenue attribution report
     */
    fastify.get('/keyword-revenue', { preHandler: requireAuthFastify }, async (request, reply) => {
        try {
            const accountId = request.accountId;
            if (!accountId) return reply.code(400).send({ error: 'No account selected' });

            const report = await KeywordRevenueService.getRevenueReport(accountId);
            return { keywords: report, count: report.length };
        } catch (error: any) {
            Logger.error('Failed to fetch keyword revenue', { error });
            return reply.code(500).send({ error: error.message });
        }
    });

    // ─────────────────────────────────────────────────────
    // Cannibalization Detection (Tier 3)
    // ─────────────────────────────────────────────────────

    /**
     * GET /api/search-console/cannibalization — Detect keyword cannibalization
     */
    fastify.get('/cannibalization', { preHandler: requireAuthFastify }, async (request, reply) => {
        try {
            const accountId = request.accountId;
            if (!accountId) return reply.code(400).send({ error: 'No account selected' });

            const results = await CannibalizationService.detectCannibalization(accountId);
            return { keywords: results, count: results.length };
        } catch (error: any) {
            Logger.error('Failed to detect cannibalization', { error });
            return reply.code(500).send({ error: error.message });
        }
    });

    // ─────────────────────────────────────────────────────
    // AI Content Briefs (Tier 3)
    // ─────────────────────────────────────────────────────

    /**
     * POST /api/search-console/content-brief — Generate AI content brief for a keyword
     * Body: { keyword: string, keywordId?: string }
     */
    fastify.post('/content-brief', { preHandler: requireAuthFastify }, async (request, reply) => {
        try {
            const accountId = request.accountId;
            if (!accountId) return reply.code(400).send({ error: 'No account selected' });

            const { keyword, keywordId } = request.body as { keyword: string; keywordId?: string };
            if (!keyword?.trim()) return reply.code(400).send({ error: 'Keyword is required' });

            const brief = await ContentBriefService.generateBrief(accountId, keyword, keywordId);
            return brief;
        } catch (error: any) {
            Logger.error('Failed to generate content brief', { error });
            return reply.code(500).send({ error: error.message });
        }
    });

    // ─────────────────────────────────────────────────────
    // SEO Digest (Tier 3)
    // ─────────────────────────────────────────────────────

    /**
     * GET /api/search-console/seo-digest/preview — Preview the next SEO digest
     */
    fastify.get('/seo-digest/preview', { preHandler: requireAuthFastify }, async (request, reply) => {
        try {
            const accountId = request.accountId;
            if (!accountId) return reply.code(400).send({ error: 'No account selected' });

            const digest = await SeoDigestService.generateDigest(accountId);
            return digest;
        } catch (error: any) {
            Logger.error('Failed to generate SEO digest preview', { error });
            return reply.code(500).send({ error: error.message });
        }
    });
};

export default searchConsoleRoutes;