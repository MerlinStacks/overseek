/**
 * Inbox Macros Routes
 * 
 * Handles automated macro actions for the inbox.
 * Extracted from chat.ts for maintainability.
 */

import { FastifyPluginAsync } from 'fastify';
import { prisma } from '../../utils/prisma';
import { requireAuthFastify } from '../../middleware/auth';

export const macroRoutes: FastifyPluginAsync = async (fastify) => {
    fastify.addHook('preHandler', requireAuthFastify);

    async function ensureConversationLabel(accountId: string, labelId: string) {
        return prisma.conversationLabel.findFirst({
            where: { id: labelId, accountId },
            select: { id: true }
        });
    }

    async function ensureAccountUser(accountId: string, userId: string) {
        return prisma.accountUser.findUnique({
            where: {
                userId_accountId: {
                    userId,
                    accountId
                }
            },
            select: { userId: true }
        });
    }

    // GET /macros - List all macros for account
    fastify.get('/macros', async (request, _reply) => {
        const accountId = request.accountId;
        if (!accountId) return [];
        return prisma.inboxMacro.findMany({
            where: { accountId },
            orderBy: { sortOrder: 'asc' }
        });
    });

    // POST /macros - Create a new macro
    fastify.post('/macros', async (request, reply) => {
        const accountId = request.accountId;
        if (!accountId) return reply.code(400).send({ error: 'Account required' });
        const { name, icon, color, actions } = request.body as any;
        return prisma.inboxMacro.create({
            data: { accountId, name, icon, color, actions }
        });
    });

    // PUT /macros/:id - Update a macro
    fastify.put<{ Params: { id: string } }>('/macros/:id', async (request, reply) => {
        const accountId = request.accountId;
        if (!accountId) return reply.code(400).send({ error: 'Account required' });
        const { name, icon, color, actions, sortOrder } = request.body as any;

        // Verify ownership before update
        const existing = await prisma.inboxMacro.findFirst({
            where: { id: request.params.id, accountId }
        });
        if (!existing) return reply.code(404).send({ error: 'Macro not found' });

        return prisma.inboxMacro.update({
            where: { id: request.params.id },
            data: { name, icon, color, actions, sortOrder }
        });
    });

    // DELETE /macros/:id - Delete a macro
    fastify.delete<{ Params: { id: string } }>('/macros/:id', async (request, reply) => {
        const accountId = request.accountId;
        if (!accountId) return reply.code(400).send({ error: 'Account required' });

        // Verify ownership before delete
        const existing = await prisma.inboxMacro.findFirst({
            where: { id: request.params.id, accountId }
        });
        if (!existing) return reply.code(404).send({ error: 'Macro not found' });

        await prisma.inboxMacro.delete({ where: { id: request.params.id } });
        return { success: true };
    });

    // POST /macros/:id/execute - Execute a macro on a conversation
    fastify.post<{ Params: { id: string } }>('/macros/:id/execute', async (request, reply) => {
        const accountId = request.accountId;
        if (!accountId) return reply.code(400).send({ error: 'Account required' });
        const { conversationId } = request.body as any;
        if (!conversationId) return reply.code(400).send({ error: 'conversationId required' });

        // Verify macro belongs to this account
        const macro = await prisma.inboxMacro.findFirst({ where: { id: request.params.id, accountId } });
        if (!macro) return reply.code(404).send({ error: 'Macro not found' });

        const actions = macro.actions as any[];
        // Verify conversation belongs to this account
        const conv = await prisma.conversation.findFirst({ where: { id: conversationId, accountId } });
        if (!conv) return reply.code(404).send({ error: 'Conversation not found' });

        for (const action of actions) {
            if (action.type === 'ASSIGN' && action.userId) {
                const assignee = await ensureAccountUser(accountId, action.userId);
                if (!assignee) {
                    return reply.code(400).send({ error: `Invalid assignee for macro action: ${action.userId}` });
                }

                await prisma.conversation.update({
                    where: { id: conversationId },
                    data: { assignedTo: action.userId }
                });
            }
            if (action.type === 'ADD_TAG' && action.labelId) {
                const label = await ensureConversationLabel(accountId, action.labelId);
                if (!label) {
                    return reply.code(400).send({ error: `Invalid label for macro action: ${action.labelId}` });
                }

                await prisma.conversationLabelAssignment.upsert({
                    where: { conversationId_labelId: { conversationId, labelId: action.labelId } },
                    create: { conversationId, labelId: action.labelId },
                    update: {}
                });
            }
            if (action.type === 'CLOSE') {
                await prisma.conversation.update({
                    where: { id: conversationId },
                    data: { status: 'CLOSED' }
                });
            }
            if (action.type === 'REOPEN') {
                await prisma.conversation.update({
                    where: { id: conversationId },
                    data: { status: 'OPEN' }
                });
            }
        }

        return { success: true, actionsExecuted: actions.length };
    });
};
