import { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { BlockedContactService, blockCommandSchema, canonicalBlockedEmail } from '../../services/BlockedContactService';
import { requireAuthFastify } from '../../middleware/auth';
import { requireInboxMutationAccess } from './authorization';
import { PermissionService } from '../../services/PermissionService';
import { prisma } from '../../utils/prisma';

export const blockedContactRoutes: FastifyPluginAsync = async app => {
    app.addHook('preHandler', requireAuthFastify);
    app.addHook('preHandler', async (request, reply) => {
        if (!request.accountId || !request.user?.id || !await PermissionService.hasPermission(request.user.id, request.accountId, 'view_inbox')) return reply.code(403).send({ error: 'Inbox read access required' });
    });
    const failure = (reply: any, error: unknown) => reply.code((error as Error)?.name === 'ZodError' ? 400 : 409).send({ error: 'Block command invalid, changed or unacknowledged. Reconcile original operation before repeating.' });
    app.post('/block', async (request, reply) => {
        if (!await requireInboxMutationAccess(request, reply)) return;
        try {
            const body = blockCommandSchema.extend({ email: z.string() }).parse(request.body);
            const { email, ...command } = body;
            return await BlockedContactService.blockContact(request.accountId!, email, request.user!.id, body.reason, command);
        } catch (error) { return failure(reply, error); }
    });
    app.get<{ Params: { id: string } }>('/:id/block-state', async (request, reply) => {
        const conversation = await prisma.conversation.findFirst({ where: { id: request.params.id, accountId: request.accountId! }, include: { wooCustomer: { select: { email: true } } } });
        if (!conversation) return reply.code(404).send({ error: 'Conversation unavailable' });
        try {
            // Channel IDs are not email identities. Unsupported social blocking is explicit.
            const email = canonicalBlockedEmail(conversation.wooCustomer?.email || conversation.guestEmail);
            const block = await BlockedContactService.getBlockObservation(request.accountId!, email);
            return { accountId: request.accountId!, email, version: block.version, conversationVersion: conversation.updatedAt };
        } catch { return reply.code(422).send({ error: 'No supported canonical email identity; channel blocking is unavailable' }); }
    });
    app.post<{ Params: { id: string } }>('/:id/block', async (request, reply) => {
        if (!await requireInboxMutationAccess(request, reply)) return;
        try {
            const body = blockCommandSchema.extend({ email: z.string() }).parse(request.body), { email, ...command } = body;
            return await BlockedContactService.blockContact(request.accountId!, email, request.user!.id, body.reason, command, request.params.id);
        } catch (error) { return failure(reply, error); }
    });
    app.delete<{ Params: { email: string } }>('/block/:email', async (request, reply) => {
        if (!await requireInboxMutationAccess(request, reply)) return;
        try { return await BlockedContactService.unblockContact(request.accountId!, request.params.email, request.user!.id, blockCommandSchema.parse(request.body)); }
        catch (error) { return failure(reply, error); }
    });
    app.get('/blocked', async (request, reply) => {
        try {
            const { cursor } = z.object({ cursor: z.string().min(1).max(200).optional() }).parse(request.query);
            const rows = await BlockedContactService.listBlocked(request.accountId!, cursor);
            return { accountId: request.accountId!, contacts: rows.slice(0, 100), nextCursor: rows.length > 100 ? rows[99].id : null };
        } catch (error) { return failure(reply, error); }
    });
    app.get<{ Params: { email: string } }>('/block/check/:email', async (request, reply) => {
        try {
            const row = await BlockedContactService.getBlockObservation(request.accountId!, request.params.email);
            return { accountId: request.accountId!, email: canonicalBlockedEmail(request.params.email), isBlocked: !!row.contact, version: row.version };
        } catch (error) { return failure(reply, error); }
    });
};
