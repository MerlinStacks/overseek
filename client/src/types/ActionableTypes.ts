/**
 * Actionable Recommendation Types (Client Side)
 */
import { isRecord } from '../utils/responseValidation';

type SuggestionCategory = 'stock' | 'performance' | 'budget' | 'creative' | 'seasonal' | 'info' | 'optimization' | 'structure' | 'audience';


interface BudgetAction {
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

interface KeywordAction {
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

interface ProductAction {
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

type RecommendationAction = BudgetAction | KeywordAction | ProductAction;


interface EstimatedImpact {
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

interface CreativeSpec {
    headlines: string[];
    descriptions: string[];
    callToActions?: string[];
    /** Final URL where ad clicks should land */
    finalUrl?: string;
    /** Display path segments (e.g., ['Shop', 'Jewelry']) */
    displayPath?: string[];
}

/** Sitelink extension spec */
interface SitelinkSpec {
    text: string;
    description1?: string;
    description2?: string;
    finalUrl: string;
}

/** Full ad specifications for campaign creation */
interface AdSpec {
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

interface ImplementationDetails {
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


const text = (value: unknown): value is string => typeof value === 'string' && !!value.trim() && value.length <= 10000;
const number = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value) && Math.abs(value) <= Number.MAX_SAFE_INTEGER;
const nonnegative = (value: unknown): value is number => number(value) && value >= 0;
const optional = (action: Record<string, unknown>, keys: string[], check: (value: unknown) => boolean) => keys.every(key => action[key] === undefined || check(action[key]));
export function isBudgetAction(action: unknown): action is BudgetAction {
    return isRecord(action) && ['budget_increase', 'budget_decrease', 'pause', 'enable'].includes(action.actionType as string) &&
        text(action.campaignId) && text(action.campaignName) && ['google', 'meta'].includes(action.platform as string) &&
        nonnegative(action.currentBudget) && nonnegative(action.suggestedBudget) && number(action.changeAmount) && number(action.changePercent) && text(action.reason) &&
        (action.actionType !== 'budget_increase' || action.suggestedBudget > action.currentBudget) &&
        (action.actionType !== 'budget_decrease' || action.suggestedBudget < action.currentBudget);
}

export function isKeywordAction(action: unknown): action is KeywordAction {
    return isRecord(action) && ['add_keyword', 'add_negative', 'adjust_bid', 'pause_keyword'].includes(action.actionType as string) && action.productId === undefined &&
        text(action.keyword) && ['exact', 'phrase', 'broad'].includes(action.matchType as string) && nonnegative(action.suggestedCpc) && nonnegative(action.estimatedRoas) &&
        optional(action, ['currentCpc', 'estimatedClicks'], nonnegative) && optional(action, ['campaignId', 'campaignName', 'adGroupId'], text) &&
        (action.platform === undefined || ['google', 'meta'].includes(action.platform as string));
}

export function isProductAction(action: unknown): action is ProductAction {
    return isRecord(action) && ['create_campaign', 'increase_visibility', 'exclude_product', 'adjust_bid'].includes(action.actionType as string) && action.keyword === undefined &&
        text(action.productId) && text(action.productName) && typeof action.sku === 'string' && action.sku.length <= 10000 &&
        ['high_velocity', 'trending', 'high_margin', 'low_roas', 'no_coverage', 'underperforming'].includes(action.reason as string) &&
        optional(action, ['salesVelocity', 'currentAdSpend', 'suggestedBudget'], nonnegative) && optional(action, ['margin'], number);
}
