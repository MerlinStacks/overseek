/**
 * Campaign Builder Service
 * 
 * Orchestrates the creation of complete Google Ads campaign structures.
 * Handles the complex multi-step process of creating campaigns with all
 * required child entities (budgets, ad groups, keywords, ads).
 */

import { createGoogleAdsClient } from './GoogleAdsClient';
import { Logger } from '../../utils/logger';

// ─────────────────────────────────────────────────────────────────────────────
// Constants
// ─────────────────────────────────────────────────────────────────────────────

/** Conversion factor from standard currency to Google Ads micros */
const CURRENCY_TO_MICROS = 1_000_000;

/** Default status for newly created campaigns (safety measure) */
const DEFAULT_CAMPAIGN_STATUS = 'PAUSED';

/** Minimum required headlines for a Responsive Search Ad */
const MIN_HEADLINES = 3;

/** Minimum required descriptions for a Responsive Search Ad */
const MIN_DESCRIPTIONS = 2;

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

/** Ad copy content for Responsive Search Ads */
export interface AdCopy {
    headlines: string[];
    descriptions: string[];
    finalUrl: string;
}

/** Keyword configuration for Search campaigns */
export interface KeywordConfig {
    text: string;
    matchType: 'BROAD' | 'PHRASE' | 'EXACT';
}

/** Parameters for creating a new campaign */
export interface NewCampaignParams {
    /** Campaign display name */
    name: string;
    /** Daily budget in standard currency (e.g., dollars) */
    dailyBudget: number;
    /** Optional target ROAS for smart bidding */
    targetRoas?: number;
    /** Optional geo targeting codes (e.g., 2840 for US) */
    geoTargetingCodes?: number[];
}

/** Result of a successful campaign creation */
export interface CampaignCreationResult {
    success: boolean;
    campaignResource: string;
    campaignName: string;
    adGroupResource?: string;
    keywordsAdded?: number;
}

// ─────────────────────────────────────────────────────────────────────────────
// Validation
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Validates campaign parameters before creation.
 * @throws Error if validation fails
 */
function validateCampaignParams(params: NewCampaignParams): void {
    if (!params.name || params.name.trim().length === 0) {
        throw new Error('Campaign name is required');
    }
    if (params.dailyBudget <= 0) {
        throw new Error('Daily budget must be greater than zero');
    }
}

/**
 * Validates ad copy content meets Google Ads requirements.
 * @throws Error if validation fails
 */
function validateAdCopy(adCopy: AdCopy): void {
    if (adCopy.headlines.length < MIN_HEADLINES) {
        throw new Error(`At least ${MIN_HEADLINES} headlines are required`);
    }
    if (adCopy.descriptions.length < MIN_DESCRIPTIONS) {
        throw new Error(`At least ${MIN_DESCRIPTIONS} descriptions are required`);
    }
    if (!adCopy.finalUrl || !adCopy.finalUrl.startsWith('http')) {
        throw new Error('A valid final URL is required');
    }
    // Validate headline lengths (max 30 chars per Google Ads spec)
    adCopy.headlines.forEach((h, i) => {
        if (h.length > 30) {
            throw new Error(`Headline ${i + 1} exceeds 30 character limit`);
        }
    });
    // Validate description lengths (max 90 chars per Google Ads spec)
    adCopy.descriptions.forEach((d, i) => {
        if (d.length > 90) {
            throw new Error(`Description ${i + 1} exceeds 90 character limit`);
        }
    });
}

// ─────────────────────────────────────────────────────────────────────────────
// Service
// ─────────────────────────────────────────────────────────────────────────────

export class CampaignBuilderService {

    /**
     * Creates a complete Google Search Campaign structure.
     * 
     * This method orchestrates the creation of:
     * 1. Campaign Budget
     * 2. Campaign (with network settings)
     * 3. Ad Group
     * 4. Keywords (batch creation)
     * 5. Responsive Search Ad
     * 
     * @param adAccountId - The internal ID of the ad account
     * @param campaignParams - Campaign configuration (name, budget, etc.)
     * @param keywords - Array of keywords with match types
     * @param adCopy - Headlines, descriptions, and final URL
     * @returns Campaign creation result with resource names
     * @throws Error if any step fails (no automatic rollback)
     */
    static async createSearchCampaign(
        adAccountId: string,
        campaignParams: NewCampaignParams,
        keywords: KeywordConfig[],
        adCopy: AdCopy
    ): Promise<CampaignCreationResult> {
        // Validate inputs before making API calls
        validateCampaignParams(campaignParams);
        validateAdCopy(adCopy);

        if (keywords.length === 0) {
            throw new Error('At least one keyword is required');
        }

        const { customer } = await createGoogleAdsClient(adAccountId);
        const { name, dailyBudget } = campaignParams;

        try {
            Logger.info('[CampaignBuilder] Starting Search Campaign creation', {
                name,
                dailyBudget,
                keywordCount: keywords.length
            });

            // Step 1: Create Budget
            const budgetRes = await customer.campaignBudgets.create([{
                name: `Budget - ${name} - ${Date.now()}`,
                amount_micros: Math.round(dailyBudget * CURRENCY_TO_MICROS),
                explicitly_shared: false
            }]);
            const budgetResource = budgetRes[0];
            Logger.info('[CampaignBuilder] Budget created', { budgetResource });

            // Step 2: Create Campaign
            const campaignRes = await customer.campaigns.create([{
                name,
                status: DEFAULT_CAMPAIGN_STATUS,
                advertising_channel_type: 'SEARCH',
                campaign_budget: budgetResource,
                target_spend: {}, // Maximize Clicks strategy
                network_settings: {
                    target_google_search: true,
                    target_search_network: true,
                    target_content_network: false,
                    target_partner_search_network: false
                }
            }]);
            const campaignResource = campaignRes[0];
            Logger.info('[CampaignBuilder] Campaign created', { campaignResource });

            // Step 3: Create Ad Group
            const adGroupRes = await customer.adGroups.create([{
                campaign: campaignResource,
                name: 'Standard Ad Group',
                status: 'ENABLED',
                type: 'SEARCH_STANDARD'
            }]);
            const adGroupResource = adGroupRes[0];
            Logger.info('[CampaignBuilder] Ad Group created', { adGroupResource });

            // Step 4: Batch Create Keywords
            const keywordOps = keywords.map(k => ({
                ad_group: adGroupResource,
                status: 'ENABLED',
                keyword: {
                    text: k.text,
                    match_type: k.matchType
                }
            }));
            await customer.adGroupCriteria.create(keywordOps);
            Logger.info('[CampaignBuilder] Keywords added', { count: keywords.length });

            // Step 5: Create Responsive Search Ad
            await customer.adGroupAds.create([{
                ad_group: adGroupResource,
                status: 'ENABLED',
                ad: {
                    final_urls: [adCopy.finalUrl],
                    responsive_search_ad: {
                        headlines: adCopy.headlines.map(h => ({ text: h })),
                        descriptions: adCopy.descriptions.map(d => ({ text: d }))
                    }
                }
            }]);
            Logger.info('[CampaignBuilder] Responsive Search Ad created');

            return {
                success: true,
                campaignResource,
                campaignName: name,
                adGroupResource,
                keywordsAdded: keywords.length
            };

        } catch (error: any) {
            Logger.error('[CampaignBuilder] Failed to build Search Campaign', {
                error: error.message,
                campaignName: name
            });
            throw new Error(`Campaign Creation Failed: ${error.message}`);
        }
    }

    /**
     * Creates a Performance Max campaign (NOT YET IMPLEMENTED).
     * 
     * PMax campaigns require complex asset group configuration including:
     * - Text assets (headlines, descriptions)
     * - Image assets (marketing images, logos)
     * - Listing groups (for Shopping products)
     * 
     * @param adAccountId - The internal ID of the ad account
     * @param campaignParams - Campaign configuration
     * @param productIds - Merchant Center product IDs to include
     * @throws Error - Always throws as this is not yet implemented
     */
    static async createPerformanceMaxCampaign(
        adAccountId: string,
        campaignParams: NewCampaignParams,
        productIds: string[]
    ): Promise<never> {
        Logger.warn('[CampaignBuilder] PMax creation attempted but not implemented', {
            adAccountId,
            productCount: productIds.length
        });
        throw new Error('Performance Max campaign creation is not yet implemented');
    }
}
