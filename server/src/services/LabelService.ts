/**
 * Label Service
 * 
 * CRUD operations for conversation labels/tags.
 * Enables categorization of conversations (Billing, Shipping, Returns, etc.)
 */

import { prisma } from '../utils/prisma';
import { Logger } from '../utils/logger';

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
        const { accountId, name, color } = input;

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
    async updateLabel(id: string, input: UpdateLabelInput) {
        Logger.debug('Updating label', { id, input });

        return prisma.conversationLabel.update({
            where: { id },
            data: {
                ...(input.name && { name: input.name.trim() }),
                ...(input.color && { color: input.color }),
            },
        });
    }

    /**
     * Delete a label and all its assignments.
     */
    async deleteLabel(id: string) {
        Logger.debug('Deleting label', { id });

        // Cascade delete will remove assignments automatically
        return prisma.conversationLabel.delete({
            where: { id },
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
    async getLabel(id: string) {
        return prisma.conversationLabel.findUnique({
            where: { id },
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
    async assignLabel(conversationId: string, labelId: string) {
        Logger.debug('Assigning label', { conversationId, labelId });

        // Use upsert to avoid duplicate errors
        const assignment = await prisma.conversationLabelAssignment.upsert({
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
            update: {}, // No-op if already exists
            include: {
                label: true,
                conversation: { select: { accountId: true } }
            },
        });

        // Trigger automation for tag added
        const { AutomationEngine } = await import('./AutomationEngine');
        const automationEngine = new AutomationEngine();
        automationEngine.processTrigger(assignment.conversation.accountId, 'TAG_ADDED', {
            conversationId,
            labelId,
            labelName: assignment.label.name
        });

        return assignment;
    }

    /**
     * Remove a label from a conversation.
     */
    async removeLabel(conversationId: string, labelId: string) {
        Logger.debug('Removing label', { conversationId, labelId });

        return prisma.conversationLabelAssignment.delete({
            where: {
                conversationId_labelId: {
                    conversationId,
                    labelId,
                },
            },
        });
    }

    /**
     * Get all labels for a conversation.
     */
    async getConversationLabels(conversationId: string) {
        const assignments = await prisma.conversationLabelAssignment.findMany({
            where: { conversationId },
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
    async bulkAssignLabel(conversationIds: string[], labelId: string) {
        Logger.debug('Bulk assigning label', { count: conversationIds.length, labelId });

        const operations = conversationIds.map((conversationId) =>
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
    async bulkRemoveLabel(conversationIds: string[], labelId: string) {
        Logger.debug('Bulk removing label', { count: conversationIds.length, labelId });

        return prisma.conversationLabelAssignment.deleteMany({
            where: {
                conversationId: { in: conversationIds },
                labelId,
            },
        });
    }
}
