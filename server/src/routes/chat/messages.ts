/**
 * Message Routes
 * 
 * Handles message-related endpoints for conversations.
 * Extracted from chat.ts for maintainability.
 */

import { FastifyPluginAsync } from 'fastify';
import { prisma } from '../../utils/prisma';
import { ChatService } from '../../services/ChatService';
import { requireAuthFastify } from '../../middleware/auth';
import { Logger } from '../../utils/logger';
import { routeMessageToChannel, sendEmailWithAttachments, validateMessageChannel } from '../../utils/ChannelRouter';
import type { DeliveryResult } from '../../utils/ChannelRouter';
import path from 'path';
import fs from 'fs';
import { getRouteAccountIdOrReply } from '../routeHelpers';
import { isAccountFeatureEnabled } from '../../utils/accountFeatures';
import { requireInboxMutationAccess } from './authorization';

const attachmentsDir = path.join(__dirname, '../../../uploads/attachments');
const MAX_RELAY_ATTACHMENTS = 10;
const MAX_RELAY_ATTACHMENT_BYTES = 10 * 1024 * 1024;
const SAFE_DELIVERY_ERROR = 'Delivery to customer failed';
const DELIVERY_FINALIZATION_ERROR = 'Message was delivered but server finalization failed';

type OwnedConversation = {
    id: string;
    accountId: string;
    channel: string;
    priority?: string | null;
    assignedTo?: string | null;
};

function providerForChannel(channel: string): string {
    if (channel === 'FACEBOOK' || channel === 'INSTAGRAM') return 'META';
    if (channel === 'SMS') return 'TWILIO';
    return channel;
}

function getPublicAttachmentUrl(filename: string): string {
    const appUrl = (process.env.APP_URL || process.env.CLIENT_URL || 'http://localhost:5173')
        .trim()
        .replace(/\/+$/, '');
    return `${appUrl}/uploads/attachments/${filename}`;
}

// Why: ensure the directory exists on startup so file writes don't crash with ENOENT
fs.mkdirSync(attachmentsDir, { recursive: true });

/**
 * Factory function to create message routes with injected ChatService
 */
export const createMessageRoutes = (chatService: ChatService): FastifyPluginAsync => {
    return async (fastify) => {
        fastify.addHook('preHandler', requireAuthFastify);

        const getUserAndAccountOrReply = (
            request: any,
            reply: any,
        ): { userId: string; accountId: string } | null => {
            const userId = request.user?.id;
            const accountId = request.accountId;
            if (!userId || !accountId) {
                reply.code(401).send({ error: 'Unauthorized' });
                return null;
            }
            return { userId, accountId };
        };

        const ensureConversationOwnership = async (conversationId: string, accountId: string) => {
            return prisma.conversation.findFirst({
                where: { id: conversationId, accountId },
                select: { id: true, accountId: true, channel: true, priority: true, assignedTo: true }
            });
        };

        const emitDeliveredMessage = (conversation: OwnedConversation, message: any) => {
            const io = (chatService as unknown as { io?: { to: (room: string) => { emit: (event: string, data: unknown) => void } } }).io;
            if (!io) return;

            io.to(`conversation:${conversation.id}`).emit('message:new', {
                ...message,
                accountId: conversation.accountId,
                priority: conversation.priority,
                assignedTo: conversation.assignedTo
            });
            io.to(`account:${conversation.accountId}`).emit('conversation:updated', {
                id: conversation.id,
                lastMessage: message,
                updatedAt: message.createdAt,
                priority: conversation.priority
            });
        };

        const deliverExternalMessage = async ({
            conversation,
            content,
            userId,
            clientRequestId,
            channel,
            deliver,
            allowContentRefresh = false
        }: {
            conversation: OwnedConversation;
            content: string;
            userId?: string;
            clientRequestId?: string;
            channel: string;
            deliver: () => Promise<DeliveryResult>;
            allowContentRefresh?: boolean;
        }): Promise<{
            message: any;
            httpStatus: number;
            reused: boolean;
            conflict?: boolean;
            error?: string;
        }> => {
            let message = clientRequestId
                ? await prisma.message.findFirst({ where: { conversationId: conversation.id, clientRequestId } })
                : null;

            if (message?.deliveryStatus === 'SENT') return { message, httpStatus: 200, reused: true };
            if (message?.deliveryStatus === 'PENDING') return { message, httpStatus: 409, reused: true };
            if (message && !allowContentRefresh && (message.content !== content || message.deliveryChannel !== channel)) {
                return { message, httpStatus: 409, reused: true, conflict: true };
            }

            const attemptedAt = new Date();
            if (message) {
                const claimed = await prisma.message.updateMany({
                    where: { id: message.id, deliveryStatus: 'FAILED' },
                    data: {
                        ...(allowContentRefresh ? { content } : {}),
                        deliveryStatus: 'PENDING',
                        deliveryChannel: channel,
                        deliveryProvider: providerForChannel(channel),
                        deliveryError: null,
                        deliveryAttemptedAt: attemptedAt
                    }
                });
                if (claimed.count === 0) {
                    message = await prisma.message.findFirst({ where: { id: message.id } });
                    return { message, httpStatus: message?.deliveryStatus === 'SENT' ? 200 : 409, reused: true };
                }
                message = await prisma.message.findFirst({ where: { id: message.id } });
            } else {
                try {
                    message = await prisma.message.create({
                        data: {
                            conversationId: conversation.id,
                            content,
                            senderType: 'AGENT',
                            senderId: userId,
                            isInternal: false,
                            deliveryStatus: 'PENDING',
                            deliveryChannel: channel,
                            deliveryProvider: providerForChannel(channel),
                            deliveryAttemptedAt: attemptedAt,
                            clientRequestId
                        }
                    });
                } catch (error: any) {
                    if (error?.code !== 'P2002' || !clientRequestId) throw error;
                    message = await prisma.message.findFirst({ where: { conversationId: conversation.id, clientRequestId } });
                    return { message, httpStatus: message?.deliveryStatus === 'SENT' ? 200 : 409, reused: true };
                }
            }

            let result: DeliveryResult;
            try {
                result = await deliver();
            } catch (error: any) {
                Logger.error('[ChannelRouting] Failed to route message', {
                    channel,
                    conversationId: conversation.id,
                    error: error?.message || error
                });
                const failed = await prisma.message.update({
                    where: { id: message!.id },
                    data: { deliveryStatus: 'FAILED', deliveryError: SAFE_DELIVERY_ERROR }
                });
                return { message: failed, httpStatus: 502, reused: false };
            }

            const sentData = {
                deliveryStatus: 'SENT' as const,
                deliveryProvider: result.provider,
                providerMessageId: result.providerMessageId,
                deliveryError: null,
                deliveredAt: new Date()
            };
            let delivered: any;
            try {
                delivered = await prisma.message.update({
                    where: { id: message!.id },
                    data: sentData
                });
            } catch (error: any) {
                Logger.error('[ChannelRouting] Failed to persist successful delivery', {
                    channel,
                    conversationId: conversation.id,
                    messageId: message!.id,
                    providerMessageId: result.providerMessageId,
                    error: error?.message || error
                });

                try {
                    const persisted = await prisma.message.updateMany({
                        where: { id: message!.id, deliveryStatus: 'PENDING' },
                        data: sentData
                    });
                    const current = await prisma.message.findFirst({ where: { id: message!.id } });
                    if (persisted.count !== 1 && current?.deliveryStatus !== 'SENT') throw error;
                    delivered = current || { ...message, ...sentData };
                } catch (fallbackError: any) {
                    Logger.error('[ChannelRouting] Successful delivery remains safely claimed for recovery', {
                        channel,
                        conversationId: conversation.id,
                        messageId: message!.id,
                        providerMessageId: result.providerMessageId,
                        error: fallbackError?.message || fallbackError
                    });
                    return { message, httpStatus: 500, reused: false, error: DELIVERY_FINALIZATION_ERROR };
                }
            }

            try {
                await prisma.conversation.update({
                    where: { id: conversation.id },
                    data: { updatedAt: new Date(), status: 'OPEN' }
                });
            } catch (error: any) {
                Logger.error('[ChannelRouting] Failed to finalize conversation after successful delivery', {
                    channel,
                    conversationId: conversation.id,
                    messageId: message!.id,
                    providerMessageId: result.providerMessageId,
                    error: error?.message || error
                });
                return { message: delivered, httpStatus: 500, reused: false, error: DELIVERY_FINALIZATION_ERROR };
            }

            emitDeliveredMessage(conversation, delivered);
            return { message: delivered, httpStatus: 200, reused: false };
        };

        const ensureMessageOwnership = async (messageId: string, accountId: string) => {
            return prisma.message.findFirst({
                where: { id: messageId, conversation: { accountId } },
                select: { id: true }
            });
        };

        const ensureEmailFeatureEnabled = async (accountId: string, reply: any): Promise<boolean> => {
            const enabled = await isAccountFeatureEnabled(accountId, 'EMAIL', true);
            if (!enabled) {
                reply.code(403).send({ error: 'Email feature is disabled for this account' });
                return false;
            }

            return true;
        };

        // POST /:id/messages
        fastify.post<{ Params: { id: string } }>('/:id/messages', async (request, reply) => {
            try {
                const { content, type, isInternal, channel, emailAccountId, clientRequestId } = request.body as any;
                const userId = request.user?.id;
                const accountId = getRouteAccountIdOrReply(request, reply);
                if (!accountId) return;
                if (!(await requireInboxMutationAccess(request, reply))) return;

                if (typeof content !== 'string' || !content.trim()) {
                    return reply.code(400).send({ error: 'Message content is required' });
                }
                if (type !== undefined && type !== 'AGENT') {
                    return reply.code(400).send({ error: 'Authenticated messages must use AGENT sender type' });
                }
                if (isInternal !== undefined && typeof isInternal !== 'boolean') {
                    return reply.code(400).send({ error: 'isInternal must be a boolean' });
                }
                if (channel !== undefined && typeof channel !== 'string') {
                    return reply.code(400).send({ error: 'channel must be a string' });
                }
                if (clientRequestId !== undefined && (typeof clientRequestId !== 'string' || !clientRequestId.trim() || clientRequestId.length > 200)) {
                    return reply.code(400).send({ error: 'clientRequestId must be a non-empty string of at most 200 characters' });
                }

                const conversation = await ensureConversationOwnership(request.params.id, accountId);
                if (!conversation) {
                    return reply.code(404).send({ error: 'Conversation not found' });
                }

                if (isInternal) {
                    const msg = await chatService.addMessage(request.params.id, content.trim(), 'AGENT', userId, true, accountId, clientRequestId);
                    return { ...msg, ...(clientRequestId ? { clientRequestId } : {}) };
                }
                if (!clientRequestId) {
                    return reply.code(400).send({ error: 'clientRequestId is required for external messages' });
                }

                const deliveryChannel = channel || conversation.channel;
                if (deliveryChannel) {
                    if (deliveryChannel === 'EMAIL' && !(await ensureEmailFeatureEnabled(accountId, reply))) {
                        return;
                    }
                    try {
                        await validateMessageChannel(request.params.id, deliveryChannel, accountId, emailAccountId);
                    } catch (validationError: any) {
                        return reply.code(400).send({ error: validationError?.message || 'Channel is unavailable' });
                    }

                    const result = await deliverExternalMessage({
                        conversation: conversation as OwnedConversation,
                        content: content.trim(),
                        userId,
                        clientRequestId: clientRequestId?.trim(),
                        channel: deliveryChannel,
                        deliver: () => routeMessageToChannel(request.params.id, content.trim(), deliveryChannel, accountId, emailAccountId)
                    });
                    if (result.httpStatus !== 200) {
                        return reply.code(result.httpStatus).send({
                            error: result.conflict ? 'clientRequestId already belongs to a different message' : result.error || result.message?.deliveryError || 'Message delivery is already pending',
                            message: result.message
                        });
                    }
                    return { ...result.message, ...(clientRequestId ? { clientRequestId } : {}) };
                }

                const msg = await chatService.addMessage(request.params.id, content.trim(), 'AGENT', userId, false, accountId, clientRequestId);
                return { ...msg, ...(clientRequestId ? { clientRequestId } : {}) };
            } catch (error: any) {
                Logger.error('Failed to send message', { conversationId: request.params.id, error: error?.message || error });
                return reply.code(500).send({ error: error?.message || 'Failed to send message' });
            }
        });

        // POST /:id/attachment (using @fastify/multipart)
        fastify.post<{ Params: { id: string } }>('/:id/attachment', async (request, reply) => {
            let writeStream: fs.WriteStream | undefined;
            try {
                const accountId = getRouteAccountIdOrReply(request, reply);
                if (!accountId) return;
                if (!(await requireInboxMutationAccess(request, reply))) return;
                if (!(await ensureConversationOwnership(request.params.id, accountId))) {
                    return reply.code(404).send({ error: 'Conversation not found' });
                }

                const data = await (request as any).file({ limits: { fileSize: 25 * 1024 * 1024 } });
                if (!data) return reply.code(400).send({ error: 'No file uploaded' });

                const allowedTypes = /jpeg|jpg|png|gif|pdf|doc|docx|xls|xlsx|txt|csv|zip/;
                const ext = path.extname(data.filename).toLowerCase();
                if (!allowedTypes.test(ext.slice(1))) {
                    return reply.code(400).send({ error: 'Invalid file type' });
                }

                const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
                const filename = uniqueSuffix + '-' + data.filename;
                const filePath = path.join(attachmentsDir, filename);
                writeStream = fs.createWriteStream(filePath);

                for await (const chunk of data.file) {
                    writeStream.write(chunk);
                }
                writeStream.end();
                await new Promise<void>((resolve, reject) => {
                    writeStream!.on('finish', resolve);
                    writeStream!.on('error', reject);
                });

                const conversationId = request.params.id;
                const userId = request.user?.id;
                const attachmentUrl = getPublicAttachmentUrl(filename);
                const content = `[Attachment: ${data.filename}](${attachmentUrl})`;

                const msg = await chatService.addMessage(conversationId, content, 'AGENT', userId, false, accountId);

                return {
                    success: true,
                    message: msg,
                    attachment: { url: attachmentUrl, name: data.filename, type: data.mimetype }
                };
            } catch (error) {
                if (writeStream) writeStream.destroy();
                Logger.error('Failed to upload attachment', { error });
                return reply.code(500).send({ error: 'Failed to upload attachment' });
            }
        });

        // POST /:id/message-with-attachments - Send message with staged attachments
        fastify.post<{ Params: { id: string } }>('/:id/message-with-attachments', async (request, reply) => {
            try {
                const conversationId = request.params.id;
                const authContext = getUserAndAccountOrReply(request, reply);
                if (!authContext) return;
                if (!(await requireInboxMutationAccess(request, reply))) return;
                const { userId, accountId } = authContext;
                const conversation = await ensureConversationOwnership(conversationId, accountId);
                if (!conversation) {
                    return reply.code(404).send({ error: 'Conversation not found' });
                }

                // Parse multipart data
                let content = '';
                let requestedType = 'AGENT';
                let isInternal = false;
                let channel: string | undefined;
                let emailAccountId: string | undefined;
                let clientRequestId: string | undefined;
                const attachmentLinks: string[] = [];
                // Track attachments with full paths for email relay
                const attachments: Array<{ filename: string; path: string; contentType: string }> = [];

                const cleanupAttachments = () => {
                    for (const attachment of attachments) {
                        try {
                            if (attachment.path && fs.existsSync(attachment.path)) {
                                fs.unlinkSync(attachment.path);
                            }
                        } catch {
                            // Ignore cleanup errors.
                        }
                    }
                };

                if (request.isMultipart()) {
                    const parts = request.parts();
                    for await (const part of parts) {
                        if (part.type === 'file') {
                            if (attachments.length >= MAX_RELAY_ATTACHMENTS) {
                                cleanupAttachments();
                                return reply.code(400).send({ error: `Maximum ${MAX_RELAY_ATTACHMENTS} attachments allowed` });
                            }

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
                            await new Promise<void>((resolve, reject) => {
                                writeStream.on('finish', resolve);
                                writeStream.on('error', reject);
                            });

                            const stats = fs.statSync(filePath);
                            if (stats.size > MAX_RELAY_ATTACHMENT_BYTES) {
                                try { fs.unlinkSync(filePath); } catch { /* ignore cleanup errors */ }
                                cleanupAttachments();
                                return reply.code(400).send({ error: `Attachment exceeds 10 MB limit: ${part.filename}` });
                            }

                            const attachmentUrl = getPublicAttachmentUrl(filename);
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
                                    requestedType = value;
                                    break;
                                case 'isInternal':
                                    isInternal = value === 'true';
                                    break;
                                case 'emailAccountId':
                                    emailAccountId = value;
                                    break;
                                case 'channel':
                                    channel = value;
                                    break;
                                case 'clientRequestId':
                                    clientRequestId = value;
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

                if (!fullContent.trim()) {
                    cleanupAttachments();
                    return reply.code(400).send({ error: 'Message content or attachment is required' });
                }
                if (requestedType !== 'AGENT') {
                    cleanupAttachments();
                    return reply.code(400).send({ error: 'Authenticated messages must use AGENT sender type' });
                }
                if (clientRequestId !== undefined && (!clientRequestId.trim() || clientRequestId.length > 200)) {
                    cleanupAttachments();
                    return reply.code(400).send({ error: 'clientRequestId must be a non-empty string of at most 200 characters' });
                }

                if (isInternal) {
                    const msg = await chatService.addMessage(conversationId, fullContent.trim(), 'AGENT', userId, true, accountId, clientRequestId);
                    return {
                        success: true,
                        message: msg,
                        ...(clientRequestId ? { clientRequestId } : {}),
                        attachmentCount: attachmentLinks.length
                    };
                }
                if (!clientRequestId) {
                    cleanupAttachments();
                    return reply.code(400).send({ error: 'clientRequestId is required for external messages' });
                }

                const deliveryChannel = channel || conversation.channel;
                if (deliveryChannel) {
                    if (deliveryChannel === 'EMAIL' && !(await ensureEmailFeatureEnabled(accountId, reply))) {
                        cleanupAttachments();
                        return;
                    }
                    try {
                        await validateMessageChannel(conversationId, deliveryChannel, accountId, emailAccountId, attachments.length > 0);
                    } catch (validationError: any) {
                        cleanupAttachments();
                        return reply.code(400).send({ error: validationError?.message || 'Channel is unavailable' });
                    }

                    const result = await deliverExternalMessage({
                        conversation: conversation as OwnedConversation,
                        content: fullContent.trim(),
                        userId,
                        clientRequestId: clientRequestId?.trim(),
                        channel: deliveryChannel,
                        allowContentRefresh: true,
                        deliver: () => attachments.length > 0 && deliveryChannel === 'EMAIL'
                            ? sendEmailWithAttachments(conversationId, content, attachments, accountId, emailAccountId)
                            : routeMessageToChannel(conversationId, fullContent.trim(), deliveryChannel, accountId, emailAccountId)
                    });
                    if (result.reused) cleanupAttachments();
                    if (result.httpStatus !== 200) {
                        return reply.code(result.httpStatus).send({
                            success: false,
                            error: result.error || result.message?.deliveryError || 'Message delivery is already pending',
                            message: result.message,
                            attachmentCount: attachmentLinks.length
                        });
                    }

                    return {
                        success: true,
                        message: result.message,
                        ...(clientRequestId ? { clientRequestId } : {}),
                        attachmentCount: attachmentLinks.length
                    };
                }

                const msg = await chatService.addMessage(conversationId, fullContent.trim(), 'AGENT', userId, isInternal, accountId, clientRequestId);

                return {
                    success: true,
                    message: msg,
                    ...(clientRequestId ? { clientRequestId } : {}),
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
                const authContext = getUserAndAccountOrReply(request, reply);
                if (!authContext) return;
                if (!(await requireInboxMutationAccess(request, reply))) return;
                const { userId, accountId } = authContext;

                if (!emoji) return reply.code(400).send({ error: 'Emoji is required' });

                const message = await ensureMessageOwnership(messageId, accountId);
                if (!message) return reply.code(404).send({ error: 'Message not found' });

                const existingReaction = await prisma.messageReaction.findUnique({
                    where: { messageId_userId_emoji: { messageId, userId, emoji } }
                });

                if (existingReaction) {
                    await prisma.messageReaction.delete({ where: { id: existingReaction.id } });
                    return { action: 'removed', emoji };
                } else {
                    const reaction = await prisma.messageReaction.create({
                        data: { messageId, userId, emoji },
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
                const accountId = getRouteAccountIdOrReply(request, reply);
                if (!accountId) return;
                const { messageId } = request.params;

                const message = await ensureMessageOwnership(messageId, accountId);
                if (!message) return reply.code(404).send({ error: 'Message not found' });

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
