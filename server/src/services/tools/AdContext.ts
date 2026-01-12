/**
 * Ad Context Utilities
 * 
 * Provides contextual awareness for ad optimization suggestions.
 * Detects brand campaigns, seasonal periods, and campaign types.
 */

// =============================================================================
// BRAND CAMPAIGN DETECTION
// =============================================================================

/**
 * Common patterns indicating a brand campaign.
 * Brand campaigns target users searching for the brand name directly.
 */
const BRAND_PATTERNS = [
    /\bbrand\b/i,
    /\bbranded\b/i,
    /\btrademark\b/i,
    /\[brand\]/i,
    /\bexact\s*match\b/i,
    /\bbrand\s*terms?\b/i,
    /\bbrand\s*protection\b/i,
    /\bdefense\b/i,
    /\bowned\b/i,
];

/**
 * Detect if a campaign is likely a brand campaign.
 * Brand campaigns typically have lower ROAS expectations.
 */
export function isBrandCampaign(campaignName: string, storeName?: string): boolean {
    const name = campaignName.toLowerCase();

    // Check common brand campaign patterns
    for (const pattern of BRAND_PATTERNS) {
        if (pattern.test(name)) {
            return true;
        }
    }

    // Check if store name is in campaign name (e.g., "CustomKings - Search")
    if (storeName && storeName.length > 2) {
        const storePattern = new RegExp(`\\b${escapeRegex(storeName)}\\b`, 'i');
        if (storePattern.test(name)) {
            return true;
        }
    }

    return false;
}

function escapeRegex(str: string): string {
    return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// =============================================================================
// SEASONAL CONTEXT
// =============================================================================

export interface SeasonalContext {
    period: string;
    isPeakSeason: boolean;
    expectedCpmIncrease: number;  // Percentage increase vs normal
    notes: string;
}

/**
 * Key retail/advertising seasonal periods.
 */
const SEASONAL_PERIODS: {
    name: string;
    check: (d: Date) => boolean;
    cpmIncrease: number;
    notes: string;
}[] = [
        {
            name: 'Black Friday / Cyber Monday',
            check: (d) => d.getMonth() === 10 && d.getDate() >= 20 ||
                d.getMonth() === 11 && d.getDate() <= 2,
            cpmIncrease: 80,
            notes: 'Peak competition. CPMs spike significantly. Focus on high-intent audiences.'
        },
        {
            name: 'Christmas Rush',
            check: (d) => d.getMonth() === 11 && d.getDate() >= 3 && d.getDate() <= 23,
            cpmIncrease: 50,
            notes: 'Gift-buying season. Creative fatigue is common. Ensure delivery promises are realistic.'
        },
        {
            name: 'Boxing Day / New Year Sales',
            check: (d) => d.getMonth() === 11 && d.getDate() >= 26 ||
                d.getMonth() === 0 && d.getDate() <= 5,
            cpmIncrease: 30,
            notes: 'Sales period. Bargain hunters active. Consider emphasizing discounts.'
        },
        {
            name: 'Valentine\'s Day',
            check: (d) => d.getMonth() === 1 && d.getDate() >= 1 && d.getDate() <= 14,
            cpmIncrease: 25,
            notes: 'Gift-buying period. Target gift-givers with urgency messaging.'
        },
        {
            name: 'Mother\'s Day Lead-up',
            check: (d) => {
                // Mother's Day is second Sunday of May - check 2 weeks before
                if (d.getMonth() !== 4) return false; // May
                const mothersDaySunday = getSecondSunday(d.getFullYear(), 4);
                const daysDiff = (mothersDaySunday.getTime() - d.getTime()) / (1000 * 60 * 60 * 24);
                return daysDiff >= 0 && daysDiff <= 14;
            },
            cpmIncrease: 20,
            notes: 'Gift-buying period. Emotional messaging performs well.'
        },
        {
            name: 'EOFY (Australia)',
            check: (d) => d.getMonth() === 5 && d.getDate() >= 15 && d.getDate() <= 30,
            cpmIncrease: 15,
            notes: 'End of Financial Year sales. B2B and big-ticket items peak.'
        },
        {
            name: 'Back to School',
            check: (d) => d.getMonth() === 0 && d.getDate() >= 10 && d.getDate() <= 31,
            cpmIncrease: 15,
            notes: 'Back-to-school shopping. Target parents and students.'
        },
    ];

function getSecondSunday(year: number, month: number): Date {
    const firstDay = new Date(year, month, 1);
    const firstSunday = 1 + (7 - firstDay.getDay()) % 7;
    return new Date(year, month, firstSunday + 7);
}

/**
 * Get the current seasonal context based on date.
 */
export function getSeasonalContext(date: Date = new Date()): SeasonalContext | null {
    for (const period of SEASONAL_PERIODS) {
        if (period.check(date)) {
            return {
                period: period.name,
                isPeakSeason: period.cpmIncrease >= 30,
                expectedCpmIncrease: period.cpmIncrease,
                notes: period.notes
            };
        }
    }
    return null;
}

// =============================================================================
// CAMPAIGN TYPE DETECTION
// =============================================================================

export type CampaignType =
    | 'brand'
    | 'shopping'
    | 'search'
    | 'display'
    | 'video'
    | 'remarketing'
    | 'prospecting'
    | 'awareness'
    | 'conversion'
    | 'unknown';

const CAMPAIGN_TYPE_PATTERNS: { type: CampaignType; patterns: RegExp[] }[] = [
    { type: 'shopping', patterns: [/\bshopping\b/i, /\bpmax\b/i, /\bperformance\s*max\b/i, /\bpla\b/i] },
    { type: 'search', patterns: [/\bsearch\b/i, /\bsem\b/i, /\btext\s*ads?\b/i] },
    { type: 'display', patterns: [/\bdisplay\b/i, /\bgdn\b/i, /\bbanner\b/i] },
    { type: 'video', patterns: [/\bvideo\b/i, /\byoutube\b/i, /\breels?\b/i] },
    { type: 'remarketing', patterns: [/\bremarket/i, /\bretarget/i, /\brmkt\b/i, /\bwebsite\s*visitors?\b/i] },
    { type: 'prospecting', patterns: [/\bprospect/i, /\bcold\b/i, /\bnew\s*audience\b/i, /\btof\b/i, /\btop\s*of\s*funnel\b/i] },
    { type: 'awareness', patterns: [/\bawareness\b/i, /\breach\b/i, /\bimpressions\b/i] },
    { type: 'conversion', patterns: [/\bconversion\b/i, /\bpurchase\b/i, /\bsales\b/i, /\bbof\b/i, /\bbottom\s*of\s*funnel\b/i] },
];

/**
 * Infer campaign type from campaign name.
 */
export function getCampaignType(campaignName: string): CampaignType {
    const name = campaignName.toLowerCase();

    for (const { type, patterns } of CAMPAIGN_TYPE_PATTERNS) {
        for (const pattern of patterns) {
            if (pattern.test(name)) {
                return type;
            }
        }
    }

    return 'unknown';
}

/**
 * Get expected ROAS threshold based on campaign type.
 * Returns null if standard thresholds should apply.
 */
export function getExpectedRoasThreshold(campaignType: CampaignType): { min: number; good: number } | null {
    switch (campaignType) {
        case 'brand':
            // Brand campaigns often break even or slightly positive
            return { min: 0.5, good: 1.5 };
        case 'awareness':
        case 'prospecting':
            // Top-of-funnel campaigns have lower immediate ROAS
            return { min: 0.3, good: 1.0 };
        case 'remarketing':
            // Remarketing should have high ROAS
            return { min: 2.0, good: 5.0 };
        case 'shopping':
        case 'conversion':
            // Direct response campaigns
            return { min: 1.0, good: 3.0 };
        default:
            return null; // Use standard thresholds
    }
}
