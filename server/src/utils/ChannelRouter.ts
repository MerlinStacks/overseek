/**
 * ChannelRouter — routes outbound messages to the correct external channel.
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

/**
 * Resolves the email account to use for sending.
 * Tries the explicit emailAccountId first, falls back to account default.
 */
async function resolveEmailAccount(accountId: string, emailAccountId?: string) {
    if (emailAccountId) {
        const explicit = await prisma.emailAccount.findUnique({ where: { id: emailAccountId } });
        if (explicit) return explicit;
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

/**
 * Routes a message to the appropriate external channel (Email, Facebook, Instagram, TikTok, SMS).
 */
export async function routeMessageToChannel(
    conversationId: string,
    content: string,
    channel: string,
    accountId: string,
    emailAccountId?: string
): Promise<void> {
    const conversation = await prisma.conversation.findUnique({
        where: { id: conversationId },
        include: {
            wooCustomer: true,
            socialAccount: true,
            mergedFrom: { include: { socialAccount: true } }
        }
    });

    if (!conversation) {
        Logger.warn('[ChannelRouter] Conversation not found', { id: conversationId });
        return;
    }

    if (channel === 'EMAIL') {
        const recipientEmail = conversation.wooCustomer?.email || conversation.guestEmail;
        if (!recipientEmail) return;

        const emailAccount = await resolveEmailAccount(accountId, emailAccountId);
        if (!emailAccount) return;

        const { subject, body } = parseEmailContent(content, conversation.title);
        const originalEmailLog = await prisma.emailLog.findFirst({
            where: { sourceId: conversation.id, messageId: { not: null } },
            orderBy: { createdAt: 'asc' }
        });

        const emailService = new EmailService();
        await emailService.sendEmail(accountId, emailAccount.id, recipientEmail, subject, body, undefined, {
            source: 'INBOX',
            sourceId: conversation.id,
            inReplyTo: originalEmailLog?.messageId || undefined,
            references: originalEmailLog?.messageId || undefined
        });
        Logger.info('[ChannelRouter] Email sent', { to: recipientEmail, conversationId });

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
            }
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
            }
        }

    } else if (channel === 'SMS') {
        let externalId = conversation.channel === 'SMS' ? conversation.externalConversationId : null;

        if (!externalId) {
            const merged = conversation.mergedFrom.find(m => m.channel === 'SMS');
            externalId = merged?.externalConversationId || null;
        }

        if (externalId) {
            await TwilioService.sendSms(accountId, externalId, content.replace(/<[^>]*>/g, ''));
            Logger.info('[ChannelRouter] SMS sent', { to: externalId });
        }
    }
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
): Promise<void> {
    const conversation = await prisma.conversation.findUnique({
        where: { id: conversationId },
        include: { wooCustomer: true }
    });

    if (conversation?.channel !== 'EMAIL') return;

    const recipientEmail = conversation.wooCustomer?.email || conversation.guestEmail;
    if (!recipientEmail) return;

    const emailAccount = await resolveEmailAccount(accountId, emailAccountId);
    if (!emailAccount) return;

    const { subject } = parseEmailContent(content, conversation.title);
    const originalEmailLog = await prisma.emailLog.findFirst({
        where: { sourceId: conversation.id, messageId: { not: null } },
        orderBy: { createdAt: 'asc' }
    });

    const emailService = new EmailService();
    await emailService.sendEmail(accountId, emailAccount.id, recipientEmail, subject, content, attachments, {
        source: 'INBOX',
        sourceId: conversation.id,
        inReplyTo: originalEmailLog?.messageId || undefined,
        references: originalEmailLog?.messageId || undefined
    });

    Logger.info('[ChannelRouter] Email sent with attachments', {
        to: recipientEmail,
        attachmentCount: attachments.length,
        conversationId
    });
}
