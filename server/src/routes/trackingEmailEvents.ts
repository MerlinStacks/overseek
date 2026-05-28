import { FastifyPluginAsync, FastifyReply, FastifyRequest } from 'fastify';
import { prisma } from '../utils/prisma';
import { EventBus, EVENTS } from '../services/events';
import { Logger } from '../utils/logger';

const FEATURE_KEY = 'TRACKING_EMAIL_EVENTS';

type ShipmentStatus =
    | 'received_by_carrier'
    | 'in_transit'
    | 'out_for_delivery'
    | 'delivery_attempted'
    | 'delivered'
    | 'exception';

interface TrackingEventPayload {
    account_id?: string;
    event?: {
        account_id?: string;
        event_name?: string;
        event_status?: string;
        provider?: string;
        order_id?: number | string;
        order_number?: string;
        tracking_number?: string;
        occurred_at?: string;
        location?: string;
        description?: string;
        eta?: string;
        customer_email?: string;
        customer_phone?: string;
        customer_name?: string;
        order_total?: string;
        order_currency?: string;
        order_status?: string;
        source?: string;
        source_version?: string;
    };
}

export function normalizeShipmentStatus(...values: Array<string | undefined>): ShipmentStatus | null {
    const nonEmptyValues = values.filter((value): value is string => typeof value === 'string' && value.trim().length > 0);
    if (nonEmptyValues.length === 0) return null;

    for (const rawValue of nonEmptyValues) {
        const value = rawValue.trim().toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
        switch (value) {
            case 'in_transit':
            case 'received_by_carrier':
            case 'out_for_delivery':
            case 'delivery_attempted':
            case 'delivered':
            case 'exception':
                return value;
        }
    }

    const text = nonEmptyValues.join(' ').trim().toLowerCase();
    if (/(out[\s_-]*for[\s_-]*delivery|on[\s_-]*board[\s_-]*for[\s_-]*delivery|onboard[\s_-]*for[\s_-]*delivery)/.test(text)) return 'out_for_delivery';
    if (/(delivery attempted|attempted delivery|card left|awaiting collection|collection point)/.test(text)) return 'delivery_attempted';
    if (/(delivered|successfully delivered)/.test(text)) return 'delivered';
    if (/(exception|delay|delayed|held|return to sender|returned|damaged|lost|address issue|failed)/.test(text)) return 'exception';
    if (/(lodged|accepted|picked up|pickup|we've got it|we have got it|received by carrier)/.test(text)) return 'received_by_carrier';
    if (/(in transit|transit|processed|sorted|transferred|facility|depot|lodged|accepted|picked up|pickup|received by carrier)/.test(text)) return 'in_transit';

    return null;
}

function mapStatusToTrigger(status: ShipmentStatus): { eventName: string; triggerType: string } {
    switch (status) {
        case 'received_by_carrier':
            return { eventName: EVENTS.SHIPMENT.RECEIVED_BY_CARRIER, triggerType: 'SHIPMENT_RECEIVED_BY_CARRIER' };
        case 'in_transit':
            return { eventName: EVENTS.SHIPMENT.IN_TRANSIT, triggerType: 'SHIPMENT_IN_TRANSIT' };
        case 'out_for_delivery':
            return { eventName: EVENTS.SHIPMENT.OUT_FOR_DELIVERY, triggerType: 'SHIPMENT_OUT_FOR_DELIVERY' };
        case 'delivery_attempted':
            return { eventName: EVENTS.SHIPMENT.DELIVERY_ATTEMPTED, triggerType: 'SHIPMENT_DELIVERY_ATTEMPTED' };
        case 'delivered':
            return { eventName: EVENTS.SHIPMENT.DELIVERED, triggerType: 'SHIPMENT_DELIVERED' };
        case 'exception':
            return { eventName: EVENTS.SHIPMENT.EXCEPTION, triggerType: 'SHIPMENT_EXCEPTION' };
    }
}

function resolveAccountId(request: { params?: { accountId?: string }; headers: Record<string, unknown>; query?: { account_id?: string }; body?: TrackingEventPayload }): string {
    const paramsAccountId = typeof request.params?.accountId === 'string' ? request.params.accountId.trim() : '';
    if (paramsAccountId) return paramsAccountId;

    const headerAccountId = typeof request.headers['x-account-id'] === 'string' ? request.headers['x-account-id'].trim() : '';
    if (headerAccountId) return headerAccountId;

    const queryAccountId = typeof request.query?.account_id === 'string' ? request.query.account_id.trim() : '';
    if (queryAccountId) return queryAccountId;

    const bodyAccountId = typeof request.body?.account_id === 'string' ? request.body.account_id.trim() : '';
    if (bodyAccountId) return bodyAccountId;

    const eventAccountId = typeof request.body?.event?.account_id === 'string' ? request.body.event.account_id.trim() : '';
    return eventAccountId;
}

async function handleTrackingEmailEvent(
    request: FastifyRequest<{ Params?: { accountId?: string }; Querystring?: { account_id?: string }; Body: TrackingEventPayload }>,
    reply: FastifyReply,
) {
    const accountId = resolveAccountId({
        params: request.params,
        headers: request.headers,
        query: request.query,
        body: request.body,
    });
    const payload = request.body || {};
    const event = payload.event;

    if (!accountId) {
        return reply.code(400).send({ error: 'Invalid payload: missing account ID' });
    }

    if (!event) {
        return reply.code(400).send({ error: 'Invalid payload: missing event object' });
    }

    const [account, feature] = await Promise.all([
        prisma.account.findUnique({
            where: { id: accountId },
            select: { id: true, wooUrl: true },
        }),
        prisma.accountFeature.findUnique({
            where: { accountId_featureKey: { accountId, featureKey: FEATURE_KEY } },
            select: { config: true },
        }),
    ]);

    if (!account?.wooUrl) {
        return reply.code(403).send({ error: 'WooCommerce connection is not configured for this account' });
    }

    const config = (feature?.config || {}) as Record<string, unknown>;
    const configuredToken = typeof config.webhookAuthToken === 'string' ? config.webhookAuthToken.trim() : '';
    if (configuredToken) {
        const authHeader = String(request.headers.authorization || '');
        const expected = `Bearer ${configuredToken}`;
        if (authHeader !== expected) {
            return reply.code(401).send({ error: 'Unauthorized' });
        }
    }

    const normalizedStatus = normalizeShipmentStatus(event.event_status, event.event_name, event.description);
    if (!normalizedStatus) {
        Logger.warn('[TrackingEmailEvents] Shipment event skipped: unsupported status', {
            accountId,
            eventStatus: event.event_status || null,
            eventName: event.event_name || null,
            description: event.description || null,
            trackingNumber: event.tracking_number || null,
        });
        return reply.code(202).send({ success: false, skipped: true, reason: 'unsupported_event_status' });
    }

    const mapped = mapStatusToTrigger(normalizedStatus);
    const triggerData = {
        accountId,
        email: event.customer_email || null,
        customerEmail: event.customer_email || null,
        customerPhone: event.customer_phone || null,
        customerName: event.customer_name || null,
        orderId: event.order_id ?? null,
        orderNumber: event.order_number || null,
        trackingNumber: event.tracking_number || null,
        eventStatus: normalizedStatus,
        eventName: event.event_name || null,
        occurredAt: event.occurred_at || null,
        location: event.location || null,
        description: event.description || null,
        eta: event.eta || null,
        orderTotal: event.order_total || null,
        orderCurrency: event.order_currency || null,
        orderStatus: event.order_status || null,
        provider: event.provider || null,
        source: event.source || 'ck_order_workflow_suite',
        sourceVersion: event.source_version || null,
        rawEvent: event,
    };

    EventBus.emit(mapped.eventName, { accountId, shipment: triggerData });

    Logger.info('[TrackingEmailEvents] Shipment event accepted', {
        accountId,
        triggerType: mapped.triggerType,
        orderId: event.order_id ?? null,
        trackingNumber: event.tracking_number || null,
        eventStatus: normalizedStatus,
        hasCustomerEmail: Boolean(event.customer_email),
    });

    return reply.code(202).send({ success: true, accepted: true, triggerType: mapped.triggerType });
}

const trackingEmailEventsRoutes: FastifyPluginAsync = async (fastify) => {
    fastify.post<{ Params: { accountId: string }; Body: TrackingEventPayload }>('/:accountId', handleTrackingEmailEvent);
    fastify.post<{ Querystring: { account_id?: string }; Body: TrackingEventPayload }>('/', handleTrackingEmailEvent);
};

export default trackingEmailEventsRoutes;
