/**
 * Dashboard Route - Fastify Plugin
 */

import { FastifyPluginAsync } from 'fastify';
import { requireAuthFastify } from '../middleware/auth';
import { prisma } from '../utils/prisma';
import { Logger } from '../utils/logger';
import { AdsTools } from '../services/tools/AdsTools';
import { cacheAside, CacheTTL } from '../utils/cache';
import { PermissionService } from '../services/PermissionService';
import { readDashboardLayout, saveDashboardLayout, layoutSchema, LayoutConflict } from '../services/DashboardLayouts';
import { z } from 'zod';

const dashboardRoutes: FastifyPluginAsync = async (fastify) => {
    fastify.addHook('preHandler', requireAuthFastify);
    fastify.addHook('preHandler', async (request, reply) => {
        if (!request.accountId || !request.user?.id) return reply.code(400).send({ error: 'Select an account' });
        const path = request.url.split('?')[0];
        const permission = path.endsWith('/inbox-count') ? 'view_inbox' : path.includes('/ad-suggestions') ? request.method === 'GET' ? 'view_marketing' : 'manage_marketing' : null;
        if (permission && !await PermissionService.hasPermission(request.user.id, request.accountId, permission)) return reply.code(403).send({ error: 'Feature permission required' });
    });

    // GET /api/dashboard/inbox-count
    // Cached for 30 seconds to reduce database load from frequent UI polls
    fastify.get('/inbox-count', async (request, reply) => {
        const accountId = request.accountId;
        if (!accountId) return reply.code(400).send({ error: 'No account' });

        try {
            const openCount = await cacheAside(
                `inbox-count:${accountId}`,
                async () => prisma.conversation.count({
                    where: { accountId, status: 'OPEN' }
                }),
                { ttl: CacheTTL.SHORT, namespace: 'dashboard' }
            );
            return { open: openCount };
        } catch (error) {
            Logger.error('Failed to fetch inbox count', { error, accountId });
            return reply.code(500).send({ error: 'Failed to fetch inbox count' });
        }
    });

    // GET /api/dashboard/ad-suggestions
    fastify.get('/ad-suggestions', async (request, reply) => {
        const accountId = request.accountId;
        if (!accountId) return reply.code(400).send({ error: 'No account' });

        try {
            // Fetch saved context to pass to optimizer
            const savedContext = await prisma.adSuggestionContext.findUnique({
                where: { accountId },
                select: { context: true }
            });

            const result = await AdsTools.getAdOptimizationSuggestions(accountId, {
                userContext: savedContext?.context,
                includeInventory: true
            });

            if (typeof result === 'string') {
                return {
                    suggestions: [],
                    action_items: [],
                    message: result
                };
            }

            return result;
        } catch (error) {
            Logger.error('Failed to fetch ad suggestions', { error, accountId });
            return reply.code(500).send({ error: 'Failed to fetch ad suggestions' });
        }
    });

    // GET /api/dashboard/ad-suggestions/context
    fastify.get('/ad-suggestions/context', async (request, reply) => {
        const accountId = request.accountId;
        if (!accountId) return reply.code(400).send({ error: 'No account' });

        try {
            const context = await prisma.adSuggestionContext.findUnique({
                where: { accountId },
                select: { context: true, updatedAt: true }
            });

            return { context: context?.context || '', updatedAt: context?.updatedAt || null };
        } catch (error) {
            Logger.error('Failed to fetch ad suggestion context', { error, accountId });
            return reply.code(500).send({ error: 'Failed to fetch context' });
        }
    });

    // POST /api/dashboard/ad-suggestions/context
    fastify.post<{ Body: { context: string } }>('/ad-suggestions/context', async (request, reply) => {
        const accountId = request.accountId;
        if (!accountId) return reply.code(400).send({ error: 'No account' });

        try {
            const parsed = z.object({ context: z.string().max(8000) }).strict().safeParse(request.body);
            if (!parsed.success) {
                return reply.code(400).send({ error: 'Context must be a string' });
            }
            const { context } = parsed.data;

            // Upsert the context
            const saved = await prisma.adSuggestionContext.upsert({
                where: { accountId },
                update: { context },
                create: { accountId, context }
            });

            Logger.info('Ad suggestion context updated', { accountId, contextLength: context.length });

            return { success: true, updatedAt: saved.updatedAt };
        } catch (error) {
            Logger.error('Failed to save ad suggestion context', { error, accountId });
            return reply.code(500).send({ error: 'Failed to save context' });
        }
    });

    // POST /api/dashboard/ad-suggestions/feedback
    // Saves user feedback on a specific recommendation for learning
    interface FeedbackBody {
        recommendationId: string;
        action: 'dismiss' | 'feedback';
        dismissReason?: string;
        userFeedback?: string;
        recommendation?: {
            headline?: string;
            category?: string;
            platform?: string;
            source?: string;
            tags?: string[];
        };
    }

    fastify.post<{ Body: FeedbackBody }>('/ad-suggestions/feedback', async (request, reply) => {
        const accountId = request.accountId;
        if (!accountId) return reply.code(400).send({ error: 'No account' });

        try {
            const parsed = z.object({ recommendationId: z.string().trim().min(1).max(200), action: z.enum(['dismiss', 'feedback']), dismissReason: z.string().max(1000).optional(), userFeedback: z.string().max(4000).optional(),
                recommendation: z.object({ headline: z.string().max(500).optional(), category: z.string().max(80).optional(), platform: z.string().max(30).optional(), source: z.string().max(100).optional(), tags: z.array(z.string().max(80)).max(20).optional() }).strict().optional() }).strict().safeParse(request.body);
            if (!parsed.success) {
                return reply.code(400).send({ error: 'recommendationId is required' });
            }
            const { recommendationId, action, dismissReason, userFeedback, recommendation } = parsed.data;

            // Create a log entry for this feedback
            await prisma.recommendationLog.create({
                data: {
                    accountId,
                    recommendationId,
                    text: recommendation?.headline || recommendationId,
                    category: recommendation?.category || 'unknown',
                    priority: 3,
                    platform: recommendation?.platform,
                    confidenceScore: 0,
                    confidenceLevel: 'n/a',
                    status: action === 'dismiss' ? 'dismissed' : 'pending',
                    dismissedAt: action === 'dismiss' ? new Date() : null,
                    dismissReason: dismissReason || null,
                    userFeedback: userFeedback || null,
                    tags: recommendation?.tags ? JSON.stringify(recommendation.tags) : null
                }
            });

            Logger.info('Recommendation feedback saved', {
                accountId,
                recommendationId,
                action,
                hasFeedback: !!userFeedback
            });

            return { success: true };
        } catch (error) {
            Logger.error('Failed to save recommendation feedback', { error, accountId });
            return reply.code(500).send({ error: 'Failed to save feedback' });
        }
    });

    // Uncached version-bearing reads; advisory locks serialize first-load initialization.
    fastify.get('/', async request => readDashboardLayout(request.user!.id, request.accountId!));
    fastify.post('/', async (request, reply) => {
        const parsed = layoutSchema.safeParse(request.body);
        if (!parsed.success) return reply.code(400).send({ error: 'A valid version and bounded widget layout are required' });
        try { return await saveDashboardLayout(request.user!.id, request.accountId!, parsed.data); }
        catch (error) { return reply.code(error instanceof LayoutConflict ? 409 : 500).send({ error: error instanceof LayoutConflict ? 'Dashboard changed; reload before saving' : 'Could not save dashboard' }); }
    });
};

export default dashboardRoutes;
