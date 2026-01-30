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
     * Start all message-related tickers
     */
    static start() {
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
     * Poll email accounts for new messages
     */
    private static async pollEmails() {
        try {
            const accounts = await prisma.emailAccount.findMany({ where: { imapEnabled: true } });
            Logger.info(`[Email Polling] Starting check - found ${accounts.length} IMAP-enabled account(s)`);

            if (accounts.length > 0) {
                const { EmailService } = await import('../EmailService');
                const emailService = new EmailService();

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

        for (const message of dueMessages) {
            try {
                if (message.conversation.channel === 'EMAIL') {
                    const { EmailService } = await import('../EmailService');
                    const emailService = new EmailService();

                    const recipientEmail = message.conversation.wooCustomer?.email
                        || message.conversation.guestEmail;

                    if (recipientEmail) {
                        const { getDefaultEmailAccount } = await import('../../utils/getDefaultEmailAccount');
                        const emailAccount = await getDefaultEmailAccount(message.conversation.accountId);

                        if (emailAccount) {
                            // Parse stored attachments (JSON array of { filename, path, contentType })
                            const attachments = message.attachmentPaths
                                ? (message.attachmentPaths as Array<{ filename: string; path: string; contentType: string }>)
                                : undefined;

                            // Use conversation title for threading
                            const subject = message.conversation.title
                                ? (message.conversation.title.startsWith('Re:') ? message.conversation.title : `Re: ${message.conversation.title}`)
                                : 'Re: Conversation';

                            await emailService.sendEmail(
                                message.conversation.accountId,
                                emailAccount.id,
                                recipientEmail,
                                subject,
                                message.content,
                                attachments // Now passes attachments!
                            );

                            Logger.info(`[Scheduler] Sent scheduled message ${message.id}`, {
                                attachmentCount: attachments?.length || 0
                            });
                        }
                    }
                }

                await prisma.message.update({
                    where: { id: message.id },
                    data: { scheduledFor: null, attachmentPaths: null }, // Clear after sending
                });

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

        for (const conversation of expiredSnoozes) {
            try {
                await prisma.conversation.update({
                    where: { id: conversation.id },
                    data: { status: 'OPEN', snoozedUntil: null },
                });

                if (io) {
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

                Logger.info(`[Scheduler] Reopened snoozed conversation ${conversation.id}`);
            } catch (error) {
                Logger.error(`[Scheduler] Failed to reopen conversation ${conversation.id}`, { error });
            }
        }
    }
}
