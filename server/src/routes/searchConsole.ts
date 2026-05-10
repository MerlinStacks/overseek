/**
 * Search Console API Routes — Fastify Plugin
 *
 * Exposes endpoints for fetching organic search analytics,
 * keyword recommendations, keyword movers, and top pages.
 * Data comes from Google Search Console + AI analysis.
 */

import { FastifyPluginAsync, FastifyReply, FastifyRequest } from 'fastify';
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
import { getAdsAccountIdOrReply } from './ads/routeHelpers';

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

function isBusinessValidationError(error: any, patterns: string[]) {
    const message = error?.message || '';
    return patterns.some((pattern) => message.includes(pattern));
}

function parseDaysAndSiteUrl(
    request: FastifyRequest,
    fallbackDays: number = 28,
): { days: number; siteUrl?: string } {
    const query = request.query as { days?: string; siteUrl?: string };
    return {
        days: parseDays(query.days, fallbackDays),
        siteUrl: query.siteUrl,
    };
}

function parseSiteUrl(request: FastifyRequest): string | undefined {
    const query = request.query as { siteUrl?: string };
    return query.siteUrl;
}

function parseRequiredDomainOrReply(request: FastifyRequest, reply: FastifyReply): string | null {
    const query = request.query as { domain?: string };
    if (!query.domain) {
        reply.code(400).send({ error: 'domain is required' });
        return null;
    }
    return query.domain;
}

function parseKeywordBodyOrReply(request: FastifyRequest, reply: FastifyReply): { keyword: string; keywordId?: string } | null {
    const { keyword, keywordId } = request.body as { keyword?: string; keywordId?: string };
    if (!keyword?.trim()) {
        reply.code(400).send({ error: 'Keyword is required' });
        return null;
    }
    return { keyword, keywordId };
}

function parseIdParam(request: FastifyRequest): string {
    return (request.params as { id: string }).id;
}

const searchConsoleRoutes: FastifyPluginAsync = async (fastify) => {

    /**
     * GET /api/search-console/analytics — Raw search analytics data
     * Query params: days (default 28)
     */
    fastify.get('/analytics', { preHandler: requireAuthFastify }, async (request, reply) => {
        try {
            const accountId = getAdsAccountIdOrReply(request, reply);
            if (!accountId) return;

            const { days, siteUrl } = parseDaysAndSiteUrl(request);
            const analytics = await SearchConsoleService.getSearchAnalytics(accountId, { days }, siteUrl);

            return { queries: analytics, count: analytics.length };
        } catch (error: any) {
            Logger.error('Failed to fetch search analytics', { error });
            return reply.code(500).send({ error: error.message });
        }
    });

    /**
     * GET /api/search-console/page-analytics — Queries driving traffic to a specific URL
     * Query params: pageUrl (required), days (default 28), siteUrl (optional)
     */
    fastify.get('/page-analytics', { preHandler: requireAuthFastify }, async (request, reply) => {
        try {
            const accountId = getAdsAccountIdOrReply(request, reply);
            if (!accountId) return;

            const query = request.query as { pageUrl?: string; days?: string; siteUrl?: string };
            if (!query.pageUrl) return reply.code(400).send({ error: 'pageUrl is required' });

            const days = parseDays(query.days);
            const queries = await SearchConsoleService.getPageAnalytics(accountId, query.pageUrl, days, query.siteUrl);

            return { queries, count: queries.length };
        } catch (error: any) {
            Logger.error('Failed to fetch page analytics', { error });
            return reply.code(500).send({ error: error.message });
        }
    });

    /**
     * GET /api/search-console/pages — Top pages by organic clicks
     * Query params: days (default 28)
     */
    fastify.get('/pages', { preHandler: requireAuthFastify }, async (request, reply) => {
        try {
            const accountId = getAdsAccountIdOrReply(request, reply);
            if (!accountId) return;

            const { days, siteUrl } = parseDaysAndSiteUrl(request);
            const pages = await SearchConsoleService.getTopPages(accountId, days, siteUrl);

            return { pages, count: pages.length };
        } catch (error: any) {
            Logger.error('Failed to fetch top pages', { error });
            return reply.code(500).send({ error: error.message });
        }
    });

    const getKeywordMoversHandler = async (
        request: FastifyRequest<{ Querystring: { siteUrl?: string; days?: string } }>,
        reply: FastifyReply
    ) => {
        try {
            const accountId = getAdsAccountIdOrReply(request, reply);
            if (!accountId) return;

            const { days, siteUrl } = parseDaysAndSiteUrl(request, 14);
            const movers = await KeywordRecommendationService.getKeywordMovers(accountId, siteUrl, days);

            return { movers, trends: movers, count: movers.length };
        } catch (error: any) {
            Logger.error('Failed to fetch keyword movers', { error });
            return reply.code(500).send({ error: error.message });
        }
    };

    /**
     * GET /api/search-console/movers — Keywords with biggest ranking movement
     * Query params: days (default 14, interpreted as last half vs previous half)
     */
    fastify.get('/movers', { preHandler: requireAuthFastify }, getKeywordMoversHandler);

    /**
     * GET /api/search-console/trends — Legacy alias for /movers
     */
    fastify.get('/trends', { preHandler: requireAuthFastify }, getKeywordMoversHandler);

    /**
     * GET /api/search-console/recommendations — AI keyword recommendations
     */
    fastify.get('/recommendations', { preHandler: requireAuthFastify }, async (request, reply) => {
        try {
            const accountId = getAdsAccountIdOrReply(request, reply);
            if (!accountId) return;

            const siteUrl = parseSiteUrl(request);
            const [lowHanging, gaps, aiRecs] = await Promise.all([
                KeywordRecommendationService.getLowHangingFruit(accountId, siteUrl),
                KeywordRecommendationService.getKeywordGaps(accountId, siteUrl),
                KeywordRecommendationService.getAIRecommendations(accountId, siteUrl)
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
            const accountId = getAdsAccountIdOrReply(request, reply);
            if (!accountId) return;

            const opportunities = await KeywordRecommendationService.getLowHangingFruit(accountId, parseSiteUrl(request));

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
            const accountId = getAdsAccountIdOrReply(request, reply);
            if (!accountId) return;

            const gaps = await KeywordRecommendationService.getKeywordGaps(accountId, parseSiteUrl(request));

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
            const accountId = getAdsAccountIdOrReply(request, reply);
            if (!accountId) return;

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
            const accountId = getAdsAccountIdOrReply(request, reply);
            if (!accountId) return;

            const keywordBody = parseKeywordBodyOrReply(request, reply);
            if (!keywordBody) return;
            const { keyword } = keywordBody;
            const { targetUrl } = request.body as { targetUrl?: string };

            const tracked = await KeywordTrackingService.addKeyword(accountId, keyword, targetUrl);

            return reply.code(201).send(tracked);
        } catch (error: any) {
            // Surface business-logic errors (limit reached, validation) as 400
            const isBizError = isBusinessValidationError(error, ['Maximum', 'must be']);
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
            const accountId = getAdsAccountIdOrReply(request, reply);
            if (!accountId) return;

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
            const accountId = getAdsAccountIdOrReply(request, reply);
            if (!accountId) return;

            const id = parseIdParam(request);
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
            const accountId = getAdsAccountIdOrReply(request, reply);
            if (!accountId) return;

            const id = parseIdParam(request);
            const { days } = parseDaysAndSiteUrl(request, 30);

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
            const accountId = getAdsAccountIdOrReply(request, reply);
            if (!accountId) return;

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
            const accountId = getAdsAccountIdOrReply(request, reply);
            if (!accountId) return;

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
            const accountId = getAdsAccountIdOrReply(request, reply);
            if (!accountId) return;

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
            const accountId = getAdsAccountIdOrReply(request, reply);
            if (!accountId) return;

            const id = parseIdParam(request);
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
            const accountId = getAdsAccountIdOrReply(request, reply);
            if (!accountId) return;

            const id = parseIdParam(request);
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
            const accountId = getAdsAccountIdOrReply(request, reply);
            if (!accountId) return;

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
            const accountId = getAdsAccountIdOrReply(request, reply);
            if (!accountId) return;

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
            const accountId = getAdsAccountIdOrReply(request, reply);
            if (!accountId) return;

            const { domain } = request.body as { domain: string };
            if (!domain?.trim()) return reply.code(400).send({ error: 'Domain is required' });

            const competitor = await CompetitorAnalysisService.addCompetitor(accountId, domain);
            return reply.code(201).send(competitor);
        } catch (error: any) {
            const isBizError = isBusinessValidationError(error, ['Maximum', 'Invalid']);
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
            const accountId = getAdsAccountIdOrReply(request, reply);
            if (!accountId) return;

            const id = parseIdParam(request);
            await CompetitorAnalysisService.removeCompetitor(accountId, id);
            return { success: true };
        } catch (error: any) {
            Logger.error('Failed to remove competitor', { error });
            return reply.code(500).send({ error: error.message });
        }
    });

    /**
     * GET /api/search-console/competitor-analysis — Run gap analysis (legacy)
     */
    fastify.get('/competitor-analysis', { preHandler: requireAuthFastify }, async (request, reply) => {
        try {
            const accountId = getAdsAccountIdOrReply(request, reply);
            if (!accountId) return;

            const query = request.query as { domain?: string };
            const analysis = await CompetitorAnalysisService.analyzeCompetitor(accountId, query.domain);
            return analysis;
        } catch (error: any) {
            Logger.error('Failed to run competitor analysis', { error });
            return reply.code(500).send({ error: error.message });
        }
    });

    /**
     * GET /api/search-console/competitors/:id/keywords — Tracked keyword positions for a competitor
     */
    fastify.get('/competitors/:id/keywords', { preHandler: requireAuthFastify }, async (request, reply) => {
        try {
            const { id } = request.params as { id: string };
            const keywords = await CompetitorAnalysisService.getCompetitorKeywords(id);
            return { keywords, count: keywords.length };
        } catch (error: any) {
            Logger.error('Failed to fetch competitor keywords', { error });
            return reply.code(500).send({ error: error.message });
        }
    });

    /**
     * GET /api/search-console/competitors/:id/keywords/:kwId/history — Rank history chart data
     * Query params: days (default 30)
     */
    fastify.get('/competitors/:id/keywords/:kwId/history', { preHandler: requireAuthFastify }, async (request, reply) => {
        try {
            const { kwId } = request.params as { id: string; kwId: string };
            const query = request.query as { days?: string };
            const days = parseDays(query.days, 30);

            const history = await CompetitorAnalysisService.getCompetitorKeywordHistory(kwId, days);
            return { history, count: history.length };
        } catch (error: any) {
            Logger.error('Failed to fetch competitor keyword history', { error });
            return reply.code(500).send({ error: error.message });
        }
    });

    /**
     * GET /api/search-console/competitor-movement — Recent significant position changes
     * Query params: days (default 7)
     */
    fastify.get('/competitor-movement', { preHandler: requireAuthFastify }, async (request, reply) => {
        try {
            const accountId = getAdsAccountIdOrReply(request, reply);
            if (!accountId) return;

            const { days } = parseDaysAndSiteUrl(request, 7);

            const movements = await CompetitorAnalysisService.getCompetitorMovement(accountId, days);
            return { movements, count: movements.length };
        } catch (error: any) {
            Logger.error('Failed to fetch competitor movement', { error });
            return reply.code(500).send({ error: error.message });
        }
    });

    /**
     * GET /api/search-console/competitor-head-to-head — You vs competitor side-by-side
     * Query params: domain (required)
     */
    fastify.get('/competitor-head-to-head', { preHandler: requireAuthFastify }, async (request, reply) => {
        try {
            const accountId = getAdsAccountIdOrReply(request, reply);
            if (!accountId) return;

            const domain = parseRequiredDomainOrReply(request, reply);
            if (!domain) return;

            const rows = await CompetitorAnalysisService.getHeadToHead(accountId, domain);
            return { rows, count: rows.length };
        } catch (error: any) {
            Logger.error('Failed to fetch head-to-head data', { error });
            return reply.code(500).send({ error: error.message });
        }
    });

    /**
     * POST /api/search-console/competitors/refresh — Manually trigger SERP position refresh
     */
    fastify.post('/competitors/refresh', { preHandler: requireAuthFastify }, async (request, reply) => {
        try {
            const accountId = getAdsAccountIdOrReply(request, reply);
            if (!accountId) return;

            // Sync keywords first, then refresh positions
            await CompetitorAnalysisService.syncCompetitorKeywords(accountId);
            const result = await CompetitorAnalysisService.refreshCompetitorPositions(accountId);
            return { success: true, ...result };
        } catch (error: any) {
            Logger.error('Failed to refresh competitor positions', { error });
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
            const accountId = getAdsAccountIdOrReply(request, reply);
            if (!accountId) return;

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
            const accountId = getAdsAccountIdOrReply(request, reply);
            if (!accountId) return;

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
            const accountId = getAdsAccountIdOrReply(request, reply);
            if (!accountId) return;

            const keywordBody = parseKeywordBodyOrReply(request, reply);
            if (!keywordBody) return;
            const { keyword, keywordId } = keywordBody;

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
            const accountId = getAdsAccountIdOrReply(request, reply);
            if (!accountId) return;

            const digest = await SeoDigestService.generateDigest(accountId);
            return digest;
        } catch (error: any) {
            Logger.error('Failed to generate SEO digest preview', { error });
            return reply.code(500).send({ error: error.message });
        }
    });
};

export default searchConsoleRoutes;
