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

        const dueMessages = await prisma.message.findMany({
            where: {
                scheduledFor: { lte: now, not: null },
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
        const emailMessages = dueMessages.filter(m => m.conversation.channel === 'EMAIL');
        const uniqueAccountIds = [...new Set(emailMessages.map(m => m.conversation.accountId))];
        await Promise.all(uniqueAccountIds.map(async (aid) => {
            const account = await getDefaultEmailAccount(aid);
            emailAccountCache.set(aid, account);
        }));

        for (const message of dueMessages) {
            try {
                let shouldClearSchedule = false;

                if (message.conversation.channel === 'EMAIL') {
                    const emailService = await this.getEmailService();

                    const recipientEmail = message.conversation.wooCustomer?.email
                        || message.conversation.guestEmail;

                    if (!recipientEmail) {
                        Logger.warn('[Scheduler] Skipping scheduled message with no recipient email', {
                            messageId: message.id,
                            conversationId: message.conversationId
                        });
                        continue;
                    }

                    const emailAccount = emailAccountCache.get(message.conversation.accountId);
                    if (!emailAccount) {
                        Logger.warn('[Scheduler] Skipping scheduled message with no sending account', {
                            messageId: message.id,
                            accountId: message.conversation.accountId
                        });
                        continue;
                    }

                    const attachments = message.attachmentPaths
                        ? (message.attachmentPaths as Array<{ filename: string; path: string; contentType: string }>)
                        : undefined;

                    const subject = message.conversation.title
                        ? (message.conversation.title.startsWith('Re:') ? message.conversation.title : `Re: ${message.conversation.title}`)
                        : 'Re: Conversation';

                    await emailService.sendEmail(
                        message.conversation.accountId,
                        emailAccount.id,
                        recipientEmail,
                        subject,
                        message.content,
                        attachments
                    );

                    Logger.info(`[Scheduler] Sent scheduled message ${message.id}`, {
                        attachmentCount: attachments?.length || 0
                    });
                    shouldClearSchedule = true;
                } else {
                    shouldClearSchedule = true;
                }

                if (shouldClearSchedule) {
                    await prisma.message.update({
                        where: { id: message.id },
                        data: { scheduledFor: null, attachmentPaths: null },
                    });
                }

            } catch (error) {
                Logger.error(`[Scheduler] Failed to send scheduled message ${message.id}`, { error });
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

