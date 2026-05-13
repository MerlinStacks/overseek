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
import { routeMessageToChannel, sendEmailWithAttachments } from '../../utils/ChannelRouter';
import path from 'path';
import fs from 'fs';
import { getRouteAccountIdOrReply } from '../routeHelpers';
import { isAccountFeatureEnabled } from '../../utils/accountFeatures';

const attachmentsDir = path.join(__dirname, '../../../uploads/attachments');
const MAX_RELAY_ATTACHMENTS = 10;
const MAX_RELAY_ATTACHMENT_BYTES = 10 * 1024 * 1024;

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
                select: { id: true }
            });
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

                if (!content?.trim()) {
                    return reply.code(400).send({ error: 'Message content is required' });
                }

                if (!(await ensureConversationOwnership(request.params.id, accountId))) {
                    return reply.code(404).send({ error: 'Conversation not found' });
                }

                // Store the message first
                const msg = await chatService.addMessage(request.params.id, content, type || 'AGENT', userId, isInternal, accountId, clientRequestId);

                // If internal note, don't route externally
                if (isInternal) {
                    return { ...msg, ...(clientRequestId ? { clientRequestId } : {}) };
                }

                // Route to external channel if specified
                if (channel) {
                    if (channel === 'EMAIL' && !(await ensureEmailFeatureEnabled(accountId, reply))) {
                        return;
                    }
                    try {
                        await routeMessageToChannel(request.params.id, content, channel, accountId, emailAccountId);
                    } catch (routingError: any) {
                        Logger.error('[ChannelRouting] Failed to route message', { channel, error: routingError.message });
                        // Don't fail the request - message is still stored
                    }
                }

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
                const attachmentUrl = `/uploads/attachments/${filename}`;
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
                const { userId, accountId } = authContext;
                if (!(await ensureConversationOwnership(conversationId, accountId))) {
                    return reply.code(404).send({ error: 'Conversation not found' });
                }

                // Parse multipart data
                let content = '';
                let type: 'AGENT' | 'SYSTEM' = 'AGENT';
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

                // Add message to conversation
                const msg = await chatService.addMessage(conversationId, fullContent, type, userId, isInternal, accountId, clientRequestId);

                // Route externally when this is not an internal note.
                // Why: attachment sends previously swallowed routing errors, so agents saw
                // success while customers never received the message/attachments.
                if (!isInternal) {
                    try {
                        if (attachments.length > 0) {
                            if (!(await ensureEmailFeatureEnabled(accountId, reply))) return;
                            await sendEmailWithAttachments(conversationId, content, attachments, accountId, emailAccountId);
                        } else if (channel) {
                            if (channel === 'EMAIL' && !(await ensureEmailFeatureEnabled(accountId, reply))) {
                                return;
                            }
                            await routeMessageToChannel(conversationId, content, channel, accountId, emailAccountId);
                        }
                    } catch (routingError: any) {
                        Logger.error('[message-with-attachments] External routing failed', {
                            error: routingError?.message,
                            conversationId,
                            channel,
                            hasAttachments: attachments.length > 0
                        });
                        return reply.code(502).send({
                            error: 'Message saved, but delivery to customer failed. Please retry or check channel configuration.'
                        });
                    }
                }

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
