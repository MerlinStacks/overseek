/**
 * Message Routes
 * 
 * Handles message-related endpoints for conversations.
 * Extracted from chat.ts for maintainability.
 */

import { FastifyPluginAsync } from 'fastify';
import { prisma } from '../../utils/prisma';
import { ChatService } from '../../services/ChatService';
import { EmailService } from '../../services/EmailService';
import { MetaMessagingService } from '../../services/messaging/MetaMessagingService';
import { TikTokMessagingService } from '../../services/messaging/TikTokMessagingService';
import { TwilioService } from '../../services/TwilioService';
import { requireAuthFastify } from '../../middleware/auth';
import { Logger } from '../../utils/logger';
import path from 'path';
import fs from 'fs';

const attachmentsDir = path.join(__dirname, '../../../uploads/attachments');

/**
 * Factory function to create message routes with injected ChatService
 */
export const createMessageRoutes = (chatService: ChatService): FastifyPluginAsync => {
    return async (fastify) => {
        fastify.addHook('preHandler', requireAuthFastify);

        // POST /:id/messages
        fastify.post<{ Params: { id: string } }>('/:id/messages', async (request, reply) => {
            try {
                const { content, type, isInternal, channel, emailAccountId } = request.body as any;
                const userId = request.user?.id;
                const accountId = request.accountId;

                if (!content?.trim()) {
                    return reply.code(400).send({ error: 'Message content is required' });
                }

                // Store the message first
                const msg = await chatService.addMessage(request.params.id, content, type || 'AGENT', userId, isInternal);

                // If internal note, don't route externally
                if (isInternal) {
                    return msg;
                }

                // Route to external channel if specified
                if (channel) {
                    try {
                        await routeMessageToChannel(request.params.id, content, channel, accountId!, emailAccountId);
                    } catch (routingError: any) {
                        Logger.error('[ChannelRouting] Failed to route message', { channel, error: routingError.message });
                        // Don't fail the request - message is still stored
                    }
                }

                return msg;
            } catch (error: any) {
                Logger.error('Failed to send message', { conversationId: request.params.id, error: error?.message || error });
                return reply.code(500).send({ error: error?.message || 'Failed to send message' });
            }
        });

        // POST /:id/attachment (using @fastify/multipart)
        fastify.post<{ Params: { id: string } }>('/:id/attachment', async (request, reply) => {
            try {
                const data = await (request as any).file();
                if (!data) return reply.code(400).send({ error: 'No file uploaded' });

                const allowedTypes = /jpeg|jpg|png|gif|pdf|doc|docx|xls|xlsx|txt|csv|zip/;
                const ext = path.extname(data.filename).toLowerCase();
                if (!allowedTypes.test(ext.slice(1))) {
                    return reply.code(400).send({ error: 'Invalid file type' });
                }

                const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
                const filename = uniqueSuffix + '-' + data.filename;
                const filePath = path.join(attachmentsDir, filename);
                const writeStream = fs.createWriteStream(filePath);

                for await (const chunk of data.file) {
                    writeStream.write(chunk);
                }
                writeStream.end();

                const conversationId = request.params.id;
                const userId = request.user?.id;
                const attachmentUrl = `/uploads/attachments/${filename}`;
                const content = `[Attachment: ${data.filename}](${attachmentUrl})`;

                const msg = await chatService.addMessage(conversationId, content, 'AGENT', userId, false);

                return {
                    success: true,
                    message: msg,
                    attachment: { url: attachmentUrl, name: data.filename, type: data.mimetype }
                };
            } catch (error) {
                Logger.error('Failed to upload attachment', { error });
                return reply.code(500).send({ error: 'Failed to upload attachment' });
            }
        });

        // POST /:id/message-with-attachments - Send message with staged attachments
        fastify.post<{ Params: { id: string } }>('/:id/message-with-attachments', async (request, reply) => {
            try {
                const conversationId = request.params.id;
                const userId = request.user?.id;
                const accountId = request.accountId;

                if (!accountId || !userId) {
                    return reply.code(401).send({ error: 'Unauthorized' });
                }

                // Parse multipart data
                let content = '';
                let type: 'AGENT' | 'SYSTEM' = 'AGENT';
                let isInternal = false;
                let emailAccountId: string | undefined;
                const attachmentLinks: string[] = [];
                // Track attachments with full paths for email relay
                const attachments: Array<{ filename: string; path: string; contentType: string }> = [];

                if (request.isMultipart()) {
                    const parts = request.parts();
                    for await (const part of parts) {
                        if (part.type === 'file') {
                            // Save file with unique name
                            const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
                            const ext = path.extname(part.filename || 'file');
                            const filename = `${uniqueSuffix}${ext}`;
                            const filePath = path.join(attachmentsDir, filename);

                            const writeStream = fs.createWriteStream(filePath);
                            for await (const chunk of part.file) {
                                writeStream.write(chunk);
                            }
                            writeStream.end();

                            const attachmentUrl = `/uploads/attachments/${filename}`;
                            attachmentLinks.push(`[${part.filename}](${attachmentUrl})`);

                            // Track for email relay transport
                            attachments.push({
                                filename: part.filename || filename,
                                path: filePath,
                                contentType: part.mimetype || 'application/octet-stream'
                            });
                        } else {
                            // Handle form fields
                            const value = (part as any).value as string;
                            switch (part.fieldname) {
                                case 'content':
                                    content = value;
                                    break;
                                case 'type':
                                    type = value as 'AGENT' | 'SYSTEM';
                                    break;
                                case 'isInternal':
                                    isInternal = value === 'true';
                                    break;
                                case 'emailAccountId':
                                    emailAccountId = value;
                                    break;
                            }
                        }
                    }
                }

                // Combine content with attachment links
                let fullContent = content;
                if (attachmentLinks.length > 0) {
                    fullContent += '\n\n**Attachments:**\n' + attachmentLinks.join('\n');
                }

                // Add message to conversation
                const msg = await chatService.addMessage(conversationId, fullContent, type, userId, isInternal);

                // Send via email if this is an EMAIL conversation and not internal
                if (!isInternal && attachments.length > 0) {
                    try {
                        await sendEmailWithAttachments(conversationId, content, attachments, accountId, emailAccountId);
                    } catch (emailError: any) {
                        // Log but don't fail - message is already stored
                        Logger.error('[message-with-attachments] Failed to send email', {
                            error: emailError.message,
                            conversationId
                        });
                    }
                }

                return {
                    success: true,
                    message: msg,
                    attachmentCount: attachmentLinks.length
                };
            } catch (error) {
                Logger.error('Failed to send message with attachments', { error });
                return reply.code(500).send({ error: 'Failed to send message with attachments' });
            }
        });

        // === MESSAGE REACTIONS ===
        fastify.post<{ Params: { messageId: string } }>('/messages/:messageId/reactions', async (request, reply) => {
            try {
                const { messageId } = request.params;
                const { emoji } = request.body as any;
                const userId = request.user?.id;

                if (!emoji) return reply.code(400).send({ error: 'Emoji is required' });

                const existingReaction = await prisma.messageReaction.findUnique({
                    where: { messageId_userId_emoji: { messageId, userId: userId!, emoji } }
                });

                if (existingReaction) {
                    await prisma.messageReaction.delete({ where: { id: existingReaction.id } });
                    return { action: 'removed', emoji };
                } else {
                    const reaction = await prisma.messageReaction.create({
                        data: { messageId, userId: userId!, emoji },
                        include: { user: { select: { id: true, fullName: true } } }
                    });
                    return { action: 'added', reaction };
                }
            } catch (error) {
                Logger.error('Failed to toggle reaction', { error });
                return reply.code(500).send({ error: 'Failed to toggle reaction' });
            }
        });

        fastify.get<{ Params: { messageId: string } }>('/messages/:messageId/reactions', async (request, reply) => {
            try {
                const { messageId } = request.params;
                const reactions = await prisma.messageReaction.findMany({
                    where: { messageId },
                    include: { user: { select: { id: true, fullName: true } } }
                });

                const grouped = reactions.reduce((acc, r) => {
                    if (!acc[r.emoji]) acc[r.emoji] = [];
                    acc[r.emoji].push({ userId: r.user.id, userName: r.user.fullName });
                    return acc;
                }, {} as Record<string, Array<{ userId: string; userName: string | null }>>);

                return grouped;
            } catch (error) {
                Logger.error('Failed to fetch reactions', { error });
                return reply.code(500).send({ error: 'Failed to fetch reactions' });
            }
        });
    };
};

/**
 * Routes a message to the appropriate external channel
 */
async function routeMessageToChannel(
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
        Logger.warn('[ChannelRouting] Conversation not found', { id: conversationId });
        return;
    }

    if (channel === 'EMAIL') {
        const recipientEmail = conversation.wooCustomer?.email || conversation.guestEmail;
        if (recipientEmail) {
            let emailAccount = null;
            if (emailAccountId) {
                emailAccount = await prisma.emailAccount.findUnique({
                    where: { id: emailAccountId }
                });
            }
            if (!emailAccount) {
                const { getDefaultEmailAccount } = await import('../../utils/getDefaultEmailAccount');
                emailAccount = await getDefaultEmailAccount(accountId);
            }
            if (emailAccount) {
                const emailService = new EmailService();
                let subject = conversation.title
                    ? (conversation.title.startsWith('Re:') ? conversation.title : `Re: ${conversation.title}`)
                    : 'Re: Your inquiry';
                let body = content;

                if (content.startsWith('Subject:')) {
                    const lines = content.split('\n');
                    subject = lines[0].replace('Subject:', '').trim();
                    body = lines.slice(2).join('\n');
                }

                const originalEmailLog = await prisma.emailLog.findFirst({
                    where: { sourceId: conversation.id, messageId: { not: null } },
                    orderBy: { createdAt: 'asc' }
                });

                await emailService.sendEmail(accountId, emailAccount.id, recipientEmail, subject, body, undefined, {
                    source: 'INBOX',
                    sourceId: conversation.id,
                    inReplyTo: originalEmailLog?.messageId || undefined,
                    references: originalEmailLog?.messageId || undefined
                });
                Logger.info('[ChannelRouting] Email sent', { to: recipientEmail, conversationId: conversation.id });
            }
        }
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
                Logger.info('[ChannelRouting] Meta message sent', { channel, messageId: result.messageId });
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
                Logger.info('[ChannelRouting] TikTok message sent', { messageId: result.messageId });
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
            Logger.info('[ChannelRouting] SMS sent', { to: externalId });
        }
    }
}

/**
 * Sends email with attachments for EMAIL channel conversations
 */
async function sendEmailWithAttachments(
    conversationId: string,
    content: string,
    attachments: Array<{ filename: string; path: string; contentType: string }>,
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

    let emailAccount = null;
    if (emailAccountId) {
        emailAccount = await prisma.emailAccount.findUnique({ where: { id: emailAccountId } });
    }
    if (!emailAccount) {
        const { getDefaultEmailAccount } = await import('../../utils/getDefaultEmailAccount');
        emailAccount = await getDefaultEmailAccount(accountId);
    }

    if (!emailAccount) return;

    const emailService = new EmailService();
    const subject = conversation.title
        ? (conversation.title.startsWith('Re:') ? conversation.title : `Re: ${conversation.title}`)
        : 'Re: Your inquiry';

    const originalEmailLog = await prisma.emailLog.findFirst({
        where: { sourceId: conversation.id, messageId: { not: null } },
        orderBy: { createdAt: 'asc' }
    });

    await emailService.sendEmail(accountId, emailAccount.id, recipientEmail, subject, content, attachments, {
        source: 'INBOX',
        sourceId: conversation.id,
        inReplyTo: originalEmailLog?.messageId || undefined,
        references: originalEmailLog?.messageId || undefined
    });

    Logger.info('[message-with-attachments] Email sent with attachments', {
        to: recipientEmail,
        attachmentCount: attachments.length,
        conversationId
    });
}
