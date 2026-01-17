/**
 * Actionable Recommendation Types (Client Side)
 */

export type SuggestionCategory = 'stock' | 'performance' | 'budget' | 'creative' | 'seasonal' | 'info' | 'optimization' | 'structure' | 'audience';

// =============================================================================
// ACTION TYPES
// =============================================================================

export interface BudgetAction {
    actionType: 'budget_increase' | 'budget_decrease' | 'pause' | 'enable';
    campaignId: string;
    campaignName: string;
    platform: 'google' | 'meta';
    currentBudget: number;
    suggestedBudget: number;
    changeAmount: number;
    changePercent: number;
    reason: string;
}

export interface KeywordAction {
    actionType: 'add_keyword' | 'add_negative' | 'adjust_bid' | 'pause_keyword';
    keyword: string;
    matchType: 'exact' | 'phrase' | 'broad';
    currentCpc?: number;
    suggestedCpc: number;
    estimatedRoas: number;
    estimatedClicks?: number;
    campaignId?: string;
    campaignName?: string;
    adGroupId?: string;
    platform?: 'google' | 'meta';
}

export interface ProductAction {
    actionType: 'create_campaign' | 'increase_visibility' | 'exclude_product' | 'adjust_bid';
    productId: string;
    productName: string;
    sku: string;
    reason: 'high_velocity' | 'trending' | 'high_margin' | 'low_roas' | 'no_coverage' | 'underperforming';
    salesVelocity?: number;
    currentAdSpend?: number;
    suggestedBudget?: number;
    margin?: number;
}

export type RecommendationAction = BudgetAction | KeywordAction | ProductAction;

// =============================================================================
// ACTIONABLE RECOMMENDATION
// =============================================================================

export interface EstimatedImpact {
    revenueChange?: number;
    roasChange?: number;
    spendChange?: number;
    conversionChange?: number;
    timeframe: '7d' | '30d';
}

// =============================================================================
// IMPLEMENTATION DETAILS (For Implementation Guide Modal)
// =============================================================================

export interface KeywordSpec {
    keyword: string;
    matchType: 'exact' | 'phrase' | 'broad';
    suggestedCpc: number;
    estimatedVolume?: number;
    estimatedClicks?: number;
    adGroupSuggestion?: string;
    source?: 'site_search' | 'product_data' | 'search_terms' | 'ai_generated';
}

export interface BudgetSpec {
    dailyBudget: number;
    bidStrategy: 'maximize_conversions' | 'maximize_clicks' | 'target_cpa' | 'target_roas' | 'manual_cpc';
    targetCpa?: number;
    targetRoas?: number;
    maxCpc?: number;
}

export interface CreativeSpec {
    headlines: string[];
    descriptions: string[];
    callToActions?: string[];
    /** Final URL where ad clicks should land */
    finalUrl?: string;
    /** Display path segments (e.g., ['Shop', 'Jewelry']) */
    displayPath?: string[];
}

/** Sitelink extension spec */
export interface SitelinkSpec {
    text: string;
    description1?: string;
    description2?: string;
    finalUrl: string;
}

/** Full ad specifications for campaign creation */
export interface AdSpec {
    /** Responsive Search Ad headlines (up to 15) */
    headlines: string[];
    /** Responsive Search Ad descriptions (up to 4) */
    descriptions: string[];
    /** Final URL */
    finalUrl: string;
    /** Display path segments */
    displayPath: string[];
    /** Sitelink extensions */
    sitelinks?: SitelinkSpec[];
}

export interface ImplementationDetails {
    /** Suggested keywords with CPCs and match types */
    suggestedKeywords?: KeywordSpec[];
    /** Budget and bidding configuration */
    budgetSpec?: BudgetSpec;
    /** Ad creative suggestions (deprecated, use adSpec) */
    creativeSpec?: CreativeSpec;
    /** Full ad specifications for new campaigns */
    adSpec?: AdSpec;
    /** Step-by-step implementation guide */
    steps?: string[];
    /** Estimated time to implement */
    estimatedTimeMinutes?: number;
    /** Difficulty level */
    difficulty?: 'easy' | 'medium' | 'advanced';
    /** Target products (for Shopping/PMax campaigns) */
    targetProducts?: { id: string; name: string; sku: string; permalink?: string }[];
    /** Suggested campaign structure notes */
    structureNotes?: string;
    /** Campaign name suggestion */
    campaignName?: string;
    /** Ad group name suggestion */
    adGroupName?: string;

    // Data source transparency
    /** How ad copy was generated: 'ai' or 'template' */
    copySource?: 'ai' | 'template';
    /** Notes about data sources and limitations */
    dataSourceNotes?: {
        cpc?: string;
        keywords?: string;
        copy?: string;
    };
}

export interface ActionableRecommendation {
    id: string;
    priority: 1 | 2 | 3;
    category: SuggestionCategory;
    headline: string;
    explanation: string;
    dataPoints: string[];
    action: RecommendationAction;
    confidence: number;
    estimatedImpact?: EstimatedImpact;
    platform: 'google' | 'meta' | 'both';
    tags?: string[];
    source: string;
    /** Detailed implementation guide for the recommendation */
    implementationDetails?: ImplementationDetails;
}

// =============================================================================
// HELPERS
// =============================================================================

export function isBudgetAction(action: RecommendationAction): action is BudgetAction {
    return 'currentBudget' in action && 'suggestedBudget' in action;
}

export function isKeywordAction(action: RecommendationAction): action is KeywordAction {
    return 'keyword' in action && 'suggestedCpc' in action;
}

export function isProductAction(action: RecommendationAction): action is ProductAction {
    return 'productId' in action && 'productName' in action;
}
