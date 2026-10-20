/**
 * Keyword Cannibalization Detection Service
 *
 * Identifies keywords where multiple pages from the same domain
 * compete for the same query, splitting authority and potentially
 * hurting rankings. Uses Search Console page-level data.
 */

import { prisma } from '../../utils/prisma';
import { Logger } from '../../utils/logger';
import { SearchConsoleService } from './SearchConsoleService';

/** Cannibalization result for a single keyword */
export interface CannibalizationResult {
    keyword: string;
    pages: Array<{
        url: string;
        clicks: number;
        impressions: number;
        position: number;
    }>;
    severity: 'high' | 'medium' | 'low';
    recommendation: string;
}

export class CannibalizationService {

    /**
     * Detect keyword cannibalization by finding queries that
     * rank multiple pages from the same site.
     *
     * Strategy:
     * 1. Fetch Search Console data with both 'query' and 'page' dimensions
     * 2. Group by query — any query with 2+ pages = potential cannibalization
     * 3. Score severity by position spread and traffic split
     */
    static async detectCannibalization(accountId: string): Promise<CannibalizationResult[]> {
        if (typeof accountId !== 'string' || !accountId.trim()) throw new Error('Account ID required');
        const scAccount = await SearchConsoleService.getActiveAccount(accountId);
        if (!scAccount) return [];

        // Fetch data with query + page dimensions (90 days for better signal)
        const siteUrl = encodeURIComponent(scAccount.siteUrl);
        const url = `https://www.googleapis.com/webmasters/v3/sites/${siteUrl}/searchAnalytics/query`;

        const endDate = formatDate(daysAgo(3));
        const startDate = formatDate(daysAgo(93));

        const rows: Array<{ keys: [string, string]; clicks: number; impressions: number; position: number }> = [];
        const pageSize = 5000;
        try {
            for (let page = 0; ; page++) {
                if (page >= 20) throw new Error('Search data exceeds analysis limit; existing findings were preserved');
                const response = await fetch(url, {
                    method: 'POST',
                    signal: AbortSignal.timeout(30000),
                    headers: {
                        Authorization: `Bearer ${scAccount.accessToken}`,
                        'Content-Type': 'application/json'
                    },
                    body: JSON.stringify({
                        startDate,
                        endDate,
                        dimensions: ['query', 'page'],
                        rowLimit: pageSize,
                        startRow: page * pageSize,
                        dataState: 'final'
                    })
                });

                if (!response.ok) throw new Error(`Search Console analysis failed (${response.status})`);
                const data = await response.json();
                const batch = data.rows ?? [];
                if (!Array.isArray(batch) || !batch.every(row => row && Array.isArray(row.keys) && row.keys.length === 2 && row.keys.every(key => typeof key === 'string' && key.trim()) && ['clicks', 'impressions', 'position'].every(key => typeof row[key] === 'number' && Number.isFinite(row[key]) && row[key] >= 0))) throw new Error('Invalid Search Console analysis response');
                rows.push(...batch);
                if (batch.length < pageSize) break;
            }
        } catch (error) {
            Logger.error('Failed to fetch page-level search data', { error, accountId });
            throw error;
        }

        // Group by query
        const queryPages = new Map<string, Array<{ url: string; clicks: number; impressions: number; position: number }>>();

        const seen = new Set<string>();
        for (const row of rows) {
            const query = row.keys[0].trim().toLowerCase();
            const page = row.keys[1];
            const key = JSON.stringify([query, page]);
            if (seen.has(key)) continue;
            seen.add(key);

            if (!queryPages.has(query)) queryPages.set(query, []);
            queryPages.get(query)!.push({
                url: page,
                clicks: row.clicks,
                impressions: row.impressions,
                position: Math.round(row.position * 10) / 10
            });
        }

        // Filter to queries with 2+ pages (cannibalization candidates)
        const results: CannibalizationResult[] = [];

        for (const [keyword, pages] of queryPages) {
            if (pages.length < 2) continue;

            // Sort by clicks desc
            pages.sort((a, b) => b.clicks - a.clicks);

            // Calculate severity
            const totalClicks = pages.reduce((sum, p) => sum + p.clicks, 0);
            const totalImpressions = pages.reduce((sum, p) => sum + p.impressions, 0);
            const positionSpread = Math.max(...pages.map(p => p.position)) - Math.min(...pages.map(p => p.position));

            // Skip low-traffic cannibalizations
            if (totalImpressions < 20) continue;

            let severity: 'high' | 'medium' | 'low';
            let recommendation: string;

            if (pages.length >= 3 && totalClicks > 20) {
                severity = 'high';
                recommendation = `${pages.length} pages rank for "${keyword}". Review search intent and content overlap before considering consolidation or redirects.`;
            } else if (positionSpread > 15) {
                severity = 'medium';
                recommendation = `Position spread of ${positionSpread} positions. Consider canonical tags or content consolidation.`;
            } else {
                severity = 'low';
                recommendation = 'Minor overlap. Monitor and consider internal linking to signal primary page.';
            }

            results.push({ keyword, pages, severity, recommendation });
        }

        // Sort: high severity first, then by total impressions
        results.sort((a, b) => {
            const sevOrder = { high: 0, medium: 1, low: 2 };
            if (sevOrder[a.severity] !== sevOrder[b.severity]) {
                return sevOrder[a.severity] - sevOrder[b.severity];
            }
            const aImps = a.pages.reduce((s, p) => s + p.impressions, 0);
            const bImps = b.pages.reduce((s, p) => s + p.impressions, 0);
            return bImps - aImps;
        });

        // Also update TrackedKeyword.cannibalizationPages for tracked keywords
        const tracked = await prisma.trackedKeyword.findMany({
            where: { accountId, isActive: true },
            select: { id: true, keyword: true }
        });
        const findings = new Map(results.map(result => [result.keyword.toLowerCase(), result.pages.map(page => page.url)]));
        const ops: any[] = [];
        for (const keyword of tracked) {
            ops.push(prisma.trackedKeyword.update({
                where: { id: keyword.id, accountId },
                data: { cannibalizationPages: findings.get(keyword.keyword.trim().toLowerCase()) || [] }
            }));
        }
        if (ops.length > 0) {
            await prisma.$transaction(ops);
        }

        return results.slice(0, 30);
    }
}

/** Format Date to YYYY-MM-DD */
function formatDate(d: Date): string {
    return d.toISOString().split('T')[0];
}

/** Get a Date N days ago */
function daysAgo(n: number): Date {
    const d = new Date();
    d.setDate(d.getDate() - n);
    return d;
}
