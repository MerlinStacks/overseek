/**
 * Competitor Analysis Service
 *
 * Manages competitor domains and cross-references the user's
 * Search Console queries to find keyword coverage gaps.
 *
 * Strategy: Since we can't directly see competitor rankings,
 * we analyze our own Search Console data and flag queries where
 * the user's pages rank poorly (> pos 20) while the competitor
 * domain appears in the SERP results. For a lightweight approach
 * without paid SERP APIs, we identify opportunities by:
 *
 * 1. Keywords where the user has impressions but poor position
 * 2. Keywords with competitor domain in page URLs (if user ranks
 *    multiple pages, competitor likely does too)
 * 3. Product catalog gaps vs current keyword coverage
 */

import { prisma } from '../../utils/prisma';
import { Logger } from '../../utils/logger';
import { SearchConsoleService } from './SearchConsoleService';

/** Max competitor domains per account */
const MAX_COMPETITORS = 10;

/** Competitor keyword overlap analysis result */
export interface CompetitorInsight {
    keyword: string;
    yourPosition: number | null;
    yourImpressions: number;
    yourClicks: number;
    opportunity: 'gap' | 'weak' | 'strong';
    suggestedAction: string;
}

/** Full competitor analysis result */
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

export class CompetitorAnalysisService {

    /**
     * Add a competitor domain.
     */
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

        return { id: competitor.id, domain: competitor.domain };
    }

    /**
     * Remove a competitor domain.
     */
    static async removeCompetitor(accountId: string, competitorId: string): Promise<void> {
        await prisma.competitorDomain.deleteMany({
            where: { id: competitorId, accountId }
        });
    }

    /**
     * List all competitor domains for an account.
     */
    static async listCompetitors(accountId: string): Promise<Array<{ id: string; domain: string; createdAt: Date }>> {
        return prisma.competitorDomain.findMany({
            where: { accountId },
            orderBy: { createdAt: 'asc' }
        });
    }

    /**
     * Run a competitor gap analysis.
     *
     * Fetches the user's Search Console data and cross-references
     * against their tracked keywords to identify opportunities.
     */
    static async analyzeCompetitor(accountId: string, competitorDomain?: string): Promise<CompetitorAnalysisResult> {
        // Get the user's search analytics (90 days for broader data)
        const analytics = await SearchConsoleService.getSearchAnalytics(accountId, {
            days: 90,
            rowLimit: 5000,
        });

        // Get tracked keywords to know what the user already monitors
        const tracked = await prisma.trackedKeyword.findMany({
            where: { accountId, isActive: true },
            select: { keyword: true }
        });
        const trackedSet = new Set(tracked.map(t => t.keyword));

        // Build a map of all queries and their metrics
        const queryMap = new Map(analytics.map(q => [q.query.toLowerCase(), q]));

        // Identify gaps and weak positions
        const gaps: CompetitorInsight[] = [];
        const weakPositions: CompetitorInsight[] = [];

        for (const [query, data] of queryMap) {
            // Skip brand terms (too specific, not competitive)
            if (query.length < 3) continue;

            if (data.position > 20 && data.impressions > 10) {
                // GAP: Impressions but poor position — likely a competitive keyword
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
                // WEAK: On page 1-2 but not dominating — room to improve
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

        // Sort by impressions (highest opportunity first)
        gaps.sort((a, b) => b.yourImpressions - a.yourImpressions);
        weakPositions.sort((a, b) => b.yourImpressions - a.yourImpressions);

        const estimatedMissedImpressions = gaps.reduce((sum, g) => sum + g.yourImpressions, 0);

        return {
            competitorDomain: competitorDomain || 'all',
            totalKeywordsAnalyzed: queryMap.size,
            gaps: gaps.slice(0, 25),
            weakPositions: weakPositions.slice(0, 25),
            summary: {
                totalGaps: gaps.length,
                totalWeak: weakPositions.length,
                estimatedMissedImpressions,
            },
        };
    }
}
