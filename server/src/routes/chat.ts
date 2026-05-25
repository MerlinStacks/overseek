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
import { Prisma } from '@prisma/client';
import { prisma } from '../utils/prisma';
import { ChatService } from '../services/ChatService';
import { EmailService } from '../services/EmailService';
import { TwilioService } from '../services/TwilioService';
import { InboxAIService } from '../services/InboxAIService';
import { requireAuthFastify } from '../middleware/auth';
import { Logger } from '../utils/logger';
import { isAccountFeatureEnabled } from '../utils/accountFeatures';
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

const MAX_RELAY_ATTACHMENTS = 10;
const MAX_RELAY_ATTACHMENT_BYTES = 10 * 1024 * 1024;

function toSmsPlainText(content: string): string {
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

export const createChatRoutes = (chatService: ChatService): FastifyPluginAsync => {
    return async (fastify) => {
        fastify.addHook('preHandler', requireAuthFastify);

        const ensureEmailFeatureEnabled = async (accountId: string, reply: any): Promise<boolean> => {
            const enabled = await isAccountFeatureEnabled(accountId, 'EMAIL', true);
            if (!enabled) {
                reply.code(403).send({ error: 'Email feature is disabled for this account' });
                return false;
            }

            return true;
        };

        // Register modular sub-routes
        await fastify.register(cannedResponseRoutes);
        await fastify.register(macroRoutes);
        await fastify.register(blockedContactRoutes);
        await fastify.register(createBulkActionRoutes(chatService));
        await fastify.register(createMessageRoutes(chatService));
        await fastify.register(schedulingRoutes);
        await fastify.register(notesRoutes, { prefix: '/conversations' });

        // GET /conversations
        fastify.get('/conversations', async (request, reply) => {
            try {
                const query = request.query as {
                    status?: string;
                    assignedTo?: string;
                    limit?: string;
                    cursor?: string;
                    wooCustomerId?: string;
                    guestEmail?: string;
                    sort?: 'updated' | 'priority';
                };
                const accountId = request.accountId;
                if (!accountId) return reply.code(400).send({ error: 'Account ID required' });
                if (!(await ensureEmailFeatureEnabled(accountId, reply))) return;

                const limit = Math.min(parseInt(query.limit || '50', 10), 100);
                // Fetch one extra to determine if there are more results
                const conversations = await chatService.listConversations(
                    accountId,
                    query.status,
                    query.assignedTo,
                    limit + 1,
                    query.cursor,
                    {
                        wooCustomerId: query.wooCustomerId,
                        guestEmail: query.guestEmail,
                        sort: query.sort || 'updated'
                    }
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
                const { q, limit = '20', status = 'ALL' } = request.query as { q?: string; limit?: string; status?: string };
                const accountId = request.accountId;
                if (!accountId) return reply.code(400).send({ error: 'Account ID required' });
                if (!q || q.trim().length < 2) return reply.code(400).send({ error: 'Search query must be at least 2 characters' });

                const rawQuery = q.trim();
                const searchTerm = rawQuery.toLowerCase();
                const maxResults = Math.min(parseInt(limit, 10), 50);

                // Supports search patterns:
                // - "file:pdf" to find attachment file types
                // - "attachment:invoice" to find attachment filenames
                const fileTypeMatch = rawQuery.match(/file:([a-z0-9]+)/i);
                const attachmentNameMatch = rawQuery.match(/attachment:([^\s]+)/i);
                const fileType = fileTypeMatch?.[1]?.toLowerCase();
                const attachmentName = attachmentNameMatch?.[1]?.toLowerCase();
                const genericAttachmentNeedle = rawQuery
                    .replace(/file:[a-z0-9]+/gi, '')
                    .replace(/attachment:[^\s]+/gi, '')
                    .trim()
                    .toLowerCase();

                const attachmentFilters: Prisma.ConversationWhereInput[] = [];
                if (fileType) {
                    attachmentFilters.push({
                        messages: {
                            some: {
                                content: { contains: `.${fileType}](/uploads/attachments/`, mode: 'insensitive' }
                            }
                        }
                    });
                }
                if (attachmentName) {
                    attachmentFilters.push({
                        messages: {
                            some: {
                                AND: [
                                    { content: { contains: '/uploads/attachments/', mode: 'insensitive' } },
                                    { content: { contains: attachmentName, mode: 'insensitive' } }
                                ]
                            }
                        }
                    });
                }
                if (genericAttachmentNeedle) {
                    attachmentFilters.push({
                        messages: {
                            some: {
                                AND: [
                                    { content: { contains: '/uploads/attachments/', mode: 'insensitive' } },
                                    { content: { contains: genericAttachmentNeedle, mode: 'insensitive' } }
                                ]
                            }
                        }
                    });
                }

                const normalizedStatus = status.toUpperCase();
                const statusFilter = normalizedStatus === 'ALL'
                    ? undefined
                    : normalizedStatus === 'OPEN'
                        ? 'OPEN'
                        : normalizedStatus === 'CLOSED'
                            ? 'CLOSED'
                            : null;

                if (statusFilter === null) {
                    return reply.code(400).send({ error: 'Invalid status filter' });
                }

                const blockedContacts = await prisma.blockedContact.findMany({
                    where: { accountId },
                    select: { email: true }
                });
                const blockedEmails = blockedContacts.map((contact) => contact.email.toLowerCase());

                const baseWhere: Prisma.ConversationWhereInput = {
                    accountId,
                    ...(statusFilter ? { status: statusFilter } : {}),
                    ...(blockedEmails.length > 0
                        ? {
                            NOT: {
                                OR: [
                                    { guestEmail: { in: blockedEmails } },
                                    { wooCustomer: { is: { email: { in: blockedEmails } } } }
                                ]
                            }
                        }
                        : {}),
                };

                const directFieldFilters: Prisma.ConversationWhereInput[] = [
                    { guestEmail: { contains: searchTerm, mode: 'insensitive' } },
                    { guestName: { contains: searchTerm, mode: 'insensitive' } },
                    { title: { contains: searchTerm, mode: 'insensitive' } },
                    { wooCustomer: { firstName: { contains: searchTerm, mode: 'insensitive' } } },
                    { wooCustomer: { lastName: { contains: searchTerm, mode: 'insensitive' } } },
                    { wooCustomer: { email: { contains: searchTerm, mode: 'insensitive' } } },
                ];

                const includePayload = {
                    wooCustomer: { select: { firstName: true, lastName: true, email: true } },
                    messages: { take: 1, orderBy: { createdAt: 'desc' as const } },
                    assignee: { select: { fullName: true } }
                };

                const directMatches = await prisma.conversation.findMany({
                    where: {
                        ...baseWhere,
                        OR: directFieldFilters,
                    },
                    include: includePayload,
                    orderBy: { updatedAt: 'desc' },
                    take: maxResults,
                });

                if (directMatches.length >= maxResults) {
                    return { results: directMatches, query: q };
                }

                const messageFilters: Prisma.ConversationWhereInput[] = [
                    { messages: { some: { content: { contains: searchTerm, mode: 'insensitive' } } } },
                    ...attachmentFilters,
                ];

                if (messageFilters.length === 0) {
                    return { results: directMatches, query: q };
                }

                const messageMatches = await prisma.conversation.findMany({
                    where: {
                        ...baseWhere,
                        ...(directMatches.length > 0
                            ? { id: { notIn: directMatches.map((conv) => conv.id) } }
                            : {}),
                        OR: [
                            ...messageFilters
                        ]
                    },
                    include: includePayload,
                    orderBy: { updatedAt: 'desc' },
                    take: maxResults - directMatches.length
                });

                const conversations = [...directMatches, ...messageMatches]
                    .sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime())
                    .slice(0, maxResults);

                return { results: conversations, query: q };
            } catch (error) {
                Logger.error('Failed to search conversations', { error });
                return reply.code(500).send({ error: 'Failed to search conversations' });
            }
        });

        // POST /conversations
        fastify.post('/conversations', async (request, reply) => {
            try {
                const { accountId: bodyAccountId, wooCustomerId, visitorToken } = request.body as any;
                const accountId = request.accountId;
                if (!accountId) return reply.code(400).send({ error: 'Account ID required' });
                if (bodyAccountId && bodyAccountId !== accountId) {
                    return reply.code(400).send({ error: 'Account ID mismatch' });
                }
                if (wooCustomerId !== undefined && typeof wooCustomerId !== 'string') {
                    return reply.code(400).send({ error: 'wooCustomerId must be a string' });
                }
                if (visitorToken !== undefined && typeof visitorToken !== 'string') {
                    return reply.code(400).send({ error: 'visitorToken must be a string' });
                }

                const conv = await chatService.createConversation(accountId, wooCustomerId, visitorToken);
                return conv;
            } catch (error) {
                Logger.error('Failed to create conversation', { error });
                return reply.code(500).send({ error: 'Failed to create conversation' });
            }
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
                    select: { id: true, name: true, email: true, isDefault: true }
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
                if (!accountId) return reply.code(400).send({ error: 'Account ID required' });
                if (!(await ensureEmailFeatureEnabled(accountId, reply))) return;

                let to, cc, subject, body, emailAccountId;
                const attachments: any[] = [];

                const cleanupAttachments = () => {
                    for (const attachment of attachments) {
                        try {
                            if (attachment?.path && fs.existsSync(attachment.path)) {
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

                            const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
                            const filename = uniqueSuffix + '-' + part.filename;
                            const filePath = path.join(attachmentsDir, filename);
                            await pipeline(part.file, fs.createWriteStream(filePath));

                            const stats = fs.statSync(filePath);
                            if (stats.size > MAX_RELAY_ATTACHMENT_BYTES) {
                                try { fs.unlinkSync(filePath); } catch { /* ignore cleanup errors */ }
                                cleanupAttachments();
                                return reply.code(400).send({ error: `Attachment exceeds 10 MB limit: ${part.filename}` });
                            }

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

                if (!to || !subject || !body || !emailAccountId) {
                    return reply.code(400).send({ error: 'Missing required fields: to, subject, body, emailAccountId' });
                }

                // Validate email format
                const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
                if (!emailRegex.test(to)) {
                    return reply.code(400).send({ error: 'Invalid email format for "to" address' });
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

                await chatService.addMessage(conversation.id, fullContent, 'AGENT', userId, false, accountId);

                const emailService = new EmailService();
                await emailService.sendEmail(accountId, emailAccountId, to, subject, body, attachments, {
                    source: 'INBOX',
                    sourceId: conversation.id,
                    category: 'TRANSACTIONAL'
                });

                if (cc && cc.trim()) {
                    const ccRecipients = cc.split(',').map((e: string) => e.trim()).filter(Boolean);
                    for (const ccEmail of ccRecipients) {
                        await emailService.sendEmail(accountId, emailAccountId, ccEmail, subject, body, attachments, {
                            source: 'INBOX',
                            sourceId: conversation.id,
                            category: 'TRANSACTIONAL'
                        });
                    }
                }

                Logger.info('Composed and sent new email', { conversationId: conversation.id, to });
                return { success: true, conversationId: conversation.id };
            } catch (error: any) {
                Logger.error('Failed to compose email', { error: error.message });
                return reply.code(500).send({ error: 'Failed to send email' });
            }
        });

        // POST /compose-sms - Create conversation and send new SMS
        fastify.post('/compose-sms', async (request, reply) => {
            try {
                const accountId = request.accountId;
                const userId = request.user?.id;
                if (!accountId) return reply.code(400).send({ error: 'Account ID required' });

                let to: string | undefined;
                let body: string | undefined;

                if (request.isMultipart()) {
                    const parts = request.parts();
                    for await (const part of parts) {
                        if (part.type === 'field') {
                            if (part.fieldname === 'to') to = String((part as any).value || '');
                            if (part.fieldname === 'body') body = String((part as any).value || '');
                        }
                    }
                } else {
                    ({ to, body } = request.body as { to?: string; body?: string });
                }

                if (!to || !body) {
                    return reply.code(400).send({ error: 'Missing required fields: to, body' });
                }

                const normalizedInput = to.replace(/[^\d+]/g, '');
                const smsDigits = normalizedInput.startsWith('+') ? normalizedInput.slice(1) : normalizedInput;
                if (smsDigits.length < 10 || smsDigits.length > 15) {
                    return reply.code(400).send({ error: 'Invalid phone number format' });
                }

                const smsSettings = await TwilioService.getSettings(accountId);
                if (!smsSettings?.enabled) {
                    return reply.code(400).send({ error: 'SMS settings not configured or disabled for this account.' });
                }
                const normalizedTo = TwilioService.normalizeToE164(to.trim(), smsSettings.fromNumber);

                const conversation = await prisma.conversation.create({
                    data: {
                        accountId,
                        channel: 'SMS',
                        status: 'OPEN',
                        externalConversationId: normalizedTo,
                        assignedTo: userId
                    }
                });

                const plainBody = toSmsPlainText(body);
                await chatService.addMessage(conversation.id, plainBody, 'AGENT', userId, false, accountId);
                await TwilioService.sendSms(accountId, normalizedTo, plainBody);

                Logger.info('Composed and sent new SMS', { conversationId: conversation.id, to });
                return { success: true, conversationId: conversation.id };
            } catch (error: any) {
                Logger.error('Failed to compose SMS', { error: error.message });
                return reply.code(500).send({ error: 'Failed to send SMS' });
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
                if (!(await ensureEmailFeatureEnabled(accountId, reply))) return;
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
        fastify.get('/settings', async (request, _reply) => {
            const accountId = request.accountId;
            if (!accountId) return {};
            const feature = await prisma.accountFeature.findUnique({
                where: { accountId_featureKey: { accountId, featureKey: 'CHAT_SETTINGS' } }
            });
            return feature?.config || {};
        });

        fastify.post('/settings', async (request, _reply) => {
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
            const accountId = request.accountId;
            if (!accountId) return reply.code(400).send({ error: 'Account ID required' });
            const conv = await chatService.getConversation(accountId, request.params.id);
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

                if (!conv || conv.accountId !== request.accountId) {
                    return reply.code(404).send({ error: 'Not found' });
                }

                const channels: Array<{ channel: string; identifier: string; available: boolean; unavailableReason?: string }> = [];
                const smsSettings = await prisma.smsSettings.findUnique({
                    where: { accountId: conv.accountId },
                    select: { enabled: true, fromNumber: true }
                });
                const isSmsEnabled = Boolean(smsSettings?.enabled);

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
                } else if (conv.channel === 'SMS' && conv.externalConversationId && isSmsEnabled) {
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
                    } else if (merged.channel === 'SMS' && merged.externalConversationId && isSmsEnabled) {
                        if (!channels.find(c => c.channel === 'SMS' && c.identifier === merged.externalConversationId)) {
                            channels.push({
                                channel: 'SMS',
                                identifier: merged.externalConversationId,
                                available: true
                            });
                        }
                    }
                }

                const wooCustomerPhone = extractWooCustomerPhone(conv.wooCustomer?.rawData);
                if (isSmsEnabled && wooCustomerPhone && smsSettings?.fromNumber) {
                    try {
                        const normalizedPhone = TwilioService.normalizeToE164(wooCustomerPhone, smsSettings.fromNumber);
                        if (!channels.find(c => c.channel === 'SMS' && c.identifier === normalizedPhone)) {
                            channels.push({
                                channel: 'SMS',
                                identifier: normalizedPhone,
                                available: true
                            });
                        }
                    } catch {
                        // Ignore invalid customer phone numbers for channel availability.
                    }
                }

                const hasSmsRecipient = channels.some(c => c.channel === 'SMS' && c.available);
                if (!hasSmsRecipient && isSmsEnabled) {
                    channels.push({
                        channel: 'SMS',
                        identifier: 'No mobile number',
                        available: false,
                        unavailableReason: 'Customer has no mobile number configured'
                    });
                }

                return { channels, currentChannel: conv.channel };
            } catch (error) {
                Logger.error('Failed to get available channels', { error });
                return reply.code(500).send({ error: 'Failed to get available channels' });
            }
        });

        // PUT /:id
        fastify.put<{ Params: { id: string } }>('/:id', async (request, reply) => {
            try {
                const body = request.body as { status?: string; assignedTo?: string | null; wooCustomerId?: string };
                const { status, wooCustomerId } = body;
                const { id } = request.params;
                const accountId = request.accountId;
                if (!accountId) return reply.code(400).send({ error: 'Account ID required' });
                if (status && !['OPEN', 'PENDING', 'RESOLVED', 'CLOSED'].includes(status)) {
                    return reply.code(400).send({ error: 'Invalid conversation status' });
                }
                if (wooCustomerId !== undefined && typeof wooCustomerId !== 'string') {
                    return reply.code(400).send({ error: 'wooCustomerId must be a string' });
                }
                if (Object.prototype.hasOwnProperty.call(body, 'assignedTo') && body.assignedTo !== null && typeof body.assignedTo !== 'string') {
                    return reply.code(400).send({ error: 'assignedTo must be a string or null' });
                }

                if (status) await chatService.updateStatus(accountId, id, status);
                if (Object.prototype.hasOwnProperty.call(body, 'assignedTo')) {
                    await chatService.assignConversation(accountId, id, body.assignedTo || null);
                }
                if (wooCustomerId) await chatService.linkCustomer(accountId, id, wooCustomerId);
                return { success: true };
            } catch (error) {
                Logger.error('Failed to update conversation', { error, conversationId: request.params.id });
                return reply.code(500).send({ error: 'Failed to update conversation' });
            }
        });

        // POST /:id/merge
        fastify.post<{ Params: { id: string } }>('/:id/merge', async (request, reply) => {
            try {
                const { sourceId } = request.body as any;
                const accountId = request.accountId;
                if (!accountId) return reply.code(400).send({ error: 'Account ID required' });
                if (!sourceId || typeof sourceId !== 'string') {
                    return reply.code(400).send({ error: 'sourceId is required' });
                }
                if (sourceId === request.params.id) {
                    return reply.code(400).send({ error: 'Cannot merge a conversation into itself' });
                }

                await chatService.mergeConversations(accountId, request.params.id, sourceId);
                return { success: true };
            } catch (error) {
                Logger.error('Failed to merge conversations', { error, targetId: request.params.id });
                return reply.code(500).send({ error: 'Failed to merge conversations' });
            }
        });

        // POST /:id/read
        fastify.post<{ Params: { id: string } }>('/:id/read', async (request, reply) => {
            try {
                const accountId = request.accountId;
                if (!accountId) return reply.code(400).send({ error: 'Account ID required' });

                await chatService.markAsRead(accountId, request.params.id);
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
