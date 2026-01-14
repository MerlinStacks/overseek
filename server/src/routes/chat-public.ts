/**
 * Public Chat Routes - Fastify Plugin Factory
 * Public-facing endpoints for guest visitors.
 * 
 * Features:
 * - Auto-links visitors to existing WooCommerce customers by email
 * - Stores guest name/email for non-customers
 * - Sets channel to LIVE_CHAT for proper categorization
 */

import { FastifyPluginAsync } from 'fastify';
import { prisma } from '../utils/prisma';
import { ChatService } from '../services/ChatService';
import { Logger } from '../utils/logger';

export const createPublicChatRoutes = (chatService: ChatService): FastifyPluginAsync => {
    return async (fastify) => {
        // POST /conversation - Start or resume a conversation for a guest visitor
        fastify.post('/conversation', async (request, reply) => {
            try {
                const { accountId, visitorToken, name, email } = request.body as any;

                if (!accountId || !visitorToken) {
                    return reply.code(400).send({ error: 'Missing accountId or visitorToken' });
                }

                // Check for existing open conversation
                let conversation = await prisma.conversation.findFirst({
                    where: { accountId, visitorToken, status: 'OPEN' },
                    include: {
                        messages: { orderBy: { createdAt: 'asc' } },
                        assignee: { select: { id: true, fullName: true, avatarUrl: true } },
                        wooCustomer: { select: { id: true, firstName: true, lastName: true, email: true, totalSpent: true, ordersCount: true } }
                    }
                });

                // If not found, create new with WooCommerce customer linking
                if (!conversation) {
                    // Try to find existing WooCommerce customer by email
                    let wooCustomerId: string | undefined;
                    if (email) {
                        const customer = await prisma.wooCustomer.findFirst({
                            where: { accountId, email: email.toLowerCase() }
                        });
                        if (customer) {
                            wooCustomerId = customer.id;
                            Logger.info('[PublicChat] Linked visitor to WooCommerce customer', {
                                email,
                                customerId: customer.id,
                                customerName: `${customer.firstName} ${customer.lastName}`.trim()
                            });
                        }
                    }

                    conversation = await prisma.conversation.create({
                        data: {
                            accountId,
                            visitorToken,
                            status: 'OPEN',
                            channel: 'CHAT',
                            wooCustomerId,
                            guestEmail: wooCustomerId ? undefined : email || undefined,
                            guestName: wooCustomerId ? undefined : name || undefined
                        },
                        include: {
                            messages: true,
                            assignee: { select: { id: true, fullName: true, avatarUrl: true } },
                            wooCustomer: { select: { id: true, firstName: true, lastName: true, email: true, totalSpent: true, ordersCount: true } }
                        }
                    });

                    Logger.info('[PublicChat] Created new conversation', {
                        conversationId: conversation.id,
                        hasCustomerLink: !!wooCustomerId,
                        guestEmail: email
                    });
                } else {
                    // Existing conversation - try to link customer if not already linked and email provided
                    if (!conversation.wooCustomerId && email) {
                        const customer = await prisma.wooCustomer.findFirst({
                            where: { accountId, email: email.toLowerCase() }
                        });
                        if (customer) {
                            conversation = await prisma.conversation.update({
                                where: { id: conversation.id },
                                data: {
                                    wooCustomerId: customer.id,
                                    guestEmail: null,
                                    guestName: null
                                },
                                include: {
                                    messages: { orderBy: { createdAt: 'asc' } },
                                    assignee: { select: { id: true, fullName: true, avatarUrl: true } },
                                    wooCustomer: { select: { id: true, firstName: true, lastName: true, email: true, totalSpent: true, ordersCount: true } }
                                }
                            });
                            Logger.info('[PublicChat] Linked existing conversation to WooCommerce customer', {
                                conversationId: conversation.id,
                                customerId: customer.id
                            });
                        }
                    }
                }

                return conversation;
            } catch (error) {
                Logger.error('Public chat conversation error', { error });
                return reply.code(500).send({ error: 'Failed to start conversation' });
            }
        });

        // POST /:id/messages - Send a message as a guest
        fastify.post<{ Params: { id: string } }>('/:id/messages', async (request, reply) => {
            try {
                const { content, visitorToken } = request.body as any;
                const conversationId = request.params.id;

                const conversation = await prisma.conversation.findUnique({ where: { id: conversationId } });
                if (!conversation || conversation.visitorToken !== visitorToken) {
                    return reply.code(403).send({ error: 'Unauthorized access to conversation' });
                }

                const msg = await chatService.addMessage(conversationId, content, 'CUSTOMER');
                return msg;
            } catch (error) {
                Logger.error('Public message error', { error });
                return reply.code(500).send({ error: 'Failed to send message' });
            }
        });

        // GET /:id/messages - Poll for updates
        fastify.get<{ Params: { id: string } }>('/:id/messages', async (request, reply) => {
            try {
                const query = request.query as { visitorToken?: string; after?: string };
                const conversationId = request.params.id;

                const conversation = await prisma.conversation.findUnique({ where: { id: conversationId } });
                if (!conversation || conversation.visitorToken !== query.visitorToken) {
                    return reply.code(403).send({ error: 'Unauthorized' });
                }

                const whereClause: any = { conversationId };
                if (query.after) {
                    whereClause.createdAt = { gt: new Date(query.after) };
                }

                const messages = await prisma.message.findMany({
                    where: whereClause,
                    orderBy: { createdAt: 'asc' }
                });

                return messages;
            } catch (error) {
                Logger.error('Public poll error', { error });
                return reply.code(500).send({ error: 'Failed to fetch messages' });
            }
        });
    };
};

// Legacy export for backward compatibility
export { createPublicChatRoutes as createPublicChatRouter };

