import { prisma } from '../utils/prisma';
import { marketingPressureConfig } from '../utils/marketingExperiment';

export class EmailDeferredError extends Error {
    constructor(public readonly retryAt: Date) {
        super('Email sending deferred until account capacity is available');
    }
}

export class MarketingContactCapError extends Error {
    constructor() { super('Contact marketing pressure cap reached'); }
}

/** SMTP cannot guarantee exactly-once delivery after an interrupted DATA exchange. */
export function classifySendFailure(error: any): { status: string; canRetry: boolean } {
    if (error.deliveryUnknown) return { status: 'UNKNOWN', canRetry: false };
    const responseCode = Number(error.responseCode);
    if (responseCode >= 400 && responseCode < 500) return { status: 'FAILED', canRetry: true };
    if (responseCode >= 500) return { status: 'FAILED', canRetry: false };
    if (['EDNS', 'EAI_AGAIN', 'ECONNREFUSED'].includes(error.code) ||
        (error.code === 'ETIMEDOUT' && ['CONN', 'EHLO', 'HELO', 'STARTTLS', 'AUTH'].includes(error.command))) {
        return { status: 'FAILED', canRetry: true };
    }
    if (['EAUTH', 'EENVELOPE', 'EMESSAGE', 'ESTREAM'].includes(error.code)) {
        return { status: 'FAILED', canRetry: false };
    }
    return { status: 'UNKNOWN', canRetry: false };
}

/** Serialize reservations across all processes, not just this worker. Count attempts
 * conservatively: an interrupted transport may already have accepted the message. */
export async function reserveEmailSend(accountId: string, logId: string, marketing: boolean): Promise<Date | null> {
    const result = await prisma.$transaction(async (tx) => {
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`email-send:${accountId}`}, 0))`;
        const log = await tx.emailLog.findFirst({ where: { id: logId, accountId } });
        if (!log || !['QUEUED', 'PENDING_RETRY'].includes(log.status)) {
            throw new Error('Email send is already claimed or completed');
        }
        const now = new Date();
        if (marketing) {
            if (['AUTOMATION', 'CAMPAIGN'].includes(log.source || '')) {
                const cap = marketingPressureConfig();
                const windowStart = new Date(now.getTime() - cap.windowHours * 3600000);
                const where = {
                    accountId, id: { not: logId }, to: { equals: log.to, mode: 'insensitive' as const },
                    source: { in: ['AUTOMATION', 'CAMPAIGN'] }, status: { in: ['SENDING', 'UNKNOWN', 'SUCCESS', 'RETRIED', 'BOUNCED', 'COMPLAINED'] },
                    lastAttemptAt: { gte: windowStart },
                    emailPayload: { path: ['category'], equals: 'MARKETING' },
                };
                // Same account advisory lock as capacity reservations: simultaneous
                // campaigns cannot both consume the final per-contact slot.
                const used = await tx.emailLog.count({ where });
                if (used >= cap.maxPerWindow) {
                    await tx.emailLog.update({ where: { id: logId }, data: { status: 'SKIPPED', canRetry: false, errorMessage: 'Contact marketing pressure cap reached' } });
                    return 'CONTACT_CAPPED' as const;
                }
            }
            const settings = await tx.emailSettings.upsert({
                where: { accountId }, update: {},
                create: { accountId, bounceTrackingEnabled: false, maxSendPerSecond: 1, maxSendPerDay: 6000 }
            });
            const dayStart = new Date(now);
            dayStart.setUTCHours(0, 0, 0, 0);
            const sentToday = await tx.emailSendAttempt.count({ where: { accountId, createdAt: { gte: dayStart } } });
            if (sentToday >= settings.maxSendPerDay) return new Date(dayStart.getTime() + 86_400_000);
            const recent = await tx.emailSendAttempt.count({ where: { accountId, createdAt: { gt: new Date(now.getTime() - 1000) } } });
            if (recent >= settings.maxSendPerSecond) return new Date(now.getTime() + 1000);
        }
        await tx.emailLog.update({ where: { id: logId }, data: { status: 'SENDING', canRetry: false, lastAttemptAt: now } });
        await tx.emailSendAttempt.create({ data: { accountId, emailLogId: logId, createdAt: now } });
        return null;
    });
    // Throw only after committing the skipped status. This is not an account
    // capacity deferral and must not stall the campaign's other recipients.
    if (result === 'CONTACT_CAPPED') throw new MarketingContactCapError();
    return result;
}
