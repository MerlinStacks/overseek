import { prisma } from '../utils/prisma';

export class EmailDeferredError extends Error {
    constructor(public readonly retryAt: Date) {
        super('Email sending deferred until account capacity is available');
    }
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
    return prisma.$transaction(async (tx) => {
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`email-send:${accountId}`}, 0))`;
        const log = await tx.emailLog.findFirst({ where: { id: logId, accountId } });
        if (!log || !['QUEUED', 'PENDING_RETRY'].includes(log.status)) {
            throw new Error('Email send is already claimed or completed');
        }
        const now = new Date();
        if (marketing) {
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
}
