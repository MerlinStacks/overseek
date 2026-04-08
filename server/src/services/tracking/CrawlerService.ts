/**
 * Crawler detection, logging, and blocking service.
 *
 * Provides structured crawler identification using the CrawlerRegistry,
 * fire-and-forget daily-aggregated logging, and Redis-cached block rule lookups.
 * All methods are designed to never block the tracking hot path.
 */

import { prisma } from '../../utils/prisma';
import { cacheAside, cacheDelete, CacheTTL } from '../../utils/cache';
import { Logger } from '../../utils/logger';
import { geoipLookupSync } from './GeoIPService';
import { CRAWLER_REGISTRY, CrawlerIdentity, CATEGORY_META } from './CrawlerRegistry';

const CACHE_NS = 'crawlers';

/**
 * Identify a crawler from its user-agent string.
 * Returns the full registry identity or a generic fallback.
 * Only call this AFTER `isBot()` has already returned `true`.
 *
 * @param userAgent - The raw user-agent string (case-insensitive)
 * @returns Matched CrawlerIdentity or null if no pattern matches
 */
export function identifyCrawler(userAgent: string): CrawlerIdentity | null {
    if (!userAgent) return null;

    const ua = userAgent.toLowerCase();

    for (const crawler of CRAWLER_REGISTRY) {
        for (const pattern of crawler.patterns) {
            if (ua.includes(pattern)) {
                return crawler;
            }
        }
    }

    return null;
}

/**
 * Fire-and-forget: log a crawler hit with daily aggregation.
 *
 * Why void/catch: This is called from the bot-skip path in EventProcessor.
 * Failures must never propagate or slow down the response.
 *
 * @param accountId - Account the crawler is hitting
 * @param userAgent - Raw user-agent string
 * @param url - The URL being crawled
 * @param ipAddress - Crawler IP for GeoIP resolution
 */
export async function logHitIfIdentifiable(
    accountId: string,
    userAgent: string,
    url?: string,
    ipAddress?: string
): Promise<void> {
    try {
        const crawler = identifyCrawler(userAgent);
        if (!crawler) return; // Unknown bot patterns — skip logging

        // Resolve country from IP using existing GeoIP service (sync, ~0.1ms)
        let country: string | null = null;
        let city: string | null = null;
        if (ipAddress) {
            const geo = geoipLookupSync(ipAddress);
            if (geo) {
                country = geo.country;
                city = geo.city;
            }
        }

        // Truncate to midnight UTC for daily bucketing
        const today = new Date();
        today.setUTCHours(0, 0, 0, 0);

        // Upsert: one row per crawler per day per account
        await prisma.crawlerLog.upsert({
            where: {
                accountId_crawlerName_date: {
                    accountId,
                    crawlerName: crawler.slug,
                    date: today,
                }
            },
            create: {
                accountId,
                crawlerName: crawler.slug,
                category: crawler.category,
                sampleAgent: userAgent.substring(0, 500),
                hitCount: 1,
                date: today,
                country,
                city,
            },
            update: {
                hitCount: { increment: 1 },
                // Update sample agent and geo on each hit (latest wins)
                sampleAgent: userAgent.substring(0, 500),
                ...(country ? { country } : {}),
                ...(city ? { city } : {}),
            }
        });
    } catch (error) {
        // Why swallowed: crawler logging is observability — must never impact tracking
        Logger.debug('[CrawlerService] Log hit failed (non-fatal)', { error, accountId });
    }
}

/**
 * Get blocked UA patterns for an account.
 * Redis-cached with 5-min TTL. Used by API for WC plugin sync.
 *
 * @param accountId - Account to fetch rules for
 * @returns Array of lowercase UA patterns to block
 */
export async function getBlockedPatterns(accountId: string): Promise<string[]> {
    return cacheAside(
        `blocked-patterns:${accountId}`,
        async () => {
            const rules = await prisma.crawlerRule.findMany({
                where: { accountId, action: 'BLOCK' },
                select: { pattern: true }
            });
            return rules.map(r => r.pattern);
        },
        { ttl: CacheTTL.MEDIUM, namespace: CACHE_NS }
    );
}

/**
 * Invalidate cached block patterns when rules change.
 *
 * @param accountId - Account whose cache to invalidate
 */
export async function invalidateBlockedPatternsCache(accountId: string): Promise<void> {
    await cacheDelete(`blocked-patterns:${accountId}`, { namespace: CACHE_NS });
}

/**
 * Get the custom block page HTML for an account.
 *
 * Why empty string sentinel: cacheAside treats null as a cache miss.
 * We store '' to indicate "no template" and convert back to null at call sites.
 *
 * @param accountId - Account to fetch template for
 * @returns HTML string or null (use default template)
 */
export async function getBlockPageHtml(accountId: string): Promise<string | null> {
    const cached = await cacheAside(
        `block-page:${accountId}`,
        async () => {
            const account = await prisma.account.findUnique({
                where: { id: accountId },
                select: { crawlerBlockPageHtml: true }
            });
            // Empty string sentinel — null would cause cacheAside to re-fetch
            return account?.crawlerBlockPageHtml || '';
        },
        { ttl: CacheTTL.LONG, namespace: CACHE_NS }
    );
    return cached || null;
}

/**
 * Get aggregated crawler stats for the dashboard.
 * On-demand query — not cached (admin-only, infrequent).
 *
 * @param accountId - Account to query
 * @param days - Number of days to aggregate
 */
export async function getCrawlerStats(accountId: string, days: number = 30) {
    const since = new Date();
    since.setDate(since.getDate() - days);
    since.setUTCHours(0, 0, 0, 0);

    const [logs, rules, totalHits24h, latestCountries] = await Promise.all([
        // Why no 'country' in groupBy: including it causes duplicate rows for
        // the same crawler from different countries, cluttering the UI table.
        prisma.crawlerLog.groupBy({
            by: ['crawlerName', 'category'],
            where: { accountId, date: { gte: since } },
            _sum: { hitCount: true },
            orderBy: { _sum: { hitCount: 'desc' } },
        }),
        prisma.crawlerRule.findMany({
            where: { accountId },
            select: { crawlerName: true, action: true, pattern: true, reason: true, createdAt: true }
        }),
        prisma.crawlerLog.aggregate({
            where: {
                accountId,
                date: { gte: new Date(Date.now() - 24 * 60 * 60 * 1000) }
            },
            _sum: { hitCount: true }
        }),
        // Fetch latest known country per crawler (most recent log entry)
        prisma.$queryRaw<Array<{ crawlerName: string; country: string | null }>>`
            SELECT DISTINCT ON ("crawlerName") "crawlerName", "country"
            FROM "CrawlerLog"
            WHERE "accountId" = ${accountId} AND "date" >= ${since}
            ORDER BY "crawlerName", "date" DESC
        `.catch(() => [] as Array<{ crawlerName: string; country: string | null }>),
    ]);

    // Enrich with registry metadata
    const ruleMap = new Map(rules.map(r => [r.crawlerName, r]));
    const countryMap = new Map(latestCountries.map(c => [c.crawlerName, c.country]));

    const crawlers = logs.map(log => {
        const identity = CRAWLER_REGISTRY.find(c => c.slug === log.crawlerName);
        const rule = ruleMap.get(log.crawlerName);

        return {
            name: identity?.name || log.crawlerName,
            slug: log.crawlerName,
            category: log.category,
            categoryLabel: CATEGORY_META[log.category as keyof typeof CATEGORY_META]?.label || 'Unknown',
            categoryEmoji: CATEGORY_META[log.category as keyof typeof CATEGORY_META]?.emoji || '❓',
            owner: identity?.owner || 'Unknown',
            description: identity?.description || '',
            website: identity?.website || '',
            intent: identity?.intent || 'neutral',
            country: countryMap.get(log.crawlerName) || null,
            totalHits: log._sum.hitCount || 0,
            action: rule?.action || 'ALLOW',
            ruleReason: rule?.reason || null,
        };
    });

    return {
        crawlers,
        totalHits24h: totalHits24h._sum.hitCount || 0,
        uniqueCrawlers: new Set(logs.map(l => l.crawlerName)).size,
        blockedCount: rules.filter(r => r.action === 'BLOCK').length,
        rules,
    };
}
