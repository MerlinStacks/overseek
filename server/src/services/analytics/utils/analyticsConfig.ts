/**
 * Analytics Configuration Constants
 * 
 * Centralized configuration for analytics services.
 * Makes tuning and adjustments easier without touching service code.
 */

export const ANALYTICS_CONFIG = {
    /**
     * Query limits to prevent OOM on large datasets
     */
    limits: {
        /** Maximum orders to fetch per cohort query */
        maxOrdersPerQuery: 50000,
        /** Maximum sessions to fetch per query */
        maxSessionsPerQuery: 100000,
        /** Maximum products in ES aggregation */
        maxProductAggregation: 1000,
    },

    /**
     * Default time windows
     */
    timeWindows: {
        /** Default lookback for cohort analysis (months) */
        cohortLookbackMonths: 6,
        /** Default lookback for acquisition source analysis (months) */
        acquisitionLookbackMonths: 6,
        /** Max retention tracking window (months) */
        maxRetentionMonths: 12,
    },

    /**
     * Digest report defaults
     */
    digest: {
        /** Number of top products in digest */
        topProductsLimit: 5,
        /** Number of top traffic sources in digest */
        topSourcesLimit: 5,
    },

    /**
     * Product ranking defaults
     */
    ranking: {
        /** Default number of top/bottom performers */
        defaultLimit: 10,
        /** Trend threshold (%) - above this = 'up', below negative = 'down' */
        trendThreshold: 5,
    },

    /**
     * Inventory Forecasting defaults
     */
    forecasting: {
        /** Minimum days of sales history required for forecasting */
        minHistoryDays: 30,
        /** Default forecast horizon (days) */
        defaultForecastDays: 30,
        /** Safety stock buffer (days) */
        safetyStockDays: 7,
        /** Default lead time if supplier not configured (days) */
        defaultLeadTimeDays: 14,
        /** Risk thresholds (days until stockout) */
        riskThresholds: {
            critical: 7,
            high: 14,
            medium: 30
        },
        /** WMA weights (most recent segment -> oldest segment) */
        wmaWeights: [0.4, 0.3, 0.2, 0.1]
    },
} as const;

/**
 * Product category inference patterns
 * Can be extended or overridden per-client in the future
 */
export const CATEGORY_PATTERNS: [string[], string][] = [
    [['ring', 'rings'], 'Rings'],
    [['necklace', 'necklaces', 'pendant', 'pendants', 'chain', 'chains'], 'Necklaces'],
    [['bracelet', 'bracelets', 'bangle', 'bangles'], 'Bracelets'],
    [['earring', 'earrings', 'stud', 'studs', 'hoop', 'hoops'], 'Earrings'],
    [['watch', 'watches'], 'Watches'],
];

/**
 * Acquisition source normalization patterns
 */
export const SOURCE_PATTERNS: [string[], string][] = [
    [['google ads', 'google_ads', 'gclid'], 'Google Ads'],
    [['meta ads', 'facebook ads', 'meta_ads', 'facebook_ads'], 'Meta Ads'],
    [['instagram'], 'Instagram'],
    [['tiktok'], 'TikTok'],
    [['email', 'newsletter'], 'Email'],
    [['organic'], 'Organic Search'],
];

/**
 * Normalize an acquisition source string using SOURCE_PATTERNS
 */
export function normalizeSource(source: string | null, medium?: string | null): string {
    if (typeof source !== 'string' || !source.trim()) return 'Direct';
    const trimmed = source.trim();
    const lowerSource = trimmed.toLowerCase();
    const tokens = new Set(lowerSource.match(/[\p{L}\p{N}]+/gu) || []);
    let urlMedium: string | null = null;
    try { urlMedium = new URL(trimmed).searchParams.get('utm_medium'); } catch { /* A source need not be a URL. */ }
    const paid = /^(?:cpc|ppc|paid|paid[_ -]?social|paid[_ -]?search)$/i.test((medium || urlMedium || '').trim()) ||
        /(?:^|[\s/_-])(?:cpc|ppc|paid)(?:$|[\s/_-])/.test(lowerSource);

    if (tokens.has('google')) {
        if (tokens.has('gclid') || paid || /\bgoogle[ _-]ads\b/.test(lowerSource)) return 'Google Ads';
        return tokens.has('organic') || (medium || urlMedium || '').toLowerCase() === 'organic' ? 'Organic Search' : 'Google';
    }
    if (tokens.has('facebook') || tokens.has('meta') || tokens.has('fbclid')) {
        return paid || /\b(?:meta|facebook)[ _-]ads\b/.test(lowerSource) ? 'Meta Ads' : 'Facebook';
    }

    for (const [patterns, normalized] of SOURCE_PATTERNS) {
        if (patterns.some(p => p.includes(' ') || p.includes('_') ? lowerSource === p : tokens.has(p))) {
            return normalized;
        }
    }

    return trimmed;
}

/**
 * Infer product category from product name using CATEGORY_PATTERNS
 */
export function inferCategory(productName: string): string {
    const words = new Set(typeof productName === 'string' ? productName.toLowerCase().match(/[\p{L}\p{N}]+/gu) || [] : []);

    for (const [patterns, category] of CATEGORY_PATTERNS) {
        if (patterns.some(p => words.has(p))) {
            return category;
        }
    }

    return 'Other';
}
