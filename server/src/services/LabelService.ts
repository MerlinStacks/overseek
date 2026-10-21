/**
 * Label Service
 * 
 * CRUD operations for conversation labels/tags.
 * Enables categorization of conversations (Billing, Shipping, Returns, etc.)
 */

import { prisma } from '../utils/prisma';
import { Logger } from '../utils/logger';
import { z } from 'zod';

const labelInput = z.object({ name: z.string().trim().min(1).max(50), color: z.string().regex(/^#[0-9A-Fa-f]{6}$/).optional() });

export interface CreateLabelInput {
    accountId: string;
    name: string;
    color?: string;
}

export interface UpdateLabelInput {
    name?: string;
    color?: string;
}

export class LabelService {
    /**
     * Create a new label for an account.
     */
    async createLabel(input: CreateLabelInput) {
        const { name, color } = labelInput.parse(input);
        const accountId = z.string().trim().min(1).parse(input.accountId);

        Logger.debug('Creating label', { accountId, name });

        return prisma.conversationLabel.create({
            data: {
                accountId,
                name: name.trim(),
                color: color || '#6366f1',
            },
        });
    }

    /**
     * Update an existing label.
     */
    async updateLabel(accountId: string, id: string, input: UpdateLabelInput) {
        input = labelInput.partial().parse(input);
        Logger.debug('Updating label', { accountId, id, input });

        const existing = await prisma.conversationLabel.findFirst({
            where: { id, accountId },
            select: { id: true }
        });
        if (!existing) {
            const error = new Error('Label not found');
            (error as any).code = 'P2025';
            throw error;
        }

        return prisma.conversationLabel.update({
            where: { id: existing.id },
            data: {
                ...(input.name !== undefined && { name: input.name }),
                ...(input.color && { color: input.color }),
            },
        });
    }

    /**
     * Delete a label and all its assignments.
     */
    async deleteLabel(accountId: string, id: string) {
        Logger.debug('Deleting label', { accountId, id });

        const existing = await prisma.conversationLabel.findFirst({
            where: { id, accountId },
            select: { id: true }
        });
        if (!existing) {
            const error = new Error('Label not found');
            (error as any).code = 'P2025';
            throw error;
        }

        // Cascade delete will remove assignments automatically
        return prisma.conversationLabel.delete({
            where: { id: existing.id },
        });
    }

    /**
     * List all labels for an account.
     */
    async listLabels(accountId: string) {
        return prisma.conversationLabel.findMany({
            where: { accountId },
            include: {
                _count: {
                    select: { conversations: true },
                },
            },
            orderBy: { name: 'asc' },
        });
    }

    /**
     * Get a single label by ID.
     */
    async getLabel(accountId: string, id: string) {
        return prisma.conversationLabel.findFirst({
            where: { id, accountId },
            include: {
                _count: {
                    select: { conversations: true },
                },
            },
        });
    }

    /**
     * Assign a label to a conversation.
     */
    async assignLabel(accountId: string, conversationId: string, labelId: string) {
        Logger.debug('Assigning label', { accountId, conversationId, labelId });

        const [conversation, label] = await Promise.all([
            prisma.conversation.findFirst({
                where: { id: conversationId, accountId },
                select: { id: true }
            }),
            prisma.conversationLabel.findFirst({
                where: { id: labelId, accountId },
                select: { id: true }
            })
        ]);
        if (!conversation || !label) {
            const error = new Error('Conversation or label not found');
            (error as any).code = 'P2025';
            throw error;
        }

        // The unique constraint atomically tells us whether this assignment is new.
        const created = await prisma.conversationLabelAssignment.createMany({
            data: [{ conversationId, labelId }], skipDuplicates: true,
        });
        const assignment = await prisma.conversationLabelAssignment.findUniqueOrThrow({
            where: {
                conversationId_labelId: {
                    conversationId,
                    labelId,
                },
            },
            include: {
                label: true,
                conversation: { select: { accountId: true } }
            },
        });

        if (created.count === 1) {
            try {
                const { AutomationEngine } = await import('./AutomationEngine');
                await new AutomationEngine().processTrigger(assignment.conversation.accountId, 'TAG_ADDED', {
                    conversationId, labelId, labelName: assignment.label.name,
                });
            } catch (error) {
                // A saved label must not be retried because downstream automation failed.
                Logger.error('Label automation failed', { accountId, conversationId, labelId, error });
            }
        }

        return assignment;
    }

    /**
     * Remove a label from a conversation.
     */
    async removeLabel(accountId: string, conversationId: string, labelId: string) {
        Logger.debug('Removing label', { accountId, conversationId, labelId });

        const assignment = await prisma.conversationLabelAssignment.findFirst({
            where: {
                conversationId,
                labelId,
                conversation: { accountId },
                label: { accountId }
            },
            select: { conversationId: true, labelId: true }
        });
        if (!assignment) {
            const error = new Error('Label assignment not found');
            (error as any).code = 'P2025';
            throw error;
        }

        return prisma.conversationLabelAssignment.delete({
            where: {
                conversationId_labelId: {
                    conversationId: assignment.conversationId,
                    labelId: assignment.labelId,
                },
            },
        });
    }

    /**
     * Get all labels for a conversation.
     */
    async getConversationLabels(accountId: string, conversationId: string) {
        const assignments = await prisma.conversationLabelAssignment.findMany({
            where: { conversationId, conversation: { accountId }, label: { accountId } },
            include: {
                label: true,
            },
            orderBy: {
                label: { name: 'asc' },
            },
        });

        return assignments.map((a) => a.label);
    }

    /**
     * Bulk assign a label to multiple conversations.
     */
    async bulkAssignLabel(accountId: string, conversationIds: string[], labelId: string) {
        Logger.debug('Bulk assigning label', { accountId, count: conversationIds.length, labelId });

        const [validLabel, validConversations] = await Promise.all([
            prisma.conversationLabel.findFirst({
                where: { id: labelId, accountId },
                select: { id: true }
            }),
            prisma.conversation.findMany({
                where: { id: { in: conversationIds }, accountId },
                select: { id: true }
            })
        ]);
        if (!validLabel) {
            const error = new Error('Label not found');
            (error as any).code = 'P2025';
            throw error;
        }

        const validIds = validConversations.map(c => c.id);
        if (validIds.length === 0) return [];

        const operations = validIds.map((conversationId) =>
            prisma.conversationLabelAssignment.upsert({
                where: {
                    conversationId_labelId: {
                        conversationId,
                        labelId,
                    },
                },
                create: {
                    conversationId,
                    labelId,
                },
                update: {},
            })
        );

        return prisma.$transaction(operations);
    }

    /**
     * Bulk remove a label from multiple conversations.
     */
    async bulkRemoveLabel(accountId: string, conversationIds: string[], labelId: string) {
        Logger.debug('Bulk removing label', { accountId, count: conversationIds.length, labelId });

        return prisma.conversationLabelAssignment.deleteMany({
            where: {
                conversationId: { in: conversationIds },
                labelId,
                conversation: { accountId },
                label: { accountId }
            },
        });
    }
}
