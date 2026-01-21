/**
 * Bulk Actions Routes
 * 
 * Handles bulk operations on multiple conversations.
 * Extracted from chat.ts for maintainability.
 */

import { FastifyPluginAsync } from 'fastify';
import { prisma } from '../../utils/prisma';
import { ChatService } from '../../services/ChatService';
import { LabelService } from '../../services/LabelService';
import { requireAuthFastify } from '../../middleware/auth';
import { Logger } from '../../utils/logger';

/**
 * Creates bulk action routes.
 * Requires ChatService injection for merge operations.
 */
export const createBulkActionRoutes = (chatService: ChatService): FastifyPluginAsync => {
    const labelService = new LabelService();

    return async (fastify) => {
        fastify.addHook('preHandler', requireAuthFastify);

        // POST /conversations/bulk - Perform bulk actions on multiple conversations
        fastify.post('/conversations/bulk', async (request, reply) => {
            try {
                const accountId = request.accountId;
                const userId = request.user?.id;
                const { conversationIds, action, labelId, assignToUserId } = request.body as {
                    conversationIds: string[];
                    action: 'close' | 'open' | 'assign' | 'addLabel' | 'removeLabel';
                    labelId?: string;
                    assignToUserId?: string;
                };

                if (!conversationIds || !Array.isArray(conversationIds) || conversationIds.length === 0) {
                    return reply.code(400).send({ error: 'conversationIds array is required' });
                }

                if (!action) {
                    return reply.code(400).send({ error: 'action is required' });
                }

                let result: { updated: number } = { updated: 0 };

                switch (action) {
                    case 'close': {
                        const closeResult = await prisma.conversation.updateMany({
                            where: { id: { in: conversationIds }, accountId },
                            data: { status: 'CLOSED' },
                        });
                        result.updated = closeResult.count;
                        break;
                    }

                    case 'open': {
                        const openResult = await prisma.conversation.updateMany({
                            where: { id: { in: conversationIds }, accountId },
                            data: { status: 'OPEN', snoozedUntil: null },
                        });
                        result.updated = openResult.count;
                        break;
                    }

                    case 'assign': {
                        if (!assignToUserId) {
                            return reply.code(400).send({ error: 'assignToUserId is required for assign action' });
                        }
                        const assignResult = await prisma.conversation.updateMany({
                            where: { id: { in: conversationIds }, accountId },
                            data: { assignedTo: assignToUserId },
                        });
                        result.updated = assignResult.count;
                        break;
                    }

                    case 'addLabel': {
                        if (!labelId) {
                            return reply.code(400).send({ error: 'labelId is required for addLabel action' });
                        }
                        await labelService.bulkAssignLabel(conversationIds, labelId);
                        result.updated = conversationIds.length;
                        break;
                    }

                    case 'removeLabel': {
                        if (!labelId) {
                            return reply.code(400).send({ error: 'labelId is required for removeLabel action' });
                        }
                        const removeResult = await labelService.bulkRemoveLabel(conversationIds, labelId);
                        result.updated = removeResult.count;
                        break;
                    }

                    default:
                        return reply.code(400).send({ error: `Unknown action: ${action}` });
                }

                Logger.info('Bulk action completed', { action, count: result.updated, userId });
                return { success: true, ...result };
            } catch (error) {
                Logger.error('Failed to perform bulk action', { error });
                return reply.code(500).send({ error: 'Failed to perform bulk action' });
            }
        });

        // POST /conversations/bulk-merge - Merge multiple conversations into one
        fastify.post('/conversations/bulk-merge', async (request, reply) => {
            try {
                const accountId = request.accountId;
                const userId = request.user?.id;
                const { targetId, sourceIds } = request.body as {
                    targetId: string;
                    sourceIds: string[];
                };

                if (!targetId) {
                    return reply.code(400).send({ error: 'targetId is required' });
                }

                if (!sourceIds || !Array.isArray(sourceIds) || sourceIds.length === 0) {
                    return reply.code(400).send({ error: 'sourceIds array is required' });
                }

                // Verify target conversation exists and belongs to this account
                const targetConv = await prisma.conversation.findFirst({
                    where: { id: targetId, accountId }
                });

                if (!targetConv) {
                    return reply.code(404).send({ error: 'Target conversation not found' });
                }

                // Merge each source into target sequentially
                let mergedCount = 0;
                for (const sourceId of sourceIds) {
                    try {
                        await chatService.mergeConversations(targetId, sourceId);
                        mergedCount++;
                    } catch (mergeError: any) {
                        Logger.warn('Failed to merge individual conversation', {
                            targetId,
                            sourceId,
                            error: mergeError.message
                        });
                    }
                }

                Logger.info('Bulk merge completed', {
                    targetId,
                    sourceCount: sourceIds.length,
                    mergedCount,
                    userId
                });

                return { success: true, mergedCount };
            } catch (error) {
                Logger.error('Failed to perform bulk merge', { error });
                return reply.code(500).send({ error: 'Failed to perform bulk merge' });
            }
        });
    };
};
