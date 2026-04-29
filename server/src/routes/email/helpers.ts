import { prisma } from '../../utils/prisma';
import { Logger } from '../../utils/logger';
import { encrypt, decrypt } from '../../utils/encryption';

export interface NormalizedDeliveryWebhookEntry {
    emailAccountId?: string;
    eventType: 'BOUNCE' | 'COMPLAINT';
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

export function mapRawDeliveryEventType(rawType: string | undefined): 'BOUNCE' | 'COMPLAINT' | null {
    if (!rawType) return null;
    const normalized = rawType.trim().toLowerCase();
    if (['bounce', 'bounced', 'failed', 'dropped', 'reject', 'rejected', 'hard_bounce', 'soft_bounce'].includes(normalized)) {
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
    return candidates.flatMap((candidate) => {
        if (!candidate || typeof candidate !== 'object') return [];
        const entry = candidate as Record<string, unknown>;
        const eventType = mapRawDeliveryEventType(getNestedString(entry, [
            ['eventType'], ['event_type'], ['event'], ['RecordType'], ['type'], ['message_event', 'type']
        ]));
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

        return [{ emailAccountId, eventType, reason, messageId, trackingId, recipientEmail }];
    });
}

export async function authenticateRelayEmailAccount(
    relayKey: string | undefined,
    emailAccountId?: string
) {
    if (!relayKey) return null;
    if (emailAccountId) {
        const account = await prisma.emailAccount.findUnique({ where: { id: emailAccountId } });
        if (account?.relayApiKey) {
            try {
                if (decrypt(account.relayApiKey) === relayKey) return account;
            } catch (error) {
                Logger.warn('Failed to decrypt relay API key during webhook auth', { emailAccountId, error });
            }
        }
        return null;
    }
    const accounts = await prisma.emailAccount.findMany({ where: { relayApiKey: { not: null } } });
    for (const account of accounts) {
        try {
            if (account.relayApiKey && decrypt(account.relayApiKey) === relayKey) return account;
        } catch (error) {
            Logger.warn('Failed to decrypt relay API key during webhook auth scan', { emailAccountId: account.id, error });
        }
    }
    return null;
}

export async function applyDeliveryEventToLog(params: {
    logId: string;
    accountId: string;
    eventType: 'BOUNCE' | 'COMPLAINT';
    reason?: string;
}) {
    const log = await prisma.emailLog.findFirst({
        where: { id: params.logId, accountId: params.accountId }
    });
    if (!log) return null;

    const existingEvent = await prisma.messageTrackingEvent.findFirst({
        where: { emailLogId: log.id, eventType: params.eventType },
        select: { id: true }
    });
    if (!existingEvent) {
        await prisma.messageTrackingEvent.create({
            data: { emailLogId: log.id, eventType: params.eventType }
        });
    }

    const suppressionScope = 'ALL';
    const suppressionReason = params.reason?.trim()
        || (params.eventType === 'COMPLAINT' ? 'Marked as spam complaint' : 'Marked as email bounce');

    await prisma.emailUnsubscribe.upsert({
        where: { accountId_email: { accountId: params.accountId, email: log.to.toLowerCase() } },
        create: { accountId: params.accountId, email: log.to.toLowerCase(), scope: suppressionScope, reason: suppressionReason },
        update: { scope: suppressionScope, reason: suppressionReason }
    });

    const nextStatus = params.eventType === 'COMPLAINT' ? 'COMPLAINED' : 'BOUNCED';
    const updatedLog = await prisma.emailLog.update({
        where: { id: log.id },
        data: { status: nextStatus, canRetry: false, errorMessage: suppressionReason }
    });
    return updatedLog;
}
