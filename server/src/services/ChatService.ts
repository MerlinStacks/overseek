/**
 * Chat Service
 * 
 * Core conversation and messaging functionality.
 * Email ingestion is delegated to EmailIngestion service.
 */

import { prisma } from '../utils/prisma';
import { Server } from 'socket.io';
import { Logger } from '../utils/logger';
import { EmailIngestion, IncomingEmailData } from './EmailIngestion';
import { BlockedContactService } from './BlockedContactService';
import { AutomationEngine } from './AutomationEngine';
import { EventBus, EVENTS } from './events';
import { cacheAside, CacheTTL, invalidateCache } from '../utils/cache';
import type { Prisma } from '@prisma/client';

type ConversationSort = 'updated' | 'priority';
type PriorityTier = 'HIGH' | 'MEDIUM' | 'LOW';

type ConversationCursor = {
    v: 1;
    type: 'conversation';
    sort: ConversationSort;
    updatedAt: string;
    id: string;
    priority?: PriorityTier;
};

type MessageCursor = {
    v: 1;
    type: 'message';
    createdAt: string;
    id: string;
};

export class InvalidChatCursorError extends Error {
    constructor() {
        super('Invalid cursor');
    }
}

function encodeCursor(cursor: ConversationCursor | MessageCursor): string {
    return Buffer.from(JSON.stringify(cursor)).toString('base64url');
}

function decodeCursor<T extends ConversationCursor | MessageCursor>(cursor: string, type: T['type']): T {
    try {
        const parsed = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8')) as T;
        const dateValue = parsed.type === 'message' ? parsed.createdAt : parsed.updatedAt;
        if (parsed.v !== 1 || parsed.type !== type || typeof parsed.id !== 'string'
            || typeof dateValue !== 'string' || !Number.isFinite(Date.parse(dateValue))) {
            throw new InvalidChatCursorError();
        }
        return parsed;
    } catch (error) {
        if (error instanceof InvalidChatCursorError) throw error;
        throw new InvalidChatCursorError();
    }
}

export class ChatService {
    private io: Server;
    private emailIngestion: EmailIngestion;
    private automationEngine: AutomationEngine;

    constructor(io: Server) {
        this.io = io;
        this.emailIngestion = new EmailIngestion(io, this.addMessage.bind(this));
        this.automationEngine = new AutomationEngine();
    }

    private static buildBlockedContactFilter(blockedEmails: string[]): Prisma.ConversationWhereInput {
        if (blockedEmails.length === 0) return {};

        return {
            AND: [
                {
                    OR: [
                        { guestEmail: null },
                        { guestEmail: { notIn: blockedEmails, mode: 'insensitive' } }
                    ]
                },
                {
                    OR: [
                        { wooCustomerId: null },
                        { wooCustomer: { email: { notIn: blockedEmails, mode: 'insensitive' } } }
                    ]
                }
            ]
        };
    }

    private static normalizePriority(priority?: string): PriorityTier {
        if (priority === 'HIGH' || priority === 'LOW') return priority;
        return 'MEDIUM';
    }

    static createConversationCursor(
        conversation: { id: string; updatedAt: Date | string; priority?: string },
        sort: ConversationSort
    ): string {
        return encodeCursor({
            v: 1,
            type: 'conversation',
            sort,
            updatedAt: new Date(conversation.updatedAt).toISOString(),
            id: conversation.id,
            ...(sort === 'priority' ? { priority: ChatService.normalizePriority(conversation.priority) } : {})
        });
    }

    static createMessageCursor(message: { id: string; createdAt: Date | string }): string {
        return encodeCursor({
            v: 1,
            type: 'message',
            createdAt: new Date(message.createdAt).toISOString(),
            id: message.id
        });
    }

    /**
     * List conversations with caching and pagination for performance.
     * Cached for 30 seconds to reduce database load.
     */
    async listConversations(
        accountId: string,
        status?: string,
        assignedTo?: string,
        limit: number = 25,
        cursor?: string,
        options?: {
            wooCustomerId?: string;
            guestEmail?: string;
            sort?: ConversationSort;
        }
    ) {
        const cacheKey = `conversations:${accountId}:${status || 'all'}:${assignedTo || 'all'}:${limit}:${cursor || 'start'}:${options?.wooCustomerId || 'any-customer'}:${options?.guestEmail || 'any-email'}:${options?.sort || 'updated'}`;

        return cacheAside(
            cacheKey,
            async () => {
                const blockedContactFilter = ChatService.buildBlockedContactFilter(
                    await BlockedContactService.listBlockedEmails(accountId)
                );
                const sort = options?.sort || 'updated';
                const decodedCursor = cursor
                    ? decodeCursor<ConversationCursor>(cursor, 'conversation')
                    : undefined;
                if (decodedCursor && (decodedCursor.sort !== sort
                    || (sort === 'priority' && !decodedCursor.priority))) {
                    throw new InvalidChatCursorError();
                }

                const baseWhere = {
                    accountId: String(accountId),
                    ...(status ? { status } : {}),
                    ...(assignedTo === '__unassigned__'
                        ? { assignedTo: null }
                        : assignedTo
                            ? { assignedTo }
                            : {}),
                    ...(options?.wooCustomerId ? { wooCustomerId: options.wooCustomerId } : {}),
                    ...(options?.guestEmail ? { guestEmail: options.guestEmail } : {}),
                    mergedIntoId: null,
                    ...blockedContactFilter
                } satisfies Prisma.ConversationWhereInput;
                const include = {
                    wooCustomer: {
                        select: {
                            id: true,
                            firstName: true,
                            lastName: true,
                            email: true,
                            ordersCount: true,
                            totalSpent: true,
                            wooId: true
                        }
                    },
                    assignee: { select: { id: true, fullName: true, avatarUrl: true } },
                    messages: {
                        orderBy: { createdAt: 'desc' as const },
                        take: 2,
                        select: { content: true, createdAt: true, senderType: true }
                    },
                    labels: {
                        select: {
                            label: {
                                select: { id: true, name: true, color: true }
                            }
                        }
                    }
                } satisfies Prisma.ConversationInclude;
                const orderBy: Prisma.ConversationOrderByWithRelationInput[] = [
                    { updatedAt: 'desc' },
                    { id: 'desc' }
                ];
                const after = (date: string, id: string): Prisma.ConversationWhereInput => ({
                    OR: [
                        { updatedAt: { lt: new Date(date) } },
                        { updatedAt: new Date(date), id: { lt: id } }
                    ]
                });

                let conversations;
                if (sort === 'updated') {
                    conversations = await prisma.conversation.findMany({
                        take: limit,
                        where: {
                            ...baseWhere,
                            ...(decodedCursor ? after(decodedCursor.updatedAt, decodedCursor.id) : {})
                        },
                        include,
                        orderBy
                    });
                } else {
                    const tiers: Array<{ name: PriorityTier; where: Prisma.ConversationWhereInput }> = [
                        { name: 'HIGH', where: { priority: 'HIGH' } },
                        { name: 'MEDIUM', where: { priority: { notIn: ['HIGH', 'LOW'] } } },
                        { name: 'LOW', where: { priority: 'LOW' } }
                    ];
                    const startTier = decodedCursor
                        ? tiers.findIndex(tier => tier.name === decodedCursor.priority)
                        : 0;
                    if (startTier < 0) throw new InvalidChatCursorError();

                    const tierPages = await Promise.all(tiers.slice(startTier).map((tier, index) =>
                        prisma.conversation.findMany({
                            take: limit,
                            where: {
                                ...baseWhere,
                                ...tier.where,
                                ...(decodedCursor && index === 0
                                    ? after(decodedCursor.updatedAt, decodedCursor.id)
                                    : {})
                            },
                            include,
                            orderBy
                        })
                    ));
                    conversations = tierPages.flat().slice(0, limit);
                }

                // Why: truncate message content before caching. Full message
                // bodies can be KBs each; list previews only need a snippet.
                // This dramatically reduces the serialized cache payload size.
                const enriched = conversations.map(c => {
                    const priorityData = ChatService.buildPriorityData(c);
                    return {
                        ...c,
                        priorityScore: priorityData.score,
                        priorityTier: priorityData.tier,
                        priorityReasons: priorityData.reasons,
                        messages: c.messages.map(m => ({
                            ...m,
                            content: m.content.length > 200
                                ? m.content.slice(0, 200) + '...'
                                : m.content
                        }))
                    };
                });

                return enriched;
            },
            { ttl: CacheTTL.SHORT, namespace: 'inbox' }
        );
    }

    /**
     * Compute an inbox priority score used to sort queue work.
     * Higher score means conversation should be handled sooner.
     */
    private static buildPriorityData(conversation: {
        priority?: string;
        isRead?: boolean;
        status?: string;
        updatedAt: Date;
        wooCustomer?: { totalSpent?: Prisma.Decimal | number | null; ordersCount?: number | null } | null;
    }): { score: number; tier: 'CRITICAL' | 'HIGH' | 'NORMAL' | 'LOW'; reasons: string[] } {
        const reasons: string[] = [];
        let score = 0;

        const priority = (conversation.priority || 'MEDIUM').toUpperCase();
        if (priority === 'HIGH') {
            score += 100;
            reasons.push('Marked high priority');
        } else if (priority === 'LOW') {
            score += 15;
        } else {
            score += 55;
        }

        if (conversation.isRead === false) {
            score += 30;
            reasons.push('Unread');
        }

        if ((conversation.status || 'OPEN') === 'OPEN') {
            score += 10;
        }

        const ageMinutes = Math.max(0, (Date.now() - new Date(conversation.updatedAt).getTime()) / 60000);
        const ageBonus = Math.min(40, Math.floor(ageMinutes / 15));
        if (ageBonus > 0) {
            score += ageBonus;
            if (ageMinutes >= 60) reasons.push(`Waiting ${Math.floor(ageMinutes)}m`);
        }

        const totalSpentRaw = conversation.wooCustomer?.totalSpent;
        const totalSpent = totalSpentRaw == null ? 0 : Number(totalSpentRaw);
        const ordersCount = conversation.wooCustomer?.ordersCount || 0;

        if (totalSpent >= 5000) {
            score += 45;
            reasons.push('VIP customer');
        } else if (totalSpent >= 1000) {
            score += 25;
            reasons.push('High-value customer');
        }

        if (ordersCount >= 10) {
            score += 15;
            reasons.push('Frequent buyer');
        } else if (ordersCount >= 5) {
            score += 8;
        }

        if (score >= 170) return { score, tier: 'CRITICAL', reasons };
        if (score >= 120) return { score, tier: 'HIGH', reasons };
        if (score >= 70) return { score, tier: 'NORMAL', reasons };
        return { score, tier: 'LOW', reasons };
    }

    /**
     * Invalidate conversation list cache for an account.
     * Call after any conversation mutation (message, status change, etc.)
     */
    private async invalidateConversationCache(accountId: string) {
        await invalidateCache('inbox', `conversations:${accountId}`);
    }

    async createConversation(accountId: string, wooCustomerId?: string, visitorToken?: string) {
        if (wooCustomerId !== undefined && !wooCustomerId.trim()) throw new Error('Customer ID is required');
        if (wooCustomerId) {
            const customer = await prisma.wooCustomer.findFirst({
                where: { id: wooCustomerId, accountId },
                select: { id: true }
            });
            if (!customer) throw new Error('Customer not found in this account');
        }

        const existing = await prisma.conversation.findFirst({
            where: {
                accountId: String(accountId),
                status: 'OPEN',
                OR: [
                    { wooCustomerId: wooCustomerId || undefined },
                    { visitorToken: visitorToken || undefined }
                ]
            }
        });
        if (existing) return existing;

        return prisma.conversation.create({
            data: {
                accountId: String(accountId),
                wooCustomerId,
                visitorToken,
                status: 'OPEN'
            }
        });
    }

    async getConversation(accountId: string, id: string, options?: { messageLimit?: number; before?: string }) {
        const messageLimit = Math.min(Math.max(options?.messageLimit || 100, 1), 200);
        const before = options?.before
            ? decodeCursor<MessageCursor>(options.before, 'message')
            : undefined;
        const blockedContactFilter = ChatService.buildBlockedContactFilter(
            await BlockedContactService.listBlockedEmails(accountId)
        );
        const conversation = await prisma.conversation.findFirst({
            where: { id, accountId, ...blockedContactFilter },
            include: {
                messages: {
                    where: before ? {
                        OR: [
                            { createdAt: { lt: new Date(before.createdAt) } },
                            { createdAt: new Date(before.createdAt), id: { lt: before.id } }
                        ]
                    } : undefined,
                    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
                    take: messageLimit + 1
                },
                wooCustomer: true,
                assignee: true,
                mergedFrom: {
                    select: {
                        id: true,
                        channel: true,
                        guestEmail: true,
                        guestName: true,
                        wooCustomer: { select: { email: true, firstName: true, lastName: true } },
                        socialAccount: { select: { name: true, platform: true } }
                    }
                }
            }
        });

        if (!conversation) return null;
        const hasMoreMessages = conversation.messages.length > messageLimit;
        const messagePage = hasMoreMessages
            ? conversation.messages.slice(0, messageLimit)
            : conversation.messages;
        const oldestReturnedMessage = messagePage[messagePage.length - 1];
        const messages = messagePage.reverse();

        // Fetch email tracking data for this conversation
        const emailLogs = await prisma.emailLog.findMany({
            where: { sourceId: id, status: 'SUCCESS' },
            select: {
                createdAt: true,
                firstOpenedAt: true,
                openCount: true,
                trackingId: true
            },
            orderBy: { createdAt: 'asc' }
        });

        // Match email logs to agent messages by creation time (within 5 seconds)
        // This allows us to associate tracking info with the correct message
        const enrichedMessages = messages.map(msg => {
            if (msg.senderType !== 'AGENT') return msg;

            // Find the closest email log sent around the same time
            const matchingLog = emailLogs.find(log => {
                const msgTime = new Date(msg.createdAt).getTime();
                const logTime = new Date(log.createdAt).getTime();
                return Math.abs(msgTime - logTime) < 5000; // 5 second window
            });

            if (matchingLog) {
                return {
                    ...msg,
                    trackingId: matchingLog.trackingId,
                    firstOpenedAt: matchingLog.firstOpenedAt,
                    openCount: matchingLog.openCount
                };
            }
            return msg;
        });

        return {
            ...conversation,
            messages: enrichedMessages,
            hasMoreMessages,
            nextMessageCursor: hasMoreMessages && oldestReturnedMessage
                ? ChatService.createMessageCursor(oldestReturnedMessage)
                : null
        };
    }

    async addMessage(
        conversationId: string,
        content: string,
        senderType: 'AGENT' | 'CUSTOMER' | 'SYSTEM',
        senderId?: string,
        isInternal: boolean = false,
        accountId?: string,
        clientRequestId?: string
    ) {
        // Resolve conversation first so we can enforce account ownership before writing.
        const conversation = await prisma.conversation.findFirst({
            where: {
                id: conversationId,
                ...(accountId ? { accountId } : {})
            },
            include: { wooCustomer: true }
        });

        if (!conversation) {
            Logger.error('[ChatService] Conversation not found', { conversationId });
            throw new Error('Conversation not found');
        }

        const message = await prisma.message.create({
            data: { conversationId, content, senderType, senderId, isInternal }
        });

        // Get the email to check for blocked status
        const contactEmail = conversation.wooCustomer?.email || conversation.guestEmail;

        // Check if sender is blocked (only for customer messages)
        let isBlocked = false;
        if (senderType === 'CUSTOMER' && contactEmail) {
            isBlocked = await BlockedContactService.isBlocked(conversation.accountId, contactEmail);
        }

        if (isBlocked) {
            // Hide blocked contact activity from the inbox while retaining the audit trail.
            await prisma.conversation.update({
                where: { id: conversationId },
                data: { status: 'CLOSED', updatedAt: new Date() }
            });
            await this.invalidateConversationCache(conversation.accountId);
            Logger.info('[ChatService] Blocked contact, suppressed inbox update', { contactEmail, conversationId });
            return message;
        } else {
            // Normal flow: update status to OPEN and mark as unread for customer messages
            await prisma.conversation.update({
                where: { id: conversationId },
                data: {
                    updatedAt: new Date(),
                    ...(!isInternal ? { status: 'OPEN' } : {}),
                    // Mark as unread when customer sends a message
                    ...(senderType === 'CUSTOMER' ? { isRead: false } : {})
                }
            });

            // Invalidate conversation cache when messages are added
            await this.invalidateConversationCache(conversation.accountId);
        }

        // Emit socket events for visible conversations.
        // Include accountId for client-side account isolation filtering
        this.io.to(`conversation:${conversationId}`).emit('message:new', {
            ...message,
            ...(clientRequestId ? { clientRequestId } : {}),
            accountId: conversation.accountId,
            priority: conversation.priority,
            assignedTo: conversation.assignedTo
        });
        this.io.to(`account:${conversation.accountId}`).emit('conversation:updated', {
            id: conversationId,
            lastMessage: message,
            updatedAt: message.createdAt,
            priority: conversation.priority
        });

        // Only handle autoreplies and push notifications for non-blocked customers
        if (senderType === 'CUSTOMER' && !isBlocked) {
            if (conversation.channel !== 'SMS') {
                await this.handleAutoReply(conversation);
            }

            // Emit event for NotificationEngine to handle push
            EventBus.emit(EVENTS.CHAT.MESSAGE_RECEIVED, {
                accountId: conversation.accountId,
                conversationId,
                content
            });

            // Trigger automation for customer messages
            this.automationEngine.processTrigger(conversation.accountId, 'MESSAGE_RECEIVED', {
                conversationId,
                messageId: message.id,
                content,
                senderType,
                customerEmail: conversation.wooCustomer?.email || conversation.guestEmail,
                customerId: conversation.wooCustomerId
            });
        }

        return message;
    }

    async assignConversation(accountId: string, id: string, userId: string | null) {
        if (userId) {
            const membership = await prisma.accountUser.findUnique({
                where: { userId_accountId: { userId, accountId } },
                select: { id: true }
            });
            if (!membership) throw new Error('Assignee is not a member of this account');
        }

        const existing = await prisma.conversation.findFirst({
            where: { id, accountId },
            select: { id: true }
        });
        if (!existing) {
            throw new Error('Conversation not found');
        }

        const conv = await prisma.conversation.update({
            where: { id: existing.id },
            data: { assignedTo: userId ?? null }
        });
        await this.invalidateConversationCache(conv.accountId);
        this.io.to(`conversation:${id}`).emit('conversation:assigned', { userId });

        // Trigger automation
        if (userId) {
            this.automationEngine.processTrigger(conv.accountId, 'CONVERSATION_ASSIGNED', {
                conversationId: id,
                assignedTo: userId
            });
        }

        return conv;
    }

    async updateStatus(accountId: string, id: string, status: string) {
        const existing = await prisma.conversation.findFirst({
            where: { id, accountId },
            select: { id: true }
        });
        if (!existing) {
            throw new Error('Conversation not found');
        }

        const conv = await prisma.conversation.update({ where: { id: existing.id }, data: { status } });

        // Invalidate cache when status changes
        await this.invalidateConversationCache(conv.accountId);

        // Trigger automation for closed conversations
        if (status === 'CLOSED') {
            this.automationEngine.processTrigger(conv.accountId, 'CONVERSATION_CLOSED', {
                conversationId: id
            });
        }

        return conv;
    }

    /**
     * Mark a conversation as read by staff
     */
    async markAsRead(accountId: string, id: string) {
        const existing = await prisma.conversation.findFirst({
            where: { id, accountId },
            select: { id: true, isRead: true }
        });
        if (!existing) {
            throw new Error('Conversation not found');
        }

        if (existing.isRead) return existing;

        const conv = await prisma.conversation.update({ where: { id: existing.id }, data: { isRead: true } });
        await this.invalidateConversationCache(accountId);
        // Emit socket event so other clients know it's been read
        this.io.to(`account:${conv.accountId}`).emit('conversation:read', { id });
        return conv;
    }

    /**
     * Get count of unread conversations for an account
     */
    async getUnreadCount(accountId: string): Promise<number> {
        const blockedContactFilter = ChatService.buildBlockedContactFilter(
            await BlockedContactService.listBlockedEmails(accountId)
        );
        return prisma.conversation.count({
            where: {
                accountId,
                isRead: false,
                status: 'OPEN',
                mergedIntoId: null,
                ...blockedContactFilter
            }
        });
    }

    async mergeConversations(accountId: string, targetId: string, sourceId: string) {
        if (targetId === sourceId) throw new Error('Cannot merge a conversation into itself');

        const [target, source] = await Promise.all([
            prisma.conversation.findFirst({
                where: { id: targetId, accountId },
                select: { id: true, mergedIntoId: true, isRead: true }
            }),
            prisma.conversation.findFirst({
                where: { id: sourceId, accountId },
                select: { id: true, mergedIntoId: true, isRead: true }
            })
        ]);
        if (!target || !source) {
            throw new Error('Conversation not found');
        }
        if (target.mergedIntoId || source.mergedIntoId) {
            throw new Error('Already merged conversations cannot be merged again');
        }

        // Why: wrap in transaction so partial failure (e.g., crash after moving
        // messages but before closing source) doesn't leave orphaned data.
        await prisma.$transaction(async (tx) => {
            const claim = await tx.conversation.updateMany({
                where: { id: source.id, accountId, mergedIntoId: null },
                data: { status: 'CLOSED', mergedIntoId: target.id }
            });
            if (claim.count !== 1) {
                throw new Error('Already merged conversations cannot be merged again');
            }

            await tx.message.updateMany({
                where: { conversationId: source.id },
                data: { conversationId: target.id }
            });
            await tx.conversation.updateMany({
                where: { accountId, mergedIntoId: source.id },
                data: { mergedIntoId: target.id }
            });
            // Assert after the unlocked work; a successful update locks the target through commit.
            const targetAssertion = await tx.conversation.updateMany({
                where: { id: target.id, accountId, mergedIntoId: null },
                data: {
                    updatedAt: new Date(),
                    ...(!source.isRead ? { isRead: false } : {})
                }
            });
            if (targetAssertion.count !== 1) {
                throw new Error('Already merged conversations cannot be merged again');
            }
            await tx.message.create({
                data: {
                    conversationId: target.id,
                    content: `Merged conversation #${source.id} into this thread.`,
                    senderType: 'SYSTEM'
                }
            });
        });
        await this.invalidateConversationCache(accountId);
        const payload = { targetId, sourceId };
        this.io.to(`conversation:${targetId}`).emit('conversation:merged', payload);
        this.io.to(`conversation:${sourceId}`).emit('conversation:merged', payload);
        this.io.to(`account:${accountId}`).emit('conversation:merged', payload);
        this.io.to(`account:${accountId}`).emit('conversation:updated', { id: targetId });
        return { success: true, ...payload };
    }

    async linkCustomer(accountId: string, conversationId: string, wooCustomerId: string) {
        if (!wooCustomerId.trim()) throw new Error('Customer ID is required');
        const [existing, customer] = await Promise.all([
            prisma.conversation.findFirst({
                where: { id: conversationId, accountId },
                select: { id: true }
            }),
            prisma.wooCustomer.findFirst({
                where: { id: wooCustomerId, accountId },
                select: { id: true }
            })
        ]);
        if (!existing) {
            throw new Error('Conversation not found');
        }
        if (!customer) throw new Error('Customer not found in this account');

        const conversation = await prisma.conversation.update({
            where: { id: existing.id },
            data: { wooCustomerId }
        });
        await this.invalidateConversationCache(accountId);
        return conversation;
    }

        async handleIncomingEmail(emailData: IncomingEmailData) {
        return this.emailIngestion.handleIncomingEmail(emailData);
    }

        private isOutsideBusinessHours(businessHours: any): boolean {
        const days = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];
        const now = new Date();
        const schedule = businessHours.days?.[days[now.getDay()]];
        if (!schedule?.isOpen) return true;
        const time = now.toTimeString().slice(0, 5);
        return time < schedule.open || time > schedule.close;
    }

    private async handleAutoReply(conversation: any) {
        const config = await prisma.accountFeature.findFirst({
            where: { accountId: conversation.accountId, featureKey: 'CHAT_SETTINGS' }
        });
        if (!config?.isEnabled || !config.config) return;

        const settings = config.config as any;
        if (!settings.businessHours?.enabled) return;

        if (this.isOutsideBusinessHours(settings.businessHours) && settings.businessHours.offlineMessage) {
            Logger.info('[AutoReply] Sending offline message', { conversationId: conversation.id });
            await this.addMessage(conversation.id, settings.businessHours.offlineMessage, 'SYSTEM');
        }
    }
}
