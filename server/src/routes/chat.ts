/**
 * Chat Routes - Fastify Plugin Factory
 * Requires ChatService injection for Socket.IO integration.
 */

import { FastifyPluginAsync } from 'fastify';
import { prisma } from '../utils/prisma';
import { ChatService } from '../services/ChatService';
import { EmailService } from '../services/EmailService';
import { InboxAIService } from '../services/InboxAIService';
import { BlockedContactService } from '../services/BlockedContactService';
import { MetaMessagingService } from '../services/messaging/MetaMessagingService';
import { TikTokMessagingService } from '../services/messaging/TikTokMessagingService';
import { TwilioService } from '../services/TwilioService';
import { LabelService } from '../services/LabelService';
import { requireAuthFastify } from '../middleware/auth';
import { Logger } from '../utils/logger';
import path from 'path';
import fs from 'fs';
import { pipeline } from 'stream/promises';

// Ensure attachments directory exists
const attachmentsDir = path.join(__dirname, '../../uploads/attachments');
if (!fs.existsSync(attachmentsDir)) {
    fs.mkdirSync(attachmentsDir, { recursive: true });
}

export const createChatRoutes = (chatService: ChatService): FastifyPluginAsync => {
    return async (fastify) => {
        fastify.addHook('preHandler', requireAuthFastify);

        // GET /conversations
        fastify.get('/conversations', async (request, reply) => {
            try {
                const query = request.query as { status?: string; assignedTo?: string };
                const accountId = request.accountId;
                if (!accountId) return reply.code(400).send({ error: 'Account ID required' });

                const conversations = await chatService.listConversations(accountId, query.status, query.assignedTo);
                return conversations;
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

                // Search in messages content and customer info
                const conversations = await prisma.conversation.findMany({
                    where: {
                        accountId,
                        OR: [
                            // Search in messages
                            { messages: { some: { content: { contains: searchTerm, mode: 'insensitive' } } } },
                            // Search in guest email/name
                            { guestEmail: { contains: searchTerm, mode: 'insensitive' } },
                            { guestName: { contains: searchTerm, mode: 'insensitive' } },
                            // Search in linked customer
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
                    where: { accountId, smtpEnabled: true },
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
                            // Fields
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

                // 1. Find existing WooCustomer by email
                let wooCustomerId: string | null = null;
                const existingCustomer = await prisma.wooCustomer.findFirst({
                    where: { accountId, email: to }
                });
                if (existingCustomer) wooCustomerId = existingCustomer.id;

                // 2. Create conversation with EMAIL channel
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

                // 3. Add message to conversation (store full content with subject and attachments)
                let fullContent = `Subject: ${subject}\n\n${body}`;

                if (attachments.length > 0) {
                    fullContent += '\n\nAttachments:\n';
                    attachments.forEach(att => {
                        // Convert file path to URL
                        const filename = path.basename(att.path);
                        const url = `/uploads/attachments/${filename}`;
                        fullContent += `[${att.filename}](${url})\n`;
                    });
                }

                await chatService.addMessage(conversation.id, fullContent, 'AGENT', userId, false);

                // 4. Send email via EmailService
                const emailService = new EmailService();
                await emailService.sendEmail(accountId, emailAccountId, to, subject, body, attachments, {
                    source: 'INBOX',
                    sourceId: conversation.id
                });

                // 5. Send to CC recipients if provided
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


        // --- Canned Response Labels ---
        fastify.get('/canned-labels', async (request, reply) => {
            const accountId = request.accountId;
            if (!accountId) return [];
            const labels = await prisma.cannedResponseLabel.findMany({
                where: { accountId },
                orderBy: { name: 'asc' }
            });
            return labels;
        });

        fastify.post('/canned-labels', async (request, reply) => {
            const { name, color } = request.body as any;
            const accountId = request.accountId;
            if (!accountId) return reply.code(400).send({ error: 'Account ID required' });
            if (!name?.trim()) return reply.code(400).send({ error: 'Name is required' });

            try {
                const label = await prisma.cannedResponseLabel.create({
                    data: { name: name.trim(), color: color || '#6366f1', accountId }
                });
                return label;
            } catch (error: any) {
                if (error.code === 'P2002') {
                    return reply.code(409).send({ error: 'A label with this name already exists' });
                }
                throw error;
            }
        });

        fastify.put<{ Params: { id: string } }>('/canned-labels/:id', async (request, reply) => {
            const { name, color } = request.body as any;
            const accountId = request.accountId;
            if (!accountId) return reply.code(400).send({ error: 'Account ID required' });

            try {
                const label = await prisma.cannedResponseLabel.update({
                    where: { id: request.params.id },
                    data: {
                        ...(name && { name: name.trim() }),
                        ...(color && { color })
                    }
                });
                return label;
            } catch (error: any) {
                if (error.code === 'P2002') {
                    return reply.code(409).send({ error: 'A label with this name already exists' });
                }
                if (error.code === 'P2025') {
                    return reply.code(404).send({ error: 'Label not found' });
                }
                throw error;
            }
        });

        fastify.delete<{ Params: { id: string } }>('/canned-labels/:id', async (request, reply) => {
            try {
                await prisma.cannedResponseLabel.delete({ where: { id: request.params.id } });
                return { success: true };
            } catch (error: any) {
                if (error.code === 'P2025') {
                    return reply.code(404).send({ error: 'Label not found' });
                }
                throw error;
            }
        });

        // --- Canned Responses ---
        fastify.get('/canned-responses', async (request, reply) => {
            const accountId = request.accountId;
            if (!accountId) return [];
            const responses = await prisma.cannedResponse.findMany({
                where: { accountId },
                include: { label: true },
                orderBy: [{ shortcut: 'asc' }]
            });
            return responses;
        });

        fastify.post('/canned-responses', async (request, reply) => {
            const { shortcut, content, labelId } = request.body as any;
            const accountId = request.accountId;
            if (!accountId) return reply.code(400).send({ error: 'Account ID required' });
            const resp = await prisma.cannedResponse.create({
                data: { shortcut, content, labelId: labelId || null, accountId },
                include: { label: true }
            });
            return resp;
        });

        fastify.put<{ Params: { id: string } }>('/canned-responses/:id', async (request, reply) => {
            const { shortcut, content, labelId } = request.body as any;
            const accountId = request.accountId;
            if (!accountId) return reply.code(400).send({ error: 'Account ID required' });

            const resp = await prisma.cannedResponse.update({
                where: { id: request.params.id },
                data: { shortcut, content, labelId: labelId || null },
                include: { label: true }
            });
            return resp;
        });

        fastify.delete<{ Params: { id: string } }>('/canned-responses/:id', async (request, reply) => {
            await prisma.cannedResponse.delete({ where: { id: request.params.id } });
            return { success: true };
        });

        // --- Conversation Notes ---
        fastify.get<{ Params: { id: string } }>('/conversations/:id/notes', async (request, reply) => {
            const notes = await prisma.conversationNote.findMany({
                where: { conversationId: request.params.id },
                include: { createdBy: { select: { id: true, fullName: true, avatarUrl: true } } },
                orderBy: { createdAt: 'desc' }
            });
            return notes;
        });

        fastify.post<{ Params: { id: string } }>('/conversations/:id/notes', async (request, reply) => {
            const { content } = request.body as any;
            const userId = (request as any).user?.id;
            if (!userId) return reply.code(401).send({ error: 'Unauthorized' });
            if (!content?.trim()) return reply.code(400).send({ error: 'Content required' });

            const note = await prisma.conversationNote.create({
                data: {
                    conversationId: request.params.id,
                    content: content.trim(),
                    createdById: userId
                },
                include: { createdBy: { select: { id: true, fullName: true, avatarUrl: true } } }
            });
            return note;
        });

        fastify.delete<{ Params: { id: string; noteId: string } }>('/conversations/:id/notes/:noteId', async (request, reply) => {
            await prisma.conversationNote.delete({ where: { id: request.params.noteId } });
            return { success: true };
        });

        // --- Inbox Macros ---
        fastify.get('/macros', async (request, reply) => {
            const accountId = request.accountId;
            if (!accountId) return [];
            return prisma.inboxMacro.findMany({
                where: { accountId },
                orderBy: { sortOrder: 'asc' }
            });
        });

        fastify.post('/macros', async (request, reply) => {
            const accountId = request.accountId;
            if (!accountId) return reply.code(400).send({ error: 'Account required' });
            const { name, icon, color, actions } = request.body as any;
            return prisma.inboxMacro.create({
                data: { accountId, name, icon, color, actions }
            });
        });

        fastify.put<{ Params: { id: string } }>('/macros/:id', async (request, reply) => {
            const { name, icon, color, actions, sortOrder } = request.body as any;
            return prisma.inboxMacro.update({
                where: { id: request.params.id },
                data: { name, icon, color, actions, sortOrder }
            });
        });

        fastify.delete<{ Params: { id: string } }>('/macros/:id', async (request, reply) => {
            await prisma.inboxMacro.delete({ where: { id: request.params.id } });
            return { success: true };
        });

        // Execute a macro on a conversation
        fastify.post<{ Params: { id: string } }>('/macros/:id/execute', async (request, reply) => {
            const { conversationId } = request.body as any;
            if (!conversationId) return reply.code(400).send({ error: 'conversationId required' });

            const macro = await prisma.inboxMacro.findUnique({ where: { id: request.params.id } });
            if (!macro) return reply.code(404).send({ error: 'Macro not found' });

            const actions = macro.actions as any[];
            const conv = await prisma.conversation.findUnique({ where: { id: conversationId } });
            if (!conv) return reply.code(404).send({ error: 'Conversation not found' });

            for (const action of actions) {
                if (action.type === 'ASSIGN' && action.userId) {
                    await prisma.conversation.update({
                        where: { id: conversationId },
                        data: { assignedTo: action.userId }
                    });
                }
                if (action.type === 'ADD_TAG' && action.labelId) {
                    await prisma.conversationLabelAssignment.upsert({
                        where: { conversationId_labelId: { conversationId, labelId: action.labelId } },
                        create: { conversationId, labelId: action.labelId },
                        update: {}
                    });
                }
                if (action.type === 'CLOSE') {
                    await prisma.conversation.update({
                        where: { id: conversationId },
                        data: { status: 'CLOSED' }
                    });
                }
                if (action.type === 'REOPEN') {
                    await prisma.conversation.update({
                        where: { id: conversationId },
                        data: { status: 'OPEN' }
                    });
                }
            }

            return { success: true, actionsExecuted: actions.length };
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
        // Returns all channels this conversation's customer can be reached on
        fastify.get<{ Params: { id: string } }>('/:id/available-channels', async (request, reply) => {
            try {
                const conv = await prisma.conversation.findUnique({
                    where: { id: request.params.id },
                    include: {
                        wooCustomer: true,
                        socialAccount: true,
                        // Get merged conversations to find all connected channels
                        mergedFrom: {
                            include: { socialAccount: true }
                        }
                    }
                });

                if (!conv) return reply.code(404).send({ error: 'Not found' });

                const channels: Array<{ channel: string; identifier: string; available: boolean }> = [];

                // Always add the current conversation's channel
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

                // Add channels from merged conversations
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

        // POST /:id/messages
        fastify.post<{ Params: { id: string } }>('/:id/messages', async (request, reply) => {
            const { content, type, isInternal, channel, emailAccountId } = request.body as any;
            const userId = request.user?.id;
            const accountId = request.accountId;

            // Store the message first
            const msg = await chatService.addMessage(request.params.id, content, type || 'AGENT', userId, isInternal);

            // If internal note, don't route externally
            if (isInternal) {
                return msg;
            }

            // Route to external channel if specified
            if (channel) {
                try {
                    const conversation = await prisma.conversation.findUnique({
                        where: { id: request.params.id },
                        include: {
                            wooCustomer: true,
                            socialAccount: true,
                            mergedFrom: { include: { socialAccount: true } }
                        }
                    });

                    if (!conversation) {
                        Logger.warn('[ChannelRouting] Conversation not found', { id: request.params.id });
                        return msg;
                    }

                    if (channel === 'EMAIL') {
                        // Route via email
                        const recipientEmail = conversation.wooCustomer?.email || conversation.guestEmail;
                        if (recipientEmail && accountId) {
                            // Use provided emailAccountId or fall back to default SMTP account
                            let emailAccount = null;
                            if (emailAccountId) {
                                emailAccount = await prisma.emailAccount.findUnique({
                                    where: { id: emailAccountId }
                                });
                            }
                            if (!emailAccount) {
                                const { getDefaultEmailAccount } = await import('../utils/getDefaultEmailAccount');
                                emailAccount = await getDefaultEmailAccount(accountId);
                            }
                            if (emailAccount) {
                                const emailService = new EmailService();
                                // Extract subject from content if it starts with Subject:
                                let subject = 'Re: Your inquiry';
                                let body = content;
                                if (content.startsWith('Subject:')) {
                                    const lines = content.split('\n');
                                    subject = lines[0].replace('Subject:', '').trim();
                                    body = lines.slice(2).join('\n');
                                }

                                // Get threading info from the conversation's email log
                                // Look for the original incoming email's message ID
                                const originalEmailLog = await prisma.emailLog.findFirst({
                                    where: {
                                        sourceId: conversation.id,
                                        messageId: { not: null }
                                    },
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
                        // Route via Meta
                        // Find the social account AND correct externalConversationId for this channel
                        let socialAccount = conversation.socialAccount?.platform === channel ? conversation.socialAccount : null;
                        let externalId = conversation.externalConversationId;

                        if (!socialAccount) {
                            const merged = conversation.mergedFrom.find(m => m.socialAccount?.platform === channel);
                            socialAccount = merged?.socialAccount || null;
                            externalId = merged?.externalConversationId || null;
                        }

                        if (socialAccount && externalId) {
                            // externalConversationId typically contains the sender's ID for Meta
                            const recipientId = externalId.split('_')[0];
                            const result = await MetaMessagingService.sendMessage(socialAccount.id, {
                                recipientId,
                                message: content.replace(/<[^>]*>/g, ''), // Strip HTML
                                messageType: 'RESPONSE'
                            });
                            if (result) {
                                Logger.info('[ChannelRouting] Meta message sent', { channel, messageId: result.messageId });
                            }
                        }
                    } else if (channel === 'TIKTOK') {
                        // Route via TikTok
                        // Find the social account AND correct externalConversationId for TikTok
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
                        // Route via Twilio
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
                } catch (routingError: any) {
                    Logger.error('[ChannelRouting] Failed to route message', { channel, error: routingError.message });
                    // Don't fail the request - message is still stored
                }
            }

            return msg;
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
                if (!accountId) return reply.code(400).send({ error: 'Account ID required' });

                const result = await InboxAIService.generateDraftReply(conversationId, accountId);
                if (result.error) return reply.code(400).send({ error: result.error });
                return { draft: result.draft };
            } catch (error) {
                Logger.error('Failed to generate AI draft', { error });
                return reply.code(500).send({ error: 'Failed to generate AI draft' });
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

        // --- Blocked Contacts ---
        fastify.post('/block', async (request, reply) => {
            try {
                const accountId = request.accountId;
                if (!accountId) return reply.code(400).send({ error: 'Account ID required' });

                const { email, reason } = request.body as any;
                if (!email) return reply.code(400).send({ error: 'Email is required' });

                const result = await BlockedContactService.blockContact(accountId, email, request.user?.id, reason);
                if (!result.success) return reply.code(500).send({ error: result.error });
                return { success: true };
            } catch (error) {
                Logger.error('Failed to block contact', { error });
                return reply.code(500).send({ error: 'Failed to block contact' });
            }
        });

        fastify.delete<{ Params: { email: string } }>('/block/:email', async (request, reply) => {
            try {
                const accountId = request.accountId;
                if (!accountId) return reply.code(400).send({ error: 'Account ID required' });

                const result = await BlockedContactService.unblockContact(accountId, decodeURIComponent(request.params.email));
                if (!result.success) return reply.code(500).send({ error: result.error });
                return { success: true };
            } catch (error) {
                Logger.error('Failed to unblock contact', { error });
                return reply.code(500).send({ error: 'Failed to unblock contact' });
            }
        });

        fastify.get('/blocked', async (request, reply) => {
            try {
                const accountId = request.accountId;
                if (!accountId) return reply.code(400).send({ error: 'Account ID required' });
                const blocked = await BlockedContactService.listBlocked(accountId);
                return blocked;
            } catch (error) {
                Logger.error('Failed to list blocked contacts', { error });
                return reply.code(500).send({ error: 'Failed to list blocked contacts' });
            }
        });

        fastify.get<{ Params: { email: string } }>('/block/check/:email', async (request, reply) => {
            try {
                const accountId = request.accountId;
                if (!accountId) return reply.code(400).send({ error: 'Account ID required' });

                const isBlocked = await BlockedContactService.isBlocked(accountId, decodeURIComponent(request.params.email));
                return { isBlocked };
            } catch (error) {
                Logger.error('Failed to check blocked status', { error });
                return reply.code(500).send({ error: 'Failed to check blocked status' });
            }
        });

        // === CONVERSATION LABELS ===
        const labelService = new LabelService();

        // GET /:id/labels - Get labels for a conversation
        fastify.get<{ Params: { id: string } }>('/:id/labels', async (request, reply) => {
            try {
                const labels = await labelService.getConversationLabels(request.params.id);
                return { labels };
            } catch (error) {
                Logger.error('Failed to get conversation labels', { error });
                return reply.code(500).send({ error: 'Failed to get labels' });
            }
        });

        // POST /:id/labels/:labelId - Assign a label to conversation
        fastify.post<{ Params: { id: string; labelId: string } }>('/:id/labels/:labelId', async (request, reply) => {
            try {
                const assignment = await labelService.assignLabel(request.params.id, request.params.labelId);
                return { success: true, label: assignment.label };
            } catch (error: any) {
                if (error.code === 'P2025') {
                    return reply.code(404).send({ error: 'Conversation or label not found' });
                }
                Logger.error('Failed to assign label', { error });
                return reply.code(500).send({ error: 'Failed to assign label' });
            }
        });

        // DELETE /:id/labels/:labelId - Remove a label from conversation
        fastify.delete<{ Params: { id: string; labelId: string } }>('/:id/labels/:labelId', async (request, reply) => {
            try {
                await labelService.removeLabel(request.params.id, request.params.labelId);
                return { success: true };
            } catch (error: any) {
                if (error.code === 'P2025') {
                    return reply.code(404).send({ error: 'Label assignment not found' });
                }
                Logger.error('Failed to remove label', { error });
                return reply.code(500).send({ error: 'Failed to remove label' });
            }
        });

        // === MESSAGE SCHEDULING ===

        // POST /:id/messages/schedule - Schedule a message for later
        fastify.post<{ Params: { id: string } }>('/:id/messages/schedule', async (request, reply) => {
            try {
                const { content, scheduledFor, isInternal } = request.body as any;
                const userId = request.user?.id;

                if (!content || !scheduledFor) {
                    return reply.code(400).send({ error: 'Content and scheduledFor are required' });
                }

                const scheduledDate = new Date(scheduledFor);
                if (scheduledDate <= new Date()) {
                    return reply.code(400).send({ error: 'Scheduled time must be in the future' });
                }

                const message = await prisma.message.create({
                    data: {
                        conversationId: request.params.id,
                        content,
                        senderType: 'AGENT',
                        senderId: userId,
                        isInternal: isInternal || false,
                        scheduledFor: scheduledDate,
                        scheduledBy: userId,
                    },
                });

                Logger.info('Message scheduled', { messageId: message.id, scheduledFor: scheduledDate });
                return { success: true, message };
            } catch (error) {
                Logger.error('Failed to schedule message', { error });
                return reply.code(500).send({ error: 'Failed to schedule message' });
            }
        });

        // DELETE /messages/:id/schedule - Cancel a scheduled message
        fastify.delete<{ Params: { id: string } }>('/messages/:id/schedule', async (request, reply) => {
            try {
                const message = await prisma.message.findUnique({
                    where: { id: request.params.id },
                    select: { scheduledFor: true, scheduledBy: true },
                });

                if (!message) {
                    return reply.code(404).send({ error: 'Message not found' });
                }

                if (!message.scheduledFor) {
                    return reply.code(400).send({ error: 'Message is not scheduled' });
                }

                // Delete the scheduled message entirely
                await prisma.message.delete({ where: { id: request.params.id } });

                Logger.info('Scheduled message cancelled', { messageId: request.params.id });
                return { success: true };
            } catch (error) {
                Logger.error('Failed to cancel scheduled message', { error });
                return reply.code(500).send({ error: 'Failed to cancel scheduled message' });
            }
        });

        // === SNOOZE ===

        // POST /:id/snooze - Snooze a conversation
        fastify.post<{ Params: { id: string } }>('/:id/snooze', async (request, reply) => {
            try {
                const { until } = request.body as any;

                if (!until) {
                    return reply.code(400).send({ error: 'Snooze until time is required' });
                }

                const snoozeUntil = new Date(until);
                if (snoozeUntil <= new Date()) {
                    return reply.code(400).send({ error: 'Snooze time must be in the future' });
                }

                const conversation = await prisma.conversation.update({
                    where: { id: request.params.id },
                    data: {
                        status: 'SNOOZED',
                        snoozedUntil: snoozeUntil,
                    },
                });

                Logger.info('Conversation snoozed', { conversationId: conversation.id, until: snoozeUntil });
                return { success: true, snoozedUntil: snoozeUntil };
            } catch (error: any) {
                if (error.code === 'P2025') {
                    return reply.code(404).send({ error: 'Conversation not found' });
                }
                Logger.error('Failed to snooze conversation', { error });
                return reply.code(500).send({ error: 'Failed to snooze conversation' });
            }
        });

        // DELETE /:id/snooze - Cancel snooze (reopen conversation)
        fastify.delete<{ Params: { id: string } }>('/:id/snooze', async (request, reply) => {
            try {
                const conversation = await prisma.conversation.update({
                    where: { id: request.params.id },
                    data: {
                        status: 'OPEN',
                        snoozedUntil: null,
                    },
                });

                Logger.info('Snooze cancelled', { conversationId: conversation.id });
                return { success: true };
            } catch (error: any) {
                if (error.code === 'P2025') {
                    return reply.code(404).send({ error: 'Conversation not found' });
                }
                Logger.error('Failed to cancel snooze', { error });
                return reply.code(500).send({ error: 'Failed to cancel snooze' });
            }
        });

        // === BULK ACTIONS ===

        // POST /conversations/bulk - Perform bulk actions on multiple conversations
        fastify.post('/conversations/bulk', async (request, reply) => {
            try {
                const accountId = request.accountId;
                const userId = request.user?.id;
                const { conversationIds, action, labelId, assignToUserId } = request.body as {
                    conversationIds: string[];
                    action: 'close' | 'open' | 'assign' | 'addLabel' | 'removeLabel';
                    labelId?: string;
                    assignToUserId?: string;
                };

                if (!conversationIds || !Array.isArray(conversationIds) || conversationIds.length === 0) {
                    return reply.code(400).send({ error: 'conversationIds array is required' });
                }

                if (!action) {
                    return reply.code(400).send({ error: 'action is required' });
                }

                let result: { updated: number } = { updated: 0 };

                switch (action) {
                    case 'close': {
                        const closeResult = await prisma.conversation.updateMany({
                            where: { id: { in: conversationIds }, accountId },
                            data: { status: 'CLOSED' },
                        });
                        result.updated = closeResult.count;
                        break;
                    }

                    case 'open': {
                        const openResult = await prisma.conversation.updateMany({
                            where: { id: { in: conversationIds }, accountId },
                            data: { status: 'OPEN', snoozedUntil: null },
                        });
                        result.updated = openResult.count;
                        break;
                    }

                    case 'assign': {
                        if (!assignToUserId) {
                            return reply.code(400).send({ error: 'assignToUserId is required for assign action' });
                        }
                        const assignResult = await prisma.conversation.updateMany({
                            where: { id: { in: conversationIds }, accountId },
                            data: { assignedTo: assignToUserId },
                        });
                        result.updated = assignResult.count;
                        break;
                    }

                    case 'addLabel': {
                        if (!labelId) {
                            return reply.code(400).send({ error: 'labelId is required for addLabel action' });
                        }
                        await labelService.bulkAssignLabel(conversationIds, labelId);
                        result.updated = conversationIds.length;
                        break;
                    }

                    case 'removeLabel': {
                        if (!labelId) {
                            return reply.code(400).send({ error: 'labelId is required for removeLabel action' });
                        }
                        const removeResult = await labelService.bulkRemoveLabel(conversationIds, labelId);
                        result.updated = removeResult.count;
                        break;
                    }

                    default:
                        return reply.code(400).send({ error: `Unknown action: ${action}` });
                }

                Logger.info('Bulk action completed', { action, count: result.updated, userId });
                return { success: true, ...result };
            } catch (error) {
                Logger.error('Failed to perform bulk action', { error });
                return reply.code(500).send({ error: 'Failed to perform bulk action' });
            }
        });

        // POST /conversations/bulk-merge - Merge multiple conversations into one
        fastify.post('/conversations/bulk-merge', async (request, reply) => {
            try {
                const accountId = request.accountId;
                const userId = request.user?.id;
                const { targetId, sourceIds } = request.body as {
                    targetId: string;
                    sourceIds: string[];
                };

                if (!targetId) {
                    return reply.code(400).send({ error: 'targetId is required' });
                }

                if (!sourceIds || !Array.isArray(sourceIds) || sourceIds.length === 0) {
                    return reply.code(400).send({ error: 'sourceIds array is required' });
                }

                // Verify target conversation exists and belongs to this account
                const targetConv = await prisma.conversation.findFirst({
                    where: { id: targetId, accountId }
                });

                if (!targetConv) {
                    return reply.code(404).send({ error: 'Target conversation not found' });
                }

                // Merge each source into target sequentially
                let mergedCount = 0;
                for (const sourceId of sourceIds) {
                    try {
                        await chatService.mergeConversations(targetId, sourceId);
                        mergedCount++;
                    } catch (mergeError: any) {
                        Logger.warn('Failed to merge individual conversation', {
                            targetId,
                            sourceId,
                            error: mergeError.message
                        });
                    }
                }

                Logger.info('Bulk merge completed', {
                    targetId,
                    sourceCount: sourceIds.length,
                    mergedCount,
                    userId
                });

                return { success: true, mergedCount };
            } catch (error) {
                Logger.error('Failed to perform bulk merge', { error });
                return reply.code(500).send({ error: 'Failed to perform bulk merge' });
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

// Legacy export for backward compatibility
export { createChatRoutes as createChatRouter };
