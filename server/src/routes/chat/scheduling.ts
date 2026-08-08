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
import { invalidateCache } from '../../utils/cache';
import {
    InvalidScheduledAttachmentError,
    resolveScheduledAttachments,
} from '../../services/scheduler/ScheduledAttachmentResolver';
import { requireInboxMutationAccess } from './authorization';

export const schedulingRoutes: FastifyPluginAsync = async (fastify) => {
    fastify.addHook('preHandler', requireAuthFastify);

    // === MESSAGE SCHEDULING ===

    // POST /:id/messages/schedule - Schedule a message for later
    fastify.post<{ Params: { id: string } }>('/:id/messages/schedule', async (request, reply) => {
        try {
            if (!(await requireInboxMutationAccess(request, reply))) return;
            const { content, scheduledFor, isInternal, attachments } = request.body as any;
            const userId = request.user?.id;
            const accountId = request.accountId;

            if (!accountId) {
                return reply.code(400).send({ error: 'Account ID required' });
            }

            if (!content || !scheduledFor) {
                return reply.code(400).send({ error: 'Content and scheduledFor are required' });
            }

            const scheduledDate = new Date(scheduledFor);
            if (Number.isNaN(scheduledDate.getTime()) || scheduledDate <= new Date()) {
                return reply.code(400).send({ error: 'Scheduled time must be in the future' });
            }

            const conversation = await prisma.conversation.findFirst({
                where: { id: request.params.id, accountId },
                select: { id: true }
            });
            if (!conversation) {
                return reply.code(404).send({ error: 'Conversation not found' });
            }

            const attachmentReferences = attachments === undefined || attachments === null
                ? []
                : (await resolveScheduledAttachments(attachments, accountId)).references;
            const attachmentPaths = attachmentReferences.length > 0 ? attachmentReferences : null;

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
            if (error instanceof InvalidScheduledAttachmentError) {
                return reply.code(400).send({ error: error.message });
            }
            Logger.error('Failed to schedule message', { error });
            return reply.code(500).send({ error: 'Failed to schedule message' });
        }
    });

    // DELETE /messages/:id/schedule - Cancel a scheduled message
    fastify.delete<{ Params: { id: string } }>('/messages/:id/schedule', async (request, reply) => {
        try {
            if (!(await requireInboxMutationAccess(request, reply))) return;
            const message = await prisma.message.findUnique({
                where: { id: request.params.id },
                select: { scheduledFor: true, scheduledBy: true, conversation: { select: { accountId: true } } },
            });

            if (!message) {
                return reply.code(404).send({ error: 'Message not found' });
            }

            // Why: prevent cross-account deletion of scheduled messages
            if (message.conversation?.accountId !== request.accountId) {
                return reply.code(403).send({ error: 'Forbidden' });
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
            if (!(await requireInboxMutationAccess(request, reply))) return;
            const { until } = request.body as any;
            const accountId = request.accountId;

            if (!accountId) {
                return reply.code(400).send({ error: 'Account ID required' });
            }

            if (!until) {
                return reply.code(400).send({ error: 'Snooze until time is required' });
            }

            const snoozeUntil = new Date(until);
            if (Number.isNaN(snoozeUntil.getTime()) || snoozeUntil <= new Date()) {
                return reply.code(400).send({ error: 'Snooze time must be in the future' });
            }

            const existing = await prisma.conversation.findFirst({
                where: { id: request.params.id, accountId },
                select: { id: true }
            });
            if (!existing) {
                return reply.code(404).send({ error: 'Conversation not found' });
            }

            const conversation = await prisma.conversation.update({
                where: { id: existing.id },
                data: {
                    status: 'SNOOZED',
                    snoozedUntil: snoozeUntil,
                },
            });
            await invalidateCache('inbox', `conversations:${accountId}`);

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
            if (!(await requireInboxMutationAccess(request, reply))) return;
            const accountId = request.accountId;
            if (!accountId) {
                return reply.code(400).send({ error: 'Account ID required' });
            }

            const existing = await prisma.conversation.findFirst({
                where: { id: request.params.id, accountId },
                select: { id: true }
            });
            if (!existing) {
                return reply.code(404).send({ error: 'Conversation not found' });
            }

            const conversation = await prisma.conversation.update({
                where: { id: existing.id },
                data: {
                    status: 'OPEN',
                    snoozedUntil: null,
                },
            });
            await invalidateCache('inbox', `conversations:${accountId}`);

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
