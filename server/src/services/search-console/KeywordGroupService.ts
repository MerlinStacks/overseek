/**
 * Keyword Group Service
 *
 * CRUD for keyword groups and group-level aggregate metrics.
 * Groups organize tracked keywords into logical categories
 * (e.g. "Brand Terms", "Product Category", "Long-tail").
 */

import { prisma } from '../../utils/prisma';
import { z } from 'zod';
const groupFields = z.object({ name: z.string().trim().min(1).max(100), color: z.string().regex(/^#[0-9a-fA-F]{6}$/) });

/** Max groups per account */
const MAX_GROUPS_PER_ACCOUNT = 20;

/** Group summary with aggregate metrics */
export interface KeywordGroupSummary {
    id: string;
    name: string;
    color: string;
    keywordCount: number;
    avgPosition: number | null;
    totalClicks: number | null;
    totalImpressions: number | null;
    metricCoverage: number;
    positionMethod: 'unweighted-known-keywords';
    avgCtr: number | null;
    createdAt: Date;
}

export class KeywordGroupService {

    /**
     * Create a new keyword group.
     */
    static async createGroup(accountId: string, name: string, color?: string): Promise<KeywordGroupSummary> {
        z.string().trim().min(1).parse(accountId);
        const parsed = groupFields.parse({ name, color: color ?? '#6366f1' });
        const trimmed = parsed.name;
        if (!trimmed || trimmed.length > 100) {
            throw new Error('Group name must be 1-100 characters');
        }

        const group = await prisma.$transaction(async tx => {
        // Serialize quota checks per tenant, including when it currently has no groups.
        await tx.$queryRaw`SELECT id FROM "Account" WHERE id = ${accountId} FOR UPDATE`;
        const count = await tx.keywordGroup.count({ where: { accountId } });
        if (count >= MAX_GROUPS_PER_ACCOUNT) {
            throw new Error(`Maximum of ${MAX_GROUPS_PER_ACCOUNT} groups reached`);
        }

        return tx.keywordGroup.create({
            data: {
                accountId,
                name: trimmed,
                color: parsed.color,
            },
            include: { keywords: { where: { isActive: true } } }
        });
        });

        return mapGroupToSummary(group);
    }

    /**
     * Update group name/color.
     */
    static async updateGroup(accountId: string, groupId: string, data: { name?: string; color?: string }): Promise<KeywordGroupSummary> {
        z.string().trim().min(1).parse(accountId);
        z.string().trim().min(1).parse(groupId);
        data = groupFields.partial().strict().parse(data);
        if (!Object.keys(data).length) throw new Error('No group fields provided');
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
        z.string().trim().min(1).parse(accountId);
        z.string().trim().min(1).parse(groupId);
        const result = await prisma.keywordGroup.deleteMany({
            where: { id: groupId, accountId }
        });
        if (!result.count) throw new Error('Group not found');
    }

    /**
     * List all groups with aggregate metrics.
     */
    static async listGroups(accountId: string): Promise<KeywordGroupSummary[]> {
        z.string().trim().min(1).parse(accountId);
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
        const count = await this.bulkAssign(accountId, [keywordId], groupId);
        if (count !== 1) throw new Error('Keyword not found');
    }

    /**
     * Bulk assign keywords to a group.
     */
    static async bulkAssign(accountId: string, keywordIds: string[], groupId: string | null): Promise<number> {
        z.string().trim().min(1).parse(accountId);
        keywordIds = [...new Set(z.array(z.string().trim().min(1).max(128)).min(1).max(500).parse(keywordIds))];
        groupId = z.string().min(1).max(128).nullable().parse(groupId);
        return prisma.$transaction(async tx => {
        if (groupId) {
            const group = await tx.keywordGroup.findFirst({
                where: { id: groupId, accountId }
            });
            if (!group) throw new Error('Group not found');
        }

        const result = await tx.trackedKeyword.updateMany({
            where: { id: { in: keywordIds }, accountId },
            data: { groupId }
        });

        if (result.count !== keywordIds.length) throw new Error('One or more keywords not found in account; no assignments saved');
        return result.count;
        });
    }
}

/** Map Prisma group + keywords to summary with metrics */
function mapGroupToSummary(group: any): KeywordGroupSummary {
    const keywords = group.keywords || [];
    const withPosition = keywords.filter((k: any) => Number.isFinite(k.currentPosition) && k.currentPosition > 0);

    const valid = (value: unknown) => typeof value === 'number' && Number.isFinite(value) && value >= 0;
    const known = keywords.filter((k: any) => valid(k.currentClicks) && valid(k.currentImpressions));
    const totalClicks = known.length === keywords.length && keywords.length ? known.reduce((sum: number, k: any) => sum + k.currentClicks, 0) : null;
    const totalImpressions = known.length === keywords.length && keywords.length ? known.reduce((sum: number, k: any) => sum + k.currentImpressions, 0) : null;

    return {
        id: group.id,
        name: group.name,
        color: group.color,
        keywordCount: keywords.length,
        metricCoverage: known.length,
        positionMethod: 'unweighted-known-keywords',
        avgPosition: withPosition.length > 0
            ? Math.round((withPosition.reduce((sum: number, k: any) => sum + k.currentPosition, 0) / withPosition.length) * 10) / 10
            : null,
        totalClicks,
        totalImpressions,
        avgCtr: totalImpressions > 0 ? Math.round((totalClicks / totalImpressions) * 10000) / 100 : null,
        createdAt: group.createdAt,
    };
}
