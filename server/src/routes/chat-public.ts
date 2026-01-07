import { Router } from 'express';
import { prisma } from '../utils/prisma';
import { ChatService } from '../services/ChatService';
import { Logger } from '../utils/logger';

export const createPublicChatRouter = (chatService: ChatService) => {
    const router = Router();

    // POST /api/chat/public/conversation
    // Start or resume a conversation for a guest visitor
    router.post('/conversation', async (req, res) => {
        try {
            const { accountId, visitorToken, name, email } = req.body;

            if (!accountId || !visitorToken) {
                return res.status(400).json({ error: 'Missing accountId or visitorToken' });
            }

            // 1. Check for existing open conversation
            let conversation = await prisma.conversation.findFirst({
                where: {
                    accountId,
                    visitorToken,
                    status: 'OPEN'
                },
                include: {
                    messages: {
                        orderBy: { createdAt: 'asc' }
                    },
                    assignee: {
                        select: { id: true, fullName: true, avatarUrl: true }
                    }
                }
            });

            // 2. If not found, create new
            if (!conversation) {
                conversation = await prisma.conversation.create({
                    data: {
                        accountId,
                        visitorToken,
                        status: 'OPEN',
                        // If we have name/email, we could try to link or create a WooCustomer?
                        // For now just store in context if needed, or rely on messages.
                    },
                    include: {
                        messages: true,
                        assignee: {
                            select: { id: true, fullName: true, avatarUrl: true }
                        }
                    }
                });

                // Add system start message? Or just wait for user to type.
            }

            res.json(conversation);

        } catch (error) {
            Logger.error('Public chat conversation error', { error });
            res.status(500).json({ error: 'Failed to start conversation' });
        }
    });

    // POST /api/chat/public/:id/messages
    // Send a message as a guest
    router.post('/:id/messages', async (req, res) => {
        try {
            const { content, visitorToken } = req.body;
            const conversationId = req.params.id;

            // Verify ownership via token
            const conversation = await prisma.conversation.findUnique({
                where: { id: conversationId }
            });

            if (!conversation || conversation.visitorToken !== visitorToken) {
                return res.status(403).json({ error: 'Unauthorized access to conversation' });
            }

            const msg = await chatService.addMessage(
                conversationId,
                content,
                'CUSTOMER'
            );

            res.json(msg);

        } catch (error) {
            Logger.error('Public message error', { error });
            res.status(500).json({ error: 'Failed to send message' });
        }
    });

    // GET /api/chat/public/:id/messages
    // Poll for updates (since we can't easily do socket auth for guests without more work)
    router.get('/:id/messages', async (req, res) => {
        try {
            const { visitorToken, after } = req.query;
            const conversationId = req.params.id;

            // Verify ownership
            const conversation = await prisma.conversation.findUnique({
                where: { id: conversationId }
            });

            if (!conversation || conversation.visitorToken !== String(visitorToken)) {
                return res.status(403).json({ error: 'Unauthorized' });
            }

            const whereClause: any = {
                conversationId
            };

            if (after) {
                whereClause.createdAt = { gt: new Date(String(after)) };
            }

            const messages = await prisma.message.findMany({
                where: whereClause,
                orderBy: { createdAt: 'asc' }
            });

            res.json(messages);

        } catch (error) {
            Logger.error('Public poll error', { error });
            res.status(500).json({ error: 'Failed to fetch messages' });
        }
    });

    return router;
};
