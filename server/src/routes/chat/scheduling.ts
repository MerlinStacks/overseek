/**
 * Scheduling Routes
 * 
 * Handles message scheduling and conversation snooze functionality.
 * Extracted from chat.ts for maintainability.
 */

import { FastifyPluginAsync } from 'fastify';
import { prisma } from '../../utils/prisma';
import { requireAuthFastify } from '../../middleware/auth';
import { Logger } from '../../utils/logger';

export const schedulingRoutes: FastifyPluginAsync = async (fastify) => {
    fastify.addHook('preHandler', requireAuthFastify);

    // === MESSAGE SCHEDULING ===

    // POST /:id/messages/schedule - Schedule a message for later
    fastify.post<{ Params: { id: string } }>('/:id/messages/schedule', async (request, reply) => {
        try {
            const { content, scheduledFor, isInternal, attachments } = request.body as any;
            const userId = request.user?.id;

            if (!content || !scheduledFor) {
                return reply.code(400).send({ error: 'Content and scheduledFor are required' });
            }

            const scheduledDate = new Date(scheduledFor);
            if (scheduledDate <= new Date()) {
                return reply.code(400).send({ error: 'Scheduled time must be in the future' });
            }

            // attachments should be array of { filename, path, contentType }
            const attachmentPaths = attachments && Array.isArray(attachments) && attachments.length > 0
                ? attachments
                : null;

            const message = await prisma.message.create({
                data: {
                    conversationId: request.params.id,
                    content,
                    senderType: 'AGENT',
                    senderId: userId,
                    isInternal: isInternal || false,
                    scheduledFor: scheduledDate,
                    scheduledBy: userId,
                    attachmentPaths, // Store for later sending
                },
            });

            Logger.info('Message scheduled', {
                messageId: message.id,
                scheduledFor: scheduledDate,
                attachmentCount: attachmentPaths?.length || 0
            });
            return { success: true, message };
        } catch (error) {
            Logger.error('Failed to schedule message', { error });
            return reply.code(500).send({ error: 'Failed to schedule message' });
        }
    });

    // DELETE /messages/:id/schedule - Cancel a scheduled message
    fastify.delete<{ Params: { id: string } }>('/messages/:id/schedule', async (request, reply) => {
        try {
            const message = await prisma.message.findUnique({
                where: { id: request.params.id },
                select: { scheduledFor: true, scheduledBy: true },
            });

            if (!message) {
                return reply.code(404).send({ error: 'Message not found' });
            }

            if (!message.scheduledFor) {
                return reply.code(400).send({ error: 'Message is not scheduled' });
            }

            // Delete the scheduled message entirely
            await prisma.message.delete({ where: { id: request.params.id } });

            Logger.info('Scheduled message cancelled', { messageId: request.params.id });
            return { success: true };
        } catch (error) {
            Logger.error('Failed to cancel scheduled message', { error });
            return reply.code(500).send({ error: 'Failed to cancel scheduled message' });
        }
    });

    // === SNOOZE ===

    // POST /:id/snooze - Snooze a conversation
    fastify.post<{ Params: { id: string } }>('/:id/snooze', async (request, reply) => {
        try {
            const { until } = request.body as any;

            if (!until) {
                return reply.code(400).send({ error: 'Snooze until time is required' });
            }

            const snoozeUntil = new Date(until);
            if (snoozeUntil <= new Date()) {
                return reply.code(400).send({ error: 'Snooze time must be in the future' });
            }

            const conversation = await prisma.conversation.update({
                where: { id: request.params.id },
                data: {
                    status: 'SNOOZED',
                    snoozedUntil: snoozeUntil,
                },
            });

            Logger.info('Conversation snoozed', { conversationId: conversation.id, until: snoozeUntil });
            return { success: true, snoozedUntil: snoozeUntil };
        } catch (error: any) {
            if (error.code === 'P2025') {
                return reply.code(404).send({ error: 'Conversation not found' });
            }
            Logger.error('Failed to snooze conversation', { error });
            return reply.code(500).send({ error: 'Failed to snooze conversation' });
        }
    });

    // DELETE /:id/snooze - Cancel snooze (reopen conversation)
    fastify.delete<{ Params: { id: string } }>('/:id/snooze', async (request, reply) => {
        try {
            const conversation = await prisma.conversation.update({
                where: { id: request.params.id },
                data: {
                    status: 'OPEN',
                    snoozedUntil: null,
                },
            });

            Logger.info('Snooze cancelled', { conversationId: conversation.id });
            return { success: true };
        } catch (error: any) {
            if (error.code === 'P2025') {
                return reply.code(404).send({ error: 'Conversation not found' });
            }
            Logger.error('Failed to cancel snooze', { error });
            return reply.code(500).send({ error: 'Failed to cancel snooze' });
        }
    });
};
