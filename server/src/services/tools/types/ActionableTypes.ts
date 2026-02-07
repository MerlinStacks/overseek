/**
 * Actionable Recommendation Types
 * 
 * Structured action types that enable specific, executable recommendations
 * with dollar amounts, campaign names, and measurable impact.
 */

import { SuggestionCategory } from '../config/MarketingCopilotConfig';


/**
 * Budget adjustment action for campaigns.
 * Specifies exact dollar amounts for budget changes.
 */
export interface BudgetAction {
    actionType: 'budget_increase' | 'budget_decrease' | 'pause' | 'enable';
    campaignId: string;
    campaignName: string;
    platform: 'google' | 'meta' | 'both';
    currentBudget: number;
    suggestedBudget: number;
    changeAmount: number;
    changePercent: number;
    reason: string;
}

/**
 * Keyword opportunity action.
 * Includes specific CPC cap recommendations.
 */
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
}

/**
 * Product promotion action.
 * For shopping campaigns and product-level recommendations.
 */
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

/**
 * Union type for all action types.
 */
export type RecommendationAction = BudgetAction | KeywordAction | ProductAction;


/**
 * Estimated impact of applying a recommendation.
 */
export interface EstimatedImpact {
    revenueChange?: number;
    roasChange?: number;
    spendChange?: number;
    conversionChange?: number;
    timeframe: '7d' | '30d';
}


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
    finalUrl?: string;
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

/**
 * Full actionable recommendation with structured action and impact.
 */
export interface ActionableRecommendation {
    id: string;
    priority: 1 | 2 | 3;
    category: SuggestionCategory;

    /** Human-readable headline */
    headline: string;

    /** Detailed explanation of why this is recommended */
    explanation: string;

    /** Supporting data points */
    dataPoints: string[];

    /** The structured action to take */
    action: RecommendationAction;

    /** Confidence score 0-100 */
    confidence: number;

    /** Estimated impact if action is taken */
    estimatedImpact?: EstimatedImpact;

    /** Platform this applies to */
    platform: 'google' | 'meta' | 'both';

    /** Tags for filtering */
    tags?: string[];

    /** Source analyzer */
    source: string;

    /** Detailed implementation guide for the recommendation */
    implementationDetails?: ImplementationDetails;
}


/**
 * Type guard to check if action is a BudgetAction.
 */
export function isBudgetAction(action: RecommendationAction): action is BudgetAction {
    return 'currentBudget' in action && 'suggestedBudget' in action;
}

/**
 * Type guard to check if action is a KeywordAction.
 */
export function isKeywordAction(action: RecommendationAction): action is KeywordAction {
    return 'keyword' in action && 'suggestedCpc' in action;
}

/**
 * Type guard to check if action is a ProductAction.
 */
export function isProductAction(action: RecommendationAction): action is ProductAction {
    return 'productId' in action && 'productName' in action;
}

/**
 * Format a budget change as a human-readable string.
 * Examples: "+$5/day", "-$10/day", "Pause"
 */
export function formatBudgetChange(action: BudgetAction): string {
    if (action.actionType === 'pause') return 'Pause campaign';
    if (action.actionType === 'enable') return 'Enable campaign';

    const sign = action.changeAmount >= 0 ? '+' : '';
    return `${sign}$${Math.abs(action.changeAmount).toFixed(0)}/day`;
}

/**
 * Format a CPC recommendation as a human-readable string.
 * Example: "$0.45 max CPC"
 */
export function formatCpcRecommendation(action: KeywordAction): string {
    return `$${action.suggestedCpc.toFixed(2)} max CPC`;
}

/**
 * Create a headline for a budget action.
 */
export function createBudgetHeadline(action: BudgetAction): string {
    const change = formatBudgetChange(action);
    return `${change} on "${action.campaignName}" - ${action.reason}`;
}

/**
 * Create a headline for a keyword action.
 */
export function createKeywordHeadline(action: KeywordAction): string {
    const cpc = formatCpcRecommendation(action);
    const actionVerb = action.actionType === 'add_keyword' ? 'Add' :
        action.actionType === 'add_negative' ? 'Add negative' :
            action.actionType === 'adjust_bid' ? 'Adjust bid for' : 'Pause';
    return `${actionVerb} "${action.keyword}" (${action.matchType}) at ${cpc}`;
}

/**
 * Create a headline for a product action.
 */
export function createProductHeadline(action: ProductAction): string {
    if (action.actionType === 'create_campaign') {
        return `Create campaign for "${action.productName}" - ${action.salesVelocity?.toFixed(1)} units/day with no ad coverage`;
    }
    if (action.actionType === 'exclude_product') {
        return `Exclude "${action.productName}" from Shopping - ${action.reason}`;
    }
    if (action.actionType === 'increase_visibility') {
        return `Boost "${action.productName}" - high margin product selling well`;
    }
    return `Adjust "${action.productName}" - ${action.reason}`;
}
