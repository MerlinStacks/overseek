/**
 * Google Search Console Service
 *
 * Wraps the Google Search Console API v3 (Webmasters API) to fetch
 * organic search analytics, top pages, and trend data.
 *
 * Why REST instead of SDK: The Search Console API is simple REST with
 * only a few endpoints. No SDK dependency needed.
 */

import { prisma } from '../../utils/prisma';
import { Logger } from '../../utils/logger';
import { getCredentials } from '../ads/types';

/** Shape of a single row from the Search Analytics API */
export interface SearchAnalyticsRow {
    keys: string[];
    clicks: number;
    impressions: number;
    ctr: number;
    position: number;
}

/** Processed query-level analytics */
export interface QueryAnalytics {
    query: string;
    clicks: number;
    impressions: number;
    ctr: number;
    position: number;
}

/** Page-level analytics */
export interface PageAnalytics {
    page: string;
    clicks: number;
    impressions: number;
    ctr: number;
    position: number;
}

/** Period-over-period trend for a query */
export interface QueryTrend {
    query: string;
    currentClicks: number;
    previousClicks: number;
    currentImpressions: number;
    previousImpressions: number;
    currentPosition: number;
    previousPosition: number;
    impressionGrowthPct: number;
    clickGrowthPct: number;
    positionChange: number;
}

/** Options for search analytics queries */
interface AnalyticsOptions {
    days?: number;
    startDate?: string;
    endDate?: string;
    dimensions?: string[];
    rowLimit?: number;
}

export class SearchConsoleService {

    /**
     * Per-account lock to prevent concurrent token refreshes.
     * Why: two parallel 401s would both trigger refresh, wasting Google quota
     * and potentially causing token shadowing.
     */
    private static refreshLocks = new Map<string, Promise<string>>();

    /**
     * Refresh access token using stored refresh token.
     * Uses a lock per account so concurrent callers share the same refresh.
     */
    static async refreshAccessToken(scAccountId: string): Promise<string> {
        // Return existing in-flight refresh if one is running for this account
        const existing = this.refreshLocks.get(scAccountId);
        if (existing) return existing;

        const refreshPromise = this.doRefreshAccessToken(scAccountId);

        this.refreshLocks.set(scAccountId, refreshPromise);
        try {
            return await refreshPromise;
        } finally {
            this.refreshLocks.delete(scAccountId);
        }
    }

    private static async doRefreshAccessToken(scAccountId: string): Promise<string> {
        const scAccount = await prisma.searchConsoleAccount.findUnique({
            where: { id: scAccountId }
        });

        if (!scAccount?.refreshToken) {
            throw new Error('No refresh token found for Search Console account');
        }

        const creds = await getCredentials('GOOGLE_ADS');
        if (!creds?.clientId || !creds?.clientSecret) {
            throw new Error('Google credentials not configured');
        }

        const response = await fetch('https://oauth2.googleapis.com/token', {
            method: 'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            body: new URLSearchParams({
                client_id: creds.clientId,
                client_secret: creds.clientSecret,
                refresh_token: scAccount.refreshToken,
                grant_type: 'refresh_token'
            }).toString()
        });

        const data = await response.json();
        if (data.error) throw new Error(data.error_description || data.error);

        // Persist the refreshed token
        await prisma.searchConsoleAccount.update({
            where: { id: scAccountId },
            data: { accessToken: data.access_token }
        });

        return data.access_token;
    }

    /**
     * Get the active Search Console account for an OverSeek account.
     * Returns the first connected site (users can have multiple properties).
     */
    static async getActiveAccount(accountId: string, siteUrl?: string) {
        const where: any = { accountId };
        if (siteUrl) where.siteUrl = siteUrl;

        const account = await prisma.searchConsoleAccount.findFirst({
            where,
            orderBy: { createdAt: 'asc' }
        });

        if (!account) return null;
        return account;
    }

    /**
     * Execute a Search Console API request with automatic token refresh on 401.
     */
    private static async apiRequest<T>(
        scAccountId: string,
        accessToken: string,
        url: string,
        options?: { method?: string; body?: any }
    ): Promise<T> {
        const method = options?.method || 'GET';
        const doFetch = async (token: string) => {
            const fetchOptions: RequestInit = {
                method,
                headers: {
                    Authorization: `Bearer ${token}`,
                    'Content-Type': 'application/json'
                }
            };
            if (options?.body) {
                fetchOptions.body = JSON.stringify(options.body);
            }
            return fetch(url, fetchOptions);
        };

        let response = await doFetch(accessToken);

        // Auto-refresh on 401
        if (response.status === 401) {
            Logger.info('Search Console token expired, refreshing...');
            const newToken = await this.refreshAccessToken(scAccountId);
            response = await doFetch(newToken);
        }

        if (!response.ok) {
            const errText = await response.text();
            throw new Error(`Search Console API error (${response.status}): ${errText}`);
        }

        return response.json() as Promise<T>;
    }

    /**
     * Fetch search analytics (queries, clicks, impressions, CTR, position).
     * This is the core data source for keyword recommendations.
     */
    static async getSearchAnalytics(
        accountId: string,
        options: AnalyticsOptions = {}
    ): Promise<QueryAnalytics[]> {
        const scAccount = await this.getActiveAccount(accountId);
        if (!scAccount) return [];

        const days = options.days || 28;
        const endDate = options.endDate || formatDate(daysAgo(3)); // SC data has ~3 day lag
        const startDate = options.startDate || formatDate(daysAgo(days + 3));

        const siteUrl = encodeURIComponent(scAccount.siteUrl);
        const url = `https://www.googleapis.com/webmasters/v3/sites/${siteUrl}/searchAnalytics/query`;

        const body = {
            startDate,
            endDate,
            dimensions: options.dimensions || ['query'],
            rowLimit: options.rowLimit || 500,
            dataState: 'final'
        };

        try {
            const data = await this.apiRequest<{ rows?: SearchAnalyticsRow[] }>(
                scAccount.id, scAccount.accessToken, url, { method: 'POST', body }
            );

            return (data.rows || []).map(row => ({
                query: row.keys[0],
                clicks: row.clicks,
                impressions: row.impressions,
                ctr: Math.round(row.ctr * 10000) / 100, // Convert to percentage with 2dp
                position: Math.round(row.position * 10) / 10
            }));
        } catch (error) {
            Logger.error('Failed to fetch search analytics', { error, accountId });
            return [];
        }
    }

    /**
     * Fetch top pages by organic clicks.
     */
    static async getTopPages(
        accountId: string,
        days: number = 28
    ): Promise<PageAnalytics[]> {
        const scAccount = await this.getActiveAccount(accountId);
        if (!scAccount) return [];

        const endDate = formatDate(daysAgo(3));
        const startDate = formatDate(daysAgo(days + 3));
        const siteUrl = encodeURIComponent(scAccount.siteUrl);
        const url = `https://www.googleapis.com/webmasters/v3/sites/${siteUrl}/searchAnalytics/query`;

        const body = {
            startDate,
            endDate,
            dimensions: ['page'],
            rowLimit: 100,
            dataState: 'final'
        };

        try {
            const data = await this.apiRequest<{ rows?: SearchAnalyticsRow[] }>(
                scAccount.id, scAccount.accessToken, url, { method: 'POST', body }
            );

            return (data.rows || []).map(row => ({
                page: row.keys[0],
                clicks: row.clicks,
                impressions: row.impressions,
                ctr: Math.round(row.ctr * 10000) / 100,
                position: Math.round(row.position * 10) / 10
            }));
        } catch (error) {
            Logger.error('Failed to fetch top pages', { error, accountId });
            return [];
        }
    }

    /**
     * Compare current period vs previous period for trend detection.
     * Splits the date range in half and compares query performance.
     */
    static async getSearchTrends(
        accountId: string,
        days: number = 28
    ): Promise<QueryTrend[]> {
        const scAccount = await this.getActiveAccount(accountId);
        if (!scAccount) return [];

        const halfDays = Math.floor(days / 2);
        const currentEnd = formatDate(daysAgo(3));
        const currentStart = formatDate(daysAgo(halfDays + 3));
        const previousEnd = formatDate(daysAgo(halfDays + 3));
        const previousStart = formatDate(daysAgo(days + 3));

        const siteUrl = encodeURIComponent(scAccount.siteUrl);
        const url = `https://www.googleapis.com/webmasters/v3/sites/${siteUrl}/searchAnalytics/query`;

        try {
            // Fetch both periods in parallel
            const [currentData, previousData] = await Promise.all([
                this.apiRequest<{ rows?: SearchAnalyticsRow[] }>(
                    scAccount.id, scAccount.accessToken, url,
                    { method: 'POST', body: { startDate: currentStart, endDate: currentEnd, dimensions: ['query'], rowLimit: 500, dataState: 'final' } }
                ),
                this.apiRequest<{ rows?: SearchAnalyticsRow[] }>(
                    scAccount.id, scAccount.accessToken, url,
                    { method: 'POST', body: { startDate: previousStart, endDate: previousEnd, dimensions: ['query'], rowLimit: 500, dataState: 'final' } }
                )
            ]);

            // Index previous period by query for O(1) lookup
            const previousMap = new Map<string, SearchAnalyticsRow>();
            for (const row of previousData.rows || []) {
                previousMap.set(row.keys[0], row);
            }

            const trends: QueryTrend[] = [];

            for (const row of currentData.rows || []) {
                const query = row.keys[0];
                const prev = previousMap.get(query);

                const currentImpressions = row.impressions;
                const previousImpressions = prev?.impressions || 0;
                const currentClicks = row.clicks;
                const previousClicks = prev?.clicks || 0;

                const impressionGrowthPct = previousImpressions > 0
                    ? Math.round(((currentImpressions - previousImpressions) / previousImpressions) * 100)
                    : currentImpressions > 10 ? 100 : 0; // New queries with decent volume

                const clickGrowthPct = previousClicks > 0
                    ? Math.round(((currentClicks - previousClicks) / previousClicks) * 100)
                    : currentClicks > 5 ? 100 : 0;

                trends.push({
                    query,
                    currentClicks,
                    previousClicks,
                    currentImpressions,
                    previousImpressions,
                    currentPosition: Math.round(row.position * 10) / 10,
                    previousPosition: prev ? Math.round(prev.position * 10) / 10 : 0,
                    impressionGrowthPct,
                    clickGrowthPct,
                    positionChange: prev
                        ? Math.round((prev.position - row.position) * 10) / 10 // Positive = improved
                        : 0
                });
            }

            // Sort by impression growth descending
            return trends.sort((a, b) => b.impressionGrowthPct - a.impressionGrowthPct);
        } catch (error) {
            Logger.error('Failed to fetch search trends', { error, accountId });
            return [];
        }
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
