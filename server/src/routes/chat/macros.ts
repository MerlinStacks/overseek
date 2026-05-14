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

        let finalAssignee: string | undefined;
        let finalStatus: 'OPEN' | 'CLOSED' | undefined;
        const labelIds = new Set<string>();
        const assigneeIds = new Set<string>();

        for (const action of actions) {
            if (action.type === 'ASSIGN' && action.userId) {
                finalAssignee = action.userId;
                assigneeIds.add(action.userId);
            }
            if (action.type === 'ADD_TAG' && action.labelId) {
                labelIds.add(action.labelId);
            }
            if (action.type === 'CLOSE') {
                finalStatus = 'CLOSED';
            }
            if (action.type === 'REOPEN') {
                finalStatus = 'OPEN';
            }
        }

        if (assigneeIds.size > 0) {
            const validAssignees = await prisma.accountUser.findMany({
                where: {
                    accountId,
                    userId: { in: Array.from(assigneeIds) }
                },
                select: { userId: true }
            });
            const validAssigneeIds = new Set(validAssignees.map((u) => u.userId));
            const invalidAssigneeId = Array.from(assigneeIds).find((id) => !validAssigneeIds.has(id));
            if (invalidAssigneeId) {
                return reply.code(400).send({ error: `Invalid assignee for macro action: ${invalidAssigneeId}` });
            }
        }

        if (labelIds.size > 0) {
            const validLabels = await prisma.conversationLabel.findMany({
                where: {
                    accountId,
                    id: { in: Array.from(labelIds) }
                },
                select: { id: true }
            });
            const validLabelIds = new Set(validLabels.map((l) => l.id));
            const invalidLabelId = Array.from(labelIds).find((id) => !validLabelIds.has(id));
            if (invalidLabelId) {
                return reply.code(400).send({ error: `Invalid label for macro action: ${invalidLabelId}` });
            }
        }

        await prisma.$transaction(async (tx) => {
            if (finalAssignee !== undefined || finalStatus !== undefined) {
                await tx.conversation.update({
                    where: { id: conversationId },
                    data: {
                        ...(finalAssignee !== undefined ? { assignedTo: finalAssignee } : {}),
                        ...(finalStatus !== undefined ? { status: finalStatus } : {})
                    }
                });
            }

            if (labelIds.size > 0) {
                await tx.conversationLabelAssignment.createMany({
                    data: Array.from(labelIds).map((labelId) => ({ conversationId, labelId })),
                    skipDuplicates: true
                });
            }
        });

        return { success: true, actionsExecuted: actions.length };
    });
};
