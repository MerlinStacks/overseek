import { FastifyPluginAsync } from 'fastify';
import { EventBus, EVENTS } from '../services/events';
import { Logger } from '../utils/logger';

type ArtworkStatus =
    | 'uploaded'
    | 'approval_requested'
    | 'approved'
    | 'changes_requested'
    | 'override_used';

interface ArtworkEventPayload {
    event?: {
        event_name?: string;
        event_status?: string;
        occurred_at?: string;
        order_id?: number | string;
        order_number?: string;
        customer_email?: string;
        customer_phone?: string;
        customer_name?: string;
        proof_url?: string;
        proof_version?: string | number;
        notes?: string;
        staff_user?: string;
        source?: string;
        source_version?: string;
    };
}

function normalizeArtworkStatus(raw?: string): ArtworkStatus | null {
    if (!raw) return null;
    const value = raw.trim().toLowerCase();
    switch (value) {
        case 'uploaded':
        case 'approval_requested':
        case 'approved':
        case 'changes_requested':
        case 'override_used':
            return value;
        default:
            return null;
    }
}

function mapArtworkStatusToTrigger(status: ArtworkStatus): { eventName: string; triggerType: string } {
    switch (status) {
        case 'uploaded':
            return { eventName: EVENTS.ARTWORK.UPLOADED, triggerType: 'ARTWORK_UPLOADED' };
        case 'approval_requested':
            return { eventName: EVENTS.ARTWORK.APPROVAL_REQUESTED, triggerType: 'ARTWORK_APPROVAL_REQUESTED' };
        case 'approved':
            return { eventName: EVENTS.ARTWORK.APPROVED, triggerType: 'ARTWORK_APPROVED' };
        case 'changes_requested':
            return { eventName: EVENTS.ARTWORK.CHANGES_REQUESTED, triggerType: 'ARTWORK_CHANGES_REQUESTED' };
        case 'override_used':
            return { eventName: EVENTS.ARTWORK.OVERRIDE_USED, triggerType: 'ARTWORK_OVERRIDE_USED' };
    }
}

const artworkEventsRoutes: FastifyPluginAsync = async (fastify) => {
    fastify.post<{ Params: { accountId: string }; Body: ArtworkEventPayload }>('/:accountId', async (request, reply) => {
        const { accountId } = request.params;
        const payload = request.body || {};
        const event = payload.event;

        if (!event) {
            return reply.code(400).send({ error: 'Invalid payload: missing event object' });
        }

        const normalizedStatus = normalizeArtworkStatus(event.event_status);
        if (!normalizedStatus) {
            return reply.code(202).send({ success: false, skipped: true, reason: 'unsupported_event_status' });
        }

        const mapped = mapArtworkStatusToTrigger(normalizedStatus);
        const triggerData = {
            accountId,
            email: event.customer_email || null,
            customerEmail: event.customer_email || null,
            customerPhone: event.customer_phone || null,
            customerName: event.customer_name || null,
            orderId: event.order_id ?? null,
            orderNumber: event.order_number || null,
            eventStatus: normalizedStatus,
            eventName: event.event_name || null,
            occurredAt: event.occurred_at || null,
            proofUrl: event.proof_url || null,
            proofVersion: event.proof_version || null,
            notes: event.notes || null,
            staffUser: event.staff_user || null,
            source: event.source || 'ck_order_workflow_suite',
            sourceVersion: event.source_version || null,
            rawEvent: event,
        };

        EventBus.emit(mapped.eventName, { accountId, artwork: triggerData });

        Logger.info('[ArtworkEvents] Artwork event accepted', {
            accountId,
            triggerType: mapped.triggerType,
            orderId: event.order_id ?? null,
            eventStatus: normalizedStatus,
        });

        return reply.code(202).send({ success: true, accepted: true, triggerType: mapped.triggerType });
    });
};

export default artworkEventsRoutes;
