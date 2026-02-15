/**
 * Keyword Group Service
 *
 * CRUD for keyword groups and group-level aggregate metrics.
 * Groups organize tracked keywords into logical categories
 * (e.g. "Brand Terms", "Product Category", "Long-tail").
 */

import { prisma } from '../../utils/prisma';
import { Logger } from '../../utils/logger';

/** Max groups per account */
const MAX_GROUPS_PER_ACCOUNT = 20;

/** Group summary with aggregate metrics */
export interface KeywordGroupSummary {
    id: string;
    name: string;
    color: string;
    keywordCount: number;
    avgPosition: number | null;
    totalClicks: number;
    totalImpressions: number;
    avgCtr: number | null;
    createdAt: Date;
}

export class KeywordGroupService {

    /**
     * Create a new keyword group.
     */
    static async createGroup(accountId: string, name: string, color?: string): Promise<KeywordGroupSummary> {
        const trimmed = name.trim();
        if (!trimmed || trimmed.length > 100) {
            throw new Error('Group name must be 1-100 characters');
        }

        const count = await prisma.keywordGroup.count({ where: { accountId } });
        if (count >= MAX_GROUPS_PER_ACCOUNT) {
            throw new Error(`Maximum of ${MAX_GROUPS_PER_ACCOUNT} groups reached`);
        }

        const group = await prisma.keywordGroup.create({
            data: {
                accountId,
                name: trimmed,
                color: color || '#6366f1',
            },
            include: { keywords: { where: { isActive: true } } }
        });

        return mapGroupToSummary(group);
    }

    /**
     * Update group name/color.
     */
    static async updateGroup(accountId: string, groupId: string, data: { name?: string; color?: string }): Promise<KeywordGroupSummary> {
        const group = await prisma.keywordGroup.update({
            where: { id: groupId, accountId },
            data: {
                ...(data.name && { name: data.name.trim() }),
                ...(data.color && { color: data.color }),
            },
            include: { keywords: { where: { isActive: true } } }
        });

        return mapGroupToSummary(group);
    }

    /**
     * Delete a group (keywords are unassigned, not deleted).
     */
    static async deleteGroup(accountId: string, groupId: string): Promise<void> {
        await prisma.keywordGroup.deleteMany({
            where: { id: groupId, accountId }
        });
    }

    /**
     * List all groups with aggregate metrics.
     */
    static async listGroups(accountId: string): Promise<KeywordGroupSummary[]> {
        const groups = await prisma.keywordGroup.findMany({
            where: { accountId },
            include: { keywords: { where: { isActive: true } } },
            orderBy: { name: 'asc' }
        });

        return groups.map(mapGroupToSummary);
    }

    /**
     * Assign a keyword to a group.
     */
    static async assignKeyword(accountId: string, keywordId: string, groupId: string | null): Promise<void> {
        // Verify group belongs to account (if not null)
        if (groupId) {
            const group = await prisma.keywordGroup.findFirst({
                where: { id: groupId, accountId }
            });
            if (!group) throw new Error('Group not found');
        }

        await prisma.trackedKeyword.updateMany({
            where: { id: keywordId, accountId },
            data: { groupId }
        });
    }

    /**
     * Bulk assign keywords to a group.
     */
    static async bulkAssign(accountId: string, keywordIds: string[], groupId: string | null): Promise<number> {
        if (groupId) {
            const group = await prisma.keywordGroup.findFirst({
                where: { id: groupId, accountId }
            });
            if (!group) throw new Error('Group not found');
        }

        const result = await prisma.trackedKeyword.updateMany({
            where: { id: { in: keywordIds }, accountId },
            data: { groupId }
        });

        return result.count;
    }
}

/** Map Prisma group + keywords to summary with metrics */
function mapGroupToSummary(group: any): KeywordGroupSummary {
    const keywords = group.keywords || [];
    const withPosition = keywords.filter((k: any) => k.currentPosition && k.currentPosition > 0);

    const totalClicks = keywords.reduce((sum: number, k: any) => sum + (k.currentClicks || 0), 0);
    const totalImpressions = keywords.reduce((sum: number, k: any) => sum + (k.currentImpressions || 0), 0);

    return {
        id: group.id,
        name: group.name,
        color: group.color,
        keywordCount: keywords.length,
        avgPosition: withPosition.length > 0
            ? Math.round((withPosition.reduce((sum: number, k: any) => sum + k.currentPosition, 0) / withPosition.length) * 10) / 10
            : null,
        totalClicks,
        totalImpressions,
        avgCtr: totalImpressions > 0 ? Math.round((totalClicks / totalImpressions) * 10000) / 100 : null,
        createdAt: group.createdAt,
    };
}
