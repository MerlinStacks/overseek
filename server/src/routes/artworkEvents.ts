import { FastifyPluginAsync, FastifyReply, FastifyRequest } from 'fastify';
import crypto from 'crypto';
import { EventBus, EVENTS } from '../services/events';
import { Logger } from '../utils/logger';
import { prisma } from '../utils/prisma';
import { decrypt } from '../utils/encryption';

const FEATURE_KEY = 'TRACKING_EMAIL_EVENTS';

type ArtworkStatus =
    | 'uploaded'
    | 'approval_requested'
    | 'approved'
    | 'changes_requested'
    | 'override_used';

interface ArtworkEventPayload {
    account_id?: string;
    event?: {
        account_id?: string;
        event_id?: string;
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
        proofVersion?: string | number;
        proof?: { version?: string | number };
        metadata?: { proof_version?: string | number; proofVersion?: string | number };
        data?: { proof_version?: string | number; proofVersion?: string | number };
        notes?: string;
        staff_user?: string;
        source?: string;
        source_version?: string;
    };
}

function resolveProofVersion(event: NonNullable<ArtworkEventPayload['event']>): number | null {
    const candidates = [
        event.proof_version,
        event.proofVersion,
        event.proof?.version,
        event.metadata?.proof_version,
        event.metadata?.proofVersion,
        event.data?.proof_version,
        event.data?.proofVersion,
    ];

    for (const candidate of candidates) {
        if (candidate === undefined || candidate === null || candidate === '') continue;
        const match = String(candidate).trim().match(/^(?:v(?:ersion)?\s*)?(\d+)$/i);
        if (match) return Number(match[1]);
    }

    return null;
}

export function normalizeArtworkStatus(...values: Array<string | undefined>): ArtworkStatus | null {
    for (const raw of values) {
        if (!raw) continue;

        const value = raw.trim().toLowerCase()
            .replace(/[^a-z0-9]+/g, '_')
            .replace(/^_+|_+$/g, '');

        if (value === 'uploaded' || value.endsWith('_uploaded')) return 'uploaded';
        if (value === 'approval_requested' || value.endsWith('_approval_requested')) return 'approval_requested';
        if (value === 'approved' || value.endsWith('_approved')) return 'approved';
        if (value === 'changes_requested' || value.endsWith('_changes_requested')) return 'changes_requested';
        if (value === 'override_used' || value.endsWith('_override_used')) return 'override_used';
    }

    return null;
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

function extractBearerToken(headers: Record<string, unknown>): string {
    const authorization = typeof headers.authorization === 'string' ? headers.authorization.trim() : '';
    const match = authorization.match(/^Bearer\s+(.+)$/i);
    return match ? match[1].trim() : '';
}

function hashSafeEquals(a: string, b: string): boolean {
    return a.length === b.length && crypto.timingSafeEqual(Buffer.from(a), Buffer.from(b));
}

async function authenticateArtworkEvent(accountId: string, bearerToken: string): Promise<boolean> {
    if (!bearerToken) return false;

    const [account, feature, emailAccounts] = await Promise.all([
        prisma.account.findUnique({
            where: { id: accountId },
            select: { webhookSecret: true },
        }),
        prisma.accountFeature.findUnique({
            where: { accountId_featureKey: { accountId, featureKey: FEATURE_KEY } },
            select: { config: true },
        }),
        prisma.emailAccount.findMany({
            where: { accountId, relayApiKey: { not: null } },
            select: { id: true, relayApiKey: true },
        }),
    ]);

    if (!account) return false;
    if (account.webhookSecret && hashSafeEquals(account.webhookSecret, bearerToken)) return true;

    const config = (feature?.config || {}) as Record<string, unknown>;
    const configuredToken = typeof config.webhookAuthToken === 'string' ? config.webhookAuthToken.trim() : '';
    if (configuredToken && hashSafeEquals(configuredToken, bearerToken)) return true;

    for (const emailAccount of emailAccounts) {
        try {
            if (emailAccount.relayApiKey && hashSafeEquals(decrypt(emailAccount.relayApiKey), bearerToken)) return true;
        } catch (error) {
            Logger.warn('[ArtworkEvents] Failed to decrypt relay API key during webhook authentication', {
                emailAccountId: emailAccount.id,
                error,
            });
        }
    }

    return false;
}

async function handleArtworkEvent(
    request: FastifyRequest<{
        Params?: { accountId?: string };
        Querystring?: { account_id?: string };
        Body: ArtworkEventPayload;
    }>,
    reply: FastifyReply,
) {
    const payload = request.body || {};
    const event = payload.event;

    if (!event) {
        return reply.code(400).send({ error: 'Invalid payload: missing event object' });
    }

    const accountId = request.params?.accountId
        || request.query?.account_id
        || payload.account_id
        || event.account_id;
    if (!accountId) {
        return reply.code(400).send({ error: 'Invalid payload: missing account_id' });
    }

    if (!await authenticateArtworkEvent(accountId, extractBearerToken(request.headers))) {
        return reply.code(401).send({ error: 'Unauthorized' });
    }

    const normalizedStatus = normalizeArtworkStatus(event.event_status, event.event_name);
    if (!normalizedStatus) {
        Logger.warn('[ArtworkEvents] Artwork event skipped: unsupported status', {
            accountId,
            eventStatus: event.event_status || null,
            eventName: event.event_name || null,
            orderId: event.order_id ?? null,
        });
        return reply.code(202).send({ success: false, skipped: true, reason: 'unsupported_event_status' });
    }

    const mapped = mapArtworkStatusToTrigger(normalizedStatus);
    const proofVersion = resolveProofVersion(event);
    const triggerData = {
        accountId,
        eventId: event.event_id || null,
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
        proofVersion,
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
        proofVersion,
    });

    return reply.code(202).send({ success: true, accepted: true, triggerType: mapped.triggerType });
}

const artworkEventsRoutes: FastifyPluginAsync = async (fastify) => {
    fastify.post<{ Params: { accountId: string }; Body: ArtworkEventPayload }>('/:accountId', handleArtworkEvent);
    fastify.post<{ Querystring: { account_id?: string }; Body: ArtworkEventPayload }>('/', handleArtworkEvent);
};

export default artworkEventsRoutes;
