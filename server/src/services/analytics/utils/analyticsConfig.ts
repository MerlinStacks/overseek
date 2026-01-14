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
} as const;

/**
 * Product category inference patterns
 * Can be extended or overridden per-client in the future
 */
export const CATEGORY_PATTERNS: [string[], string][] = [
    [['ring', 'rings'], 'Rings'],
    [['necklace', 'pendant', 'chain'], 'Necklaces'],
    [['bracelet', 'bangle'], 'Bracelets'],
    [['earring', 'stud', 'hoop'], 'Earrings'],
    [['watch', 'watches'], 'Watches'],
];

/**
 * Acquisition source normalization patterns
 */
export const SOURCE_PATTERNS: [string[], string][] = [
    [['google', 'gclid'], 'Google Ads'],
    [['facebook', 'meta', 'fbclid'], 'Meta Ads'],
    [['instagram'], 'Instagram'],
    [['tiktok'], 'TikTok'],
    [['email', 'newsletter'], 'Email'],
    [['organic'], 'Organic Search'],
];

/**
 * Normalize an acquisition source string using SOURCE_PATTERNS
 */
export function normalizeSource(source: string | null): string {
    if (!source) return 'Direct';

    const lowerSource = source.toLowerCase();

    for (const [patterns, normalized] of SOURCE_PATTERNS) {
        if (patterns.some(p => lowerSource.includes(p))) {
            return normalized;
        }
    }

    return source;
}

/**
 * Infer product category from product name using CATEGORY_PATTERNS
 */
export function inferCategory(productName: string): string {
    const name = productName.toLowerCase();

    for (const [patterns, category] of CATEGORY_PATTERNS) {
        if (patterns.some(p => name.includes(p))) {
            return category;
        }
    }

    return 'Other';
}
