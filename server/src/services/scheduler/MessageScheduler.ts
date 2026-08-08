/**
 * Message Scheduler
 * 
 * Handles all messaging-related scheduling:
 * - Scheduled message processing (1 min)
 * - Snoozed conversation checks (1 min)
 * - Email polling (2 min)
 */
import { Logger } from '../../utils/logger';
import { prisma } from '../../utils/prisma';
import { resolveScheduledAttachments } from './ScheduledAttachmentResolver';

const SAFE_SCHEDULED_DELIVERY_ERROR = 'Scheduled delivery to customer failed';
const UNSUPPORTED_SCHEDULED_CHANNEL_ERROR = 'Scheduled delivery is not supported for this channel';
const DELIVERY_CLAIM_LEASE_MS = 5 * 60 * 1000;

export class MessageScheduler {
    private static emailPollingInterval: NodeJS.Timeout | null = null;
    private static scheduledMsgInterval: NodeJS.Timeout | null = null;
    private static snoozeCheckInterval: NodeJS.Timeout | null = null;

    /**
     * Why lazy singleton: creating new EmailService() every 2-min poll cycle
     * leaked IMAP/SMTP transport handles that weren't fully GC'd.
     */
    private static emailServiceInstance: InstanceType<typeof import('../EmailService').EmailService> | null = null;

    /** Returns a shared EmailService, creating it lazily on first use. */
    private static async getEmailService() {
        if (!this.emailServiceInstance) {
            const { EmailService } = await import('../EmailService');
            this.emailServiceInstance = new EmailService();
        }
        return this.emailServiceInstance;
    }

    /**
     * Start all message-related tickers
     */
    static start() {
        // Defensive: avoid duplicate intervals if start() is called more than once.
        this.stop();

        // Email Polling (every 2 minutes)
        Logger.info('[Email Polling] Starting immediate email check on startup');
        this.pollEmails();
        this.emailPollingInterval = setInterval(() => this.pollEmails(), 2 * 60 * 1000);

        // Scheduled Messages (every minute)
        this.scheduledMsgInterval = setInterval(
            () => this.processScheduledMessages().catch(e => Logger.error('Scheduled Message Error', { error: e })),
            60 * 1000
        );

        // Snooze Reminder (every minute)
        this.snoozeCheckInterval = setInterval(
            () => this.checkSnoozedConversations().catch(e => Logger.error('Snooze Check Error', { error: e })),
            60 * 1000
        );
    }

    /**
     * Stop all message-related tickers and release singleton references.
     */
    static stop() {
        if (this.emailPollingInterval) {
            clearInterval(this.emailPollingInterval);
            this.emailPollingInterval = null;
        }

        if (this.scheduledMsgInterval) {
            clearInterval(this.scheduledMsgInterval);
            this.scheduledMsgInterval = null;
        }

        if (this.snoozeCheckInterval) {
            clearInterval(this.snoozeCheckInterval);
            this.snoozeCheckInterval = null;
        }

        this.emailServiceInstance = null;
    }

    /**
     * Poll email accounts for new messages
     */
    private static async pollEmails() {
        try {
            const accounts = await prisma.emailAccount.findMany({ where: { imapEnabled: true } });
            Logger.info(`[Email Polling] Starting check - found ${accounts.length} IMAP-enabled account(s)`);

            if (accounts.length > 0) {
                const emailService = await this.getEmailService();

                const results = await Promise.allSettled(
                    accounts.map(async (acc) => {
                        await emailService.checkEmails(acc.id);
                        return acc.email;
                    })
                );

                for (let i = 0; i < results.length; i++) {
                    const result = results[i];
                    const email = accounts[i].email;
                    if (result.status === 'fulfilled') {
                        Logger.info(`[Email Polling] Checked account: ${email}`);
                    } else {
                        Logger.error(`[Email Polling] Failed to check account: ${email}`, { error: result.reason });
                    }
                }
            }
        } catch (error) {
            Logger.error('Email Polling Error', { error });
        }
    }

    /**
     * Process scheduled messages that are due to be sent.
     */
    private static async processScheduledMessages() {
        const now = new Date();
        const staleClaimBefore = new Date(now.getTime() - DELIVERY_CLAIM_LEASE_MS);

        const dueMessages = await prisma.message.findMany({
            where: {
                scheduledFor: { lte: now, not: null },
                OR: [
                    { providerMessageId: { not: null } },
                    { deliveryStatus: { not: 'PENDING' } },
                    { deliveryStatus: 'PENDING', deliveryAttemptedAt: null },
                    { deliveryStatus: 'PENDING', deliveryAttemptedAt: { lte: staleClaimBefore } },
                ],
            },
            include: {
                conversation: {
                    include: {
                        account: true,
                        wooCustomer: true,
                    },
                },
            },
            take: 50,
        });

        if (dueMessages.length === 0) return;

        Logger.info(`[Scheduler] Processing ${dueMessages.length} scheduled message(s)`);

        // Pre-fetch email accounts once per accountId to avoid N repeated DB lookups.
        // Why: getDefaultEmailAccount queries the DB each call; messages for the same
        // account would hit the DB once per message without this cache.
        const { getDefaultEmailAccount } = await import('../../utils/getDefaultEmailAccount');
        const emailAccountCache = new Map<string, any>();
        const emailMessages = dueMessages.filter(m => !m.isInternal && m.conversation.channel === 'EMAIL');
        const uniqueAccountIds = [...new Set(emailMessages.map(m => m.conversation.accountId))];
        await Promise.all(uniqueAccountIds.map(async (aid) => {
            const account = await getDefaultEmailAccount(aid);
            emailAccountCache.set(aid, account);
        }));

        for (const message of dueMessages) {
            // A provider acknowledgement is durable before schedule cleanup. Recover cleanup
            // without contacting the provider again if a previous finalization failed.
            if (message.providerMessageId) {
                try {
                    await prisma.message.updateMany({
                        where: {
                            id: message.id,
                            scheduledFor: { lte: now, not: null },
                            providerMessageId: message.providerMessageId,
                        },
                        data: { scheduledFor: null, attachmentPaths: null },
                    });
                } catch (error) {
                    Logger.error(`[Scheduler] Failed to finalize delivered scheduled message ${message.id}`, { error });
                }
                continue;
            }

            const attemptedAt = new Date();
            const claimed = await prisma.message.updateMany({
                where: {
                    id: message.id,
                    scheduledFor: { lte: now, not: null },
                    providerMessageId: null,
                    OR: [
                        { deliveryStatus: { not: 'PENDING' } },
                        { deliveryStatus: 'PENDING', deliveryAttemptedAt: null },
                        { deliveryStatus: 'PENDING', deliveryAttemptedAt: { lte: staleClaimBefore } },
                    ],
                },
                data: {
                    deliveryStatus: 'PENDING',
                    deliveryChannel: message.conversation.channel,
                    deliveryProvider: null,
                    providerMessageId: null,
                    deliveryError: null,
                    deliveryAttemptedAt: attemptedAt,
                    deliveredAt: null,
                },
            });

            if (claimed.count === 0) continue;

            if (message.isInternal) {
                try {
                    await prisma.message.update({
                        where: { id: message.id },
                        data: {
                            scheduledFor: null,
                            deliveryStatus: 'SENT',
                            deliveryChannel: null,
                            deliveryProvider: null,
                            deliveryError: null,
                            deliveredAt: new Date(),
                            attachmentPaths: null,
                        },
                    });
                } catch (error) {
                    Logger.error(`[Scheduler] Failed to finalize scheduled internal note ${message.id}`, { error });
                }
                continue;
            }

            let providerSucceeded = false;
            try {
                if (message.conversation.channel === 'EMAIL') {
                    const emailService = await this.getEmailService();

                    const recipientEmail = message.conversation.wooCustomer?.email
                        || message.conversation.guestEmail;

                    if (!recipientEmail) {
                        throw new Error('Scheduled email recipient is unavailable');
                    }

                    const emailAccount = emailAccountCache.get(message.conversation.accountId);
                    if (!emailAccount) {
                        throw new Error('Scheduled email sender account is unavailable');
                    }

                    const attachments = message.attachmentPaths
                        ? (await resolveScheduledAttachments(
                            message.attachmentPaths,
                            message.conversation.accountId,
                        )).attachments
                        : undefined;

                    const subject = message.conversation.title
                        ? (message.conversation.title.startsWith('Re:') ? message.conversation.title : `Re: ${message.conversation.title}`)
                        : 'Re: Conversation';

                    const result = await emailService.sendEmail(
                        message.conversation.accountId,
                        emailAccount.id,
                        recipientEmail,
                        subject,
                        message.content,
                        attachments,
                        { category: 'TRANSACTIONAL' }
                    );

                    const providerMessageId = result && typeof result === 'object' && 'messageId' in result
                        && typeof result.messageId === 'string' && result.messageId
                        ? result.messageId
                        : null;
                    if (!providerMessageId) {
                        throw new Error('Email provider did not confirm scheduled delivery');
                    }
                    providerSucceeded = true;

                    // First persist a non-redeliverable provider acknowledgement. Schedule
                    // cleanup is deliberately separate so it can be safely recovered.
                    const sentData = {
                        deliveryStatus: 'SENT' as const,
                        deliveryProvider: 'EMAIL',
                        providerMessageId,
                        deliveryError: null,
                        deliveredAt: new Date(),
                    };
                    try {
                        await prisma.message.update({
                            where: { id: message.id },
                            data: sentData,
                        });
                    } catch (error) {
                        Logger.error(`[Scheduler] Failed to persist provider acknowledgement for scheduled message ${message.id}`, { error });
                        const persisted = await prisma.message.updateMany({
                            where: {
                                id: message.id,
                                OR: [
                                    {
                                        deliveryStatus: 'PENDING',
                                        deliveryAttemptedAt: attemptedAt,
                                        providerMessageId: null,
                                    },
                                    { deliveryStatus: 'SENT', providerMessageId },
                                ],
                            },
                            data: sentData,
                        });
                        if (persisted.count === 0) throw error;
                    }

                    try {
                        await prisma.message.update({
                            where: { id: message.id },
                            data: { scheduledFor: null, attachmentPaths: null },
                        });
                        Logger.info(`[Scheduler] Sent scheduled message ${message.id}`, {
                            attachmentCount: attachments?.length || 0
                        });
                    } catch (error) {
                        Logger.error(`[Scheduler] Provider delivered scheduled message ${message.id}, but finalization failed`, { error });
                    }
                } else {
                    throw new Error(UNSUPPORTED_SCHEDULED_CHANNEL_ERROR);
                }
            } catch (error) {
                if (providerSucceeded) {
                    Logger.error(`[Scheduler] Provider delivered scheduled message ${message.id}; acknowledgement remains claimed for recovery`, { error });
                    continue;
                }
                Logger.error(`[Scheduler] Failed to send scheduled message ${message.id}`, { error });
                await prisma.message.update({
                    where: { id: message.id },
                    data: {
                        scheduledFor: null,
                        deliveryStatus: 'FAILED',
                        deliveryError: message.conversation.channel === 'EMAIL'
                            ? SAFE_SCHEDULED_DELIVERY_ERROR
                            : UNSUPPORTED_SCHEDULED_CHANNEL_ERROR,
                    },
                });
            }
        }
    }

    /**
     * Check for snoozed conversations that should be reopened.
     */
    private static async checkSnoozedConversations() {
        const now = new Date();

        const expiredSnoozes = await prisma.conversation.findMany({
            where: {
                status: 'SNOOZED',
                snoozedUntil: { lte: now, not: null },
            },
            include: {
                assignee: true,
                wooCustomer: true,
            },
            take: 50,
        });

        if (expiredSnoozes.length === 0) return;

        Logger.info(`[Scheduler] Reopening ${expiredSnoozes.length} snoozed conversation(s)`);

        const { getIO } = await import('../../socket');
        const io = getIO();

        // All expired conversations get identical values — one updateMany replaces N updates
        // Why: avoids a separate conversation.update() per row inside the loop (N+1)
        try {
            await prisma.conversation.updateMany({
                where: { id: { in: expiredSnoozes.map(c => c.id) } },
                data: { status: 'OPEN', snoozedUntil: null },
            });
            Logger.info(`[Scheduler] Reopened ${expiredSnoozes.length} snoozed conversation(s)`);
        } catch (error) {
            Logger.error('[Scheduler] Failed to bulk-reopen snoozed conversations', { error });
            return;
        }

        // Socket emits are in-process (no DB) — loop is fine
        if (io) {
            for (const conversation of expiredSnoozes) {
                const customerName = conversation.wooCustomer
                    ? `${conversation.wooCustomer.firstName || ''} ${conversation.wooCustomer.lastName || ''}`.trim()
                    : conversation.guestName || conversation.guestEmail || 'Unknown';

                io.to(`account:${conversation.accountId}`).emit('snooze:expired', {
                    conversationId: conversation.id,
                    assignedToId: conversation.assignedTo,
                    customerName,
                });

                io.to(`conversation:${conversation.id}`).emit('conversation:updated', {
                    id: conversation.id,
                    status: 'OPEN',
                    snoozedUntil: null,
                });
            }
        }
    }
}
