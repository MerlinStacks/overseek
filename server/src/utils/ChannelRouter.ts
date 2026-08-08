/**
 * ChannelRouter routes outbound messages to the correct external channel.
 *
 * Why: extracted from messages.ts to DRY the duplicated conversation + email-account
 * lookup pattern shared by `routeMessageToChannel` and `sendEmailWithAttachments`,
 * and to keep messages.ts under 200 lines.
 */

import { prisma } from '../utils/prisma';
import { EmailService } from '../services/EmailService';
import { MetaMessagingService } from '../services/messaging/MetaMessagingService';
import { TikTokMessagingService } from '../services/messaging/TikTokMessagingService';
import { TwilioService } from '../services/TwilioService';
import { Logger } from '../utils/logger';

interface Attachment {
    filename: string;
    path: string;
    contentType: string;
}

export interface DeliveryResult {
    provider: string;
    providerMessageId?: string;
}

const SUPPORTED_CHANNELS = new Set(['EMAIL', 'CHAT', 'FACEBOOK', 'INSTAGRAM', 'TIKTOK', 'SMS']);

export async function validateMessageChannel(
    conversationId: string,
    channel: string,
    accountId: string,
    emailAccountId?: string,
    hasAttachments = false
): Promise<void> {
    if (!SUPPORTED_CHANNELS.has(channel)) throw new Error('Unsupported message channel');

    const conversation = await prisma.conversation.findFirst({
        where: { id: conversationId, accountId },
        include: {
            wooCustomer: true,
            socialAccount: true,
            mergedFrom: { include: { socialAccount: true } }
        }
    });
    if (!conversation) throw new Error('Conversation not found');

    if (hasAttachments && channel !== 'EMAIL') {
        throw new Error('Attachments can only be delivered by email');
    }
    if (channel === 'CHAT') {
        if (!conversation.visitorToken) throw new Error('Chat recipient is unavailable');
        return;
    }
    if (channel === 'EMAIL') {
        if (!conversation.wooCustomer?.email && !conversation.guestEmail) throw new Error('Email recipient is unavailable');
        const emailAccount = await resolveEmailAccount(accountId, emailAccountId);
        if (!emailAccount) throw new Error('Email sender account is unavailable');
        return;
    }
    if (channel === 'FACEBOOK' || channel === 'INSTAGRAM') {
        const direct = conversation.socialAccount?.platform === channel && conversation.externalConversationId;
        const merged = conversation.mergedFrom.some((item) => item.socialAccount?.platform === channel && item.externalConversationId);
        if (!direct && !merged) throw new Error(`${channel} recipient is unavailable`);
        return;
    }
    if (channel === 'TIKTOK') {
        const direct = conversation.socialAccount?.platform === 'TIKTOK' && conversation.externalConversationId;
        const merged = conversation.mergedFrom.some((item) => item.socialAccount?.platform === 'TIKTOK' && item.externalConversationId);
        if (!direct && !merged) throw new Error('TIKTOK recipient is unavailable');
        return;
    }

    let recipient = conversation.channel === 'SMS' ? conversation.externalConversationId : null;
    recipient ||= conversation.mergedFrom.find((item) => item.channel === 'SMS')?.externalConversationId || null;
    const settings = await TwilioService.getSettings(accountId);
    if (!settings?.enabled || !settings.fromNumber) throw new Error('SMS is not configured for this account');
    if (!recipient) {
        const phone = extractWooCustomerPhone(conversation.wooCustomer?.rawData);
        if (phone) recipient = TwilioService.normalizeToE164(phone, settings.fromNumber);
    }
    if (!recipient) throw new Error('SMS recipient is unavailable');
}

/**
 * Resolves the email account to use for sending.
 * Tries the explicit emailAccountId first, falls back to account default.
 */
async function resolveEmailAccount(accountId: string, emailAccountId?: string) {
    if (emailAccountId) {
        const explicit = await prisma.emailAccount.findFirst({
            where: { id: emailAccountId, accountId }
        });
        if (explicit) return explicit;
        throw new Error('Email sender account does not belong to this account');
    }
    const { getDefaultEmailAccount } = await import('../utils/getDefaultEmailAccount');
    return getDefaultEmailAccount(accountId);
}

/**
 * Builds the email subject and body from raw content.
 * Extracts subject line if content starts with "Subject:".
 */
function parseEmailContent(content: string, conversationTitle?: string | null) {
    let subject = conversationTitle
        ? (conversationTitle.startsWith('Re:') ? conversationTitle : `Re: ${conversationTitle}`)
        : 'Re: Your inquiry';
    let body = content;

    if (content.startsWith('Subject:')) {
        const lines = content.split('\n');
        subject = lines[0].replace('Subject:', '').trim();
        body = lines.slice(2).join('\n');
    }

    return { subject, body };
}

function toPlainText(content: string): string {
    return content
        .replace(/<br\s*\/?\s*>/gi, '\n')
        .replace(/<\/p>/gi, '\n')
        .replace(/<[^>]*>/g, '')
        .replace(/&nbsp;/g, ' ')
        .replace(/&amp;/g, '&')
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .trim();
}

function extractWooCustomerPhone(rawData: unknown): string | null {
    if (!rawData || typeof rawData !== 'object' || Array.isArray(rawData)) return null;
    const record = rawData as Record<string, unknown>;
    const billing = record.billing;
    if (billing && typeof billing === 'object' && !Array.isArray(billing)) {
        const billingPhone = (billing as Record<string, unknown>).phone;
        if (typeof billingPhone === 'string' && billingPhone.trim()) return billingPhone.trim();
    }
    const phone = record.phone;
    if (typeof phone === 'string' && phone.trim()) return phone.trim();
    return null;
}

/**
 * Routes a message to the appropriate external channel (Email, Facebook, Instagram, TikTok, SMS).
 */
export async function routeMessageToChannel(
    conversationId: string,
    content: string,
    channel: string,
    accountId: string,
    emailAccountId?: string
): Promise<DeliveryResult> {
    const conversation = await prisma.conversation.findFirst({
        where: { id: conversationId, accountId },
        include: {
            wooCustomer: true,
            socialAccount: true,
            mergedFrom: { include: { socialAccount: true } }
        }
    });

    if (!conversation) throw new Error('Conversation not found');

    if (channel === 'EMAIL') {
        const recipientEmail = conversation.wooCustomer?.email || conversation.guestEmail;
        if (!recipientEmail) throw new Error('Email recipient is unavailable');

        const emailAccount = await resolveEmailAccount(accountId, emailAccountId);
        if (!emailAccount) throw new Error('Email sender account is unavailable');

        const { subject, body } = parseEmailContent(content, conversation.title);
        const originalEmailLog = await prisma.emailLog.findFirst({
            where: { sourceId: conversation.id, messageId: { not: null } },
            orderBy: { createdAt: 'asc' }
        });

        const emailService = new EmailService();
        const result = await emailService.sendEmail(accountId, emailAccount.id, recipientEmail, subject, body, undefined, {
            source: 'INBOX',
            sourceId: conversation.id,
            inReplyTo: originalEmailLog?.messageId || undefined,
            references: originalEmailLog?.messageId || undefined,
            category: 'TRANSACTIONAL',
            isInboxReply: true
        });
        Logger.info('[ChannelRouter] Email sent', { to: recipientEmail, conversationId });
        return { provider: 'EMAIL', providerMessageId: result.messageId };

    } else if (channel === 'FACEBOOK' || channel === 'INSTAGRAM') {
        let socialAccount = conversation.socialAccount?.platform === channel ? conversation.socialAccount : null;
        let externalId = conversation.externalConversationId;

        if (!socialAccount) {
            const merged = conversation.mergedFrom.find(m => m.socialAccount?.platform === channel);
            socialAccount = merged?.socialAccount || null;
            externalId = merged?.externalConversationId || null;
        }

        if (socialAccount && externalId) {
            const recipientId = externalId.split('_')[0];
            const result = await MetaMessagingService.sendMessage(socialAccount.id, {
                recipientId,
                message: content.replace(/<[^>]*>/g, ''),
                messageType: 'RESPONSE'
            });
            if (result) {
                Logger.info('[ChannelRouter] Meta message sent', { channel, messageId: result.messageId });
                return { provider: 'META', providerMessageId: result.messageId };
            } else throw new Error(`${channel} delivery failed`);
        } else {
            throw new Error(`${channel} recipient is unavailable`);
        }

    } else if (channel === 'TIKTOK') {
        let socialAccount = conversation.socialAccount?.platform === 'TIKTOK' ? conversation.socialAccount : null;
        let externalId = conversation.externalConversationId;

        if (!socialAccount) {
            const merged = conversation.mergedFrom.find(m => m.socialAccount?.platform === 'TIKTOK');
            socialAccount = merged?.socialAccount || null;
            externalId = merged?.externalConversationId || null;
        }

        if (socialAccount && externalId) {
            const recipientOpenId = externalId.split('_')[0];
            const result = await TikTokMessagingService.sendMessage(socialAccount.id, {
                recipientOpenId,
                message: content.replace(/<[^>]*>/g, '')
            });
            if (result) {
                Logger.info('[ChannelRouter] TikTok message sent', { messageId: result.messageId });
                return { provider: 'TIKTOK', providerMessageId: result.messageId };
            } else throw new Error('TIKTOK delivery failed');
        } else {
            throw new Error('TIKTOK recipient is unavailable');
        }

    } else if (channel === 'SMS') {
        let externalId = conversation.channel === 'SMS' ? conversation.externalConversationId : null;

        if (!externalId) {
            const merged = conversation.mergedFrom.find(m => m.channel === 'SMS');
            externalId = merged?.externalConversationId || null;
        }

        if (!externalId) {
            const wooCustomerPhone = extractWooCustomerPhone(conversation.wooCustomer?.rawData);
            if (wooCustomerPhone) {
                const smsSettings = await TwilioService.getSettings(accountId);
                if (smsSettings?.enabled && smsSettings.fromNumber) {
                    try {
                        externalId = TwilioService.normalizeToE164(wooCustomerPhone, smsSettings.fromNumber);
                    } catch {
                        externalId = null;
                    }
                }
            }
        }

        if (externalId) {
            const result = await TwilioService.sendSms(accountId, externalId, toPlainText(content), {
                source: 'INBOX',
                sourceId: conversation.id
            });
            Logger.info('[ChannelRouter] SMS sent', { to: externalId });
            return { provider: 'TWILIO', providerMessageId: result.sid };
        } else throw new Error('SMS recipient is unavailable');
    } else if (channel !== 'CHAT') {
        throw new Error('Unsupported message channel');
    }

    return { provider: 'CHAT' };
}

/**
 * Sends email with attachments for EMAIL channel conversations.
 * Reuses resolveEmailAccount and parseEmailContent to avoid duplication.
 */
export async function sendEmailWithAttachments(
    conversationId: string,
    content: string,
    attachments: Attachment[],
    accountId: string,
    emailAccountId?: string
): Promise<DeliveryResult> {
    const conversation = await prisma.conversation.findFirst({
        where: { id: conversationId, accountId },
        include: { wooCustomer: true }
    });

    if (!conversation) throw new Error('Conversation not found');
    if (conversation.channel !== 'EMAIL') throw new Error('Attachments can only be delivered to email conversations');

    const recipientEmail = conversation.wooCustomer?.email || conversation.guestEmail;
    if (!recipientEmail) throw new Error('Email recipient is unavailable');

    const emailAccount = await resolveEmailAccount(accountId, emailAccountId);
    if (!emailAccount) throw new Error('Email sender account is unavailable');

    const { subject } = parseEmailContent(content, conversation.title);
    const originalEmailLog = await prisma.emailLog.findFirst({
        where: { sourceId: conversation.id, messageId: { not: null } },
        orderBy: { createdAt: 'asc' }
    });

    const emailService = new EmailService();
    const result = await emailService.sendEmail(accountId, emailAccount.id, recipientEmail, subject, content, attachments, {
        source: 'INBOX',
        sourceId: conversation.id,
        inReplyTo: originalEmailLog?.messageId || undefined,
        references: originalEmailLog?.messageId || undefined,
        category: 'TRANSACTIONAL',
        isInboxReply: true
    });

    Logger.info('[ChannelRouter] Email sent with attachments', {
        to: recipientEmail,
        attachmentCount: attachments.length,
        conversationId
    });
    return { provider: 'EMAIL', providerMessageId: result.messageId };
}
