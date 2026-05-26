/**
 * Tracking Dashboard Routes - Fastify Plugin
 * Protected analytics endpoints: live visitors, stats, funnel, revenue, etc.
 */

import { FastifyPluginAsync } from 'fastify';
import { TrackingService } from '../services/TrackingService';
import { getVisitorCount24h } from '../services/tracking';
import { getCartAbandonmentStats } from '../services/analytics/CartAbandonmentService';
import { requireAuthFastify } from '../middleware/auth';
import { Logger } from '../utils/logger';
import { prisma } from '../utils/prisma';

const trackingDashboardRoutes: FastifyPluginAsync = async (fastify) => {
    fastify.addHook('preHandler', requireAuthFastify);

    const getAccountId = (request: any): string | null => request.accountId || null;
    const resolveDaysFromQuery = (
        query: { startDate?: string; endDate?: string; days?: string },
        fallbackDays: number = 30
    ): number => {
        if (query.startDate && query.endDate) {
            const start = new Date(query.startDate);
            const end = new Date(query.endDate);

            if (!Number.isNaN(start.getTime()) && !Number.isNaN(end.getTime())) {
                const msPerDay = 24 * 60 * 60 * 1000;
                const diffMs = Math.abs(end.getTime() - start.getTime());
                return Math.max(1, Math.floor(diffMs / msPerDay) + 1);
            }
        }

        const parsedDays = parseInt(query.days || `${fallbackDays}`, 10);
        return Number.isFinite(parsedDays) && parsedDays > 0 ? parsedDays : fallbackDays;
    };

    fastify.get('/live', async (request, reply) => {
        try {
            const accountId = getAccountId(request);
            if (!accountId) return reply.code(400).send({ error: 'Account ID required' });
            return await TrackingService.getLiveVisitors(accountId);
        } catch (error) {
            Logger.error('Live Users Error', { error });
            return reply.code(500).send({ error: 'Failed to fetch live users' });
        }
    });

    fastify.get('/visitors-24h', async (request, reply) => {
        try {
            const accountId = getAccountId(request);
            if (!accountId) return reply.code(400).send({ error: 'Account ID required' });
            const count = await getVisitorCount24h(accountId);
            return { count };
        } catch (error) {
            Logger.error('Visitors 24h Error', { error });
            return reply.code(500).send({ error: 'Failed to fetch 24h visitor count' });
        }
    });

    fastify.get('/carts', async (request, reply) => {
        try {
            const accountId = getAccountId(request);
            if (!accountId) return reply.code(400).send({ error: 'Account ID required' });
            return await TrackingService.getLiveCarts(accountId);
        } catch (error) {
            Logger.error('Live Carts Error', { error });
            return reply.code(500).send({ error: 'Failed to fetch live carts' });
        }
    });

    fastify.get('/abandoned-carts', async (request, reply) => {
        try {
            const accountId = getAccountId(request);
            if (!accountId) return reply.code(400).send({ error: 'Account ID required' });

            const query = request.query as { limit?: string; offset?: string; search?: string; thresholdMinutes?: string };
            const limit = Math.min(Math.max(parseInt(query.limit || '50', 10) || 50, 1), 200);
            const offset = Math.max(parseInt(query.offset || '0', 10) || 0, 0);
            const thresholdMinutes = Math.min(Math.max(parseInt(query.thresholdMinutes || '30', 10) || 30, 1), 10080);
            const search = query.search?.trim();
            const cutoff = new Date(Date.now() - thresholdMinutes * 60 * 1000);

            const where = {
                accountId,
                cartValue: { gt: 0 },
                email: { not: null },
                lastActiveAt: { lt: cutoff },
                ...(search ? {
                    OR: [
                        { email: { contains: search, mode: 'insensitive' as const } },
                        { visitorId: { contains: search, mode: 'insensitive' as const } }
                    ]
                } : {})
            };

            const [sessions, total] = await Promise.all([
                prisma.analyticsSession.findMany({
                    where,
                    select: {
                        id: true,
                        visitorId: true,
                        email: true,
                        wooCustomerId: true,
                        cartValue: true,
                        cartItems: true,
                        currency: true,
                        createdAt: true,
                        lastActiveAt: true,
                        abandonedNotificationSentAt: true
                    },
                    orderBy: { lastActiveAt: 'desc' },
                    take: limit,
                    skip: offset
                }),
                prisma.analyticsSession.count({ where })
            ]);

            const customerIds = sessions
                .map((session) => session.wooCustomerId)
                .filter((id): id is number => typeof id === 'number');
            const customers = customerIds.length > 0
                ? await prisma.wooCustomer.findMany({
                    where: { accountId, wooId: { in: customerIds } },
                    select: { wooId: true, firstName: true, lastName: true, email: true, rawData: true }
                })
                : [];
            const customerByWooId = new Map(customers.map((customer) => [customer.wooId, customer]));
            const now = Date.now();

            return {
                items: sessions.map((session) => {
                    const customer = session.wooCustomerId ? customerByWooId.get(session.wooCustomerId) : null;
                    const cartItems = Array.isArray(session.cartItems)
                        ? session.cartItems.map((item: any) => ({
                            productId: item.productId || item.product_id || 0,
                            variationId: item.variationId || item.variation_id,
                            name: item.name || item.product_name || 'Unknown Product',
                            sku: item.sku,
                            thumbnail: item.thumbnail || item.image,
                            quantity: Number(item.quantity) || 1,
                            price: Number(item.price) || 0,
                            total: Number(item.total || item.line_total) || ((Number(item.price) || 0) * (Number(item.quantity) || 1))
                        }))
                        : [];

                    const firstName = customer?.firstName?.trim() || '';
                    const lastName = customer?.lastName?.trim() || '';
                    const customerName = `${firstName} ${lastName}`.trim() || null;
                    const customerRawData = customer?.rawData as any;

                    return {
                        id: session.id,
                        visitorId: session.visitorId,
                        email: session.email || customer?.email || null,
                        phone: customerRawData?.billing?.phone || null,
                        wooCustomerId: session.wooCustomerId,
                        customerName,
                        createdAt: session.createdAt,
                        lastActiveAt: session.lastActiveAt,
                        minutesSinceActivity: Math.floor((now - new Date(session.lastActiveAt).getTime()) / 60000),
                        status: session.abandonedNotificationSentAt ? 'Notified' : 'Recoverable',
                        cartItems,
                        itemCount: cartItems.reduce((sum, item) => sum + item.quantity, 0),
                        cartValue: Number(session.cartValue),
                        currency: session.currency
                    };
                }),
                total,
                limit,
                offset
            };
        } catch (error) {
            Logger.error('Abandoned Carts Error', { error });
            return reply.code(500).send({ error: 'Failed to fetch abandoned carts' });
        }
    });

    fastify.get<{ Params: { sessionId: string } }>('/session/:sessionId', async (request, reply) => {
        try {
            return await TrackingService.getSessionHistory(request.params.sessionId);
        } catch (error) {
            Logger.error('Session History Error', { error });
            return reply.code(500).send({ error: 'Failed to fetch session history' });
        }
    });

    fastify.get('/status', async (request, reply) => {
        try {
            const accountId = getAccountId(request);
            if (!accountId) return reply.code(400).send({ error: 'Account ID required' });

            const lastSession = await prisma.analyticsSession.findFirst({
                where: { accountId },
                orderBy: { lastActiveAt: 'desc' },
                select: { lastActiveAt: true }
            });

            return { connected: !!lastSession, lastSignal: lastSession?.lastActiveAt || null };
        } catch (error) {
            Logger.error('Status Check Error', { error });
            return reply.code(500).send({ error: 'Failed to check status' });
        }
    });

    fastify.get('/stats', async (request, reply) => {
        try {
            const accountId = getAccountId(request);
            if (!accountId) return reply.code(400).send({ error: 'Account ID required' });
            const query = request.query as { startDate?: string; endDate?: string; days?: string };
            const days = resolveDaysFromQuery(query);
            const timezone = (request.headers['x-timezone'] as string) || 'Australia/Sydney';
            return await TrackingService.getStats(accountId, days, timezone);
        } catch (error) {
            Logger.error('Stats Error', { error });
            return reply.code(500).send({ error: 'Failed to fetch stats' });
        }
    });

    fastify.get('/funnel', async (request, reply) => {
        try {
            const accountId = getAccountId(request);
            if (!accountId) return reply.code(400).send({ error: 'Account ID required' });
            const query = request.query as { startDate?: string; endDate?: string; days?: string };
            const days = resolveDaysFromQuery(query);
            const timezone = (request.headers['x-timezone'] as string) || 'Australia/Sydney';
            return await TrackingService.getFunnel(accountId, days, timezone);
        } catch (error) {
            Logger.error('Funnel Error', { error });
            return reply.code(500).send({ error: 'Failed to fetch funnel' });
        }
    });

    fastify.get('/revenue', async (request, reply) => {
        try {
            const accountId = getAccountId(request);
            if (!accountId) return reply.code(400).send({ error: 'Account ID required' });
            const query = request.query as { startDate?: string; endDate?: string; days?: string };
            const days = resolveDaysFromQuery(query);
            const timezone = (request.headers['x-timezone'] as string) || 'Australia/Sydney';
            return await TrackingService.getRevenue(accountId, days, timezone);
        } catch (error) {
            Logger.error('Revenue Error', { error });
            return reply.code(500).send({ error: 'Failed to fetch revenue' });
        }
    });

    fastify.get('/attribution', async (request, reply) => {
        try {
            const accountId = getAccountId(request);
            if (!accountId) return reply.code(400).send({ error: 'Account ID required' });
            const query = request.query as { startDate?: string; endDate?: string; days?: string };
            const days = resolveDaysFromQuery(query);
            const timezone = (request.headers['x-timezone'] as string) || 'Australia/Sydney';
            return await TrackingService.getAttribution(accountId, days, timezone);
        } catch (error) {
            Logger.error('Attribution Error', { error });
            return reply.code(500).send({ error: 'Failed to fetch attribution' });
        }
    });

    fastify.get('/abandonment', async (request, reply) => {
        try {
            const accountId = getAccountId(request);
            if (!accountId) return reply.code(400).send({ error: 'Account ID required' });
            const query = request.query as { startDate?: string; endDate?: string; days?: string };
            const days = resolveDaysFromQuery(query);
            const timezone = (request.headers['x-timezone'] as string) || 'Australia/Sydney';
            return await TrackingService.getAbandonmentRate(accountId, days, timezone);
        } catch (error) {
            Logger.error('Abandonment Error', { error });
            return reply.code(500).send({ error: 'Failed to fetch abandonment' });
        }
    });

    fastify.get('/searches', async (request, reply) => {
        try {
            const accountId = getAccountId(request);
            if (!accountId) return reply.code(400).send({ error: 'Account ID required' });
            const query = request.query as { startDate?: string; endDate?: string; days?: string };
            const days = resolveDaysFromQuery(query);
            return await TrackingService.getSearches(accountId, days);
        } catch (error) {
            Logger.error('Searches Error', { error });
            return reply.code(500).send({ error: 'Failed to fetch searches' });
        }
    });

    fastify.get('/exits', async (request, reply) => {
        try {
            const accountId = getAccountId(request);
            if (!accountId) return reply.code(400).send({ error: 'Account ID required' });
            const query = request.query as { startDate?: string; endDate?: string; days?: string };
            const days = resolveDaysFromQuery(query);
            return await TrackingService.getExitPages(accountId, days);
        } catch (error) {
            Logger.error('Exits Error', { error });
            return reply.code(500).send({ error: 'Failed to fetch exits' });
        }
    });

    fastify.get('/cohorts', async (request, reply) => {
        try {
            const accountId = getAccountId(request);
            if (!accountId) return reply.code(400).send({ error: 'Account ID required' });
            return await TrackingService.getCohorts(accountId);
        } catch (error) {
            Logger.error('Cohorts Error', { error });
            return reply.code(500).send({ error: 'Failed to fetch cohorts' });
        }
    });

    fastify.get('/ltv', async (request, reply) => {
        try {
            const accountId = getAccountId(request);
            if (!accountId) return reply.code(400).send({ error: 'Account ID required' });
            return await TrackingService.getLTV(accountId);
        } catch (error) {
            Logger.error('LTV Error', { error });
            return reply.code(500).send({ error: 'Failed to fetch LTV' });
        }
    });

    // Product-level cart abandonment analytics
    fastify.get('/cart-abandonment', async (request, reply) => {
        try {
            const accountId = getAccountId(request);
            if (!accountId) return reply.code(400).send({ error: 'Account ID required' });

            const query = request.query as { startDate?: string; endDate?: string; days?: string };

            let startDate: Date;
            let endDate: Date = new Date();

            if (query.startDate && query.endDate) {
                startDate = new Date(query.startDate);
                endDate = new Date(query.endDate);
            } else {
                const days = parseInt(query.days || '30', 10);
                startDate = new Date();
                startDate.setDate(startDate.getDate() - days);
            }

            return await getCartAbandonmentStats(accountId, startDate, endDate);
        } catch (error) {
            Logger.error('Cart Abandonment Error', { error });
            return reply.code(500).send({ error: 'Failed to fetch cart abandonment stats' });
        }
    });

    fastify.get('/export', async (request, reply) => {
        try {
            const accountId = getAccountId(request);
            if (!accountId) return reply.code(400).send({ error: 'Account ID required' });
            const query = request.query as { startDate?: string; endDate?: string; days?: string };
            const days = resolveDaysFromQuery(query);

            const [stats, funnel, revenue, attribution, abandonment, cohorts, ltv] = await Promise.all([
                TrackingService.getStats(accountId, days),
                TrackingService.getFunnel(accountId, days),
                TrackingService.getRevenue(accountId, days),
                TrackingService.getAttribution(accountId, days),
                TrackingService.getAbandonmentRate(accountId, days),
                TrackingService.getCohorts(accountId),
                TrackingService.getLTV(accountId)
            ]);

            reply.header('Content-Disposition', 'attachment; filename="analytics-export.json"');
            return { exportedAt: new Date().toISOString(), dateRange: `Last ${days} days`, stats, funnel, revenue, attribution, abandonment, cohorts, ltv };
        } catch (error) {
            Logger.error('Export Error', { error });
            return reply.code(500).send({ error: 'Failed to export data' });
        }
    });
    fastify.post('/retry-google-enhanced', async (request, reply) => {
        try {
            const accountId = getAccountId(request);
            if (!accountId) return reply.code(400).send({ error: 'Account ID required' });
            
            const query = request.query as { hours?: string };
            const hours = parseInt(query.hours || '8', 10);

            // Import dynamically to avoid circular dependencies if any
            const { GoogleEnhancedConversionsService } = await import('../services/tracking/GoogleEnhancedConversionsService');
            const service = new GoogleEnhancedConversionsService();
            const result = await service.retryFailedDeliveries(accountId, hours);

            return { success: true, ...result };
        } catch (error) {
            Logger.error('Retry Google Enhanced Error', { error });
            return reply.code(500).send({ error: 'Failed to retry deliveries' });
        }
    });
};

export default trackingDashboardRoutes;
