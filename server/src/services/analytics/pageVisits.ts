import { Prisma } from '@prisma/client';
import { pageEventFilter, reportPageUrl } from '../tracking/pageTracking';

/**
 * Common period page visits for page, entry, exit and roadblock reports.
 * Legacy events without visitId are split on 30-minute inactivity gaps using
 * ALL activity, not just page views (cart interactions keep a visit alive).
 */
export function pageVisitCtes(accountId: string, start: Date, end: Date) {
    return Prisma.sql`
        WITH Activity AS (
            SELECT e.*, LAG(e."createdAt") OVER (
                PARTITION BY e."sessionId" ORDER BY e."createdAt", e.id
            ) AS previous_activity
            FROM "AnalyticsEvent" e
            JOIN "AnalyticsSession" s ON e."sessionId" = s.id
            WHERE s."accountId" = ${accountId}
            AND e."createdAt" >= ${start} AND e."createdAt" <= ${end}
        ), ActivityGroups AS (
            SELECT *, SUM(CASE WHEN previous_activity IS NULL
                OR "createdAt" - previous_activity > INTERVAL '30 minutes'
                THEN 1 ELSE 0 END) OVER (
                    PARTITION BY "sessionId" ORDER BY "createdAt", id
                ) AS legacy_visit
            FROM Activity
        ), VisitActivity AS (
            SELECT *, COALESCE('visit:' || "visitId",
                'legacy:' || "sessionId" || ':' || legacy_visit) AS visit_key
            FROM ActivityGroups
        ), PageVisits AS (
            SELECT e.id, ${reportPageUrl} AS url, e."pageTitle", e.visit_key, e."createdAt"
            FROM VisitActivity e
            WHERE ${pageEventFilter}
        ), RankedVisits AS (
            SELECT *,
                ROW_NUMBER() OVER (PARTITION BY visit_key ORDER BY "createdAt", id) AS entry_rank,
                ROW_NUMBER() OVER (PARTITION BY visit_key ORDER BY "createdAt" DESC, id DESC) AS exit_rank
            FROM PageVisits
        ), PageTitles AS (
            SELECT DISTINCT ON (url) url, "pageTitle"
            FROM PageVisits
            WHERE NULLIF(BTRIM("pageTitle"), '') IS NOT NULL
            ORDER BY url, "createdAt" DESC, id DESC
        )
    `;
}
