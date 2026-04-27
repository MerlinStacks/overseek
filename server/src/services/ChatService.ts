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
import { TwilioService } from './TwilioService';
import { cacheAside, CacheTTL, invalidateCache } from '../utils/cache';
import type { Prisma } from '@prisma/client';

export class ChatService {
    private io: Server;
    private emailIngestion: EmailIngestion;
    private automationEngine: AutomationEngine;

    constructor(io: Server) {
        this.io = io;
        this.emailIngestion = new EmailIngestion(io, this.addMessage.bind(this));
        this.automationEngine = new AutomationEngine();
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
            sort?: 'updated' | 'priority';
        }
    ) {
        const cacheKey = `conversations:${accountId}:${status || 'all'}:${assignedTo || 'all'}:${limit}:${cursor || 'start'}:${options?.wooCustomerId || 'any-customer'}:${options?.guestEmail || 'any-email'}:${options?.sort || 'updated'}`;

        return cacheAside(
            cacheKey,
            async () => {
                const conversations = await prisma.conversation.findMany({
                    take: limit,
                    skip: cursor ? 1 : 0,
                    cursor: cursor ? { id: cursor } : undefined,
                    where: {
                        accountId: String(accountId),
                        ...(status ? { status } : {}),
                        ...(assignedTo === '__unassigned__'
                            ? { assignedTo: null }
                            : assignedTo
                                ? { assignedTo }
                                : {}),
                        ...(options?.wooCustomerId ? { wooCustomerId: options.wooCustomerId } : {}),
                        ...(options?.guestEmail ? { guestEmail: options.guestEmail } : {}),
                        mergedIntoId: null
                    } satisfies Prisma.ConversationWhereInput,
                    include: {
                        // Only fetch fields needed for display
                        wooCustomer: {
                            select: {
                                firstName: true,
                                lastName: true,
                                email: true,
                                ordersCount: true,
                                totalSpent: true,
                                wooId: true
                            }
                        },
                        assignee: { select: { id: true, fullName: true, avatarUrl: true } },
                        // Only need last 2 messages for preview and timing
                        messages: {
                            orderBy: { createdAt: 'desc' },
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
                    },
                    orderBy: { updatedAt: 'desc' }
                });

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

                if (options?.sort === 'priority') {
                    return enriched.sort((a, b) => {
                        if (b.priorityScore !== a.priorityScore) return b.priorityScore - a.priorityScore;
                        return new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime();
                    });
                }

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

    async getConversation(accountId: string, id: string) {
        const conversation = await prisma.conversation.findFirst({
            where: { id, accountId },
            include: {
                messages: { orderBy: { createdAt: 'asc' } },
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
        const enrichedMessages = conversation.messages.map(msg => {
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

        return { ...conversation, messages: enrichedMessages };
    }

    async addMessage(
        conversationId: string,
        content: string,
        senderType: 'AGENT' | 'CUSTOMER' | 'SYSTEM',
        senderId?: string,
        isInternal: boolean = false,
        accountId?: string
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

        // Handle Outbound SMS (Agent replies)
        if (senderType === 'AGENT' && !isInternal && conversation.channel === 'SMS') {
            try {
                const to = conversation.externalConversationId; // Phone number stored here
                if (to) {
                    await TwilioService.sendSms(conversation.accountId, to, content);
                } else {
                    Logger.warn('[ChatService] Cannot send SMS, no phone number found', { conversationId });
                }
            } catch (error) {
                Logger.error('[ChatService] Failed to send outbound SMS', { error, conversationId });
                // We still return the message, but maybe we should mark it as failed?
                // For now, we'll just log the error.
            }
        }

        // Get the email to check for blocked status
        const contactEmail = conversation.wooCustomer?.email || conversation.guestEmail;

        // Check if sender is blocked (only for customer messages)
        let isBlocked = false;
        if (senderType === 'CUSTOMER' && contactEmail) {
            isBlocked = await BlockedContactService.isBlocked(conversation.accountId, contactEmail);
        }

        if (isBlocked) {
            // Auto-close without autoreplies or push notifications
            await prisma.conversation.update({
                where: { id: conversationId },
                data: { status: 'CLOSED', updatedAt: new Date() }
            });
            Logger.info('[ChatService] Blocked contact, auto-resolved', { contactEmail, conversationId });
        } else {
            // Normal flow: update status to OPEN and mark as unread for customer messages
            await prisma.conversation.update({
                where: { id: conversationId },
                data: {
                    updatedAt: new Date(),
                    status: 'OPEN',
                    // Mark as unread when customer sends a message
                    ...(senderType === 'CUSTOMER' ? { isRead: false } : {})
                }
            });

            // Invalidate conversation cache when messages are added
            await this.invalidateConversationCache(conversation.accountId);
        }

        // Emit socket events (always, so UI stays in sync)
        // Include accountId for client-side account isolation filtering
        this.io.to(`conversation:${conversationId}`).emit('message:new', {
            ...message,
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
            await this.handleAutoReply(conversation);

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
            select: { id: true }
        });
        if (!existing) {
            throw new Error('Conversation not found');
        }

        const conv = await prisma.conversation.update({
            where: { id: existing.id },
            data: { isRead: true }
        });
        // Emit socket event so other clients know it's been read
        this.io.to(`account:${conv.accountId}`).emit('conversation:read', { id });
        return conv;
    }

    /**
     * Get count of unread conversations for an account
     */
    async getUnreadCount(accountId: string): Promise<number> {
        return prisma.conversation.count({
            where: {
                accountId,
                isRead: false,
                status: 'OPEN',
                mergedIntoId: null
            }
        });
    }

    async mergeConversations(accountId: string, targetId: string, sourceId: string) {
        const [target, source] = await Promise.all([
            prisma.conversation.findFirst({
                where: { id: targetId, accountId },
                select: { id: true }
            }),
            prisma.conversation.findFirst({
                where: { id: sourceId, accountId },
                select: { id: true }
            })
        ]);
        if (!target || !source) {
            throw new Error('Conversation not found');
        }

        // Why: wrap in transaction so partial failure (e.g., crash after moving
        // messages but before closing source) doesn't leave orphaned data.
        await prisma.$transaction(async (tx) => {
            await tx.message.updateMany({
                where: { conversationId: source.id },
                data: { conversationId: target.id }
            });
            await tx.conversation.update({
                where: { id: source.id },
                data: { status: 'CLOSED', mergedIntoId: target.id }
            });
            await tx.message.create({
                data: {
                    conversationId: target.id,
                    content: `Merged conversation #${source.id} into this thread.`,
                    senderType: 'SYSTEM'
                }
            });
        });
        return { success: true };
    }

    async linkCustomer(accountId: string, conversationId: string, wooCustomerId: string) {
        const existing = await prisma.conversation.findFirst({
            where: { id: conversationId, accountId },
            select: { id: true }
        });
        if (!existing) {
            throw new Error('Conversation not found');
        }

        return prisma.conversation.update({
            where: { id: existing.id },
            data: { wooCustomerId }
        });
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
