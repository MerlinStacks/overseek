import { FastifyPluginAsync } from 'fastify';
import { prisma } from '../utils/prisma';
import { EventBus, EVENTS } from '../services/events';
import { Logger } from '../utils/logger';

const FEATURE_KEY = 'TRACKING_EMAIL_EVENTS';

type ShipmentStatus =
    | 'in_transit'
    | 'out_for_delivery'
    | 'delivery_attempted'
    | 'delivered'
    | 'exception';

interface TrackingEventPayload {
    event?: {
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

function normalizeShipmentStatus(raw?: string): ShipmentStatus | null {
    if (!raw) return null;
    const value = raw.trim().toLowerCase();
    switch (value) {
        case 'in_transit':
        case 'out_for_delivery':
        case 'delivery_attempted':
        case 'delivered':
        case 'exception':
            return value;
        default:
            return null;
    }
}

function mapStatusToTrigger(status: ShipmentStatus): { eventName: string; triggerType: string } {
    switch (status) {
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

const trackingEmailEventsRoutes: FastifyPluginAsync = async (fastify) => {
    fastify.post<{ Params: { accountId: string }; Body: TrackingEventPayload }>('/:accountId', async (request, reply) => {
        const { accountId } = request.params;
        const payload = request.body || {};
        const event = payload.event;

        if (!event) {
            return reply.code(400).send({ error: 'Invalid payload: missing event object' });
        }

        const feature = await prisma.accountFeature.findUnique({
            where: { accountId_featureKey: { accountId, featureKey: FEATURE_KEY } },
            select: { isEnabled: true, config: true },
        });

        if (!feature?.isEnabled) {
            return reply.code(403).send({ error: 'Tracking email events feature is disabled for this account' });
        }

        const config = (feature.config || {}) as Record<string, unknown>;
        const configuredToken = typeof config.webhookAuthToken === 'string' ? config.webhookAuthToken.trim() : '';
        if (configuredToken) {
            const authHeader = String(request.headers.authorization || '');
            const expected = `Bearer ${configuredToken}`;
            if (authHeader !== expected) {
                return reply.code(401).send({ error: 'Unauthorized' });
            }
        }

        const normalizedStatus = normalizeShipmentStatus(event.event_status);
        if (!normalizedStatus) {
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
        });

        return reply.code(202).send({ success: true, accepted: true, triggerType: mapped.triggerType });
    });
};

export default trackingEmailEventsRoutes;
