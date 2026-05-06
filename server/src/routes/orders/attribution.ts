/**
 * Order Attribution & COGS Sub-Routes
 */

import { FastifyPluginAsync } from 'fastify';
import { prisma } from '../../utils/prisma';
import { Logger } from '../../utils/logger';
import { requireAuthFastify } from '../../middleware/auth';
import { z } from 'zod';

const orderIdParamSchema = z.object({
    id: z.union([
        z.string().uuid(),
        z.string().regex(/^\d+$/, "ID must be a UUID or a numeric string")
    ])
});

const attributionRoutes: FastifyPluginAsync = async (fastify) => {
    fastify.addHook('preHandler', requireAuthFastify);

    // Batch attribution lookup — replaces N individual calls with one
    // TODO(perf): Store orderId as a denormalized column on AnalyticsEvent
    // to replace this O(N×M) linear scan over 1000 events. For accounts
    // with high purchase volume this will degrade significantly.
    fastify.post<{ Body: { orderIds: number[] } }>('/batch-attributions', async (request, reply) => {
        const accountId = request.user?.accountId;
        if (!accountId) return reply.code(400).send({ error: 'accountId header is required' });

        const { orderIds } = request.body as { orderIds: number[] };
        if (!orderIds?.length) return reply.code(400).send({ error: 'orderIds array is required' });

        // Cap at 50 to prevent abuse
        const ids = orderIds.slice(0, 50);

        try {
            // 1. Fetch all matching orders in one query
            const orders = await prisma.wooOrder.findMany({
                where: { accountId, wooId: { in: ids } },
                select: { wooId: true }
            });
            const wooIds = new Set(orders.map(o => o.wooId));

            // 2. Fetch all purchase events for this account in one query
            const purchaseEvents = await prisma.analyticsEvent.findMany({
                where: {
                    type: 'purchase',
                    session: { accountId }
                },
                include: {
                    session: {
                        select: {
                            firstTouchSource: true,
                            lastTouchSource: true,
                            utmSource: true,
                            utmMedium: true,
                            utmCampaign: true,
                            referrer: true
                        }
                    }
                },
                orderBy: { createdAt: 'desc' },
                take: 1000
            });

            // 3. Match events to orders by wooId in payload
            const result: Record<number, {
                lastTouchSource: string;
                firstTouchSource?: string;
                utmSource?: string;
                utmMedium?: string;
                utmCampaign?: string;
                referrer?: string;
            } | null> = {};

            for (const wooId of ids) {
                if (!wooIds.has(wooId)) {
                    result[wooId] = null;
                    continue;
                }

                const matched = purchaseEvents.find(e => {
                    const payload = e.payload as Record<string, unknown>;
                    return payload?.orderId === wooId || payload?.order_id === wooId;
                });

                result[wooId] = matched
                    ? {
                        lastTouchSource: matched.session.lastTouchSource || 'direct',
                        firstTouchSource: matched.session.firstTouchSource || undefined,
                        utmSource: matched.session.utmSource || undefined,
                        utmMedium: matched.session.utmMedium || undefined,
                        utmCampaign: matched.session.utmCampaign || undefined,
                        referrer: matched.session.referrer || undefined,
                    }
                    : null;
            }

            return { attributions: result };
        } catch (error) {
            Logger.error('Failed to fetch batch attributions', { error });
            return reply.code(500).send({ error: 'Failed to fetch batch attributions' });
        }
    });

    // Get Attribution data for an Order
    fastify.get<{ Params: { id: string } }>('/:id/attribution', async (request, reply) => {
        const parsedParams = orderIdParamSchema.safeParse(request.params);
        if (!parsedParams.success) return reply.code(400).send({ error: parsedParams.error.issues[0].message });
        const { id } = parsedParams.data;
        const accountId = request.user?.accountId;

        if (!accountId) {
            return reply.code(400).send({ error: 'accountId header is required' });
        }

        try {
            let order;

            // Try finding by internal UUID first (scoped to account to prevent IDOR)
            order = await prisma.wooOrder.findFirst({ where: { id, accountId } });

            // If not found and ID is numeric, try finding by WooID
            if (!order && !isNaN(Number(id))) {
                order = await prisma.wooOrder.findUnique({
                    where: { accountId_wooId: { accountId, wooId: Number(id) } }
                });
            }

            if (!order) {
                return reply.code(404).send({ error: 'Order not found' });
            }

            // Find purchase event matching this order by scanning all recent events.
            // Cannot filter by JSON payload fields in Prisma, so we fetch a reasonable set
            // and scan for a match.
            const sessionSelect = {
                firstTouchSource: true,
                lastTouchSource: true,
                utmSource: true,
                utmMedium: true,
                utmCampaign: true,
                referrer: true,
                country: true,
                city: true,
                deviceType: true,
                browser: true,
                os: true
            };

            let attribution = null;

            const allPurchaseEvents = await prisma.analyticsEvent.findMany({
                where: {
                    type: 'purchase',
                    session: { accountId }
                },
                include: { session: { select: sessionSelect } },
                orderBy: { createdAt: 'desc' },
                take: 500
            });

            for (const event of allPurchaseEvents) {
                const payload = event.payload as Record<string, unknown>;
                if (payload?.orderId === order.wooId || payload?.order_id === order.wooId) {
                    const session = event.session;
                    attribution = {
                        firstTouchSource: session.firstTouchSource || 'direct',
                        lastTouchSource: session.lastTouchSource || 'direct',
                        utmSource: session.utmSource,
                        utmMedium: session.utmMedium,
                        utmCampaign: session.utmCampaign,
                        referrer: session.referrer,
                        country: session.country,
                        city: session.city,
                        deviceType: session.deviceType,
                        browser: session.browser,
                        os: session.os
                    };
                    break;
                }
            }

            return { attribution };
        } catch (error) {
            Logger.error('Failed to fetch order attribution', { error });
            return reply.code(500).send({ error: 'Failed to fetch order attribution' });
        }
    });

    // -------------------------------------------------------------------------
    // COGS Breakdown - GET /api/orders/:id/cogs
    // -------------------------------------------------------------------------
    fastify.get<{ Params: { id: string } }>('/:id/cogs', async (request, reply) => {
        const parsedParams = orderIdParamSchema.safeParse(request.params);
        if (!parsedParams.success) return reply.code(400).send({ error: parsedParams.error.issues[0].message });
        const { id } = parsedParams.data;
        const accountId = request.user?.accountId;
        const userId = request.user?.id;

        if (!accountId || !userId) {
            return reply.code(400).send({ error: 'accountId header is required' });
        }

        // Server-side permission gate — COGS is sensitive financial data
        const { PermissionService } = await import('../../services/PermissionService');
        const allowed = await PermissionService.hasPermission(userId, accountId, 'view_cogs');
        if (!allowed) {
            return reply.code(403).send({ error: 'Insufficient permissions' });
        }

        try {
            let order;

            order = await prisma.wooOrder.findFirst({ where: { id, accountId } });

            if (!order && !isNaN(Number(id))) {
                order = await prisma.wooOrder.findUnique({
                    where: { accountId_wooId: { accountId, wooId: Number(id) } }
                });
            }

            if (!order) {
                return reply.code(404).send({ error: 'Order not found' });
            }

            const { getOrderCOGS } = await import('../../services/orderCogs');
            const result = await getOrderCOGS(accountId, order.rawData as Record<string, unknown>);

            return result;
        } catch (error) {
            Logger.error('Failed to fetch order COGS', { error });
            return reply.code(500).send({ error: 'Failed to fetch order COGS' });
        }
    });
};

export default attributionRoutes;
