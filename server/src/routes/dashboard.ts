/**
 * Dashboard Route - Fastify Plugin
 */

import { FastifyPluginAsync } from 'fastify';
import { requireAuthFastify } from '../middleware/auth';
import { prisma } from '../utils/prisma';
import { Logger } from '../utils/logger';
import { AdsTools } from '../services/tools/AdsTools';
import { cacheAside, cacheDelete, CacheTTL, CacheNamespace, invalidateCache } from '../utils/cache';

const dashboardRoutes: FastifyPluginAsync = async (fastify) => {
    fastify.addHook('preHandler', requireAuthFastify);

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
    fastify.get<{ Querystring: { refresh?: string } }>('/ad-suggestions', async (request, reply) => {
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
            const { context } = request.body;

            if (typeof context !== 'string') {
                return reply.code(400).send({ error: 'Context must be a string' });
            }

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
            const { recommendationId, action, dismissReason, userFeedback, recommendation } = request.body;

            if (!recommendationId) {
                return reply.code(400).send({ error: 'recommendationId is required' });
            }

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
                dismissReason,
                hasFeedback: !!userFeedback
            });

            return { success: true };
        } catch (error) {
            Logger.error('Failed to save recommendation feedback', { error, accountId });
            return reply.code(500).send({ error: 'Failed to save feedback' });
        }
    });

    /** Why namespace: dashboard layout is per-user and only changes on explicit save */
    const LAYOUT_NAMESPACE = 'dash-layout';

    // GET Layout
    fastify.get('/', async (request, reply) => {
        const accountId = request.accountId;
        if (!accountId) return reply.code(400).send({ error: 'No account' });
        const userId = request.user?.id ?? '';

        return cacheAside(
            `${userId}:${accountId}`,
            async () => {
                let layout = await prisma.dashboardLayout.findFirst({
                    where: { accountId, userId },
                    include: { widgets: { orderBy: { sortOrder: 'asc' } } }
                });

                if (!layout) {
                    layout = await prisma.dashboardLayout.create({
                        data: {
                            accountId,
                            userId,
                            name: 'Main Dashboard',
                            isDefault: true,
                            widgets: {
                                create: [
                                    { widgetKey: 'total-sales', position: { x: 0, y: 0, w: 4, h: 4 }, sortOrder: 0 },
                                    { widgetKey: 'recent-orders', position: { x: 4, y: 0, w: 4, h: 4 }, sortOrder: 1 },
                                    { widgetKey: 'marketing-roas', position: { x: 8, y: 0, w: 4, h: 4 }, sortOrder: 2 },
                                    { widgetKey: 'sales-chart', position: { x: 0, y: 4, w: 8, h: 6 }, sortOrder: 3 },
                                    { widgetKey: 'top-products', position: { x: 8, y: 4, w: 4, h: 6 }, sortOrder: 4 },
                                    { widgetKey: 'customer-growth', position: { x: 0, y: 10, w: 6, h: 6 }, sortOrder: 5 }
                                ]
                            }
                        },
                        include: { widgets: { orderBy: { sortOrder: 'asc' } } }
                    });
                }

                return layout;
            },
            { ttl: CacheTTL.MEDIUM, namespace: LAYOUT_NAMESPACE }
        );
    });

    // SAVE Layout (Widgets Update)
    fastify.post<{ Body: { widgets: Array<{ widgetKey: string; position: any; settings?: any }> } }>('/', async (request, reply) => {
        const accountId = request.accountId;
        if (!accountId) return reply.code(400).send({ error: 'No account' });

        const layout = await prisma.dashboardLayout.findFirst({
            where: { accountId, userId: request.user?.id }
        });

        if (!layout) return reply.code(404).send({ error: 'Dashboard not found' });

        const { widgets } = request.body;

        await prisma.$transaction([
            prisma.dashboardWidget.deleteMany({ where: { dashboardId: layout.id } }),
            prisma.dashboardWidget.createMany({
                data: widgets.map((w, index) => ({
                    dashboardId: layout.id,
                    widgetKey: w.widgetKey,
                    position: w.position,
                    settings: w.settings || {},
                    sortOrder: index
                }))
            })
        ]);

        /** Bust the layout cache so next GET picks up the new widgets */
        const userId = request.user?.id ?? '';
        await cacheDelete(`${userId}:${accountId}`, { namespace: LAYOUT_NAMESPACE });

        const updated = await prisma.dashboardLayout.findUnique({
            where: { id: layout.id },
            include: { widgets: { orderBy: { sortOrder: 'asc' } } }
        });

        return updated;
    });
};

export default dashboardRoutes;
