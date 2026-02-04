/**
 * Chat Routes - Fastify Plugin Factory
 * Requires ChatService injection for Socket.IO integration.
 * 
 * Modular sub-routes extracted for maintainability:
 * - cannedResponses.ts: Canned response templates
 * - macros.ts: Chat macros
 * - blockedContacts.ts: Blocked contact management
 * - bulkActions.ts: Bulk conversation actions
 * - messages.ts: Message CRUD, attachments, reactions
 * - scheduling.ts: Scheduled messages, snooze
 * - notes.ts: Conversation notes and labels
 */

import { FastifyPluginAsync } from 'fastify';
import { prisma } from '../utils/prisma';
import { ChatService } from '../services/ChatService';
import { EmailService } from '../services/EmailService';
import { InboxAIService } from '../services/InboxAIService';
import { requireAuthFastify } from '../middleware/auth';
import { Logger } from '../utils/logger';
import path from 'path';
import fs from 'fs';
import { pipeline } from 'stream/promises';

// Modular sub-routes (extracted for maintainability)
import { cannedResponseRoutes } from './chat/cannedResponses';
import { macroRoutes } from './chat/macros';
import { blockedContactRoutes } from './chat/blockedContacts';
import { createBulkActionRoutes } from './chat/bulkActions';
import { createMessageRoutes } from './chat/messages';
import { schedulingRoutes } from './chat/scheduling';
import { notesRoutes } from './chat/notes';

// Ensure attachments directory exists
const attachmentsDir = path.join(__dirname, '../../uploads/attachments');
if (!fs.existsSync(attachmentsDir)) {
    fs.mkdirSync(attachmentsDir, { recursive: true });
}

export const createChatRoutes = (chatService: ChatService): FastifyPluginAsync => {
    return async (fastify) => {
        fastify.addHook('preHandler', requireAuthFastify);

        // Register modular sub-routes
        await fastify.register(cannedResponseRoutes);
        await fastify.register(macroRoutes);
        await fastify.register(blockedContactRoutes);
        await fastify.register(createBulkActionRoutes(chatService));
        await fastify.register(createMessageRoutes(chatService));
        await fastify.register(schedulingRoutes);
        await fastify.register(notesRoutes);

        // GET /conversations
        fastify.get('/conversations', async (request, reply) => {
            try {
                const query = request.query as { status?: string; assignedTo?: string; limit?: string; cursor?: string };
                const accountId = request.accountId;
                if (!accountId) return reply.code(400).send({ error: 'Account ID required' });

                const limit = Math.min(parseInt(query.limit || '50'), 100);
                // Fetch one extra to determine if there are more results
                const conversations = await chatService.listConversations(
                    accountId,
                    query.status,
                    query.assignedTo,
                    limit + 1,
                    query.cursor
                );

                const hasMore = conversations.length > limit;
                const result = hasMore ? conversations.slice(0, limit) : conversations;

                return {
                    conversations: result,
                    hasMore,
                    nextCursor: hasMore ? result[result.length - 1]?.id : null
                };
            } catch (error) {
                Logger.error('Failed to fetch conversations', { error });
                return reply.code(500).send({ error: 'Failed to fetch conversations' });
            }
        });

        // GET /conversations/search - Global search across conversations
        fastify.get('/conversations/search', async (request, reply) => {
            try {
                const { q, limit = '20' } = request.query as { q?: string; limit?: string };
                const accountId = request.accountId;
                if (!accountId) return reply.code(400).send({ error: 'Account ID required' });
                if (!q || q.trim().length < 2) return reply.code(400).send({ error: 'Search query must be at least 2 characters' });

                const searchTerm = q.trim().toLowerCase();
                const maxResults = Math.min(parseInt(limit), 50);

                const conversations = await prisma.conversation.findMany({
                    where: {
                        accountId,
                        OR: [
                            { messages: { some: { content: { contains: searchTerm, mode: 'insensitive' } } } },
                            { guestEmail: { contains: searchTerm, mode: 'insensitive' } },
                            { guestName: { contains: searchTerm, mode: 'insensitive' } },
                            { wooCustomer: { firstName: { contains: searchTerm, mode: 'insensitive' } } },
                            { wooCustomer: { lastName: { contains: searchTerm, mode: 'insensitive' } } },
                            { wooCustomer: { email: { contains: searchTerm, mode: 'insensitive' } } }
                        ]
                    },
                    include: {
                        wooCustomer: { select: { firstName: true, lastName: true, email: true } },
                        messages: { take: 1, orderBy: { createdAt: 'desc' } },
                        assignee: { select: { fullName: true } }
                    },
                    orderBy: { updatedAt: 'desc' },
                    take: maxResults
                });

                return { results: conversations, query: q };
            } catch (error) {
                Logger.error('Failed to search conversations', { error });
                return reply.code(500).send({ error: 'Failed to search conversations' });
            }
        });

        // POST /conversations
        fastify.post('/conversations', async (request, reply) => {
            const { accountId: bodyAccountId, wooCustomerId, visitorToken } = request.body as any;
            const accountId = request.accountId;
            if (!accountId) return reply.code(400).send({ error: 'Account ID required' });
            if (bodyAccountId && bodyAccountId !== accountId) {
                return reply.code(400).send({ error: 'Account ID mismatch' });
            }

            const conv = await chatService.createConversation(accountId, wooCustomerId, visitorToken);
            return conv;
        });

        // GET /email-accounts - List configured email accounts for sending
        fastify.get('/email-accounts', async (request, reply) => {
            try {
                const accountId = request.accountId;
                if (!accountId) return reply.code(400).send({ error: 'Account ID required' });

                const accounts = await prisma.emailAccount.findMany({
                    where: {
                        accountId,
                        OR: [
                            { smtpEnabled: true },
                            { relayEndpoint: { not: null } }
                        ]
                    },
                    select: { id: true, name: true, email: true }
                });
                return accounts;
            } catch (error) {
                Logger.error('Failed to fetch email accounts', { error });
                return reply.code(500).send({ error: 'Failed to fetch email accounts' });
            }
        });

        // POST /compose - Create conversation and send new email
        fastify.post('/compose', async (request, reply) => {
            try {
                const accountId = request.accountId;
                const userId = request.user?.id;

                let to, cc, subject, body, emailAccountId;
                const attachments: any[] = [];

                if (request.isMultipart()) {
                    const parts = request.parts();
                    for await (const part of parts) {
                        if (part.type === 'file') {
                            const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
                            const filename = uniqueSuffix + '-' + part.filename;
                            const filePath = path.join(attachmentsDir, filename);
                            await pipeline(part.file, fs.createWriteStream(filePath));
                            attachments.push({
                                filename: part.filename,
                                path: filePath,
                                contentType: part.mimetype
                            });
                        } else {
                            if (part.fieldname === 'to') to = (part as any).value;
                            if (part.fieldname === 'cc') cc = (part as any).value;
                            if (part.fieldname === 'subject') subject = (part as any).value;
                            if (part.fieldname === 'body') body = (part as any).value;
                            if (part.fieldname === 'emailAccountId') emailAccountId = (part as any).value;
                        }
                    }
                } else {
                    ({ to, cc, subject, body, emailAccountId } = request.body as any);
                }

                if (!accountId) return reply.code(400).send({ error: 'Account ID required' });
                if (!to || !subject || !body || !emailAccountId) {
                    return reply.code(400).send({ error: 'Missing required fields: to, subject, body, emailAccountId' });
                }

                let wooCustomerId: string | null = null;
                const existingCustomer = await prisma.wooCustomer.findFirst({
                    where: { accountId, email: to }
                });
                if (existingCustomer) wooCustomerId = existingCustomer.id;

                const conversation = await prisma.conversation.create({
                    data: {
                        accountId,
                        channel: 'EMAIL',
                        status: 'OPEN',
                        guestEmail: to,
                        wooCustomerId,
                        assignedTo: userId
                    }
                });

                let fullContent = `Subject: ${subject}\n\n${body}`;

                if (attachments.length > 0) {
                    fullContent += '\n\nAttachments:\n';
                    attachments.forEach(att => {
                        const filename = path.basename(att.path);
                        const url = `/uploads/attachments/${filename}`;
                        fullContent += `[${att.filename}](${url})\n`;
                    });
                }

                await chatService.addMessage(conversation.id, fullContent, 'AGENT', userId, false);

                const emailService = new EmailService();
                await emailService.sendEmail(accountId, emailAccountId, to, subject, body, attachments, {
                    source: 'INBOX',
                    sourceId: conversation.id
                });

                if (cc && cc.trim()) {
                    const ccRecipients = cc.split(',').map((e: string) => e.trim()).filter(Boolean);
                    for (const ccEmail of ccRecipients) {
                        await emailService.sendEmail(accountId, emailAccountId, ccEmail, subject, body, attachments, {
                            source: 'INBOX',
                            sourceId: conversation.id
                        });
                    }
                }

                Logger.info('Composed and sent new email', { conversationId: conversation.id, to });
                return { success: true, conversationId: conversation.id };
            } catch (error: any) {
                Logger.error('Failed to compose email', { error: error.message });
                return reply.code(500).send({ error: error.message || 'Failed to send email' });
            }
        });

        // POST /compose-ai - Generate AI-assisted email draft for new composition
        fastify.post('/compose-ai', async (request, reply) => {
            try {
                const accountId = request.accountId;
                const { recipient, subject, currentDraft } = request.body as {
                    recipient?: string;
                    subject?: string;
                    currentDraft?: string;
                };

                if (!accountId) return reply.code(400).send({ error: 'Account ID required' });
                if (!recipient || !subject) {
                    return reply.code(400).send({ error: 'Recipient and subject are required for AI assistance' });
                }

                const result = await InboxAIService.generateComposeAssist(accountId, recipient, subject, currentDraft);
                if (result.error) return reply.code(400).send({ error: result.error });
                return { draft: result.draft };
            } catch (error) {
                Logger.error('Failed to generate compose AI draft', { error });
                return reply.code(500).send({ error: 'Failed to generate AI draft' });
            }
        });

        // GET /unread-count
        fastify.get('/unread-count', async (request, reply) => {
            try {
                const accountId = request.accountId;
                if (!accountId) return reply.code(400).send({ error: 'Account ID required' });
                const count = await chatService.getUnreadCount(accountId);
                return { count };
            } catch (error) {
                Logger.error('Failed to get unread count', { error });
                return reply.code(500).send({ error: 'Failed to get unread count' });
            }
        });

        // --- Settings ---
        fastify.get('/settings', async (request, reply) => {
            const accountId = request.accountId;
            if (!accountId) return {};
            const feature = await prisma.accountFeature.findUnique({
                where: { accountId_featureKey: { accountId, featureKey: 'CHAT_SETTINGS' } }
            });
            return feature?.config || {};
        });

        fastify.post('/settings', async (request, reply) => {
            const accountId = request.accountId;
            if (!accountId) return {};
            const { enabled, businessHours, autoReply, position, showOnMobile, primaryColor, headerText, welcomeMessage, businessTimezone } = request.body as any;
            const config = { enabled, businessHours, autoReply, position, showOnMobile, primaryColor, headerText, welcomeMessage, businessTimezone };

            await prisma.accountFeature.upsert({
                where: { accountId_featureKey: { accountId, featureKey: 'CHAT_SETTINGS' } },
                update: { config, isEnabled: true },
                create: { accountId, featureKey: 'CHAT_SETTINGS', isEnabled: true, config }
            });
            return { success: true };
        });

        // GET /:id
        fastify.get<{ Params: { id: string } }>('/:id', async (request, reply) => {
            const conv = await chatService.getConversation(request.params.id);
            if (!conv) return reply.code(404).send({ error: 'Not found' });
            return conv;
        });

        // GET /:id/available-channels
        fastify.get<{ Params: { id: string } }>('/:id/available-channels', async (request, reply) => {
            try {
                const conv = await prisma.conversation.findUnique({
                    where: { id: request.params.id },
                    include: {
                        wooCustomer: true,
                        socialAccount: true,
                        mergedFrom: { include: { socialAccount: true } }
                    }
                });

                if (!conv) return reply.code(404).send({ error: 'Not found' });

                const channels: Array<{ channel: string; identifier: string; available: boolean }> = [];

                if (conv.channel === 'EMAIL' && (conv.wooCustomer?.email || conv.guestEmail)) {
                    channels.push({
                        channel: 'EMAIL',
                        identifier: conv.wooCustomer?.email || conv.guestEmail || 'Unknown',
                        available: true
                    });
                } else if (conv.channel === 'CHAT' && conv.visitorToken) {
                    channels.push({
                        channel: 'CHAT',
                        identifier: conv.guestName || 'Visitor',
                        available: true
                    });
                } else if (['FACEBOOK', 'INSTAGRAM', 'TIKTOK'].includes(conv.channel) && conv.socialAccount) {
                    channels.push({
                        channel: conv.channel,
                        identifier: conv.socialAccount.name,
                        available: true
                    });
                } else if (conv.channel === 'SMS' && conv.externalConversationId) {
                    channels.push({
                        channel: 'SMS',
                        identifier: conv.externalConversationId,
                        available: true
                    });
                }

                for (const merged of conv.mergedFrom) {
                    if (['FACEBOOK', 'INSTAGRAM', 'TIKTOK'].includes(merged.channel) && merged.socialAccount) {
                        if (!channels.find(c => c.channel === merged.channel)) {
                            channels.push({
                                channel: merged.channel,
                                identifier: merged.socialAccount.name,
                                available: true
                            });
                        }
                    } else if (merged.channel === 'EMAIL' && merged.guestEmail) {
                        if (!channels.find(c => c.channel === 'EMAIL')) {
                            channels.push({
                                channel: 'EMAIL',
                                identifier: merged.guestEmail,
                                available: true
                            });
                        }
                    } else if (merged.channel === 'SMS' && merged.externalConversationId) {
                        if (!channels.find(c => c.channel === 'SMS' && c.identifier === merged.externalConversationId)) {
                            channels.push({
                                channel: 'SMS',
                                identifier: merged.externalConversationId,
                                available: true
                            });
                        }
                    }
                }

                return { channels, currentChannel: conv.channel };
            } catch (error) {
                Logger.error('Failed to get available channels', { error });
                return reply.code(500).send({ error: 'Failed to get available channels' });
            }
        });

        // PUT /:id
        fastify.put<{ Params: { id: string } }>('/:id', async (request, reply) => {
            const { status, assignedTo, wooCustomerId } = request.body as any;
            const { id } = request.params;
            if (status) await chatService.updateStatus(id, status);
            if (assignedTo) await chatService.assignConversation(id, assignedTo);
            if (wooCustomerId) await chatService.linkCustomer(id, wooCustomerId);
            return { success: true };
        });

        // POST /:id/merge
        fastify.post<{ Params: { id: string } }>('/:id/merge', async (request, reply) => {
            const { sourceId } = request.body as any;
            await chatService.mergeConversations(request.params.id, sourceId);
            return { success: true };
        });

        // POST /:id/read
        fastify.post<{ Params: { id: string } }>('/:id/read', async (request, reply) => {
            try {
                await chatService.markAsRead(request.params.id);
                return { success: true };
            } catch (error) {
                Logger.error('Failed to mark conversation as read', { error });
                return reply.code(500).send({ error: 'Failed to mark as read' });
            }
        });

        // POST /:id/ai-draft
        fastify.post<{ Params: { id: string } }>('/:id/ai-draft', async (request, reply) => {
            try {
                const conversationId = request.params.id;
                const accountId = request.accountId;
                const { currentDraft } = request.body as { currentDraft?: string };
                if (!accountId) return reply.code(400).send({ error: 'Account ID required' });

                const result = await InboxAIService.generateDraftReply(conversationId, accountId, currentDraft);
                if (result.error) return reply.code(400).send({ error: result.error });
                return { draft: result.draft };
            } catch (error) {
                Logger.error('Failed to generate AI draft', { error });
                return reply.code(500).send({ error: 'Failed to generate AI draft' });
            }
        });
    };
};

// Legacy export for backward compatibility
export { createChatRoutes as createChatRouter };
