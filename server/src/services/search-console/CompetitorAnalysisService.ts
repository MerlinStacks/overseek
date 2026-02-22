/**
 * Competitor Analysis Service
 *
 * Manages competitor domains, synchronizes tracked keywords per
 * competitor, checks SERP positions via SerpCheckService, stores
 * historical rank data, and produces movement/head-to-head reports.
 *
 * Why separate from KeywordTrackingService: competitor rank data
 * comes from Google Custom Search API (not Search Console), has its
 * own schema models, and updates on a different schedule. Keeping
 * them separate prevents coupling and lets each evolve independently.
 */

import { prisma } from '../../utils/prisma';
import { Logger } from '../../utils/logger';
import { SearchConsoleService } from './SearchConsoleService';
import { SerpCheckService } from './SerpCheckService';
import { EventBus, EVENTS } from '../events';

/** Max competitor domains per account */
const MAX_COMPETITORS = 10;

/** Position change threshold to emit an alert event */
const SIGNIFICANT_POSITION_CHANGE = 5;

// ─────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────

/** Legacy gap-analysis result (kept for backward compatibility) */
export interface CompetitorInsight {
    keyword: string;
    yourPosition: number | null;
    yourImpressions: number;
    yourClicks: number;
    opportunity: 'gap' | 'weak' | 'strong';
    suggestedAction: string;
}

export interface CompetitorAnalysisResult {
    competitorDomain: string;
    totalKeywordsAnalyzed: number;
    gaps: CompetitorInsight[];
    weakPositions: CompetitorInsight[];
    summary: {
        totalGaps: number;
        totalWeak: number;
        estimatedMissedImpressions: number;
    };
}

/** A competitor keyword with its current position and recent change */
export interface CompetitorKeywordPosition {
    id: string;
    keyword: string;
    currentPosition: number | null;
    previousPosition: number | null;
    rankingUrl: string | null;
    positionChange: number | null;
    lastCheckedAt: string | null;
}

/** Movement event: a significant position change for a competitor */
export interface CompetitorMovement {
    competitorDomain: string;
    keyword: string;
    previousPosition: number | null;
    newPosition: number | null;
    change: number;
    direction: 'improved' | 'declined' | 'entered' | 'dropped';
    date: string;
}

/** Head-to-head row: your position vs competitor's on one keyword */
export interface HeadToHeadRow {
    keyword: string;
    yourPosition: number | null;
    theirPosition: number | null;
    positionDelta: number | null;
    /** positive = you're ahead, negative = they're ahead */
    advantage: number | null;
}

/** Competitor domain with keyword stats */
export interface CompetitorWithStats {
    id: string;
    domain: string;
    notes: string | null;
    isActive: boolean;
    keywordCount: number;
    avgPosition: number | null;
    lastCheckedAt: string | null;
    createdAt: Date;
}

export class CompetitorAnalysisService {

    // ─────────────────────────────────────────────────────
    // CRUD — Competitor Domains
    // ─────────────────────────────────────────────────────

    /** Add a competitor domain. */
    static async addCompetitor(accountId: string, domain: string): Promise<{ id: string; domain: string }> {
        const normalized = domain.toLowerCase().replace(/^(https?:\/\/)?(www\.)?/, '').replace(/\/+$/, '').trim();
        if (!normalized || normalized.length > 255) {
            throw new Error('Invalid domain');
        }

        const count = await prisma.competitorDomain.count({ where: { accountId } });
        if (count >= MAX_COMPETITORS) {
            throw new Error(`Maximum of ${MAX_COMPETITORS} competitor domains reached`);
        }

        const competitor = await prisma.competitorDomain.create({
            data: { accountId, domain: normalized }
        });

        // Auto-sync keywords for the new competitor
        await this.syncCompetitorKeywords(accountId, competitor.id);

        return { id: competitor.id, domain: competitor.domain };
    }

    /** Remove a competitor domain (cascades to keywords + history). */
    static async removeCompetitor(accountId: string, competitorId: string): Promise<void> {
        await prisma.competitorDomain.deleteMany({
            where: { id: competitorId, accountId }
        });
    }

    /** List all competitor domains with aggregate keyword stats. */
    static async listCompetitors(accountId: string): Promise<CompetitorWithStats[]> {
        const competitors = await prisma.competitorDomain.findMany({
            where: { accountId },
            include: {
                keywords: {
                    select: { currentPosition: true, lastCheckedAt: true }
                }
            },
            orderBy: { createdAt: 'asc' }
        });

        return competitors.map(c => {
            const withPosition = c.keywords.filter(k => k.currentPosition !== null);
            const avgPos = withPosition.length > 0
                ? withPosition.reduce((sum, k) => sum + (k.currentPosition ?? 0), 0) / withPosition.length
                : null;

            const latestCheck = c.keywords
                .filter(k => k.lastCheckedAt)
                .sort((a, b) => (b.lastCheckedAt?.getTime() ?? 0) - (a.lastCheckedAt?.getTime() ?? 0))[0];

            return {
                id: c.id,
                domain: c.domain,
                notes: c.notes,
                isActive: c.isActive,
                keywordCount: c.keywords.length,
                avgPosition: avgPos ? Math.round(avgPos * 10) / 10 : null,
                lastCheckedAt: latestCheck?.lastCheckedAt?.toISOString() ?? null,
                createdAt: c.createdAt,
            };
        });
    }

    // ─────────────────────────────────────────────────────
    // Keyword Sync — link tracked keywords to competitors
    // ─────────────────────────────────────────────────────

    /**
     * Ensure each competitor has CompetitorKeyword records for all
     * of the user's active TrackedKeywords. Called when adding a
     * competitor or when the user adds new tracked keywords.
     */
    static async syncCompetitorKeywords(accountId: string, competitorId?: string): Promise<number> {
        const trackedKeywords = await prisma.trackedKeyword.findMany({
            where: { accountId, isActive: true },
            select: { keyword: true }
        });

        if (trackedKeywords.length === 0) return 0;

        const competitors = competitorId
            ? await prisma.competitorDomain.findMany({ where: { id: competitorId, accountId } })
            : await prisma.competitorDomain.findMany({ where: { accountId, isActive: true } });

        let created = 0;

        for (const comp of competitors) {
            const existing = await prisma.competitorKeyword.findMany({
                where: { competitorId: comp.id },
                select: { keyword: true }
            });
            const existingSet = new Set(existing.map(e => e.keyword));

            const newKeywords = trackedKeywords
                .filter(tk => !existingSet.has(tk.keyword))
                .map(tk => ({
                    competitorId: comp.id,
                    keyword: tk.keyword,
                }));

            if (newKeywords.length > 0) {
                await prisma.competitorKeyword.createMany({
                    data: newKeywords,
                    skipDuplicates: true,
                });
                created += newKeywords.length;
            }
        }

        Logger.info(`Synced competitor keywords: ${created} new records`, { accountId });
        return created;
    }

    // ─────────────────────────────────────────────────────
    // SERP Position Refresh
    // ─────────────────────────────────────────────────────

    /**
     * Refresh SERP positions for all active competitors of an account.
     * For each competitor × keyword, runs a SERP check via Custom Search
     * API, stores the result in CompetitorRankHistory, and updates the
     * denormalized currentPosition on CompetitorKeyword.
     */
    static async refreshCompetitorPositions(accountId: string): Promise<{
        checked: number;
        movements: CompetitorMovement[];
    }> {
        const competitors = await prisma.competitorDomain.findMany({
            where: { accountId, isActive: true },
            include: {
                keywords: { select: { id: true, keyword: true, currentPosition: true } }
            }
        });

        const today = new Date();
        today.setHours(0, 0, 0, 0);

        let checked = 0;
        const movements: CompetitorMovement[] = [];

        for (const comp of competitors) {
            if (comp.keywords.length === 0) continue;

            const keywords = comp.keywords.map(k => k.keyword);
            const results = await SerpCheckService.checkPositionsBulk(keywords, comp.domain);

            for (const kw of comp.keywords) {
                const result = results.get(kw.keyword);
                if (!result) continue;

                const previousPosition = kw.currentPosition;

                // Upsert history for today (idempotent — safe to re-run)
                await prisma.competitorRankHistory.upsert({
                    where: {
                        competitorKeywordId_date: {
                            competitorKeywordId: kw.id,
                            date: today,
                        }
                    },
                    create: {
                        competitorKeywordId: kw.id,
                        position: result.position,
                        previousPosition,
                        rankingUrl: result.rankingUrl,
                        date: today,
                    },
                    update: {
                        position: result.position,
                        previousPosition,
                        rankingUrl: result.rankingUrl,
                    }
                });

                // Update denormalized fields on CompetitorKeyword
                await prisma.competitorKeyword.update({
                    where: { id: kw.id },
                    data: {
                        currentPosition: result.position,
                        rankingUrl: result.rankingUrl,
                        lastCheckedAt: new Date(),
                    }
                });

                checked++;

                // Detect significant movement
                const movement = this.classifyMovement(
                    comp.domain, kw.keyword, previousPosition, result.position, today
                );
                if (movement) {
                    movements.push(movement);
                }
            }
        }

        // Emit events for significant movements
        if (movements.length > 0) {
            EventBus.emit(EVENTS.SEO.COMPETITOR_RANK_CHANGE, { accountId, movements });
        }

        Logger.info(`Competitor SERP refresh complete: ${checked} keywords checked, ${movements.length} movements`, { accountId });
        return { checked, movements };
    }

    // ─────────────────────────────────────────────────────
    // Reports — Movement & Head-to-Head
    // ─────────────────────────────────────────────────────

    /** Get competitor keywords with positions for a specific competitor. */
    static async getCompetitorKeywords(competitorId: string): Promise<CompetitorKeywordPosition[]> {
        const keywords = await prisma.competitorKeyword.findMany({
            where: { competitorId },
            include: {
                history: {
                    orderBy: { date: 'desc' },
                    take: 2,
                    select: { position: true, previousPosition: true }
                }
            },
            orderBy: { keyword: 'asc' }
        });

        return keywords.map(kw => {
            const latest = kw.history[0];
            const previous = kw.history[1];
            const prevPos = latest?.previousPosition ?? previous?.position ?? null;
            const change = (kw.currentPosition !== null && prevPos !== null)
                ? prevPos - kw.currentPosition
                : null;

            return {
                id: kw.id,
                keyword: kw.keyword,
                currentPosition: kw.currentPosition,
                previousPosition: prevPos,
                rankingUrl: kw.rankingUrl,
                positionChange: change,
                lastCheckedAt: kw.lastCheckedAt?.toISOString() ?? null,
            };
        });
    }

    /** Get rank history for a specific competitor keyword (chart data). */
    static async getCompetitorKeywordHistory(
        competitorKeywordId: string,
        days: number = 30
    ): Promise<Array<{ date: string; position: number | null }>> {
        const since = new Date();
        since.setDate(since.getDate() - days);

        const history = await prisma.competitorRankHistory.findMany({
            where: {
                competitorKeywordId,
                date: { gte: since }
            },
            orderBy: { date: 'asc' },
            select: { date: true, position: true }
        });

        return history.map(h => ({
            date: h.date.toISOString().split('T')[0],
            position: h.position,
        }));
    }

    /**
     * Recent significant position changes across all competitors.
     * Returns the top movements sorted by magnitude.
     */
    static async getCompetitorMovement(accountId: string, days: number = 7): Promise<CompetitorMovement[]> {
        const since = new Date();
        since.setDate(since.getDate() - days);

        const history = await prisma.competitorRankHistory.findMany({
            where: {
                competitorKeyword: {
                    competitor: { accountId, isActive: true }
                },
                date: { gte: since },
                previousPosition: { not: null },
            },
            include: {
                competitorKeyword: {
                    select: {
                        keyword: true,
                        competitor: { select: { domain: true } }
                    }
                }
            },
            orderBy: { date: 'desc' }
        });

        const movements: CompetitorMovement[] = [];

        for (const h of history) {
            const movement = this.classifyMovement(
                h.competitorKeyword.competitor.domain,
                h.competitorKeyword.keyword,
                h.previousPosition,
                h.position,
                h.date
            );
            if (movement) {
                movements.push(movement);
            }
        }

        // Sort by absolute change magnitude
        movements.sort((a, b) => Math.abs(b.change) - Math.abs(a.change));
        return movements.slice(0, 50);
    }

    /**
     * Side-by-side comparison: your positions vs a competitor's positions
     * on all shared keywords.
     */
    static async getHeadToHead(accountId: string, competitorDomain: string): Promise<HeadToHeadRow[]> {
        const competitor = await prisma.competitorDomain.findFirst({
            where: { accountId, domain: competitorDomain },
            include: {
                keywords: {
                    select: { keyword: true, currentPosition: true }
                }
            }
        });

        if (!competitor) return [];

        // Get the user's own keyword positions
        const tracked = await prisma.trackedKeyword.findMany({
            where: { accountId, isActive: true },
            select: { keyword: true, currentPosition: true }
        });
        const yourPositions = new Map(tracked.map(t => [t.keyword, t.currentPosition]));

        return competitor.keywords.map(ck => {
            const yourPos = yourPositions.get(ck.keyword) ?? null;
            const theirPos = ck.currentPosition;
            const advantage = (yourPos !== null && theirPos !== null)
                ? theirPos - yourPos
                : null;

            return {
                keyword: ck.keyword,
                yourPosition: yourPos,
                theirPosition: theirPos,
                positionDelta: theirPos !== null
                    ? (ck.currentPosition ?? 0) - (yourPos ?? 0)
                    : null,
                advantage,
            };
        }).sort((a, b) => {
            // Sort: you're behind first, then by keyword
            if (a.advantage !== null && b.advantage !== null) return a.advantage - b.advantage;
            if (a.advantage === null) return 1;
            return -1;
        });
    }

    // ─────────────────────────────────────────────────────
    // Legacy — Gap Analysis (backward compatibility)
    // ─────────────────────────────────────────────────────

    /**
     * Run a competitor gap analysis from the user's own Search Console data.
     * This is the original approach — identifies keywords where the user
     * ranks poorly, inferring competitive pressure. Kept for backward
     * compatibility with the existing frontend.
     */
    static async analyzeCompetitor(accountId: string, competitorDomain?: string): Promise<CompetitorAnalysisResult> {
        const analytics = await SearchConsoleService.getSearchAnalytics(accountId, {
            days: 90,
            rowLimit: 5000,
        });

        const tracked = await prisma.trackedKeyword.findMany({
            where: { accountId, isActive: true },
            select: { keyword: true }
        });
        const trackedSet = new Set(tracked.map(t => t.keyword));

        const queryMap = new Map(analytics.map(q => [q.query.toLowerCase(), q]));

        const gaps: CompetitorInsight[] = [];
        const weakPositions: CompetitorInsight[] = [];

        for (const [query, data] of queryMap) {
            if (query.length < 3) continue;

            if (data.position > 20 && data.impressions > 10) {
                const insight: CompetitorInsight = {
                    keyword: query,
                    yourPosition: data.position,
                    yourImpressions: data.impressions,
                    yourClicks: data.clicks,
                    opportunity: 'gap',
                    suggestedAction: data.position > 50
                        ? 'Create dedicated content targeting this keyword'
                        : 'Optimize existing pages to improve ranking',
                };
                if (!trackedSet.has(query)) {
                    gaps.push(insight);
                }
            } else if (data.position > 5 && data.position <= 20 && data.impressions > 50) {
                weakPositions.push({
                    keyword: query,
                    yourPosition: data.position,
                    yourImpressions: data.impressions,
                    yourClicks: data.clicks,
                    opportunity: 'weak',
                    suggestedAction: data.position <= 10
                        ? 'Strengthen content and build backlinks to reach top 3'
                        : 'Improve on-page SEO and internal linking to reach page 1',
                });
            }
        }

        gaps.sort((a, b) => b.yourImpressions - a.yourImpressions);
        weakPositions.sort((a, b) => b.yourImpressions - a.yourImpressions);

        return {
            competitorDomain: competitorDomain || 'all',
            totalKeywordsAnalyzed: queryMap.size,
            gaps: gaps.slice(0, 25),
            weakPositions: weakPositions.slice(0, 25),
            summary: {
                totalGaps: gaps.length,
                totalWeak: weakPositions.length,
                estimatedMissedImpressions: gaps.reduce((sum, g) => sum + g.yourImpressions, 0),
            },
        };
    }

    // ─────────────────────────────────────────────────────
    // Internal Helpers
    // ─────────────────────────────────────────────────────

    /**
     * Classify a position change into a movement event.
     * Returns null if the change isn't significant enough.
     */
    private static classifyMovement(
        domain: string,
        keyword: string,
        previousPosition: number | null,
        newPosition: number | null,
        date: Date
    ): CompetitorMovement | null {
        if (previousPosition === null && newPosition !== null) {
            return {
                competitorDomain: domain,
                keyword,
                previousPosition: null,
                newPosition,
                change: 0,
                direction: 'entered',
                date: date.toISOString().split('T')[0],
            };
        }

        if (previousPosition !== null && newPosition === null) {
            return {
                competitorDomain: domain,
                keyword,
                previousPosition,
                newPosition: null,
                change: 0,
                direction: 'dropped',
                date: date.toISOString().split('T')[0],
            };
        }

        if (previousPosition !== null && newPosition !== null) {
            const change = previousPosition - newPosition;
            if (Math.abs(change) >= SIGNIFICANT_POSITION_CHANGE) {
                return {
                    competitorDomain: domain,
                    keyword,
                    previousPosition,
                    newPosition,
                    change,
                    direction: change > 0 ? 'improved' : 'declined',
                    date: date.toISOString().split('T')[0],
                };
            }
        }

        return null;
    }
}
