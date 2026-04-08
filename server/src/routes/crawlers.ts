/**
 * Crawler Management Routes - Fastify Plugin
 * Protected endpoints for viewing crawler activity and managing block rules.
 */

import { FastifyPluginAsync } from 'fastify';
import { requireAuthFastify } from '../middleware/auth';
import { Logger } from '../utils/logger';
import { prisma } from '../utils/prisma';
import { z } from 'zod';
import * as CrawlerService from '../services/tracking/CrawlerService';
import { CRAWLER_REGISTRY, CATEGORY_META } from '../services/tracking/CrawlerRegistry';
import { cacheDelete } from '../utils/cache';

// =============================================================================
// VALIDATION SCHEMAS
// =============================================================================

const createRuleSchema = z.object({
    crawlerName: z.string().min(1, 'Crawler name is required'),
    pattern: z.string().min(1, 'Pattern is required'),
    action: z.enum(['BLOCK', 'ALLOW']).default('BLOCK'),
    reason: z.string().optional(),
});

const updateRuleSchema = z.object({
    action: z.enum(['BLOCK', 'ALLOW']),
    reason: z.string().optional(),
});

const blockPageSchema = z.object({
    html: z.string().max(50000, 'Block page HTML must be under 50KB').nullable(),
});

const querySchema = z.object({
    days: z.coerce.number().min(1).max(365).default(30),
    category: z.string().optional(),
});

// =============================================================================
// ROUTE PLUGIN
// =============================================================================

const crawlerRoutes: FastifyPluginAsync = async (fastify) => {

    // -------------------------------------------------------------------------
    // PUBLIC: BLOCKED AGENTS - GET /api/crawlers/blocked-agents
    // Called by WC plugin via WP-Cron. No JWT available — uses account ID
    // from header for scoping. Validated via account existence check.
    //
    // Why outside register(): Fastify addHook applies to ALL routes in the
    // same encapsulation context regardless of registration order. This must
    // live outside the auth-scoped register() to avoid the JWT preHandler.
    // -------------------------------------------------------------------------
    fastify.get('/blocked-agents', async (request, reply) => {
        const accountId = request.headers['x-account-id'] as string | undefined;
        if (!accountId) return reply.code(400).send({ error: 'Account ID required' });

        try {
            // Validate account exists to prevent enumeration
            const account = await prisma.account.findUnique({
                where: { id: accountId },
                select: { id: true }
            });
            if (!account) return reply.code(404).send({ error: 'Account not found' });

            const [patterns, blockPageHtml] = await Promise.all([
                CrawlerService.getBlockedPatterns(accountId),
                CrawlerService.getBlockPageHtml(accountId),
            ]);

            return { patterns, blockPageHtml };
        } catch (error) {
            Logger.error('[CrawlerRoutes] Blocked agents error', { error });
            return reply.code(500).send({ error: 'Failed to fetch blocked agents' });
        }
    });

    // =========================================================================
    // AUTHENTICATED ROUTES — all routes below require a valid JWT
    // =========================================================================
    fastify.register(async (authScope) => {
        authScope.addHook('preHandler', requireAuthFastify);

        const getAccountId = (request: any): string | null => request.accountId || null;

        // ---------------------------------------------------------------------
        // LIST - GET /api/crawlers
        // ---------------------------------------------------------------------
        authScope.get('/', async (request, reply) => {
            const accountId = getAccountId(request);
            if (!accountId) return reply.code(400).send({ error: 'Account ID required' });

            const query = querySchema.safeParse(request.query);
            if (!query.success) return reply.code(400).send({ error: query.error.issues[0].message });

            try {
                const stats = await CrawlerService.getCrawlerStats(accountId, query.data.days);

                // Filter by category if specified
                let crawlers = stats.crawlers;
                if (query.data.category && query.data.category !== 'all') {
                    crawlers = crawlers.filter(c => c.category === query.data.category);
                }

                return {
                    crawlers,
                    totalHits24h: stats.totalHits24h,
                    uniqueCrawlers: stats.uniqueCrawlers,
                    blockedCount: stats.blockedCount,
                };
            } catch (error) {
                Logger.error('[CrawlerRoutes] List error', { error });
                return reply.code(500).send({ error: 'Failed to fetch crawler data' });
            }
        });

        // ---------------------------------------------------------------------
        // STATS - GET /api/crawlers/stats
        // ---------------------------------------------------------------------
        authScope.get('/stats', async (request, reply) => {
            const accountId = getAccountId(request);
            if (!accountId) return reply.code(400).send({ error: 'Account ID required' });

            try {
                const stats = await CrawlerService.getCrawlerStats(accountId, 30);
                return {
                    totalHits24h: stats.totalHits24h,
                    uniqueCrawlers: stats.uniqueCrawlers,
                    blockedCount: stats.blockedCount,
                    topCrawlers: stats.crawlers.slice(0, 5).map(c => ({
                        name: c.name,
                        slug: c.slug,
                        hits: c.totalHits,
                        category: c.category,
                    })),
                };
            } catch (error) {
                Logger.error('[CrawlerRoutes] Stats error', { error });
                return reply.code(500).send({ error: 'Failed to fetch crawler stats' });
            }
        });

        // ---------------------------------------------------------------------
        // REGISTRY - GET /api/crawlers/registry
        // ---------------------------------------------------------------------
        authScope.get('/registry', async (_request, _reply) => {
            return {
                crawlers: CRAWLER_REGISTRY.map(c => ({
                    name: c.name,
                    slug: c.slug,
                    category: c.category,
                    categoryLabel: CATEGORY_META[c.category]?.label || 'Unknown',
                    owner: c.owner,
                    description: c.description,
                    website: c.website,
                    intent: c.intent,
                })),
                categories: CATEGORY_META,
            };
        });

        // ---------------------------------------------------------------------
        // LIST RULES - GET /api/crawlers/rules
        // ---------------------------------------------------------------------
        authScope.get('/rules', async (request, reply) => {
            const accountId = getAccountId(request);
            if (!accountId) return reply.code(400).send({ error: 'Account ID required' });

            try {
                const rules = await prisma.crawlerRule.findMany({
                    where: { accountId },
                    orderBy: { createdAt: 'desc' },
                });

                // Enrich with registry metadata
                const enriched = rules.map(rule => {
                    const identity = CRAWLER_REGISTRY.find(c => c.slug === rule.crawlerName);
                    return {
                        ...rule,
                        displayName: identity?.name || rule.crawlerName,
                        owner: identity?.owner || 'Unknown',
                        intent: identity?.intent || 'neutral',
                        category: identity?.category || 'unknown',
                    };
                });

                return { rules: enriched };
            } catch (error) {
                Logger.error('[CrawlerRoutes] List rules error', { error });
                return reply.code(500).send({ error: 'Failed to fetch rules' });
            }
        });

        // ---------------------------------------------------------------------
        // CREATE RULE - POST /api/crawlers/rules
        // ---------------------------------------------------------------------
        authScope.post('/rules', async (request, reply) => {
            const accountId = getAccountId(request);
            const userId = request.user?.id;
            if (!accountId) return reply.code(400).send({ error: 'Account ID required' });

            const parsed = createRuleSchema.safeParse(request.body);
            if (!parsed.success) return reply.code(400).send({ error: parsed.error.issues[0].message });

            try {
                const rule = await prisma.crawlerRule.upsert({
                    where: {
                        accountId_crawlerName: {
                            accountId,
                            crawlerName: parsed.data.crawlerName,
                        }
                    },
                    create: {
                        accountId,
                        crawlerName: parsed.data.crawlerName,
                        pattern: parsed.data.pattern.toLowerCase(),
                        action: parsed.data.action,
                        reason: parsed.data.reason,
                        blockedBy: userId,
                    },
                    update: {
                        action: parsed.data.action,
                        pattern: parsed.data.pattern.toLowerCase(),
                        reason: parsed.data.reason,
                        blockedBy: userId,
                    },
                });

                await CrawlerService.invalidateBlockedPatternsCache(accountId);

                Logger.info('[CrawlerRoutes] Rule created/updated', {
                    accountId, crawlerName: rule.crawlerName, action: rule.action
                });

                return reply.code(201).send(rule);
            } catch (error) {
                Logger.error('[CrawlerRoutes] Create rule error', { error });
                return reply.code(500).send({ error: 'Failed to create rule' });
            }
        });

        // ---------------------------------------------------------------------
        // UPDATE RULE - PUT /api/crawlers/rules/:id
        // ---------------------------------------------------------------------
        authScope.put<{ Params: { id: string } }>('/rules/:id', async (request, reply) => {
            const accountId = getAccountId(request);
            if (!accountId) return reply.code(400).send({ error: 'Account ID required' });

            const parsed = updateRuleSchema.safeParse(request.body);
            if (!parsed.success) return reply.code(400).send({ error: parsed.error.issues[0].message });

            try {
                const existing = await prisma.crawlerRule.findFirst({
                    where: { id: request.params.id, accountId }
                });
                if (!existing) return reply.code(404).send({ error: 'Rule not found' });

                const updated = await prisma.crawlerRule.update({
                    where: { id: request.params.id },
                    data: {
                        action: parsed.data.action,
                        reason: parsed.data.reason ?? existing.reason,
                    },
                });

                await CrawlerService.invalidateBlockedPatternsCache(accountId);

                Logger.info('[CrawlerRoutes] Rule updated', {
                    accountId, crawlerName: updated.crawlerName, action: updated.action
                });

                return updated;
            } catch (error) {
                Logger.error('[CrawlerRoutes] Update rule error', { error });
                return reply.code(500).send({ error: 'Failed to update rule' });
            }
        });

        // ---------------------------------------------------------------------
        // DELETE RULE - DELETE /api/crawlers/rules/:id
        // ---------------------------------------------------------------------
        authScope.delete<{ Params: { id: string } }>('/rules/:id', async (request, reply) => {
            const accountId = getAccountId(request);
            if (!accountId) return reply.code(400).send({ error: 'Account ID required' });

            try {
                const existing = await prisma.crawlerRule.findFirst({
                    where: { id: request.params.id, accountId }
                });
                if (!existing) return reply.code(404).send({ error: 'Rule not found' });

                await prisma.crawlerRule.delete({ where: { id: request.params.id } });
                await CrawlerService.invalidateBlockedPatternsCache(accountId);

                return { success: true };
            } catch (error) {
                Logger.error('[CrawlerRoutes] Delete rule error', { error });
                return reply.code(500).send({ error: 'Failed to delete rule' });
            }
        });

        // ---------------------------------------------------------------------
        // GET BLOCK PAGE - GET /api/crawlers/block-page
        // ---------------------------------------------------------------------
        authScope.get('/block-page', async (request, reply) => {
            const accountId = getAccountId(request);
            if (!accountId) return reply.code(400).send({ error: 'Account ID required' });

            try {
                const account = await prisma.account.findUnique({
                    where: { id: accountId },
                    select: { crawlerBlockPageHtml: true }
                });

                return { html: account?.crawlerBlockPageHtml || null };
            } catch (error) {
                Logger.error('[CrawlerRoutes] Get block page error', { error });
                return reply.code(500).send({ error: 'Failed to fetch block page' });
            }
        });

        // ---------------------------------------------------------------------
        // UPDATE BLOCK PAGE - PUT /api/crawlers/block-page
        // ---------------------------------------------------------------------
        authScope.put('/block-page', async (request, reply) => {
            const accountId = getAccountId(request);
            if (!accountId) return reply.code(400).send({ error: 'Account ID required' });

            const parsed = blockPageSchema.safeParse(request.body);
            if (!parsed.success) return reply.code(400).send({ error: parsed.error.issues[0].message });

            try {
                await prisma.account.update({
                    where: { id: accountId },
                    data: { crawlerBlockPageHtml: parsed.data.html },
                });

                // Invalidate cached block page
                await cacheDelete(`block-page:${accountId}`, { namespace: 'crawlers' });

                Logger.info('[CrawlerRoutes] Block page updated', { accountId });
                return { success: true };
            } catch (error) {
                Logger.error('[CrawlerRoutes] Update block page error', { error });
                return reply.code(500).send({ error: 'Failed to update block page' });
            }
        });
    });
};

export default crawlerRoutes;
