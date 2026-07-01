/**
 * Order Attribution & COGS Sub-Routes
 */

import { FastifyPluginAsync } from 'fastify';
import { Prisma } from '@prisma/client';
import { prisma } from '../../utils/prisma';
import { Logger } from '../../utils/logger';
import { getPayloadWooOrderId } from '../../utils/orderIds';
import { requireAuthFastify } from '../../middleware/auth';
import {
    findOrderByAnyId,
    getOrderAccountIdOrReply,
    getOrderUserAndAccountOrReply,
    parseOrderIdParamOrReply,
} from './helpers';

const ATTRIBUTION_SESSION_SELECT = {
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
    os: true,
};

interface BasicAttribution {
    lastTouchSource: string;
    firstTouchSource?: string;
    utmSource?: string;
    utmMedium?: string;
    utmCampaign?: string;
    referrer?: string;
    country?: string | null;
    city?: string | null;
    deviceType?: string | null;
    browser?: string | null;
    os?: string | null;
}

function toStringValue(value: unknown): string | undefined {
    if (typeof value !== 'string' && typeof value !== 'number') return undefined;
    const text = String(value).trim();
    return text || undefined;
}

function getMetaValue(rawData: unknown, keys: string[]): string | undefined {
    const order = rawData as Record<string, unknown> | null;
    const metaData = order?.meta_data;
    if (!Array.isArray(metaData)) return undefined;

    const normalizedKeys = new Set(keys.map((key) => key.toLowerCase()));
    for (const item of metaData) {
        const meta = item as { key?: unknown; value?: unknown };
        const key = toStringValue(meta.key)?.toLowerCase();
        if (key && normalizedKeys.has(key)) return toStringValue(meta.value);
    }

    return undefined;
}

function getRawAttributionValue(rawData: unknown, keys: string[]): string | undefined {
    const order = rawData as Record<string, unknown> | null;
    const attribution = order?.attribution as Record<string, unknown> | null;

    for (const key of keys) {
        const direct = toStringValue(order?.[key]);
        if (direct) return direct;

        const attrValue = toStringValue(attribution?.[key]);
        if (attrValue) return attrValue;
    }

    return getMetaValue(rawData, keys);
}

function sourceFromReferrer(referrer?: string): string | undefined {
    if (!referrer) return undefined;

    try {
        return new URL(referrer).hostname.replace(/^www\./, '');
    } catch {
        return referrer;
    }
}

function mapWooOrderAttribution(rawData: unknown): BasicAttribution | null {
    const sourceType = getRawAttributionValue(rawData, ['source_type', '_wc_order_attribution_source_type']);
    const utmSource = getRawAttributionValue(rawData, ['utm_source', '_wc_order_attribution_utm_source']);
    const utmMedium = getRawAttributionValue(rawData, ['utm_medium', '_wc_order_attribution_utm_medium']);
    const utmCampaign = getRawAttributionValue(rawData, ['utm_campaign', '_wc_order_attribution_utm_campaign']);
    const referrer = getRawAttributionValue(rawData, ['referrer', '_wc_order_attribution_referrer']);
    const deviceType = getRawAttributionValue(rawData, ['device_type', '_wc_order_attribution_device_type']);

    if (!sourceType && !utmSource && !utmMedium && !utmCampaign && !referrer && !deviceType) {
        return null;
    }

    const lastTouchSource = utmSource
        || sourceFromReferrer(referrer)
        || (sourceType === 'typein' ? 'direct' : sourceType)
        || 'direct';

    return {
        lastTouchSource,
        firstTouchSource: lastTouchSource,
        utmSource,
        utmMedium,
        utmCampaign,
        referrer,
        deviceType,
    };
}

function mapEventToBasicAttribution(event: {
    session: {
        lastTouchSource: string | null;
        firstTouchSource: string | null;
        utmSource: string | null;
        utmMedium: string | null;
        utmCampaign: string | null;
        referrer: string | null;
    };
}) {
    return {
        lastTouchSource: event.session.lastTouchSource || 'direct',
        firstTouchSource: event.session.firstTouchSource || undefined,
        utmSource: event.session.utmSource || undefined,
        utmMedium: event.session.utmMedium || undefined,
        utmCampaign: event.session.utmCampaign || undefined,
        referrer: event.session.referrer || undefined,
    };
}

function getEventWooOrderId(event: { orderId: number | null; payload: unknown }): number | null {
    if (event.orderId) return event.orderId;
    return getPayloadWooOrderId(event.payload);
}

async function findPurchaseEventsForOrderIds(accountId: string, orderIds: number[]) {
    const orderIdTexts = orderIds.map(String);
    const eventRows = await prisma.$queryRaw<Array<{ id: string }>>(Prisma.sql`
        SELECT e.id
        FROM "AnalyticsEvent" e
        INNER JOIN "AnalyticsSession" s ON s.id = e."sessionId"
        WHERE s."accountId" = ${accountId}
          AND e.type = 'purchase'
            AND (
                e."orderId"::text IN (${Prisma.join(orderIdTexts)})
                OR e.payload->>'orderId' IN (${Prisma.join(orderIdTexts)})
                OR e.payload->>'order_id' IN (${Prisma.join(orderIdTexts)})
            )
        ORDER BY e."createdAt" DESC
    `);

    const eventIds = eventRows.map((row) => row.id);
    if (eventIds.length === 0) return [];

    return prisma.analyticsEvent.findMany({
        where: { id: { in: eventIds } },
        include: {
            session: { select: ATTRIBUTION_SESSION_SELECT }
        }
    });
}

const attributionRoutes: FastifyPluginAsync = async (fastify) => {
    fastify.addHook('preHandler', requireAuthFastify);

    // Batch attribution lookup — uses denormalized orderId column for O(1) lookups
    fastify.post<{ Body: { orderIds: number[] } }>('/batch-attributions', async (request, reply) => {
        const accountId = getOrderAccountIdOrReply(request, reply);
        if (!accountId) return;

        const { orderIds } = request.body as { orderIds: number[] };
        if (!orderIds?.length) return reply.code(400).send({ error: 'orderIds array is required' });

        // Cap at 50 to prevent abuse
        const ids = orderIds.slice(0, 50);

        try {
            // 1. Fetch all matching orders in one query
            const orders = await prisma.wooOrder.findMany({
                where: { accountId, wooId: { in: ids } },
                select: { wooId: true, rawData: true }
            });
            const wooIds = new Set(orders.map(o => o.wooId));
            const orderMap = new Map(orders.map((order) => [order.wooId, order]));

            // 2. Query purchase events by denormalized orderId with payload fallback for legacy/string IDs.
            const purchaseEvents = await findPurchaseEventsForOrderIds(accountId, ids);

            // 3. Build a map from orderId to the most recent event per order
            const eventMap = new Map<number, typeof purchaseEvents[0]>();
            for (const event of purchaseEvents) {
                const oid = getEventWooOrderId(event);
                if (!oid) continue;
                const existing = eventMap.get(oid);
                if (!existing || event.createdAt > existing.createdAt) {
                    eventMap.set(oid, event);
                }
            }

            // 4. Build result
            const result: Record<number, BasicAttribution | null> = {};

            for (const wooId of ids) {
                if (!wooIds.has(wooId)) {
                    result[wooId] = null;
                    continue;
                }

                const matched = eventMap.get(wooId);
                result[wooId] = matched
                    ? mapEventToBasicAttribution(matched)
                    : mapWooOrderAttribution(orderMap.get(wooId)?.rawData);
            }

            return { attributions: result };
        } catch (error) {
            Logger.error('Failed to fetch batch attributions', { error });
            return reply.code(500).send({ error: 'Failed to fetch batch attributions' });
        }
    });

    // Get Attribution data for an Order
    fastify.get<{ Params: { id: string } }>('/:id/attribution', async (request, reply) => {
        const id = parseOrderIdParamOrReply(request, reply);
        if (!id) return;
        const accountId = getOrderAccountIdOrReply(request, reply);
        if (!accountId) return;

        try {
            const order = await findOrderByAnyId(accountId, id);

            if (!order) {
                return reply.code(404).send({ error: 'Order not found' });
            }

            const matchedEvent = (await findPurchaseEventsForOrderIds(accountId, [order.wooId]))[0] || null;

            const attribution = matchedEvent
                ? {
                    ...mapEventToBasicAttribution(matchedEvent),
                    country: matchedEvent.session.country,
                    city: matchedEvent.session.city,
                    deviceType: matchedEvent.session.deviceType,
                    browser: matchedEvent.session.browser,
                    os: matchedEvent.session.os
                }
                : mapWooOrderAttribution(order.rawData);

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
        const id = parseOrderIdParamOrReply(request, reply);
        if (!id) return;
        const userAndAccount = getOrderUserAndAccountOrReply(request, reply);
        if (!userAndAccount) return;
        const { userId, accountId } = userAndAccount;

        // Server-side permission gate — COGS is sensitive financial data
        const { PermissionService } = await import('../../services/PermissionService');
        const allowed = await PermissionService.hasPermission(userId, accountId, 'view_cogs');
        if (!allowed) {
            return reply.code(403).send({ error: 'Insufficient permissions' });
        }

        try {
            const order = await findOrderByAnyId(accountId, id);

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
