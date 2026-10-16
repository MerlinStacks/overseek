import { prisma } from '../../utils/prisma';
import { Logger } from '../../utils/logger';
import { pageVisitCtes } from './pageVisits';
import { pageEventFilter } from '../tracking/pageTracking';
import { getSearches } from '../tracking/EngagementMetrics';

export class BehaviourAnalytics {

    /**
     * Get pages with matching view, entry and exit metrics for the reporting period.
     */
    static async getBehaviourPages(accountId: string, startDate?: string, endDate?: string) {
        try {
            const start = startDate ? new Date(startDate) : new Date(0);
            const end = endDate ? new Date(endDate) : new Date();

            const pages = await prisma.$queryRaw<Array<{
                url: string; pageTitle: string | null; views: bigint; entries: bigint; exits: bigint;
            }>>`
                ${pageVisitCtes(accountId, start, end)}
                SELECT v.url, t."pageTitle", COUNT(*) AS views,
                    COUNT(*) FILTER (WHERE v.entry_rank = 1) AS entries,
                    COUNT(*) FILTER (WHERE v.exit_rank = 1) AS exits
                FROM RankedVisits v
                LEFT JOIN PageTitles t ON t.url = v.url
                GROUP BY v.url, t."pageTitle"
                ORDER BY views DESC, v.url
            `;

            return pages.map(p => ({
                url: p.url,
                title: p.pageTitle || 'Untitled',
                views: Number(p.views),
                entries: Number(p.entries),
                exits: Number(p.exits),
                exitRate: p.views ? Number(p.exits) / Number(p.views) * 100 : 0,
            }));

        } catch (error) {
            Logger.error('Analytics Pages Error', { error });
            return [];
        }
    }

    /**
     * Get Site Search Terms
     */
    static async getSiteSearch(accountId: string, startDate?: string, endDate?: string) {
        try {
            const start = startDate ? new Date(startDate) : new Date(0);
            const end = endDate ? new Date(endDate) : new Date();

            // Use the overview's aggregation so both reports recognize the same
            // search payloads and search-results pageviews, excluding empty terms.
            const { topQueries } = await getSearches(accountId, 30, {
                startDate: start,
                endDate: end,
            }, 50);

            return topQueries.map(t => ({
                term: t.query,
                searches: t.count
            }));
        } catch (error) {
            Logger.error('Analytics Search Error', { error });
            return [];
        }
    }

    /**
     * Get Entry Pages
     */
    static async getEntryPages(accountId: string, startDate?: string, endDate?: string) {
        try {
            const start = startDate ? new Date(startDate) : new Date(0);
            const end = endDate ? new Date(endDate) : new Date();

            const entries = await prisma.$queryRaw`
                ${pageVisitCtes(accountId, start, end)}
                SELECT url, COUNT(*) as entries
                FROM RankedVisits
                WHERE entry_rank = 1
                GROUP BY url
                ORDER BY entries DESC
                LIMIT 50
            `;

            return (entries as any[]).map(e => ({
                url: e.url,
                entries: Number(e.entries)
            }));

        } catch (error) {
            Logger.error('Analytics Entry Pages Error', { error });
            return [];
        }
    }

    /**
     * Get Exit Pages
     */
    static async getExitPages(accountId: string, startDate?: string, endDate?: string) {
        try {
            const start = startDate ? new Date(startDate) : new Date(0);
            const end = endDate ? new Date(endDate) : new Date();

            const exits = await prisma.$queryRaw`
               ${pageVisitCtes(accountId, start, end)}
               SELECT url, COUNT(*) as exits
               FROM RankedVisits
               WHERE exit_rank = 1
               GROUP BY url
               ORDER BY exits DESC
               LIMIT 50
           `;

            return (exits as any[]).map(e => ({
                url: e.url,
                exits: Number(e.exits)
            }));

        } catch (error) {
            Logger.error('Analytics Exit Pages Error', { error });
            return [];
        }
    }

    /**
     * Get page view counts for a specific product URL (7d and 30d).
     *
     * Why pathname-only matching: the tracking pixel records the full browser URL
     * (e.g. `https://www.store.com/product/ring/`) while the WooCommerce permalink
     * may use a different scheme or subdomain (e.g. `https://store.com/product/ring`).
     * Extracting the pathname from both sides normalises this mismatch.
     *
     * Why we avoid leading-wildcard LIKE: `LIKE '%/product/ring'` prevents PostgreSQL
     * from using a B-tree index and can produce false positives where one product slug
     * is a suffix of another path.
     */
    static async getProductPageViews(accountId: string, productUrl: string) {
        try {
            const now = new Date();
            const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
            const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);

            // Extract pathname from the WooCommerce permalink
            let pathname: string;
            try {
                pathname = new URL(productUrl).pathname;
            } catch {
                // Already a relative path or malformed — use as-is
                pathname = productUrl;
            }

            // Normalise: remove trailing slash, ensure leading slash
            const normalizedPath = pathname.replace(/\/+$/, '') || '/';

            // Build both with and without trailing slash for exact comparison.
            // The SQL extracts the pathname from the stored event URL (which is a
            // full absolute URL) using regexp_replace, then compares it to the
            // normalised path. This is an exact path check, not a substring LIKE.
            const pathWithSlash = normalizedPath + '/';

            const [views7d, views30d] = await Promise.all([
                prisma.$queryRaw<[{ count: bigint }]>`
                    SELECT COUNT(e.id) as count
                    FROM "AnalyticsEvent" e
                    JOIN "AnalyticsSession" s ON e."sessionId" = s.id
                    WHERE s."accountId" = ${accountId}
                    AND e."createdAt" >= ${sevenDaysAgo}
                    AND ${pageEventFilter}
                    AND e.type IN ('pageview', 'product_view')
                    AND regexp_replace(split_part(e.url, '?', 1), '^https?://[^/]+', '') IN (${normalizedPath}, ${pathWithSlash})
                `,
                prisma.$queryRaw<[{ count: bigint }]>`
                    SELECT COUNT(e.id) as count
                    FROM "AnalyticsEvent" e
                    JOIN "AnalyticsSession" s ON e."sessionId" = s.id
                    WHERE s."accountId" = ${accountId}
                    AND e."createdAt" >= ${thirtyDaysAgo}
                    AND ${pageEventFilter}
                    AND e.type IN ('pageview', 'product_view')
                    AND regexp_replace(split_part(e.url, '?', 1), '^https?://[^/]+', '') IN (${normalizedPath}, ${pathWithSlash})
                `
            ]);

            return {
                views7d: Number(views7d[0]?.count || 0),
                views30d: Number(views30d[0]?.count || 0)
            };

        } catch (error) {
            Logger.error('Product Page Views Error', { error, productUrl });
            return { views7d: 0, views30d: 0 };
        }
    }
}
