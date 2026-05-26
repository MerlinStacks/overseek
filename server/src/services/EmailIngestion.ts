/**
 * Email Ingestion Service
 * 
 * Handles incoming emails from IMAP.
 * Uses conversation resolution: threading → subject fallback → create new.
 */

import { prisma } from '../utils/prisma';
import { Logger } from '../utils/logger';
import { Server } from 'socket.io';
import { BlockedContactService } from './BlockedContactService';
import { EventBus, EVENTS } from './events';
import { EmailService } from './EmailService';
import { invalidateCache } from '../utils/cache';

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
    attachments?: Array<{ filename: string; url: string; type: string }>;
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
        const { emailAccountId, fromEmail, fromName, subject, body, html, messageId, inReplyTo, references, attachments } = emailData;

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

        // LOOP PREVENTION: Skip emails from our own email accounts
        const ownEmailAccounts = await prisma.emailAccount.findMany({
            where: { accountId },
            select: { email: true }
        });
        const ownEmails = ownEmailAccounts.map(a => a.email.toLowerCase());
        if (ownEmails.includes(fromEmail.toLowerCase())) {
            Logger.info('[EmailIngestion] Skipping email from own account (loop prevention)', { fromEmail });
            return;
        }

        // Check if sender is blocked
        const isBlocked = await BlockedContactService.isBlocked(accountId, fromEmail);

        // IDEMPOTENCY CHECK: Skip if message already exists
        const existingMessage = await prisma.message.findFirst({
            where: { emailMessageId: messageId }
        });

        if (existingMessage) {
            Logger.info('[EmailIngestion] Skipping duplicate email', { messageId });
            return;
        }

        let conversation = await this.resolveConversation(accountId, fromEmail, fromName, subject, inReplyTo, references);

        // Add message with emailMessageId (even for blocked contacts, for audit trail)
        // Prefer HTML if available, otherwise use text body
        let contentBody = html || body;

        // Append attachments if present
        if (attachments && attachments.length > 0) {
            const attachmentLinks = attachments.map(a => `[Attachment: ${a.filename}](${a.url})`).join('\n');
            contentBody += `\n\n${attachmentLinks}`;
        }

        const message = await prisma.message.create({
            data: {
                conversationId: conversation.id,
                content: `Subject: ${subject}\n\n${contentBody}`,
                senderType: 'CUSTOMER',
                emailMessageId: messageId
            }
        });

        if (isBlocked) {
            // Store for audit, but keep blocked contact activity out of the inbox UI.
            await prisma.conversation.update({
                where: { id: conversation.id },
                data: { updatedAt: new Date() }
            });
            Logger.info('[EmailIngestion] Blocked sender, imported without inbox update', { fromEmail, conversationId: conversation.id });
            await invalidateCache('inbox', `conversations:${accountId}`);
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

        // Invalidate conversation list cache so inbox shows new email immediately
        await invalidateCache('inbox', `conversations:${accountId}`);

        // Auto-reply and push (only for non-blocked contacts)
        await this.handleAutoReply(conversation, fromEmail, subject, messageId, emailAccountId);

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

    /**
     * Extract a clean title from email subject, stripping Re:/Fwd: prefixes.
     */
    private cleanSubjectForTitle(subject: string): string {
        return subject.replace(/^(re:|fwd:|fw:)\s*/gi, '').trim();
    }

    /**
     * Ensure inbound email senders have a customer profile.
     * New profiles are created as marketing-unsubscribed by default.
     */
    private async ensureInboundEmailCustomerProfile(accountId: string, fromEmail: string, fromName?: string) {
        const normalizedEmail = fromEmail.toLowerCase().trim();

        const existingCustomer = await prisma.wooCustomer.findFirst({
            where: { accountId, email: normalizedEmail }
        });

        if (existingCustomer) {
            return existingCustomer;
        }

        const nameParts = (fromName || '').trim().split(/\s+/).filter(Boolean);
        const firstName = nameParts.length > 0 ? nameParts[0] : null;
        const lastName = nameParts.length > 1 ? nameParts.slice(1).join(' ') : null;

        let createdCustomer: Awaited<ReturnType<typeof prisma.wooCustomer.create>> | null = null;

        // Use negative wooIds for inbox-only contacts to avoid collisions with real Woo IDs.
        for (let attempt = 0; attempt < 3; attempt++) {
            const minSynthetic = await prisma.wooCustomer.aggregate({
                where: { accountId, wooId: { lt: 0 } },
                _min: { wooId: true }
            });

            const nextSyntheticWooId = (minSynthetic._min.wooId ?? 0) - 1;

            try {
                createdCustomer = await prisma.wooCustomer.create({
                    data: {
                        accountId,
                        wooId: nextSyntheticWooId,
                        email: normalizedEmail,
                        firstName,
                        lastName,
                        totalSpent: 0,
                        ordersCount: 0,
                        rawData: {
                            source: 'INBOX_EMAIL',
                            importedAt: new Date().toISOString(),
                            marketingSubscribed: false
                        }
                    }
                });
                break;
            } catch (error: any) {
                if (error?.code !== 'P2002' || attempt === 2) {
                    throw error;
                }
            }
        }

        if (!createdCustomer) {
            return null;
        }

        await prisma.emailUnsubscribe.upsert({
            where: { accountId_email: { accountId, email: normalizedEmail } },
            create: {
                accountId,
                email: normalizedEmail,
                scope: 'MARKETING',
                reason: 'Auto-unsubscribed: inbound inbox sender without prior customer profile'
            },
            update: {
                scope: 'MARKETING'
            }
        });

        Logger.info('[EmailIngestion] Created inbox customer profile as unsubscribed', {
            accountId,
            customerId: createdCustomer.id,
            email: normalizedEmail
        });

        return createdCustomer;
    }

    private async resolveConversation(accountId: string, fromEmail: string, fromName?: string, subject?: string, inReplyTo?: string | null, references?: string | null) {
        const cleanTitle = subject ? this.cleanSubjectForTitle(subject) : undefined;
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
                    const conv = matchedMessage.conversation;
                    const updates: any = {};
                    // Backfill guestName if missing but now available from email
                    if (conv.guestEmail && !conv.guestName && fromName) {
                        updates.guestName = fromName;
                    }
                    // Backfill title if missing
                    if (!conv.title && cleanTitle) {
                        updates.title = cleanTitle;
                    }
                    if (Object.keys(updates).length > 0) {
                        await prisma.conversation.update({ where: { id: conv.id }, data: updates });
                        Logger.info('[EmailIngestion] Backfilled fields via threading match', {
                            conversationId: conv.id,
                            ...updates
                        });
                    }
                    Logger.info('[EmailIngestion] Matched by threading', { conversationId: conv.id });
                    return conv;
                }

                // Fallback: outbound SMTP messageIds are stored in emailLog, not message table.
                // Without this, replies to emails WE sent can't be threaded via In-Reply-To.
                const matchedLog = await prisma.emailLog.findFirst({
                    where: { messageId: { in: threadIds }, accountId }
                });
                if (matchedLog?.sourceId) {
                    const conv = await prisma.conversation.findUnique({
                        where: { id: matchedLog.sourceId }
                    });
                    if (conv && !conv.mergedIntoId) {
                        const updates: any = {};
                        if (conv.guestEmail && !conv.guestName && fromName) {
                            updates.guestName = fromName;
                        }
                        if (!conv.title && cleanTitle) {
                            updates.title = cleanTitle;
                        }
                        if (Object.keys(updates).length > 0) {
                            await prisma.conversation.update({ where: { id: conv.id }, data: updates });
                        }
                        Logger.info('[EmailIngestion] Matched by emailLog threading (outbound reply)', {
                            conversationId: conv.id,
                            matchedMessageId: matchedLog.messageId
                        });
                        return conv;
                    }
                }
            }
        }

        // TIER 1.5: Subject-based matching when headers are missing
        // EDGE CASE FIX: Prevents duplicate conversations when email clients strip threading headers
        // Only matches if: same sender, same clean subject, conversation updated within 7 days
        if (cleanTitle && fromEmail) {
            const SEVEN_DAYS_AGO = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);

            // Look for recent conversations with matching subject from same sender
            const subjectMatchConv = await prisma.conversation.findFirst({
                where: {
                    accountId,
                    channel: 'EMAIL',
                    mergedIntoId: null,
                    title: cleanTitle,
                    updatedAt: { gte: SEVEN_DAYS_AGO },
                    OR: [
                        { guestEmail: fromEmail },
                        { wooCustomer: { email: fromEmail } }
                    ]
                },
                orderBy: { updatedAt: 'desc' }
            });

            if (subjectMatchConv) {
                Logger.info('[EmailIngestion] Matched by subject (fallback for missing headers)', {
                    conversationId: subjectMatchConv.id,
                    subject: cleanTitle,
                    fromEmail
                });
                return subjectMatchConv;
            }
        }

        // TIER 2: Create new conversation.
        // Intentionally do not fall back to sender-email-only matching because
        // that incorrectly merges brand new emails into old threads.
        const customer = await this.ensureInboundEmailCustomerProfile(accountId, fromEmail, fromName);

        const conv = await prisma.conversation.create({
            data: {
                accountId,
                status: 'OPEN',
                channel: 'EMAIL',
                wooCustomerId: customer?.id,
                guestEmail: customer ? undefined : fromEmail,
                guestName: customer ? undefined : fromName || undefined,
                title: cleanTitle || undefined,
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
    private async handleAutoReply(conversation: any, fromEmail: string, originalSubject: string, inReplyToMessageId: string, emailAccountId: string) {
        const config = await prisma.accountFeature.findFirst({
            where: { accountId: conversation.accountId, featureKey: 'CHAT_SETTINGS' }
        });
        if (!config?.isEnabled || !config.config) return;

        const settings = config.config as any;

        // Default business hours: Mon-Fri 9am-5pm if not configured
        const defaultBusinessHours = {
            enabled: true,
            days: {
                mon: { isOpen: true, open: '09:00', close: '17:00' },
                tue: { isOpen: true, open: '09:00', close: '17:00' },
                wed: { isOpen: true, open: '09:00', close: '17:00' },
                thu: { isOpen: true, open: '09:00', close: '17:00' },
                fri: { isOpen: true, open: '09:00', close: '17:00' },
                sat: { isOpen: false },
                sun: { isOpen: false }
            },
            offlineMessage: null // No auto-reply unless explicitly configured
        };

        const businessHours = settings.businessHours?.enabled
            ? settings.businessHours
            : (settings.businessHours === undefined ? defaultBusinessHours : null);

        // Early exit if business hours feature is explicitly disabled
        if (!businessHours) return;

        if (this.isOutsideBusinessHours(businessHours, settings.businessTimezone) && businessHours.offlineMessage) {
            // LOOP PREVENTION: Check if we already sent an auto-reply for this conversation recently (within 5 minutes)
            const recentAutoReply = await prisma.emailLog.findFirst({
                where: {
                    sourceId: conversation.id,
                    source: 'AUTO_REPLY',
                    createdAt: { gte: new Date(Date.now() - 5 * 60 * 1000) } // 5 minutes ago
                }
            });

            if (recentAutoReply) {
                Logger.info('[EmailIngestion] Skipping auto-reply, one was sent recently (loop prevention)', {
                    conversationId: conversation.id,
                    lastAutoReply: recentAutoReply.createdAt
                });
                return;
            }

            // Send actual email reply
            await this.sendOfflineEmailReply(
                conversation.accountId,
                emailAccountId,
                fromEmail,
                originalSubject,
                businessHours.offlineMessage,
                inReplyToMessageId,
                conversation.id
            );

            // Add system message for visibility in inbox (strip HTML for clean display)
            const plainTextMessage = businessHours.offlineMessage
                .replace(/<[^>]*>/g, ' ')
                .replace(/\s+/g, ' ')
                .trim();
            await this.addMessageFn(conversation.id, `[Auto-reply sent] ${plainTextMessage}`, 'SYSTEM');

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
        emailAccountId: string,
        toEmail: string,
        originalSubject: string,
        message: string,
        inReplyToMessageId: string,
        conversationId: string
    ) {
        try {
            // Use the email account that received the email (must have SMTP enabled)
            const emailAccount = await prisma.emailAccount.findUnique({
                where: { id: emailAccountId }
            });

            if (!emailAccount || !emailAccount.smtpEnabled) {
                Logger.info('[EmailIngestion] Receiving email account has no SMTP, skipping auto-reply', { emailAccountId });
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
                    references: inReplyToMessageId,
                    category: 'TRANSACTIONAL'
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
