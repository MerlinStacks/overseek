/**
 * Blocked Contacts Routes
 * 
 * Handles blocking/unblocking contacts from the inbox.
 * Extracted from chat.ts for maintainability.
 */

import { FastifyPluginAsync } from 'fastify';
import { BlockedContactService } from '../../services/BlockedContactService';
import { requireAuthFastify } from '../../middleware/auth';
import { Logger } from '../../utils/logger';

export const blockedContactRoutes: FastifyPluginAsync = async (fastify) => {
    fastify.addHook('preHandler', requireAuthFastify);

    // POST /block - Block a contact by email
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

    // POST /:id/block - Block contact by conversation ID (for mobile/PWA)
    fastify.post<{ Params: { id: string } }>('/:id/block', async (request, reply) => {
        try {
            const accountId = request.accountId;
            if (!accountId) return reply.code(400).send({ error: 'Account ID required' });

            const { reason } = request.body as any;
            const conversationId = request.params.id;

            // Import prisma to look up conversation
            const { prisma } = await import('../../utils/prisma');

            const conversation = await prisma.conversation.findFirst({
                where: { id: conversationId, accountId },
                include: { wooCustomer: true }
            });

            if (!conversation) {
                return reply.code(404).send({ error: 'Conversation not found' });
            }

            // Resolve contact identifier - prefer email, fall back to external ID
            const contactIdentifier = conversation.wooCustomer?.email
                || conversation.guestEmail
                || conversation.externalConversationId;

            if (!contactIdentifier) {
                return reply.code(400).send({ error: 'No contact identifier found for this conversation' });
            }

            const result = await BlockedContactService.blockContact(
                accountId,
                contactIdentifier,
                request.user?.id,
                reason || `Blocked from conversation ${conversationId}`
            );

            if (!result.success) return reply.code(500).send({ error: result.error });

            // Also close the conversation
            await prisma.conversation.update({
                where: { id: conversationId },
                data: { status: 'CLOSED' }
            });

            return { success: true, blockedIdentifier: contactIdentifier };
        } catch (error) {
            Logger.error('Failed to block contact by conversation', { error });
            return reply.code(500).send({ error: 'Failed to block contact' });
        }
    });

    // DELETE /block/:email - Unblock a contact
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

    // GET /blocked - List blocked contacts
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

    // GET /block/check/:email - Check if a contact is blocked
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
};
