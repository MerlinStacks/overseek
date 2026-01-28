/**
 * Notes Routes
 * 
 * Handles conversation notes and labels.
 * Extracted from chat.ts for maintainability.
 */

import { FastifyPluginAsync } from 'fastify';
import { prisma } from '../../utils/prisma';
import { LabelService } from '../../services/LabelService';
import { requireAuthFastify } from '../../middleware/auth';
import { Logger } from '../../utils/logger';

export const notesRoutes: FastifyPluginAsync = async (fastify) => {
    fastify.addHook('preHandler', requireAuthFastify);

    const labelService = new LabelService();

    // === CONVERSATION NOTES ===

    // GET /:id/notes - Get notes for a conversation
    fastify.get<{ Params: { id: string } }>('/:id/notes', async (request, reply) => {
        const notes = await prisma.conversationNote.findMany({
            where: { conversationId: request.params.id },
            include: { createdBy: { select: { id: true, fullName: true, avatarUrl: true } } },
            orderBy: { createdAt: 'desc' }
        });
        return notes;
    });

    // POST /:id/notes - Create a note
    fastify.post<{ Params: { id: string } }>('/:id/notes', async (request, reply) => {
        const { content } = request.body as any;
        const userId = (request as any).user?.id;
        if (!userId) return reply.code(401).send({ error: 'Unauthorized' });
        if (!content?.trim()) return reply.code(400).send({ error: 'Content required' });

        const note = await prisma.conversationNote.create({
            data: {
                conversationId: request.params.id,
                content: content.trim(),
                createdById: userId
            },
            include: { createdBy: { select: { id: true, fullName: true, avatarUrl: true } } }
        });
        return note;
    });

    // DELETE /:id/notes/:noteId - Delete a note
    fastify.delete<{ Params: { id: string; noteId: string } }>('/:id/notes/:noteId', async (request, reply) => {
        await prisma.conversationNote.delete({ where: { id: request.params.noteId } });
        return { success: true };
    });

    // === CONVERSATION LABELS ===

    // GET /:id/labels - Get labels for a conversation
    fastify.get<{ Params: { id: string } }>('/:id/labels', async (request, reply) => {
        try {
            const labels = await labelService.getConversationLabels(request.params.id);
            return { labels };
        } catch (error) {
            Logger.error('Failed to get conversation labels', { error });
            return reply.code(500).send({ error: 'Failed to get labels' });
        }
    });

    // POST /:id/labels/:labelId - Assign a label to conversation
    fastify.post<{ Params: { id: string; labelId: string } }>('/:id/labels/:labelId', async (request, reply) => {
        try {
            const assignment = await labelService.assignLabel(request.params.id, request.params.labelId);
            return { success: true, label: assignment.label };
        } catch (error: any) {
            if (error.code === 'P2025') {
                return reply.code(404).send({ error: 'Conversation or label not found' });
            }
            Logger.error('Failed to assign label', { error });
            return reply.code(500).send({ error: 'Failed to assign label' });
        }
    });

    // DELETE /:id/labels/:labelId - Remove a label from conversation
    fastify.delete<{ Params: { id: string; labelId: string } }>('/:id/labels/:labelId', async (request, reply) => {
        try {
            await labelService.removeLabel(request.params.id, request.params.labelId);
            return { success: true };
        } catch (error: any) {
            if (error.code === 'P2025') {
                return reply.code(404).send({ error: 'Label assignment not found' });
            }
            Logger.error('Failed to remove label', { error });
            return reply.code(500).send({ error: 'Failed to remove label' });
        }
    });
};
