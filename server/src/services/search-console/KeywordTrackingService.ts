/**
 * Keyword Tracking Service
 *
 * Manages tracked keywords: add, remove, fetch history,
 * and scheduled position updates via Search Console API.
 *
 * Why denormalize current metrics on TrackedKeyword:
 * Avoids joining history table on every list render.
 * History is only queried when viewing a specific keyword's chart.
 */

import { prisma } from '../../utils/prisma';
import { Logger } from '../../utils/logger';
import { SearchConsoleService } from './SearchConsoleService';
import { EventBus, EVENTS } from '../events';

/** Max tracked keywords per account to prevent unbounded growth */
const MAX_KEYWORDS_PER_ACCOUNT = 100;

/** Rank movement threshold to trigger an alert (positions) */
const RANK_ALERT_THRESHOLD = 5;

/** Page boundary positions — crossing these triggers alerts */
const PAGE_BOUNDARIES = [10, 20, 30];

/** Shape returned when listing tracked keywords */
export interface TrackedKeywordSummary {
    id: string;
    keyword: string;
    targetUrl: string | null;
    currentPosition: number | null;
    currentCtr: number | null;
    currentImpressions: number | null;
    currentClicks: number | null;
    isActive: boolean;
    createdAt: Date;
    groupId: string | null;
    estimatedRevenue: number | null;
    estimatedSearchVolume: number | null;
    tags: string[];
}

/** Shape of a single history data point for charts */
export interface RankHistoryPoint {
    date: string;
    position: number;
    previousPosition: number | null;
    clicks: number;
    impressions: number;
    ctr: number;
}

/** Result from bulk keyword import */
export interface BulkImportResult {
    added: number;
    skipped: number;
    failed: number;
    errors: string[];
}

export class KeywordTrackingService {

    /**
     * Add a keyword to tracking. Deduplicates by accountId + keyword.
     */
    static async addKeyword(accountId: string, keyword: string, targetUrl?: string): Promise<TrackedKeywordSummary> {
        const normalized = keyword.toLowerCase().trim();
        if (!normalized || normalized.length > 200) {
            throw new Error('Keyword must be 1-200 characters');
        }

        const existing = await prisma.trackedKeyword.findUnique({
            where: { accountId_keyword: { accountId, keyword: normalized } }
        });

        if (existing) {
            // Reactivate if previously deactivated
            if (!existing.isActive) {
                const updated = await prisma.trackedKeyword.update({
                    where: { id: existing.id },
                    data: { isActive: true, targetUrl }
                });
                return mapToSummary(updated);
            }
            return mapToSummary(existing);
        }

        // Enforce per-account limit to prevent unbounded growth
        const activeCount = await prisma.trackedKeyword.count({
            where: { accountId, isActive: true }
        });
        if (activeCount >= MAX_KEYWORDS_PER_ACCOUNT) {
            throw new Error(`Maximum of ${MAX_KEYWORDS_PER_ACCOUNT} tracked keywords reached`);
        }

        const created = await prisma.trackedKeyword.create({
            data: {
                accountId,
                keyword: normalized,
                targetUrl: targetUrl || null,
                isActive: true,
            }
        });

        return mapToSummary(created);
    }

    /**
     * Add multiple keywords in bulk. Returns summary of results.
     */
    static async addKeywordsBulk(accountId: string, keywords: string[], targetUrl?: string): Promise<BulkImportResult> {
        const result: BulkImportResult = { added: 0, skipped: 0, failed: 0, errors: [] };

        for (const kw of keywords) {
            const normalized = kw.toLowerCase().trim();
            if (!normalized || normalized.length > 200) {
                result.failed++;
                result.errors.push(`Invalid keyword: "${kw.substring(0, 50)}"`);
                continue;
            }

            try {
                const existing = await prisma.trackedKeyword.findUnique({
                    where: { accountId_keyword: { accountId, keyword: normalized } }
                });

                if (existing && existing.isActive) {
                    result.skipped++;
                    continue;
                }

                if (existing && !existing.isActive) {
                    await prisma.trackedKeyword.update({
                        where: { id: existing.id },
                        data: { isActive: true, targetUrl }
                    });
                    result.added++;
                    continue;
                }

                // Check limit before each add
                const activeCount = await prisma.trackedKeyword.count({
                    where: { accountId, isActive: true }
                });
                if (activeCount >= MAX_KEYWORDS_PER_ACCOUNT) {
                    result.failed++;
                    result.errors.push(`Limit reached (${MAX_KEYWORDS_PER_ACCOUNT}). "${normalized}" not added.`);
                    continue;
                }

                await prisma.trackedKeyword.create({
                    data: {
                        accountId,
                        keyword: normalized,
                        targetUrl: targetUrl || null,
                        isActive: true,
                    }
                });
                result.added++;
            } catch (error: any) {
                result.failed++;
                result.errors.push(`"${normalized}": ${error.message}`);
            }
        }

        Logger.info('Bulk keyword import completed', { accountId, ...result });
        return result;
    }

    /**
     * Remove a keyword from tracking (soft-delete via isActive flag).
     */
    static async removeKeyword(accountId: string, keywordId: string): Promise<void> {
        await prisma.trackedKeyword.updateMany({
            where: { id: keywordId, accountId },
            data: { isActive: false }
        });
    }

    /**
     * Permanently delete a keyword and all history.
     */
    static async deleteKeyword(accountId: string, keywordId: string): Promise<void> {
        await prisma.trackedKeyword.deleteMany({
            where: { id: keywordId, accountId }
        });
    }

    /**
     * List all tracked keywords for an account.
     */
    static async listKeywords(accountId: string, includeInactive = false): Promise<TrackedKeywordSummary[]> {
        const where: any = { accountId };
        if (!includeInactive) where.isActive = true;

        const keywords = await prisma.trackedKeyword.findMany({
            where,
            orderBy: { createdAt: 'asc' }
        });

        return keywords.map(mapToSummary);
    }

    /**
     * Get rank history for a specific keyword.
     */
    static async getHistory(accountId: string, keywordId: string, days: number = 30): Promise<RankHistoryPoint[]> {
        const since = new Date();
        since.setDate(since.getDate() - days);

        const history = await prisma.keywordRankHistory.findMany({
            where: {
                keywordId,
                keyword: { accountId },
                date: { gte: since }
            },
            orderBy: { date: 'asc' }
        });

        return history.map(h => ({
            date: h.date.toISOString().split('T')[0],
            position: h.position,
            previousPosition: h.previousPosition,
            clicks: h.clicks,
            impressions: h.impressions,
            ctr: h.ctr,
        }));
    }

    /**
     * Refresh positions for all tracked keywords for an account.
     * Called by the scheduled job or manually triggered.
     *
     * Fetches Search Console data and creates/updates history entries.
     * Emits rank change events when significant position shifts are detected.
     */
    static async refreshPositions(accountId: string): Promise<number> {
        const keywords = await prisma.trackedKeyword.findMany({
            where: { accountId, isActive: true }
        });

        if (keywords.length === 0) return 0;

        // Fetch all query analytics for the last 7 days (recent data)
        const analytics = await SearchConsoleService.getSearchAnalytics(accountId, {
            days: 7,
            rowLimit: 2000,
        });

        if (analytics.length === 0) {
            Logger.info('No SC data available for keyword refresh', { accountId });
            return 0;
        }

        // Build a lookup map of query -> metrics
        const queryMap = new Map(analytics.map(q => [q.query.toLowerCase(), q]));
        const today = new Date();
        today.setHours(0, 0, 0, 0);
        let updated = 0;

        // Collect rank change alerts to emit after transaction completes
        const rankChanges: Array<{
            keyword: string;
            keywordId: string;
            oldPosition: number;
            newPosition: number;
            direction: 'up' | 'down';
            delta: number;
            crossedPageBoundary: boolean;
        }> = [];

        // Batch all writes into a single transaction to avoid N+1 DB round-trips
        const ops: any[] = [];

        for (const kw of keywords) {
            const data = queryMap.get(kw.keyword);

            if (data) {
                const oldPosition = kw.currentPosition ?? 0;
                const newPosition = data.position;
                const delta = Math.abs(newPosition - oldPosition);

                // Detect significant rank changes for alerts
                if (oldPosition > 0 && delta >= RANK_ALERT_THRESHOLD) {
                    const direction = newPosition < oldPosition ? 'up' : 'down';
                    const crossedPageBoundary = PAGE_BOUNDARIES.some(
                        boundary => (oldPosition <= boundary && newPosition > boundary) ||
                            (oldPosition > boundary && newPosition <= boundary)
                    );

                    rankChanges.push({
                        keyword: kw.keyword,
                        keywordId: kw.id,
                        oldPosition,
                        newPosition,
                        direction,
                        delta,
                        crossedPageBoundary,
                    });
                }

                // Update denormalized current metrics
                ops.push(prisma.trackedKeyword.update({
                    where: { id: kw.id },
                    data: {
                        currentPosition: data.position,
                        currentCtr: data.ctr,
                        currentImpressions: data.impressions,
                        currentClicks: data.clicks,
                    }
                }));

                // Upsert today's history entry (with previousPosition tracking)
                ops.push(prisma.keywordRankHistory.upsert({
                    where: {
                        keywordId_date: { keywordId: kw.id, date: today }
                    },
                    update: {
                        position: data.position,
                        previousPosition: oldPosition || null,
                        clicks: data.clicks,
                        impressions: data.impressions,
                        ctr: data.ctr,
                    },
                    create: {
                        keywordId: kw.id,
                        date: today,
                        position: data.position,
                        previousPosition: oldPosition || null,
                        clicks: data.clicks,
                        impressions: data.impressions,
                        ctr: data.ctr,
                    }
                }));

                updated++;
            }
        }

        if (ops.length > 0) {
            await prisma.$transaction(ops);
        }

        // Emit rank change events after successful DB writes
        for (const change of rankChanges) {
            EventBus.emit(EVENTS.SEO.RANK_CHANGE, {
                accountId,
                ...change,
            });
        }

        Logger.info('Keyword positions refreshed', { accountId, tracked: keywords.length, updated, alerts: rankChanges.length });
        return updated;
    }

    /**
     * Refresh positions for ALL accounts with tracked keywords.
     * Called by the daily scheduler.
     */
    static async refreshAllAccounts(): Promise<void> {
        const accountIds = await prisma.trackedKeyword.findMany({
            where: { isActive: true },
            select: { accountId: true },
            distinct: ['accountId']
        });

        Logger.info(`Refreshing keyword positions for ${accountIds.length} accounts`);

        for (const { accountId } of accountIds) {
            try {
                await this.refreshPositions(accountId);
            } catch (error) {
                Logger.error('Failed to refresh keywords for account', { accountId, error });
            }
        }
    }
}

/** Map Prisma model to summary DTO */
function mapToSummary(kw: any): TrackedKeywordSummary {
    return {
        id: kw.id,
        keyword: kw.keyword,
        targetUrl: kw.targetUrl,
        currentPosition: kw.currentPosition,
        currentCtr: kw.currentCtr,
        currentImpressions: kw.currentImpressions,
        currentClicks: kw.currentClicks,
        isActive: kw.isActive,
        createdAt: kw.createdAt,
        groupId: kw.groupId ?? null,
        estimatedRevenue: kw.estimatedRevenue ?? null,
        estimatedSearchVolume: kw.estimatedSearchVolume ?? null,
        tags: kw.tags ?? [],
    };
}
