/**
 * Keyword Revenue Attribution Service
 *
 * Correlates tracked keywords with revenue by matching:
 * 1. AnalyticsSessions with Google organic referrer
 * 2. Landing page paths matching keyword targetUrl
 * 3. Purchase events from those sessions
 *
 * Updates TrackedKeyword.estimatedRevenue during the daily refresh cycle.
 */

import { prisma } from '../../utils/prisma';
import { Logger } from '../../utils/logger';

/** Revenue attribution result for a single keyword */
export interface KeywordRevenueAttribution {
    keywordId: string;
    keyword: string;
    targetUrl: string | null;
    sessions: number;
    conversions: number;
    estimatedRevenue: number;
}

export class KeywordRevenueService {

    /**
     * Calculate and update revenue attribution for all tracked keywords.
     * Called during the daily keyword refresh cycle.
     *
     * Strategy:
     * - Find AnalyticsSessions from Google organic traffic (referrer contains 'google')
     * - Match sessions whose landing pages (first pageview URL) contain the keyword's targetUrl path
     * - Sum up purchase event revenue from those sessions
     * - For keywords without a targetUrl, match based on search query parameters in the URL
     */
    static async refreshRevenueAttribution(accountId: string): Promise<number> {
        const keywords = await prisma.trackedKeyword.findMany({
            where: { accountId, isActive: true }
        });

        if (keywords.length === 0) return 0;

        // Get the last 30 days of analytics sessions from Google organic
        const thirtyDaysAgo = new Date();
        thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

        const organicSessions = await prisma.analyticsSession.findMany({
            where: {
                accountId,
                createdAt: { gte: thirtyDaysAgo },
                OR: [
                    { referrer: { contains: 'google', mode: 'insensitive' } },
                    { utmSource: { contains: 'google', mode: 'insensitive' } },
                    { firstTouchSource: { contains: 'google', mode: 'insensitive' } },
                ],
            },
            include: {
                events: {
                    where: {
                        type: { in: ['pageview', 'purchase'] }
                    },
                    orderBy: { createdAt: 'asc' }
                }
            }
        });

        if (organicSessions.length === 0) {
            Logger.debug('No Google organic sessions found for revenue attribution', { accountId });
            return 0;
        }

        let updated = 0;
        const ops: any[] = [];

        for (const kw of keywords) {
            let revenue = 0;
            let sessions = 0;
            let conversions = 0;

            for (const session of organicSessions) {
                const pageviews = session.events.filter(e => e.type === 'pageview');
                const purchases = session.events.filter(e => e.type === 'purchase');

                if (pageviews.length === 0) continue;

                // Check if this session's landing page matches the keyword's target URL
                let isMatch = false;

                if (kw.targetUrl) {
                    // Extract path from targetUrl for comparison
                    const targetPath = extractPath(kw.targetUrl);
                    isMatch = pageviews.some(pv => {
                        const pvPath = extractPath(pv.url);
                        return pvPath.includes(targetPath) || targetPath.includes(pvPath);
                    });
                } else {
                    // Without targetUrl, check if the keyword appears in any pageview URL
                    const kwSlug = kw.keyword.replace(/\s+/g, '-').toLowerCase();
                    isMatch = pageviews.some(pv => {
                        const pvUrl = pv.url.toLowerCase();
                        return pvUrl.includes(kwSlug) || pvUrl.includes(kw.keyword.replace(/\s+/g, '+'));
                    });
                }

                if (isMatch) {
                    sessions++;
                    for (const purchase of purchases) {
                        const payload = purchase.payload as any;
                        if (payload?.revenue || payload?.total) {
                            revenue += parseFloat(String(payload.revenue || payload.total)) || 0;
                            conversions++;
                        }
                    }
                }
            }

            // Only update if we have data (don't zero out existing values when there's no traffic)
            if (sessions > 0) {
                ops.push(prisma.trackedKeyword.update({
                    where: { id: kw.id },
                    data: { estimatedRevenue: Math.round(revenue * 100) / 100 }
                }));
                updated++;
            }
        }

        if (ops.length > 0) {
            await prisma.$transaction(ops);
        }

        Logger.info('Keyword revenue attribution refreshed', { accountId, updated });
        return updated;
    }

    /**
     * Get revenue attribution for all tracked keywords (read-only, from denormalized data).
     */
    static async getRevenueReport(accountId: string): Promise<KeywordRevenueAttribution[]> {
        const keywords = await prisma.trackedKeyword.findMany({
            where: { accountId, isActive: true, estimatedRevenue: { gt: 0 } },
            orderBy: { estimatedRevenue: 'desc' }
        });

        return keywords.map(kw => ({
            keywordId: kw.id,
            keyword: kw.keyword,
            targetUrl: kw.targetUrl,
            sessions: 0, // Would need to re-query for live session count
            conversions: 0,
            estimatedRevenue: kw.estimatedRevenue ?? 0,
        }));
    }
}

/**
 * Extract URL path, removing protocol and domain.
 */
function extractPath(url: string): string {
    try {
        const parsed = new URL(url.startsWith('http') ? url : `https://${url}`);
        return parsed.pathname.replace(/\/+$/, '').toLowerCase();
    } catch {
        // Fallback: treat the whole thing as a path
        return url.replace(/^https?:\/\/[^/]+/, '').replace(/\/+$/, '').toLowerCase();
    }
}
