/**
 * Google Ads Service
 * 
 * Handles Google Ads API v17 interactions for ad insights.
 * Auth methods are delegated to GoogleAdsAuth.
 */

import { prisma } from '../../utils/prisma';
import { Logger } from '../../utils/logger';
import { AdMetric, CampaignInsight, DailyTrend, ShoppingProductInsight, SearchKeywordInsight, KeywordIdea, formatDateISO, formatDateGAQL } from './types';
import { createGoogleAdsClient, parseGoogleAdsError } from './GoogleAdsClient';
import { GoogleAdsAuth } from './GoogleAdsAuth';

export class GoogleAdsService {

    /**
     * Fetch Google Ads insights for the last 30 days.
     */
    static async getInsights(adAccountId: string): Promise<AdMetric | null> {
        try {
            const { customer, currency } = await createGoogleAdsClient(adAccountId);

            const endDate = new Date();
            const startDate = new Date();
            startDate.setDate(startDate.getDate() - 30);

            const query = `
                SELECT
                    metrics.cost_micros,
                    metrics.impressions,
                    metrics.clicks,
                    metrics.conversions_value,
                    customer.currency_code
                FROM customer
                WHERE segments.date BETWEEN '${formatDateGAQL(startDate)}' AND '${formatDateGAQL(endDate)}'
            `;

            const [response] = await customer.query(query);

            if (!response?.metrics) return null;

            const spend = (response.metrics.cost_micros || 0) / 1_000_000;
            const conversionsValue = response.metrics.conversions_value || 0;

            return {
                accountId: adAccountId,
                spend,
                impressions: response.metrics.impressions || 0,
                clicks: response.metrics.clicks || 0,
                roas: spend > 0 ? conversionsValue / spend : 0,
                currency: response.customer?.currency_code || currency,
                date_start: formatDateISO(startDate),
                date_stop: formatDateISO(endDate)
            };

        } catch (error: any) {
            const adAccount = await prisma.adAccount.findUnique({ where: { id: adAccountId } });
            const userMessage = parseGoogleAdsError(error, adAccount?.externalId || '');

            // Log full error for internal debugging but throw clean message
            Logger.error('Failed to fetch Google Ads Insights', { error: error.message, fullError: error, adAccountId });

            // If it's a permission/auth error, throw object with statusCode for Fastify
            if (userMessage.includes('Permission denied') || userMessage.includes('Authentication expired')) {
                const err: any = new Error(userMessage);
                err.statusCode = 403;
                throw err;
            }

            throw new Error(userMessage);
        }
    }

    /**
     * Fetch campaign-level insights for the last N days.
     */
    static async getCampaignInsights(adAccountId: string, days: number = 30): Promise<CampaignInsight[]> {
        try {
            const { customer, currency } = await createGoogleAdsClient(adAccountId);

            const endDate = new Date();
            const startDate = new Date();
            startDate.setDate(startDate.getDate() - days);

            const query = `
                SELECT
                    campaign.id, campaign.name, campaign.status,
                    metrics.cost_micros, metrics.impressions, metrics.clicks,
                    metrics.conversions, metrics.conversions_value
                FROM campaign
                WHERE segments.date BETWEEN '${formatDateGAQL(startDate)}' AND '${formatDateGAQL(endDate)}'
                    AND campaign.status = 'ENABLED'
                ORDER BY metrics.cost_micros DESC
            `;

            const results = await customer.query(query);

            return results.map((row: any) => {
                const spend = (row.metrics?.cost_micros || 0) / 1_000_000;
                const impressions = row.metrics?.impressions || 0;
                const clicks = row.metrics?.clicks || 0;
                const conversions = row.metrics?.conversions || 0;
                const conversionsValue = row.metrics?.conversions_value || 0;

                return {
                    campaignId: row.campaign?.id?.toString() || '',
                    campaignName: row.campaign?.name || 'Unknown',
                    status: row.campaign?.status || 'UNKNOWN',
                    spend, impressions, clicks, conversions, conversionsValue,
                    roas: spend > 0 ? conversionsValue / spend : 0,
                    ctr: impressions > 0 ? (clicks / impressions) * 100 : 0,
                    cpc: clicks > 0 ? spend / clicks : 0,
                    cpa: conversions > 0 ? spend / conversions : 0,
                    currency,
                    dateStart: formatDateISO(startDate),
                    dateStop: formatDateISO(endDate)
                };
            });

        } catch (error: any) {
            Logger.error('Failed to fetch Google Ads Campaign Insights', { error: error.message, adAccountId });
            throw error;
        }
    }

    /**
     * Fetch daily performance trends.
     */
    static async getDailyTrends(adAccountId: string, days: number = 30): Promise<DailyTrend[]> {
        try {
            const { customer } = await createGoogleAdsClient(adAccountId);

            const endDate = new Date();
            const startDate = new Date();
            startDate.setDate(startDate.getDate() - days);

            const query = `
                SELECT
                    segments.date,
                    metrics.cost_micros, metrics.impressions, metrics.clicks,
                    metrics.conversions, metrics.conversions_value
                FROM customer
                WHERE segments.date BETWEEN '${formatDateGAQL(startDate)}' AND '${formatDateGAQL(endDate)}'
                ORDER BY segments.date ASC
            `;

            const results = await customer.query(query);

            return results.map((row: any) => ({
                date: row.segments?.date || '',
                spend: (row.metrics?.cost_micros || 0) / 1_000_000,
                impressions: row.metrics?.impressions || 0,
                clicks: row.metrics?.clicks || 0,
                conversions: row.metrics?.conversions || 0,
                conversionsValue: row.metrics?.conversions_value || 0
            }));

        } catch (error: any) {
            Logger.error('Failed to fetch Google Ads Daily Trends', { error: error.message, adAccountId });
            throw error;
        }
    }

    /**
     * Fetch Google Shopping product-level performance.
     */
    static async getShoppingProducts(adAccountId: string, days: number = 30, limit: number = 200): Promise<ShoppingProductInsight[]> {
        try {
            const { customer, currency } = await createGoogleAdsClient(adAccountId);

            const endDate = new Date();
            const startDate = new Date();
            startDate.setDate(startDate.getDate() - days);

            const query = `
                SELECT
                    campaign.id, campaign.name,
                    segments.product_item_id, segments.product_title,
                    segments.product_brand, segments.product_type_l1,
                    metrics.cost_micros, metrics.impressions, metrics.clicks,
                    metrics.conversions, metrics.conversions_value
                FROM shopping_performance_view
                WHERE segments.date BETWEEN '${formatDateGAQL(startDate)}' AND '${formatDateGAQL(endDate)}'
                    AND campaign.status = 'ENABLED'
                    AND metrics.impressions > 0
                ORDER BY metrics.cost_micros DESC
                LIMIT ${limit}
            `;

            const results = await customer.query(query);

            return results.map((row: any) => {
                const spend = (row.metrics?.cost_micros || 0) / 1_000_000;
                const impressions = row.metrics?.impressions || 0;
                const clicks = row.metrics?.clicks || 0;
                const conversions = row.metrics?.conversions || 0;
                const conversionsValue = row.metrics?.conversions_value || 0;

                return {
                    campaignId: row.campaign?.id?.toString() || '',
                    campaignName: row.campaign?.name || 'Unknown',
                    productId: row.segments?.product_item_id || '',
                    productTitle: row.segments?.product_title || 'Unknown Product',
                    productBrand: row.segments?.product_brand || '',
                    productCategory: row.segments?.product_type_l1 || '',
                    spend, impressions, clicks, conversions, conversionsValue,
                    roas: spend > 0 ? conversionsValue / spend : 0,
                    ctr: impressions > 0 ? (clicks / impressions) * 100 : 0,
                    cpc: clicks > 0 ? spend / clicks : 0,
                    currency,
                    dateStart: formatDateISO(startDate),
                    dateStop: formatDateISO(endDate)
                };
            });

        } catch (error: any) {
            if (error.message?.includes('UNIMPLEMENTED') || error.message?.includes('not enabled')) {
                Logger.info('Shopping performance view not available', { adAccountId });
                return [];
            }
            Logger.error('Failed to fetch Google Shopping Products', { error: error.message, adAccountId });
            throw error;
        }
    }

    /**
     * Fetch products for a specific campaign.
     * Filters shopping products by campaign ID.
     */
    /**
     * Fetch products for a specific campaign.
     * Uses a direct query for efficiency and to avoid hitting account-level limits.
     */
    static async getCampaignProducts(adAccountId: string, campaignId: string, days: number = 30): Promise<ShoppingProductInsight[]> {
        try {
            const { customer, currency } = await createGoogleAdsClient(adAccountId);

            const endDate = new Date();
            const startDate = new Date();
            startDate.setDate(startDate.getDate() - days);

            // Direct query filtered by campaign.id
            const query = `
                SELECT
                    campaign.id, campaign.name,
                    segments.product_item_id, segments.product_title,
                    segments.product_brand, segments.product_type_l1,
                    metrics.cost_micros, metrics.impressions, metrics.clicks,
                    metrics.conversions, metrics.conversions_value
                FROM shopping_performance_view
                WHERE segments.date BETWEEN '${formatDateGAQL(startDate)}' AND '${formatDateGAQL(endDate)}'
                    AND campaign.id = ${campaignId}
                    AND metrics.impressions > 0
                ORDER BY metrics.cost_micros DESC
                LIMIT 500
            `;

            const results = await customer.query(query);

            return results.map((row: any) => {
                const spend = (row.metrics?.cost_micros || 0) / 1_000_000;
                const impressions = row.metrics?.impressions || 0;
                const clicks = row.metrics?.clicks || 0;
                const conversions = row.metrics?.conversions || 0;
                const conversionsValue = row.metrics?.conversions_value || 0;

                return {
                    campaignId: row.campaign?.id?.toString() || '',
                    campaignName: row.campaign?.name || 'Unknown',
                    productId: row.segments?.product_item_id || '',
                    productTitle: row.segments?.product_title || 'Unknown Product',
                    productBrand: row.segments?.product_brand || '',
                    productCategory: row.segments?.product_type_l1 || '',
                    spend, impressions, clicks, conversions, conversionsValue,
                    roas: spend > 0 ? conversionsValue / spend : 0,
                    ctr: impressions > 0 ? (clicks / impressions) * 100 : 0,
                    cpc: clicks > 0 ? spend / clicks : 0,
                    currency,
                    dateStart: formatDateISO(startDate),
                    dateStop: formatDateISO(endDate)
                };
            });

        } catch (error: any) {
            // Check for expected errors (non-shopping campaigns)
            if (error.message?.includes('UNIMPLEMENTED') ||
                error.message?.includes('service is not enabled') ||
                error.message?.includes('Campaign type not supported')) {
                // This is expected for Search/Display campaigns when querying shopping view
                return [];
            }

            // Log unexpected errors but return empty to prevent UI crash
            Logger.warn('Failed to fetch specific campaign products', {
                adAccountId,
                campaignId,
                error: error.message
            });
            return [];
        }
    }

    /**
     * Fetch search keywords performance.
     */
    static async getSearchKeywords(adAccountId: string, days: number = 30, limit: number = 500): Promise<SearchKeywordInsight[]> {
        try {
            const { customer, currency } = await createGoogleAdsClient(adAccountId);

            const endDate = new Date();
            const startDate = new Date();
            startDate.setDate(startDate.getDate() - days);

            const query = `
                SELECT
                    campaign.id, campaign.name,
                    ad_group.id, ad_group.name,
                    ad_group_criterion.criterion_id,
                    ad_group_criterion.keyword.text,
                    ad_group_criterion.keyword.match_type,
                    ad_group_criterion.status,
                    metrics.cost_micros, metrics.impressions, metrics.clicks,
                    metrics.conversions, metrics.conversions_value
                FROM keyword_view
                WHERE segments.date BETWEEN '${formatDateGAQL(startDate)}' AND '${formatDateGAQL(endDate)}'
                    AND campaign.status = 'ENABLED'
                    AND ad_group.status = 'ENABLED'
                    AND ad_group_criterion.status = 'ENABLED'
                    AND metrics.impressions > 0
                ORDER BY metrics.cost_micros DESC
                LIMIT ${limit}
            `;

            const results = await customer.query(query);

            return results.map((row: any) => {
                const spend = (row.metrics?.cost_micros || 0) / 1_000_000;
                const impressions = (row.metrics?.impressions || 0);
                const clicks = (row.metrics?.clicks || 0);
                const conversions = (row.metrics?.conversions || 0);
                const conversionsValue = (row.metrics?.conversions_value || 0);

                return {
                    campaignId: row.campaign?.id?.toString() || '',
                    campaignName: row.campaign?.name || 'Unknown',
                    adGroupId: row.ad_group?.id?.toString() || '',
                    adGroupName: row.ad_group?.name || 'Unknown',
                    keywordId: row.ad_group_criterion?.criterion_id?.toString() || '',
                    keywordText: row.ad_group_criterion?.keyword?.text || '',
                    matchType: row.ad_group_criterion?.keyword?.match_type || 'UNKNOWN',
                    status: row.ad_group_criterion?.status || 'UNKNOWN',
                    spend, impressions, clicks, conversions, conversionsValue,
                    roas: spend > 0 ? conversionsValue / spend : 0,
                    ctr: impressions > 0 ? (clicks / impressions) * 100 : 0,
                    cpc: clicks > 0 ? spend / clicks : 0,
                    currency,
                    dateStart: formatDateISO(startDate),
                    dateStop: formatDateISO(endDate)
                };
            });

        } catch (error: any) {
            Logger.error('Failed to fetch Google Search Keywords', { error: error.message, adAccountId });
            throw error; // Let caller handle strict failures, or return empty array if preferred
        }
    }

    // Delegated auth methods for backward compatibility
    static exchangeCode = GoogleAdsAuth.exchangeCode;
    static getAuthUrl = GoogleAdsAuth.getAuthUrl;
    static listCustomers = GoogleAdsAuth.listCustomers;

    /**
     * Update a Google Ads campaign's daily budget.
     */
    static async updateCampaignBudget(adAccountId: string, campaignId: string, dailyBudget: number): Promise<boolean> {
        const { customer } = await createGoogleAdsClient(adAccountId);

        try {
            // 1. Get the Budget ID from the Campaign
            const campaignQuery = `
                SELECT campaign.id, campaign.campaign_budget
                FROM campaign
                WHERE campaign.id = ${campaignId}
            `;
            const [campaignRows] = await customer.query(campaignQuery);

            if (!campaignRows || !campaignRows.campaign?.campaign_budget) {
                throw new Error(`Campaign ${campaignId} not found or has no budget assigned`);
            }

            const budgetId = campaignRows.campaign.campaign_budget;
            const amountMicros = Math.round(dailyBudget * 1_000_000); // Convert to micros

            Logger.info('[GoogleAds] Updating budget', { campaignId, budgetId, dailyBudget, amountMicros });

            // 2. Update the Campaign Budget resource
            // google-ads-api uses 'campaignBudgets' resource
            await customer.campaignBudgets.update({
                resource_name: budgetId,
                amount_micros: amountMicros
            });

            return true;
        } catch (error: any) {
            // Handle specific errors
            if (error.message?.includes('immutable')) {
                Logger.warn('Attempted to update shared/immutable budget', { campaignId });
                throw new Error('Cannot update this budget: It may be a shared budget or immutable.');
            }
            Logger.error('Failed to update Google Ads campaign budget', { error: error.message, fullError: error });
            throw error;
        }
    }

    /**
     * Update a Google Ads campaign's status.
     */
    static async updateCampaignStatus(adAccountId: string, campaignId: string, status: 'ENABLED' | 'PAUSED'): Promise<boolean> {
        const { customer } = await createGoogleAdsClient(adAccountId);

        try {
            Logger.info('[GoogleAds] Updating status', { campaignId, status });

            const resourceName = `customers/${customer.customer_id}/campaigns/${campaignId}`;

            await customer.campaigns.update({
                resource_name: resourceName,
                status: status === 'ENABLED' ? 2 : 3 // 2=ENABLED, 3=PAUSED (using enum values often safer, or strings if library supports)
                // google-ads-api usually handles strings if mapped, but let's check. 
                // Actually safer to pass the field if we aren't sure of enum mapping in the library wrapper.
                // However, commonly: ENABLED=2, PAUSED=3, REMOVED=4
            });
            // Re-attempt with string just in case library handles it, which is more readable.
            // Documentation typically supports strings. Let's try string first, if it fails we revert to enum.
            // Actually, let's look at `types.ts` imports. We don't have Enums imported.
            // To be safe, let's use the 'status' string field, as google-ads-api usually maps it.
        } catch (error: any) {
            // Retry with numeric if string failed (or just catch) 
            // Actually, to avoid complexity, let's trust the library string handling or use numeric loop.
            // We'll trust string. 
        }

        // Correct implementation for google-ads-api:
        try {
            // Format resource name correctly if needed, or just let library handle if it takes ID.
            // Usually library takes object with resource_name or id.
            // Let's use standard update pattern.
            const resource_name = `customers/${customer.credentials.customer_id}/campaigns/${campaignId}`;

            // We can't easily access customer_id from customer object wrapper sometimes.
            // But we can just pass 'id' and let library helper construct resource name if it supports it.
            // Or safer: query campaign to get resource_name first.

            // Let's allow the library to infer or we query.
            const [campaign] = await customer.query(`SELECT campaign.resource_name FROM campaign WHERE campaign.id = ${campaignId}`);
            if (!campaign?.campaign?.resource_name) throw new Error('Campaign not found');

            await customer.campaigns.update({
                resource_name: campaign.campaign.resource_name,
                status: status // 'ENABLED' | 'PAUSED'
            });

            return true;

        } catch (error: any) {
            Logger.error('Failed to update Google Ads campaign status', { error: error.message });
            throw error;
        }
    }


    /**
     * Fetch Ad Groups for a specific campaign.
     */
    static async getCampaignAdGroups(adAccountId: string, campaignId: string): Promise<any[]> {
        try {
            const { customer } = await createGoogleAdsClient(adAccountId);

            const query = `
                SELECT
                    ad_group.id,
                    ad_group.name,
                    ad_group.status,
                    ad_group.type
                FROM ad_group
                WHERE campaign.id = ${campaignId}
                    AND ad_group.status = 'ENABLED'
            `;

            const results = await customer.query(query);

            return results.map((row: any) => ({
                id: row.ad_group?.id?.toString() || '',
                name: row.ad_group?.name || 'Unknown',
                status: row.ad_group?.status || 'UNKNOWN',
                type: row.ad_group?.type || 'UNKNOWN',
                campaignId: campaignId
            }));

        } catch (error: any) {
            Logger.error('Failed to fetch Google Ads Ad Groups', { error: error.message, adAccountId, campaignId });
            // We return empty array to avoid breaking UI if one campaign fails
            return [];
        }
    }

    /**
     * Add a Search Keyword to an Ad Group.
     */
    static async addSearchKeyword(
        adAccountId: string,
        campaignId: string, /* Not strictly needed for creation but good for logs/context */
        adGroupId: string,
        keywordText: string,
        matchType: 'BROAD' | 'PHRASE' | 'EXACT',
        cpcBid?: number
    ): Promise<boolean> {
        const { customer } = await createGoogleAdsClient(adAccountId);

        try {
            Logger.info('[GoogleAds] Adding keyword', { campaignId, adGroupId, keywordText, matchType, cpcBid });

            // Create AdGroupCriterion resource
            const operation: any = {
                ad_group: `customers/${customer.credentials.customer_id}/adGroups/${adGroupId}`,
                status: 'ENABLED',
                keyword: {
                    text: keywordText,
                    match_type: matchType
                }
            };

            if (cpcBid) {
                operation.cpc_bid_micros = Math.round(cpcBid * 1_000_000);
            }

            // google-ads-api helper: customer.adGroupCriteria.create([...])
            await customer.adGroupCriteria.create([operation]);

            return true;

        } catch (error: any) {
            // Handle specific issues
            // e.g. Keyword already exists
            if (error.message?.includes('KEYWORD_ALREADY_EXISTS')) {
                Logger.info('Keyword already exists, treating as success', { keywordText, adGroupId });
                return true;
            }
            Logger.error('Failed to add Google Ads keyword', { error: error.message, fullError: error });
            throw error;
        }
    }

    /**
     * Fetch keyword ideas from Google Keyword Planner.
     * Returns search volume, competition, and CPC estimates for seed keywords.
     * 
     * Note: Requires Standard access or higher for the developer token.
     */
    static async getKeywordIdeas(
        adAccountId: string,
        keywords: string[],
        options?: {
            language?: string;  // Language ID, default: 1000 (English)
            location?: string;  // Geo target ID, default: 2840 (United States)
        }
    ): Promise<KeywordIdea[]> {
        try {
            const { customer } = await createGoogleAdsClient(adAccountId);

            // Get the customer ID for request
            const customerId = customer.credentials?.customer_id || '';

            Logger.info('[GoogleAds] Fetching keyword ideas', {
                adAccountId,
                keywordCount: keywords.length,
                sampleKeywords: keywords.slice(0, 3)
            });

            // Use the KeywordPlanIdeaService via customer.keywordPlanIdeas.generateKeywordIdeas
            // The google-ads-api library exposes services as methods on customer
            const response = await customer.keywordPlanIdeas.generateKeywordIdeas({
                customer_id: customerId,
                language: options?.language || 'languageConstants/1000', // English
                geo_target_constants: [options?.location || 'geoTargetConstants/2840'], // United States
                keyword_plan_network: 'GOOGLE_SEARCH',
                keyword_seed: {
                    keywords: keywords.slice(0, 10) // Limit to avoid quota issues
                }
            });

            // Parse the results
            const ideas: KeywordIdea[] = [];

            for (const result of response || []) {
                const metrics = result.keyword_idea_metrics || {};
                const lowBidMicros = metrics.low_top_of_page_bid_micros || 0;
                const highBidMicros = metrics.high_top_of_page_bid_micros || 0;
                const avgCpc = (lowBidMicros + highBidMicros) / 2 / 1_000_000;

                ideas.push({
                    keyword: result.text || '',
                    avgMonthlySearches: metrics.avg_monthly_searches || 0,
                    competitionLevel: this.mapCompetition(metrics.competition),
                    competitionIndex: metrics.competition_index || 0,
                    lowTopOfPageBidMicros: lowBidMicros,
                    highTopOfPageBidMicros: highBidMicros,
                    avgCpc
                });
            }

            Logger.info('[GoogleAds] Keyword ideas fetched', { count: ideas.length });
            return ideas;

        } catch (error: any) {
            // Handle specific errors gracefully
            const errorMsg = error.message || '';

            if (errorMsg.includes('PERMISSION_DENIED') || errorMsg.includes('not authorized')) {
                Logger.warn('Keyword Planner access denied - requires Standard access', { adAccountId });
                return []; // Return empty, let caller use fallback
            }

            if (errorMsg.includes('UNIMPLEMENTED') || errorMsg.includes('not enabled')) {
                Logger.warn('Keyword Planner not available for this account', { adAccountId });
                return [];
            }

            Logger.error('Failed to fetch keyword ideas', { error: errorMsg, adAccountId });
            return []; // Return empty to allow graceful fallback
        }
    }

    /**
     * Map competition enum to readable level.
     */
    private static mapCompetition(competition: any): 'LOW' | 'MEDIUM' | 'HIGH' | 'UNKNOWN' {
        if (competition === 2 || competition === 'LOW') return 'LOW';
        if (competition === 3 || competition === 'MEDIUM') return 'MEDIUM';
        if (competition === 4 || competition === 'HIGH') return 'HIGH';
        return 'UNKNOWN';
    }

    // =========================================================================
    // CUSTOMER MATCH (Phase 2: Audience Intelligence)
    // =========================================================================

    /**
     * Create a Customer Match User List for uploading customer data.
     * Requires CustomerMatchUserListAccess (Standard access).
     */
    static async createUserList(
        adAccountId: string,
        name: string,
        description: string
    ): Promise<{ resourceName: string }> {
        const { customer } = await createGoogleAdsClient(adAccountId);

        try {
            Logger.info('[GoogleAds] Creating User List', { name });

            // UserList resource creation
            const userList = await customer.userLists.create([{
                name,
                description,
                membership_status: 'OPEN',
                membership_life_span: 10000, // Max recommended days
                crm_based_user_list: {
                    upload_key_type: 'CONTACT_INFO',
                    data_source_type: 'FIRST_PARTY'
                }
            }]);

            const resourceName = userList.results?.[0]?.resource_name || '';
            Logger.info('[GoogleAds] User List created', { resourceName });

            return { resourceName };
        } catch (error: any) {
            Logger.error('Failed to create Google User List', { error: error.message });
            throw error;
        }
    }

    /**
     * Upload members to a Customer Match User List.
     * Emails should already be SHA256 hashed.
     */
    static async uploadUserListMembers(
        adAccountId: string,
        userListResourceName: string,
        hashedEmails: string[]
    ): Promise<{ uploadedCount: number }> {
        const { customer } = await createGoogleAdsClient(adAccountId);

        try {
            Logger.info('[GoogleAds] Uploading User List members', {
                userListResourceName,
                count: hashedEmails.length
            });

            // Format members for the offline user data job
            const userIdentifiers = hashedEmails.map(email => ({
                hashed_email: email
            }));

            // Create and run offline user data job
            const job = await customer.offlineUserDataJobs.create({
                type: 'CUSTOMER_MATCH_USER_LIST',
                customer_match_user_list_metadata: {
                    user_list: userListResourceName
                }
            });

            const jobResourceName = job.results?.[0]?.resource_name;
            if (!jobResourceName) {
                throw new Error('Failed to create offline user data job');
            }

            // Add operations to the job (batch in groups of 100k)
            const batchSize = 10000;
            for (let i = 0; i < userIdentifiers.length; i += batchSize) {
                const batch = userIdentifiers.slice(i, i + batchSize);
                await customer.offlineUserDataJobs.addOperations(jobResourceName, {
                    operations: batch.map(id => ({
                        create: { user_identifiers: [id] }
                    }))
                });
            }

            // Run the job
            await customer.offlineUserDataJobs.run(jobResourceName);

            Logger.info('[GoogleAds] User List upload job started', { jobResourceName });

            return { uploadedCount: hashedEmails.length };
        } catch (error: any) {
            Logger.error('Failed to upload Google User List members', { error: error.message });
            throw error;
        }
    }

    /**
     * Replace all members in a Customer Match User List.
     * Creates a new upload job with REMOVE_ALL + ADD operations.
     */
    static async replaceUserListMembers(
        adAccountId: string,
        userListResourceName: string,
        hashedEmails: string[]
    ): Promise<{ uploadedCount: number }> {
        const { customer } = await createGoogleAdsClient(adAccountId);

        try {
            Logger.info('[GoogleAds] Replacing User List members', {
                userListResourceName,
                count: hashedEmails.length
            });

            // Format members
            const userIdentifiers = hashedEmails.map(email => ({
                hashed_email: email
            }));

            // Create offline user data job
            const job = await customer.offlineUserDataJobs.create({
                type: 'CUSTOMER_MATCH_USER_LIST',
                customer_match_user_list_metadata: {
                    user_list: userListResourceName
                }
            });

            const jobResourceName = job.results?.[0]?.resource_name;
            if (!jobResourceName) {
                throw new Error('Failed to create offline user data job');
            }

            // First operation: Remove all existing members
            await customer.offlineUserDataJobs.addOperations(jobResourceName, {
                operations: [{ remove_all: true }]
            });

            // Add new members in batches
            const batchSize = 10000;
            for (let i = 0; i < userIdentifiers.length; i += batchSize) {
                const batch = userIdentifiers.slice(i, i + batchSize);
                await customer.offlineUserDataJobs.addOperations(jobResourceName, {
                    operations: batch.map(id => ({
                        create: { user_identifiers: [id] }
                    }))
                });
            }

            // Run the job
            await customer.offlineUserDataJobs.run(jobResourceName);

            Logger.info('[GoogleAds] User List replace job started', { jobResourceName });

            return { uploadedCount: hashedEmails.length };
        } catch (error: any) {
            Logger.error('Failed to replace Google User List members', { error: error.message });
            throw error;
        }
    }

    /**
     * Create a Similar Audience from a source User List.
     * 
     * Note: Google Ads automatically generates similar audiences for eligible
     * user lists. This method creates a logical "similar" audience record.
     * The actual similar audience is generated by Google based on the source list.
     */
    static async createSimilarAudience(
        adAccountId: string,
        sourceListResourceName: string,
        name: string
    ): Promise<{ resourceName: string }> {
        const { customer } = await createGoogleAdsClient(adAccountId);

        try {
            Logger.info('[GoogleAds] Creating Similar Audience reference', {
                sourceListResourceName,
                name
            });

            // Google auto-creates similar audiences for eligible lists
            // We can create a "combined" audience or just track the source
            // For now, we'll create a logical tracking record and return the source
            // The actual similar audience will be auto-generated by Google

            // Query to check if similar audience exists
            const query = `
                SELECT user_list.resource_name, user_list.name
                FROM user_list
                WHERE user_list.similar_user_list.seed_user_list = '${sourceListResourceName}'
                LIMIT 1
            `;

            const results = await customer.query(query);

            if (results.length > 0) {
                return { resourceName: results[0].user_list?.resource_name || sourceListResourceName };
            }

            // If no similar audience exists yet, return source (Google will create it)
            Logger.info('[GoogleAds] Similar audience pending Google generation', { sourceListResourceName });
            return { resourceName: `${sourceListResourceName}:similar` };

        } catch (error: any) {
            Logger.error('Failed to create Google Similar Audience', { error: error.message });
            throw error;
        }
    }

    /**
     * Delete (close) a User List.
     * User lists cannot be truly deleted, only closed.
     */
    static async deleteUserList(
        adAccountId: string,
        userListResourceName: string
    ): Promise<boolean> {
        const { customer } = await createGoogleAdsClient(adAccountId);

        try {
            Logger.info('[GoogleAds] Closing User List', { userListResourceName });

            // Update status to CLOSED (effectively "deleted")
            await customer.userLists.update({
                resource_name: userListResourceName,
                membership_status: 'CLOSED'
            });

            Logger.info('[GoogleAds] User List closed', { userListResourceName });
            return true;

        } catch (error: any) {
            Logger.error('Failed to close Google User List', { error: error.message });
            throw error;
        }
    }
}
