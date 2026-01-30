import { prisma } from '../../utils/prisma';
import { Logger } from '../../utils/logger';

export class BehaviourAnalytics {

    /**
     * Get Top Pages (Behaviour)
     */
    static async getBehaviourPages(accountId: string, startDate?: string, endDate?: string) {
        try {
            const start = startDate ? new Date(startDate) : new Date(0);
            const end = endDate ? new Date(endDate) : new Date();

            const pages = await prisma.$queryRaw`
                SELECT e.url as url, e."pageTitle", COUNT(e.id) as views
                FROM "AnalyticsEvent" e
                JOIN "AnalyticsSession" s ON e."sessionId" = s.id
                WHERE s."accountId" = ${accountId}
                AND e."createdAt" >= ${start}
                AND e."createdAt" <= ${end}
                AND e.type = 'pageview'
                GROUP BY e.url, e."pageTitle"
                ORDER BY views DESC
                LIMIT 50
            `;

            return (pages as any[]).map(p => ({
                url: p.url,
                title: p.pageTitle || 'Untitled',
                views: Number(p.views)
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

            const terms = await prisma.$queryRaw`
                SELECT COALESCE(payload->>'query', payload->>'term') as term, COUNT(e.id) as searches
                FROM "AnalyticsEvent" e
                JOIN "AnalyticsSession" s ON e."sessionId" = s.id
                WHERE s."accountId" = ${accountId}
                AND e."createdAt" >= ${start}
                AND e."createdAt" <= ${end}
                AND e.type = 'search'
                GROUP BY term
                ORDER BY searches DESC
                LIMIT 50
             `;

            return (terms as any[]).map(t => ({
                term: t.term,
                searches: Number(t.searches)
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
                WITH FirstEvents AS (
                    SELECT DISTINCT ON (e."sessionId") e.url, e."sessionId"
                    FROM "AnalyticsEvent" e
                    JOIN "AnalyticsSession" s ON e."sessionId" = s.id
                    WHERE s."accountId" = ${accountId}
                    AND s."createdAt" >= ${start}
                    AND s."createdAt" <= ${end}
                    ORDER BY e."sessionId", e."createdAt" ASC
                )
                SELECT url, COUNT("sessionId") as entries
                FROM FirstEvents
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
               WITH LastEvents AS (
                   SELECT DISTINCT ON (e."sessionId") e.url, e."sessionId"
                   FROM "AnalyticsEvent" e
                   JOIN "AnalyticsSession" s ON e."sessionId" = s.id
                   WHERE s."accountId" = ${accountId}
                   AND s."createdAt" >= ${start}
                   AND s."createdAt" <= ${end}
                   ORDER BY e."sessionId", e."createdAt" DESC
               )
               SELECT url, COUNT("sessionId") as exits
               FROM LastEvents
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
     * Get page view counts for a specific product URL (7d and 30d)
     */
    static async getProductPageViews(accountId: string, productUrl: string) {
        try {
            const now = new Date();
            const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
            const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);

            // Normalize URL by removing trailing slash for matching
            const normalizedUrl = productUrl.replace(/\/$/, '');

            const [views7d, views30d] = await Promise.all([
                prisma.$queryRaw<[{ count: bigint }]>`
                    SELECT COUNT(e.id) as count
                    FROM "AnalyticsEvent" e
                    JOIN "AnalyticsSession" s ON e."sessionId" = s.id
                    WHERE s."accountId" = ${accountId}
                    AND e."createdAt" >= ${sevenDaysAgo}
                    AND e.type IN ('pageview', 'product_view')
                    AND (e.url = ${normalizedUrl} OR e.url = ${normalizedUrl + '/'})
                `,
                prisma.$queryRaw<[{ count: bigint }]>`
                    SELECT COUNT(e.id) as count
                    FROM "AnalyticsEvent" e
                    JOIN "AnalyticsSession" s ON e."sessionId" = s.id
                    WHERE s."accountId" = ${accountId}
                    AND e."createdAt" >= ${thirtyDaysAgo}
                    AND e.type IN ('pageview', 'product_view')
                    AND (e.url = ${normalizedUrl} OR e.url = ${normalizedUrl + '/'})
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
