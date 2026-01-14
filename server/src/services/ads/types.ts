/**
 * Shared types and utilities for Ads platform integrations.
 * Centralizes interfaces and credential management for Meta and Google Ads.
 */

import { prisma } from '../../utils/prisma';
import { Logger } from '../../utils/logger';

// =============================================================================
// TYPE DEFINITIONS
// =============================================================================

/**
 * Metric interface for ad platform insights.
 * Unified structure across all ad platforms.
 */
export interface AdMetric {
    accountId: string;
    spend: number;
    impressions: number;
    clicks: number;
    roas: number;
    currency: string;
    date_start: string;
    date_stop: string;
}

/**
 * Campaign-level insight metrics.
 */
export interface CampaignInsight {
    campaignId: string;
    campaignName: string;
    status: string;
    spend: number;
    impressions: number;
    clicks: number;
    conversions: number;
    conversionsValue: number;
    roas: number;
    ctr: number;      // Click-through rate (%)
    cpc: number;      // Cost per click
    cpa: number;      // Cost per acquisition
    currency: string;
    dateStart: string;
    dateStop: string;
    // Optional: UTM-correlated data from WooCommerce
    trackedOrders?: number;
    trackedRevenue?: number;
    trueROAS?: number;
}

/**
 * Daily trend data point.
 */
export interface DailyTrend {
    date: string;
    spend: number;
    impressions: number;
    clicks: number;
    conversions: number;
    conversionsValue: number;
}

/**
 * Shopping product-level performance insight.
 * Used for AI analysis of product performance within Shopping campaigns.
 */
export interface ShoppingProductInsight {
    campaignId: string;
    campaignName: string;
    productId: string;
    productTitle: string;
    productBrand: string;
    productCategory: string;
    spend: number;
    impressions: number;
    clicks: number;
    conversions: number;
    conversionsValue: number;
    roas: number;
    ctr: number;
    cpc: number;
    currency: string;
    dateStart: string;
    dateStop: string;
}

/**
 * Search Keyword performance insight.
 */
export interface SearchKeywordInsight {
    campaignId: string;
    campaignName: string;
    adGroupId: string;
    adGroupName: string;
    keywordId: string;
    keywordText: string;
    matchType: string;
    status: string;
    spend: number;
    impressions: number;
    clicks: number;
    conversions: number;
    conversionsValue: number;
    roas: number;
    ctr: number;
    cpc: number;
    currency: string;
    dateStart: string;
    dateStop: string;
}

// =============================================================================
// CREDENTIAL MANAGEMENT
// =============================================================================

/**
 * Cached credentials to avoid repeated DB lookups.
 * In production, consider using Redis for distributed caching.
 */
const credentialsCache: Map<string, { data: any; expiry: number }> = new Map();
const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

/**
 * Clear the credentials cache for a specific platform or all platforms.
 * Call this when platform credentials are updated in Super Admin.
 */
export function clearCredentialsCache(platform?: 'GOOGLE_ADS' | 'META_ADS'): void {
    if (platform) {
        credentialsCache.delete(platform);
        Logger.info(`Cleared credentials cache for ${platform}`);
    } else {
        credentialsCache.clear();
        Logger.info('Cleared all credentials cache');
    }
}

/**
 * Fetch platform credentials from database with caching.
 * Falls back to environment variables for backwards compatibility.
 */
export async function getCredentials(platform: 'GOOGLE_ADS' | 'META_ADS'): Promise<Record<string, string> | null> {
    const cacheKey = platform;
    const cached = credentialsCache.get(cacheKey);

    if (cached && cached.expiry > Date.now()) {
        return cached.data;
    }

    try {
        const record = await prisma.platformCredentials.findUnique({
            where: { platform }
        });

        if (record?.credentials) {
            const creds = record.credentials as Record<string, string>;
            credentialsCache.set(cacheKey, { data: creds, expiry: Date.now() + CACHE_TTL_MS });
            return creds;
        }
    } catch (error) {
        Logger.warn(`Failed to fetch ${platform} credentials from database`, { error });
    }

    // Fallback to environment variables for backwards compatibility
    if (platform === 'GOOGLE_ADS') {
        const clientId = process.env.GOOGLE_ADS_CLIENT_ID;
        const clientSecret = process.env.GOOGLE_ADS_CLIENT_SECRET;
        const developerToken = process.env.GOOGLE_ADS_DEVELOPER_TOKEN;
        if (clientId && clientSecret && developerToken) {
            return { clientId, clientSecret, developerToken };
        }
    } else if (platform === 'META_ADS') {
        const appId = process.env.META_APP_ID;
        const appSecret = process.env.META_APP_SECRET;
        if (appId && appSecret) {
            return { appId, appSecret };
        }
    }

    return null;
}

// =============================================================================
// UTILITY HELPERS
// =============================================================================

/**
 * Format a Date object to YYYY-MM-DD string.
 */
export function formatDateISO(d: Date): string {
    return d.toISOString().split('T')[0];
}

/**
 * Format a Date object to YYYYMMDD string (for Google Ads GAQL).
 */
export function formatDateGAQL(d: Date): string {
    return d.toISOString().split('T')[0].replace(/-/g, '');
}

// =============================================================================
// ADVISOR TYPES
// =============================================================================

/**
 * Inventory analysis summary for ad optimization.
 */
export interface InventorySummary {
    total_products: number;
    out_of_stock_count: number;
    relevant_out_of_stock: number;
    low_stock_count: number;
}

/**
 * Week-over-week performance trend summary.
 */
export interface TrendsSummary {
    this_week_roas: string;
    last_week_roas: string;
    roas_change: string;
    ctr_change: string;
}

/**
 * Aggregated metrics for trend calculation.
 */
export interface TrendMetrics {
    spend: number;
    conversionsValue: number;
    clicks: number;
    impressions: number;
}

/**
 * Shopping product reference for matching.
 */
export interface ShoppingProductRef {
    product: string;
    product_id?: string;
    roas?: string;
    spend?: string;
    clicks?: number;
}

/**
 * Shopping data structure with top products.
 */
export interface ShoppingAnalysisData {
    top_products?: ShoppingProductRef[];
}

