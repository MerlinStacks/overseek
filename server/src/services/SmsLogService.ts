import { prisma } from '../utils/prisma';
import { Logger } from '../utils/logger';

export interface SmsLogContext {
    source?: 'INBOX' | 'MANUAL' | 'AUTOMATION';
    sourceId?: string;
}

interface SmsLogInput extends SmsLogContext {
    accountId: string;
    to: string;
    from?: string;
    body: string;
    status: string;
    errorMessage?: string;
    errorCode?: string | number;
    messageId?: string;
    segments?: string | number;
    price?: string;
    priceUnit?: string;
}

export async function recordSmsLog(input: SmsLogInput): Promise<void> {
    try {
        const parsedSegments = input.segments == null ? undefined : Number.parseInt(String(input.segments), 10);
        await prisma.smsLog.create({
            data: {
                accountId: input.accountId,
                to: input.to,
                from: input.from,
                body: input.body,
                status: input.status.toUpperCase(),
                errorMessage: input.errorMessage,
                errorCode: input.errorCode == null ? undefined : String(input.errorCode),
                source: input.source,
                sourceId: input.sourceId,
                messageId: input.messageId,
                segments: Number.isFinite(parsedSegments) ? parsedSegments : undefined,
                price: input.price,
                priceUnit: input.priceUnit,
                statusAt: new Date()
            }
        });
    } catch (error) {
        // Logging must not turn a successful Twilio request into a failed send.
        Logger.error('Failed to persist SMS log', { error, accountId: input.accountId, messageId: input.messageId });
    }
}
