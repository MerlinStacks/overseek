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

    // GET /macros - List all macros for account
    fastify.get('/macros', async (request, reply) => {
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
        const { name, icon, color, actions, sortOrder } = request.body as any;
        return prisma.inboxMacro.update({
            where: { id: request.params.id },
            data: { name, icon, color, actions, sortOrder }
        });
    });

    // DELETE /macros/:id - Delete a macro
    fastify.delete<{ Params: { id: string } }>('/macros/:id', async (request, reply) => {
        await prisma.inboxMacro.delete({ where: { id: request.params.id } });
        return { success: true };
    });

    // POST /macros/:id/execute - Execute a macro on a conversation
    fastify.post<{ Params: { id: string } }>('/macros/:id/execute', async (request, reply) => {
        const { conversationId } = request.body as any;
        if (!conversationId) return reply.code(400).send({ error: 'conversationId required' });

        const macro = await prisma.inboxMacro.findUnique({ where: { id: request.params.id } });
        if (!macro) return reply.code(404).send({ error: 'Macro not found' });

        const actions = macro.actions as any[];
        const conv = await prisma.conversation.findUnique({ where: { id: conversationId } });
        if (!conv) return reply.code(404).send({ error: 'Conversation not found' });

        for (const action of actions) {
            if (action.type === 'ASSIGN' && action.userId) {
                await prisma.conversation.update({
                    where: { id: conversationId },
                    data: { assignedTo: action.userId }
                });
            }
            if (action.type === 'ADD_TAG' && action.labelId) {
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
