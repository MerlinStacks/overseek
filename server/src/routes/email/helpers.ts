import { prisma } from '../../utils/prisma';
import { Logger } from '../../utils/logger';
import { decrypt } from '../../utils/encryption';
import { timingSafeEqual } from 'crypto';
type DeliveryEventType = 'BOUNCE' | 'COMPLAINT' | 'SOFT_BOUNCE' | 'DELIVERY_FAILURE';

export interface NormalizedDeliveryWebhookEntry {
    emailAccountId?: string;
    eventType: DeliveryEventType;
    reason?: string;
    messageId?: string;
    trackingId?: string;
    recipientEmail?: string;
}

export function getNestedString(source: unknown, paths: string[][]): string | undefined {
    for (const path of paths) {
        let current: unknown = source;
        for (const segment of path) {
            if (!current || typeof current !== 'object' || !(segment in (current as Record<string, unknown>))) {
                current = undefined;
                break;
            }
            current = (current as Record<string, unknown>)[segment];
        }
        if (typeof current === 'string' && current.trim()) {
            return current.trim();
        }
    }
    return undefined;
}

export function mapRawDeliveryEventType(rawType: string | undefined): DeliveryEventType | null {
    if (!rawType) return null;
    const normalized = rawType.trim().toLowerCase();
    if (['soft_bounce', 'softbounce', 'temporary', 'transient', 'deferred'].includes(normalized)) return 'SOFT_BOUNCE';
    if (['failed', 'dropped', 'reject', 'rejected', 'bounce', 'bounced'].includes(normalized)) return 'DELIVERY_FAILURE';
    if (['hard_bounce', 'hardbounce', 'permanent'].includes(normalized)) {
        return 'BOUNCE';
    }
    if (['complaint', 'complained', 'spam_complaint', 'spam complaint', 'spamreport', 'spam_report'].includes(normalized)) {
        return 'COMPLAINT';
    }
    return null;
}

export function extractCandidateEvents(payload: unknown): unknown[] {
    if (Array.isArray(payload)) return payload;
    if (!payload || typeof payload !== 'object') return [];
    const record = payload as Record<string, unknown>;
    if (Array.isArray(record.events)) return record.events;
    if (Array.isArray(record.records)) return record.records;
    if (record['event-data'] && typeof record['event-data'] === 'object') return [record['event-data']];
    if (record.msys && typeof record.msys === 'object') return [record.msys];
    return [payload];
}

export function normalizeDeliveryWebhookEntries(payload: unknown): NormalizedDeliveryWebhookEntry[] {
    const candidates = extractCandidateEvents(payload);
    if (candidates.length > 100) throw new Error('Delivery event batch exceeds 100');
    return candidates.flatMap((candidate) => {
        if (!candidate || typeof candidate !== 'object') return [];
        const entry = candidate as Record<string, unknown>;
        let eventType = mapRawDeliveryEventType(getNestedString(entry, [
            ['eventType'], ['event_type'], ['event'], ['RecordType'], ['type'], ['message_event', 'type']
        ]));
        const classification = getNestedString(entry, [['bounce', 'type'], ['bounce', 'severity'], ['severity'], ['Type']]);
        if (eventType && eventType !== 'COMPLAINT' && classification) {
            if (/soft|transient|temporary/i.test(classification)) eventType = 'SOFT_BOUNCE';
            else if (/hard|permanent/i.test(classification)) eventType = 'BOUNCE';
        }
        if (!eventType) return [];

        const messageId = getNestedString(entry, [
            ['messageId'], ['message_id'], ['MessageID'], ['MessageId'], ['BouncedMessageID'],
            ['msg_id'], ['smtp-id'], ['sg_message_id'],
            ['message', 'headers', 'message-id'], ['message', 'headers', 'Message-Id'],
            ['email', 'messageId']
        ])?.replace(/^<|>$/g, '');

        const trackingId = getNestedString(entry, [
            ['trackingId'], ['tracking_id'], ['custom_args', 'trackingId'], ['metadata', 'trackingId'], ['mail', 'tracking_id']
        ]);

        const recipientEmail = getNestedString(entry, [
            ['recipientEmail'], ['recipient_email'], ['email'], ['recipient'], ['recipientEmailAddress'],
            ['Email'], ['email_address'], ['rcptTo'], ['message', 'rcpt_to'], ['envelope', 'to']
        ])?.toLowerCase();

        const emailAccountId = getNestedString(entry, [
            ['emailAccountId'], ['email_account_id'], ['custom_args', 'emailAccountId'], ['metadata', 'emailAccountId']
        ]);

        const reason = getNestedString(entry, [
            ['reason'], ['description'], ['details'], ['error'], ['diagnosticCode'], ['DiagnosticCode'], ['bounce', 'description']
        ]);

        if ([emailAccountId, messageId, trackingId].some(value => value && value.length > 256) || reason && reason.length > 2000 || recipientEmail && recipientEmail.length > 320) throw new Error('Delivery event field exceeds limit');
        return [{ emailAccountId, eventType, reason, messageId, trackingId, recipientEmail }];
    });
}

export async function authenticateRelayEmailAccount(
    relayKey: string | undefined,
    emailAccountId?: string
) {
    if (!relayKey) return null;
    const matches = (secret: string) => { const left = Buffer.from(secret); const right = Buffer.from(relayKey); return left.length === right.length && timingSafeEqual(left, right); };
    if (emailAccountId) {
        const account = await prisma.emailAccount.findUnique({ where: { id: emailAccountId } });
        if (account?.relayApiKey) {
            try {
                if (matches(decrypt(account.relayApiKey))) return account;
            } catch (error) {
                Logger.warn('Failed to decrypt relay API key during webhook auth', { emailAccountId, error });
            }
        }
        return null;
    }
    const accounts = await prisma.emailAccount.findMany({ where: { relayApiKey: { not: null } }, take: 1001 });
    if (accounts.length > 1000) return null;
    let matched: typeof accounts[number] | null = null;
    for (const account of accounts) {
        try {
            if (account.relayApiKey && matches(decrypt(account.relayApiKey))) { if (matched) return null; matched = account; }
        } catch (error) {
            Logger.warn('Failed to decrypt relay API key during webhook auth scan', { emailAccountId: account.id, error });
        }
    }
    return matched;
}

export async function applyDeliveryEventToLog(params: {
    logId: string;
    accountId: string;
    eventType: DeliveryEventType;
    reason?: string;
}) {
    if (typeof params.accountId !== 'string' || !params.accountId.trim() || typeof params.logId !== 'string' || !params.logId.trim() || !['BOUNCE', 'COMPLAINT', 'SOFT_BOUNCE', 'DELIVERY_FAILURE'].includes(params.eventType) || params.reason !== undefined && (typeof params.reason !== 'string' || params.reason.length > 2000)) throw new Error('Invalid delivery event');
    return prisma.$transaction(async tx => {
    // Account-level serialization also protects suppression precedence across different sends.
    await tx.$queryRaw`SELECT id FROM "Account" WHERE id = ${params.accountId} FOR NO KEY UPDATE`;
    const log = await tx.emailLog.findFirst({
        where: { id: params.logId, accountId: params.accountId }
    });
    if (!log) return null;

    if (params.eventType === 'BOUNCE') {
        const settings = await tx.emailSettings.findUnique({
            where: { accountId: params.accountId },
            select: { bounceTrackingEnabled: true }
        });

        if (!settings?.bounceTrackingEnabled) {
            Logger.info('Ignoring bounce delivery event because bounce tracking is disabled', {
                accountId: params.accountId,
                emailLogId: log.id,
                recipientEmail: log.to,
            });
            return { ...log, deliveryEventApplied: false, deliveryEventReason: 'BOUNCE_TRACKING_DISABLED' };
        }
    }

    const existingEvent = await tx.messageTrackingEvent.findFirst({
        where: { emailLogId: log.id, eventType: params.eventType },
        select: { id: true }
    });
    if (!existingEvent) {
        await tx.messageTrackingEvent.create({
            data: { emailLogId: log.id, eventType: params.eventType }
        });
    }
    if (params.eventType === 'SOFT_BOUNCE' || params.eventType === 'DELIVERY_FAILURE') return { ...log, deliveryEventApplied: false, deliveryEventReason: 'TEMPORARY_OR_UNCLASSIFIED_FAILURE_RECORDED' };

    const suppressionScope = 'ALL';
    const suppressionReason = params.reason?.trim()
        || (params.eventType === 'COMPLAINT' ? 'Marked as spam complaint' : 'Marked as email bounce');
    const contactStatus = params.eventType === 'COMPLAINT' ? 'COMPLAINT' : 'BOUNCED';

    const previous = await tx.emailUnsubscribe.findUnique({ where: { accountId_email: { accountId: params.accountId, email: log.to.toLowerCase() } } });
    const keepComplaint = previous?.contactStatus === 'COMPLAINT';
    await tx.emailUnsubscribe.upsert({
        where: { accountId_email: { accountId: params.accountId, email: log.to.toLowerCase() } },
        create: { accountId: params.accountId, email: log.to.toLowerCase(), scope: suppressionScope, reason: suppressionReason, contactStatus },
        update: { scope: suppressionScope, ...(keepComplaint ? {} : { reason: suppressionReason, contactStatus }) }
    });

    const nextStatus = params.eventType === 'COMPLAINT' || log.status === 'COMPLAINED' ? 'COMPLAINED' : 'BOUNCED';
    const updatedLog = await tx.emailLog.update({
        where: { id: log.id },
        data: { status: nextStatus, canRetry: false, errorMessage: suppressionReason }
    });
    return { ...updatedLog, deliveryEventApplied: true, deliveryEventReason: existingEvent ? 'ALREADY_RECORDED' : 'APPLIED' };
    });
}
