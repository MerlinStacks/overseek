/**
 * Email Ingestion Service
 * 
 * Handles incoming emails from IMAP.
 * Uses three-tier conversation resolution: threading → email match → create new.
 */

import { prisma } from '../utils/prisma';
import { Logger } from '../utils/logger';
import { Server } from 'socket.io';

export interface IncomingEmailData {
    emailAccountId: string;
    fromEmail: string;
    fromName?: string;
    subject: string;
    body: string;
    messageId: string;
    inReplyTo?: string | null;
    references?: string | null;
}

export class EmailIngestion {
    private io: Server;
    private addMessageFn: (conversationId: string, content: string, senderType: 'SYSTEM', senderId?: string, isInternal?: boolean) => Promise<any>;

    constructor(io: Server, addMessageFn: any) {
        this.io = io;
        this.addMessageFn = addMessageFn;
    }

    /**
     * Handle incoming email from IMAP ingestion.
     */
    async handleIncomingEmail(emailData: IncomingEmailData) {
        const { emailAccountId, fromEmail, fromName, subject, body, messageId, inReplyTo, references } = emailData;

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
        let conversation = await this.resolveConversation(accountId, fromEmail, fromName, inReplyTo, references);

        // Reopen if closed
        if (conversation.status !== 'OPEN') {
            await prisma.conversation.update({
                where: { id: conversation.id },
                data: { status: 'OPEN', updatedAt: new Date() }
            });
            Logger.info('[EmailIngestion] Reopened conversation', { conversationId: conversation.id });
        }

        // Add message with emailMessageId
        const message = await prisma.message.create({
            data: {
                conversationId: conversation.id,
                content: `Subject: ${subject}\n\n${body}`,
                senderType: 'CUSTOMER',
                emailMessageId: messageId
            }
        });

        await prisma.conversation.update({
            where: { id: conversation.id },
            data: { updatedAt: new Date() }
        });

        // Socket events
        this.io.to(`conversation:${conversation.id}`).emit('message:new', message);
        this.io.to(`account:${accountId}`).emit('conversation:updated', {
            id: conversation.id,
            lastMessage: message,
            updatedAt: new Date()
        });

        // Auto-reply and push
        await this.handleAutoReply(conversation);
        await this.sendPushNotification(accountId, fromName, fromEmail, subject);

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

    private async handleAutoReply(conversation: any) {
        const config = await prisma.accountFeature.findFirst({
            where: { accountId: conversation.accountId, featureKey: 'CHAT_SETTINGS' }
        });
        if (!config?.isEnabled || !config.config) return;

        const settings = config.config as any;
        if (!settings.businessHours?.enabled) return;

        if (this.isOutsideBusinessHours(settings.businessHours) && settings.businessHours.offlineMessage) {
            await this.addMessageFn(conversation.id, settings.businessHours.offlineMessage, 'SYSTEM');
        }
    }

    private isOutsideBusinessHours(businessHours: any): boolean {
        const days = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];
        const now = new Date();
        const schedule = businessHours.days?.[days[now.getDay()]];
        if (!schedule?.isOpen) return true;
        const time = now.toTimeString().slice(0, 5);
        return time < schedule.open || time > schedule.close;
    }

    private async sendPushNotification(accountId: string, fromName?: string, fromEmail?: string, subject?: string) {
        const { PushNotificationService } = require('./PushNotificationService');
        await PushNotificationService.sendToAccount(accountId, {
            title: '📧 New Email',
            body: `${fromName || fromEmail}: ${subject}`.substring(0, 100),
            data: { url: '/inbox' }
        }, 'message');
    }
}
