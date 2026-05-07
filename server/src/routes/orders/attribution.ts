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

    // Batch attribution lookup — uses denormalized orderId column for O(1) lookups
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

            // 2. Query purchase events directly by denormalized orderId
            const purchaseEvents = await prisma.analyticsEvent.findMany({
                where: {
                    orderId: { in: ids },
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
                }
            });

            // 3. Build a map from orderId to the most recent event per order
            const eventMap = new Map<number, typeof purchaseEvents[0]>();
            for (const event of purchaseEvents) {
                const oid = event.orderId!;
                const existing = eventMap.get(oid);
                if (!existing || event.createdAt > existing.createdAt) {
                    eventMap.set(oid, event);
                }
            }

            // 4. Build result
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

                const matched = eventMap.get(wooId);
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

            // Query purchase event directly by denormalized orderId
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

            const matchedEvent = await prisma.analyticsEvent.findFirst({
                where: {
                    orderId: order.wooId,
                    session: { accountId }
                },
                include: { session: { select: sessionSelect } },
                orderBy: { createdAt: 'desc' }
            });

            const attribution = matchedEvent
                ? {
                    firstTouchSource: matchedEvent.session.firstTouchSource || 'direct',
                    lastTouchSource: matchedEvent.session.lastTouchSource || 'direct',
                    utmSource: matchedEvent.session.utmSource,
                    utmMedium: matchedEvent.session.utmMedium,
                    utmCampaign: matchedEvent.session.utmCampaign,
                    referrer: matchedEvent.session.referrer,
                    country: matchedEvent.session.country,
                    city: matchedEvent.session.city,
                    deviceType: matchedEvent.session.deviceType,
                    browser: matchedEvent.session.browser,
                    os: matchedEvent.session.os
                }
                : null;

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
