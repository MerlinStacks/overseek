/**
 * Email Ingestion Service
 * 
 * Handles incoming emails from IMAP.
 * Uses three-tier conversation resolution: threading → email match → create new.
 */

import { prisma } from '../utils/prisma';
import { Logger } from '../utils/logger';
import { Server } from 'socket.io';
import { BlockedContactService } from './BlockedContactService';
import { EventBus, EVENTS } from './events';
import { EmailService } from './EmailService';

export interface IncomingEmailData {
    emailAccountId: string;
    fromEmail: string;
    fromName?: string;
    subject: string;
    body: string;
    html?: string;
    messageId: string;
    inReplyTo?: string | null;
    references?: string | null;
}

export class EmailIngestion {
    private io: Server;
    private addMessageFn: (conversationId: string, content: string, senderType: 'SYSTEM', senderId?: string, isInternal?: boolean) => Promise<any>;
    private emailService: EmailService;

    constructor(io: Server, addMessageFn: any) {
        this.io = io;
        this.addMessageFn = addMessageFn;
        this.emailService = new EmailService();
    }

    /**
     * Handle incoming email from IMAP ingestion.
     */
    async handleIncomingEmail(emailData: IncomingEmailData) {
        const { emailAccountId, fromEmail, fromName, subject, body, html, messageId, inReplyTo, references } = emailData;

        // Find Account ID
        const emailVars = await prisma.emailAccount.findUnique({
            where: { id: emailAccountId },
            select: { accountId: true }
        });

        if (!emailVars) {
            Logger.error('Email Account not found', { emailAccountId });
            return;
        }

        const accountId = emailVars.accountId;

        // Check if sender is blocked
        const isBlocked = await BlockedContactService.isBlocked(accountId, fromEmail);

        let conversation = await this.resolveConversation(accountId, fromEmail, fromName, inReplyTo, references);

        // Add message with emailMessageId (even for blocked contacts, for audit trail)
        // Prefer HTML if available, otherwise use text body
        const contentBody = html || body;

        const message = await prisma.message.create({
            data: {
                conversationId: conversation.id,
                content: `Subject: ${subject}\n\n${contentBody}`,
                senderType: 'CUSTOMER',
                emailMessageId: messageId
            }
        });

        if (isBlocked) {
            // Auto-resolve without autoreplies or push notifications
            await prisma.conversation.update({
                where: { id: conversation.id },
                data: { status: 'CLOSED', updatedAt: new Date() }
            });
            Logger.info('[EmailIngestion] Blocked sender, auto-resolved', { fromEmail, conversationId: conversation.id });

            // Still emit socket events so UI updates
            this.io.to(`conversation:${conversation.id}`).emit('message:new', message);
            this.io.to(`account:${accountId}`).emit('conversation:updated', {
                id: conversation.id,
                lastMessage: message,
                updatedAt: new Date()
            });
            return;
        }

        // Reopen if closed (only for non-blocked contacts)
        if (conversation.status !== 'OPEN') {
            await prisma.conversation.update({
                where: { id: conversation.id },
                data: { status: 'OPEN', updatedAt: new Date() }
            });
            Logger.info('[EmailIngestion] Reopened conversation', { conversationId: conversation.id });
        } else {
            await prisma.conversation.update({
                where: { id: conversation.id },
                data: { updatedAt: new Date() }
            });
        }

        // Socket events
        this.io.to(`conversation:${conversation.id}`).emit('message:new', message);
        this.io.to(`account:${accountId}`).emit('conversation:updated', {
            id: conversation.id,
            lastMessage: message,
            updatedAt: new Date()
        });

        // Auto-reply and push (only for non-blocked contacts)
        await this.handleAutoReply(conversation, fromEmail, subject, messageId);

        // Emit event for NotificationEngine to handle push
        EventBus.emit(EVENTS.EMAIL.RECEIVED, {
            accountId,
            conversationId: conversation.id,
            fromEmail,
            fromName,
            subject
        });

        Logger.info('[EmailIngestion] Imported email', { fromEmail, conversationId: conversation.id });
    }

    private async resolveConversation(accountId: string, fromEmail: string, fromName?: string, inReplyTo?: string | null, references?: string | null) {
        // TIER 1: Match by threading headers
        if (inReplyTo || references) {
            const threadIds: string[] = [];
            if (inReplyTo) threadIds.push(inReplyTo.trim());
            if (references) {
                const refIds = references.split(/[\s,]+/).filter(id => id.startsWith('<'));
                threadIds.push(...refIds);
            }

            if (threadIds.length > 0) {
                const matchedMessage = await prisma.message.findFirst({
                    where: { emailMessageId: { in: threadIds }, conversation: { accountId } },
                    include: { conversation: true }
                });
                if (matchedMessage) {
                    Logger.info('[EmailIngestion] Matched by threading', { conversationId: matchedMessage.conversation.id });
                    return matchedMessage.conversation;
                }
            }
        }

        // TIER 2: Match by email address
        const customer = await prisma.wooCustomer.findFirst({ where: { accountId, email: fromEmail } });
        if (customer) {
            const conv = await prisma.conversation.findFirst({
                where: { accountId, wooCustomerId: customer.id, mergedIntoId: null },
                orderBy: { updatedAt: 'desc' }
            });
            if (conv) return conv;
        }

        const guestConv = await prisma.conversation.findFirst({
            where: { accountId, guestEmail: fromEmail, mergedIntoId: null },
            orderBy: { updatedAt: 'desc' }
        });
        if (guestConv) return guestConv;

        // TIER 3: Create new
        const newCustomer = await prisma.wooCustomer.findFirst({ where: { accountId, email: fromEmail } });
        const conv = await prisma.conversation.create({
            data: {
                accountId,
                status: 'OPEN',
                channel: 'EMAIL',
                wooCustomerId: newCustomer?.id,
                guestEmail: newCustomer ? undefined : fromEmail,
                guestName: newCustomer ? undefined : fromName || undefined,
                priority: 'MEDIUM'
            }
        });
        Logger.info('[EmailIngestion] Created new conversation', { conversationId: conv.id });
        return conv;
    }

    /**
     * Handle business hours auto-reply for incoming emails.
     * If outside business hours:
     * 1. Sends an actual email reply to the customer
     * 2. Adds a system message to the conversation for visibility
     */
    private async handleAutoReply(conversation: any, fromEmail: string, originalSubject: string, inReplyToMessageId: string) {
        const config = await prisma.accountFeature.findFirst({
            where: { accountId: conversation.accountId, featureKey: 'CHAT_SETTINGS' }
        });
        if (!config?.isEnabled || !config.config) return;

        const settings = config.config as any;
        if (!settings.businessHours?.enabled) return;

        if (this.isOutsideBusinessHours(settings.businessHours, settings.businessTimezone) && settings.businessHours.offlineMessage) {
            // Send actual email reply
            await this.sendOfflineEmailReply(
                conversation.accountId,
                fromEmail,
                originalSubject,
                settings.businessHours.offlineMessage,
                inReplyToMessageId,
                conversation.id
            );

            // Add system message for visibility in inbox
            await this.addMessageFn(conversation.id, `[Auto-reply sent] ${settings.businessHours.offlineMessage}`, 'SYSTEM');

            Logger.info('[EmailIngestion] Sent offline auto-reply email', {
                conversationId: conversation.id,
                to: fromEmail
            });
        }
    }

    /**
     * Send an actual email reply when outside business hours.
     */
    private async sendOfflineEmailReply(
        accountId: string,
        toEmail: string,
        originalSubject: string,
        message: string,
        inReplyToMessageId: string,
        conversationId: string
    ) {
        try {
            // Get default email account for sending
            const emailAccount = await prisma.emailAccount.findFirst({
                where: { accountId, isDefault: true, type: 'SMTP' }
            });

            if (!emailAccount) {
                Logger.warn('[EmailIngestion] No default SMTP account for auto-reply', { accountId });
                return;
            }

            // Build subject with Re: prefix if not already present
            const replySubject = originalSubject.toLowerCase().startsWith('re:')
                ? originalSubject
                : `Re: ${originalSubject}`;

            // Simple HTML email body
            const htmlBody = `
                <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 600px; margin: 0 auto;">
                    <p style="color: #374151; font-size: 15px; line-height: 1.6;">${message.replace(/\n/g, '<br>')}</p>
                    <hr style="border: none; border-top: 1px solid #e5e7eb; margin: 24px 0;">
                    <p style="color: #9ca3af; font-size: 12px;">This is an automated response. We'll get back to you during business hours.</p>
                </div>
            `;

            await this.emailService.sendEmail(
                accountId,
                emailAccount.id,
                toEmail,
                replySubject,
                htmlBody,
                undefined, // no attachments
                {
                    source: 'AUTO_REPLY',
                    sourceId: conversationId,
                    inReplyTo: inReplyToMessageId,
                    references: inReplyToMessageId
                }
            );
        } catch (error: any) {
            Logger.error('[EmailIngestion] Failed to send auto-reply email', {
                accountId,
                toEmail,
                error: error?.message
            });
            // Don't throw - auto-reply failure shouldn't break email ingestion
        }
    }

    private isOutsideBusinessHours(businessHours: any, timezone?: string): boolean {
        const days = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];

        // Use configured timezone or default to Australia/Sydney
        const tz = timezone || 'Australia/Sydney';

        try {
            const now = new Date();
            const options: Intl.DateTimeFormatOptions = {
                timeZone: tz,
                weekday: 'short',
                hour: '2-digit',
                minute: '2-digit',
                hour12: false
            };
            const formatter = new Intl.DateTimeFormat('en-US', options);
            const parts = formatter.formatToParts(now);

            const weekday = parts.find(p => p.type === 'weekday')?.value?.toLowerCase().slice(0, 3) || '';
            const hour = parseInt(parts.find(p => p.type === 'hour')?.value || '0', 10);
            const minute = parseInt(parts.find(p => p.type === 'minute')?.value || '0', 10);

            const schedule = businessHours.days?.[weekday];
            if (!schedule?.isOpen) return true;

            const nowTime = hour * 60 + minute;
            const [openH, openM] = (schedule.open || '09:00').split(':').map(Number);
            const [closeH, closeM] = (schedule.close || '17:00').split(':').map(Number);

            return nowTime < openH * 60 + openM || nowTime > closeH * 60 + closeM;
        } catch (e) {
            Logger.warn('[EmailIngestion] Business hours timezone check failed', { timezone: tz, error: e });
            // Fallback to simple check if timezone not supported
            const now = new Date();
            const schedule = businessHours.days?.[days[now.getDay()]];
            if (!schedule?.isOpen) return true;
            const time = now.toTimeString().slice(0, 5);
            return time < schedule.open || time > schedule.close;
        }
    }
}

