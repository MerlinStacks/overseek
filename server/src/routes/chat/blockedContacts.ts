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

    // POST /block - Block a contact
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
