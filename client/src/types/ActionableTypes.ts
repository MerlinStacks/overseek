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
