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

export class ChatService {
    private io: Server;
    private emailIngestion: EmailIngestion;

    constructor(io: Server) {
        this.io = io;
        this.emailIngestion = new EmailIngestion(io, this.addMessage.bind(this));
    }

    // --- Conversations ---

    async listConversations(accountId: String, status?: string, assignedTo?: string) {
        return prisma.conversation.findMany({
            where: {
                accountId: String(accountId),
                status: status || undefined,
                assignedTo: assignedTo || undefined,
                mergedIntoId: null
            },
            include: {
                wooCustomer: true,
                assignee: { select: { id: true, fullName: true, avatarUrl: true } },
                messages: { orderBy: { createdAt: 'desc' }, take: 1 },
                _count: { select: { messages: true } }
            },
            orderBy: { updatedAt: 'desc' }
        });
    }

    async createConversation(accountId: String, wooCustomerId?: string, visitorToken?: string) {
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

    async getConversation(id: string) {
        return prisma.conversation.findUnique({
            where: { id },
            include: {
                messages: { orderBy: { createdAt: 'asc' } },
                wooCustomer: true,
                assignee: true
            }
        });
    }

    // --- Messages ---

    async addMessage(
        conversationId: string,
        content: string,
        senderType: 'AGENT' | 'CUSTOMER' | 'SYSTEM',
        senderId?: string,
        isInternal: boolean = false
    ) {
        const message = await prisma.message.create({
            data: { conversationId, content, senderType, senderId, isInternal }
        });

        const conversation = await prisma.conversation.update({
            where: { id: conversationId },
            data: { updatedAt: new Date(), status: 'OPEN' }
        });

        this.io.to(`conversation:${conversationId}`).emit('message:new', message);
        this.io.to(`account:${conversation.accountId}`).emit('conversation:updated', {
            id: conversationId,
            lastMessage: message,
            updatedAt: new Date()
        });

        if (senderType === 'CUSTOMER') {
            await this.handleAutoReply(conversation);
            const { PushNotificationService } = require('./PushNotificationService');
            await PushNotificationService.sendToAccount(conversation.accountId, {
                title: '💬 New Chat Message',
                body: content.substring(0, 100) + (content.length > 100 ? '...' : ''),
                data: { url: '/inbox' }
            }, 'message');
        }

        return message;
    }

    // --- Actions ---

    async assignConversation(id: string, userId: string) {
        const conv = await prisma.conversation.update({
            where: { id },
            data: { assignedTo: userId }
        });
        this.io.to(`conversation:${id}`).emit('conversation:assigned', { userId });
        return conv;
    }

    async updateStatus(id: string, status: string) {
        return prisma.conversation.update({ where: { id }, data: { status } });
    }

    async mergeConversations(targetId: string, sourceId: string) {
        await prisma.message.updateMany({
            where: { conversationId: sourceId },
            data: { conversationId: targetId }
        });
        await prisma.conversation.update({
            where: { id: sourceId },
            data: { status: 'CLOSED', mergedIntoId: targetId }
        });
        await this.addMessage(targetId, `Merged conversation #${sourceId} into this thread.`, 'SYSTEM');
        return { success: true };
    }

    async linkCustomer(conversationId: string, wooCustomerId: string) {
        return prisma.conversation.update({
            where: { id: conversationId },
            data: { wooCustomerId }
        });
    }

    // --- Email delegation ---

    async handleIncomingEmail(emailData: IncomingEmailData) {
        return this.emailIngestion.handleIncomingEmail(emailData);
    }

    // --- Business Hours ---

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
