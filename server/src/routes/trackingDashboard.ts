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
import { PermissionService } from '../services/PermissionService';

const trackingDashboardRoutes: FastifyPluginAsync = async (fastify) => {
    fastify.addHook('preHandler', requireAuthFastify);
    fastify.addHook('preHandler', async (request, reply) => {
        const accountId = request.accountId;
        const userId = request.user?.id;
        if (!accountId || !userId) {
            return reply.code(400).send({ error: 'Account ID required' });
        }

        const canView = await PermissionService.hasAnyPermission(userId, accountId, ['view_finance', 'view_analytics']);
        if (!canView) {
            await reply.code(403).send({ error: 'You do not have permission to view tracking analytics' });
            return reply;
        }
    });

    const getAccountId = (request: any): string | null => request.accountId || null;
    const MAX_LOOKBACK_DAYS = 365;
    const resolveMetricsWindow = (
        query: { startDate?: string; endDate?: string; days?: string },
        fallbackDays: number = 30
    ): { days: number; dateRange?: { startDate: Date; endDate: Date } } => {
        if (query.startDate && query.endDate) {
            const start = new Date(query.startDate.includes('T') ? query.startDate : `${query.startDate}T00:00:00.000Z`);
            const end = new Date(query.endDate.includes('T') ? query.endDate : `${query.endDate}T23:59:59.999Z`);

            if (!Number.isNaN(start.getTime()) && !Number.isNaN(end.getTime()) && end >= start) {
                const msPerDay = 24 * 60 * 60 * 1000;
                const days = Math.max(1, Math.floor((end.getTime() - start.getTime()) / msPerDay) + 1);
                if (days <= MAX_LOOKBACK_DAYS) {
                    return { days, dateRange: { startDate: start, endDate: end } };
                }
            }
        }

        const parsedDays = parseInt(query.days || `${fallbackDays}`, 10);
        const days = Number.isFinite(parsedDays) && parsedDays > 0 ? parsedDays : fallbackDays;
        return { days: Math.min(days, MAX_LOOKBACK_DAYS) };
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
                    orderBy: { createdAt: 'desc' },
                    take: limit,
                    skip: offset
                }),
                prisma.analyticsSession.count({ where })
            ]);

            const enrollments = sessions.length > 0
                ? await prisma.automationEnrollment.findMany({
                    where: {
                        accountId,
                        triggerEntityType: 'CART',
                        triggerEntityId: {
                            in: sessions.flatMap((session) => [session.id, session.visitorId])
                        },
                        automation: { triggerType: 'ABANDONED_CART' }
                    },
                    select: {
                        triggerEntityId: true,
                        conversionAt: true,
                        convertedOrderId: true,
                        convertedRevenue: true,
                        automation: { select: { name: true } },
                        runEvents: {
                            where: { outcome: 'EMAIL_SENT' },
                            select: { createdAt: true },
                            orderBy: { createdAt: 'desc' },
                            take: 1
                        }
                    },
                    orderBy: { enteredAt: 'desc' }
                })
                : [];
            const flowStatusByCartId = new Map<string, {
                flowName: string;
                flowSentAt: Date | null;
                recoveredAt: Date | null;
                recoveredOrderId: string | null;
                recoveredRevenue: number | null;
            }>();

            for (const enrollment of enrollments) {
                if (!enrollment.triggerEntityId) continue;
                const existing = flowStatusByCartId.get(enrollment.triggerEntityId);
                const sentAt = enrollment.runEvents[0]?.createdAt || null;
                flowStatusByCartId.set(enrollment.triggerEntityId, {
                    flowName: existing?.flowName || enrollment.automation.name,
                    flowSentAt: existing?.flowSentAt || sentAt,
                    recoveredAt: existing?.recoveredAt || enrollment.conversionAt,
                    recoveredOrderId: existing?.recoveredOrderId || enrollment.convertedOrderId,
                    recoveredRevenue: existing?.recoveredRevenue
                        ?? (enrollment.convertedRevenue === null ? null : Number(enrollment.convertedRevenue))
                });
            }

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
                    // Older scheduler enrollments used visitorId before cart session IDs were included.
                    const flowStatus = flowStatusByCartId.get(session.id)
                        || flowStatusByCartId.get(session.visitorId);
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
                        status: flowStatus?.recoveredAt ? 'Recovered' : flowStatus?.flowSentAt ? 'Flow sent' : 'Not sent',
                        flowName: flowStatus?.flowName || null,
                        flowSentAt: flowStatus?.flowSentAt || null,
                        recoveredAt: flowStatus?.recoveredAt || null,
                        recoveredOrderId: flowStatus?.recoveredOrderId || null,
                        recoveredRevenue: flowStatus?.recoveredRevenue ?? null,
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
            const accountId = getAccountId(request);
            if (!accountId) return reply.code(400).send({ error: 'Account ID required' });
            return await TrackingService.getSessionHistory(accountId, request.params.sessionId);
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
            const { days, dateRange } = resolveMetricsWindow(query);
            const timezone = (request.headers['x-timezone'] as string) || 'Australia/Sydney';
            return await TrackingService.getStats(accountId, days, timezone, dateRange);
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
            const { days, dateRange } = resolveMetricsWindow(query);
            const timezone = (request.headers['x-timezone'] as string) || 'Australia/Sydney';
            return await TrackingService.getFunnel(accountId, days, timezone, dateRange);
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
            const { days, dateRange } = resolveMetricsWindow(query);
            const timezone = (request.headers['x-timezone'] as string) || 'Australia/Sydney';
            return await TrackingService.getRevenue(accountId, days, timezone, dateRange);
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
            const { days, dateRange } = resolveMetricsWindow(query);
            const timezone = (request.headers['x-timezone'] as string) || 'Australia/Sydney';
            return await TrackingService.getAttribution(accountId, days, timezone, dateRange);
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
            const { days, dateRange } = resolveMetricsWindow(query);
            const timezone = (request.headers['x-timezone'] as string) || 'Australia/Sydney';
            return await TrackingService.getAbandonmentRate(accountId, days, timezone, dateRange);
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
            const { days, dateRange } = resolveMetricsWindow(query);
            return await TrackingService.getSearches(accountId, days, dateRange);
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
            const { days, dateRange } = resolveMetricsWindow(query);
            return await TrackingService.getExitPages(accountId, days, dateRange);
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
            const { days, dateRange } = resolveMetricsWindow(query);
            const endDate = dateRange?.endDate || new Date();
            const startDate = dateRange?.startDate || new Date(endDate.getTime() - days * 24 * 60 * 60 * 1000);

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
            const { days, dateRange } = resolveMetricsWindow(query);

            const [stats, funnel, revenue, attribution, abandonment, cohorts, ltv] = await Promise.all([
                TrackingService.getStats(accountId, days, 'Australia/Sydney', dateRange),
                TrackingService.getFunnel(accountId, days, 'Australia/Sydney', dateRange),
                TrackingService.getRevenue(accountId, days, 'Australia/Sydney', dateRange),
                TrackingService.getAttribution(accountId, days, 'Australia/Sydney', dateRange),
                TrackingService.getAbandonmentRate(accountId, days, 'Australia/Sydney', dateRange),
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
            const parsedHours = parseInt(query.hours || '8', 10);
            const hours = Number.isFinite(parsedHours) && parsedHours > 0 ? Math.min(parsedHours, 168) : 8;

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
