
import { prisma } from '../utils/prisma';
import { Server, Socket } from 'socket.io';
import { Logger } from '../utils/logger';

export class ChatService {
    private io: Server;

    constructor(io: Server) {
        this.io = io;
    }

    // --- Conversations ---

    async listConversations(accountId: String, status?: string, assignedTo?: string) {
        return prisma.conversation.findMany({
            where: {
                accountId: String(accountId),
                status: status || undefined,
                assignedTo: assignedTo || undefined,
                mergedIntoId: null // Don't show merged/archived ones by default
            },
            include: {
                wooCustomer: true,
                assignee: { select: { id: true, fullName: true, avatarUrl: true } },
                messages: {
                    orderBy: { createdAt: 'desc' },
                    take: 1
                },
                _count: {
                    select: { messages: true }
                }
            },
            orderBy: { updatedAt: 'desc' }
        });
    }

    async createConversation(accountId: String, wooCustomerId?: string, visitorToken?: string) {
        // Check for existing open conversation for this visitor/customer
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
            data: {
                conversationId,
                content,
                senderType,
                senderId,
                isInternal
            }
        });

        // Update conversation timestamp
        const conversation = await prisma.conversation.update({
            where: { id: conversationId },
            data: { updatedAt: new Date(), status: 'OPEN' } // Re-open if closed
        });

        // Emit socket event
        this.io.to(`conversation:${conversationId}`).emit('message:new', message);

        // Notify account room (for inbox lists)
        this.io.to(`account:${conversation.accountId}`).emit('conversation:updated', {
            id: conversationId,
            lastMessage: message,
            updatedAt: new Date()
        });

        // Handle Auto-Replies if sender is CUSTOMER
        if (senderType === 'CUSTOMER') {
            await this.handleAutoReply(conversation);
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
        return prisma.conversation.update({
            where: { id },
            data: { status }
        });
    }

    async mergeConversations(targetId: string, sourceId: string) {
        // 1. Move all messages from source to target
        await prisma.message.updateMany({
            where: { conversationId: sourceId },
            data: { conversationId: targetId }
        });

        // 2. Mark source as merged
        await prisma.conversation.update({
            where: { id: sourceId },
            data: {
                status: 'CLOSED',
                mergedIntoId: targetId
            }
        });

        // 3. Add system note
        await this.addMessage(targetId, `Merged conversation #${sourceId} into this thread.`, 'SYSTEM');

        return { success: true };
    }

    async linkCustomer(conversationId: string, wooCustomerId: string) {
        return prisma.conversation.update({
            where: { id: conversationId },
            data: { wooCustomerId }
        });
    }

    // --- Internal Logic ---

    private async handleAutoReply(conversation: any) {
        // Check business hours logic (Generic placeholder for now)
        // we would check AccountFeature config here

        /* 
        const config = await prisma.accountFeature.findFirst({
            where: { accountId: conversation.accountId, featureKey: 'CHAT_SETTINGS' }
        });
        if (config?.isEnabled && isOutsideBusinessHours(config.config)) {
           await this.addMessage(conversation.id, config.config.offlineMessage, 'SYSTEM');
        }
        */
    }
    async handleIncomingEmail(emailData: {
        emailAccountId: string;
        fromEmail: string;
        fromName?: string;
        subject: string;
        body: string;
        messageId: string;
    }) {
        const { emailAccountId, fromEmail, fromName, subject, body, messageId } = emailData;

        // 1. Find the Account ID for this Email Account
        const emailVars = await prisma.emailAccount.findUnique({
            where: { id: emailAccountId },
            select: { accountId: true }
        });

        if (!emailVars) {
            Logger.error(`Email Account not found`, { emailAccountId });
            return;
        }

        const accountId = emailVars.accountId;

        // 2. Try to find an open conversation with this customer email
        // We need to look up WooCustomer by email first to find conversation linked to them
        // OR search conversation by some other means (e.g. subject containing Ticket ID in future)
        let conversation = await prisma.conversation.findFirst({
            where: {
                accountId,
                status: 'OPEN',
                wooCustomer: { email: fromEmail }
            }
        });

        // 3. If no conversation, create one
        if (!conversation) {
            // Find or create WooCustomer placeholder? 
            // For now, let's see if we have a customer with this email
            const customer = await prisma.wooCustomer.findFirst({
                where: { accountId, email: fromEmail }
            });

            conversation = await prisma.conversation.create({
                data: {
                    accountId,
                    status: 'OPEN',
                    wooCustomerId: customer?.id,
                    // If no customer, we might need a way to store "Guest Email" on conversation
                    // For now, we rely on the first message or context.
                    // Ideally: Add `guestEmail` field to Conversation or use VisitorToken as email hash?
                    // Let's create a System Message with the email info if no customer profile exists.
                    priority: 'MEDIUM'
                }
            });

            if (!customer) {
                // Determine if we should create a "Lead" or just leave it.
                // Let's prepend a header in the message body for now.
            }
        }

        // 4. Add the message
        await this.addMessage(
            conversation.id,
            `Subject: ${subject}\n\n${body}`,
            'CUSTOMER',
            undefined, // No senderId if we don't have a user/customer ID exactly linked yet. 
            // Note: addMessage logic might need tweaking if senderId is required? 
            // schema says senderId is String? (optional).
            false
        );

        Logger.info(`Imported email to Conversation`, { fromEmail, conversationId: conversation.id });
    }
}

