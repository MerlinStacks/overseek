import { prisma } from '../utils/prisma';
import { Logger } from '../utils/logger';
import { GoogleAdsApi, enums } from 'google-ads-api';

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
 * Cached credentials to avoid repeated DB lookups.
 * In production, consider using Redis for distributed caching.
 */
const credentialsCache: Map<string, { data: any; expiry: number }> = new Map();
const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

/**
 * Fetch platform credentials from database with caching.
 * Falls back to environment variables for backwards compatibility.
 */
async function getCredentials(platform: 'GOOGLE_ADS' | 'META_ADS'): Promise<Record<string, string> | null> {
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

/**
 * Service for managing ad platform connections and fetching insights.
 * Supports Meta (Facebook/Instagram) and Google Ads platforms.
 */
export class AdsService {

    // ──────────────────────────────────────────────────────────────
    // META ADS (Facebook/Instagram) - Graph API v18.0
    // ──────────────────────────────────────────────────────────────

    /**
     * Fetch Meta Ads insights for the last 30 days.
     * Uses Facebook Graph API to retrieve spend, impressions, clicks, and ROAS.
     */
    static async getMetaInsights(adAccountId: string): Promise<AdMetric | null> {
        const adAccount = await prisma.adAccount.findUnique({
            where: { id: adAccountId }
        });

        if (!adAccount || adAccount.platform !== 'META' || !adAccount.accessToken || !adAccount.externalId) {
            throw new Error('Invalid Meta Ad Account');
        }

        const actId = adAccount.externalId.startsWith('act_') ? adAccount.externalId : `act_${adAccount.externalId}`;
        const fields = 'spend,impressions,clicks,purchase_roas,action_values';
        const url = `https://graph.facebook.com/v18.0/${actId}/insights?fields=${fields}&date_preset=last_30d&access_token=${adAccount.accessToken}`;

        try {
            const response = await fetch(url);
            const data = await response.json();

            if (data.error) {
                Logger.error('Meta API Error', { error: data.error });
                throw new Error(data.error.message);
            }

            const insights = data.data?.[0];
            if (!insights) return null;

            const spend = parseFloat(insights.spend || '0');

            // Calculate ROAS from action_values
            let purchaseValue = 0;
            if (insights.action_values && Array.isArray(insights.action_values)) {
                const purchaseAction = insights.action_values.find(
                    (a: any) => a.action_type === 'purchase' || a.action_type === 'omni_purchase'
                );
                if (purchaseAction?.value) {
                    purchaseValue = parseFloat(purchaseAction.value);
                }
            }

            const roas = spend > 0 ? purchaseValue / spend : 0;

            return {
                accountId: adAccountId,
                spend,
                impressions: parseInt(insights.impressions || '0'),
                clicks: parseInt(insights.clicks || '0'),
                roas,
                currency: adAccount.currency || 'USD',
                date_start: insights.date_start,
                date_stop: insights.date_stop
            };

        } catch (error) {
            Logger.error('Failed to fetch Meta Insights', { error });
            throw error;
        }
    }

    /**
     * Exchange a short-lived Meta token for a long-lived token (~60 days).
     * Call this after OAuth to extend token validity.
     */
    static async exchangeMetaToken(shortLivedToken: string): Promise<string> {
        const creds = await getCredentials('META_ADS');
        if (!creds?.appId || !creds?.appSecret) {
            throw new Error('Meta Ads credentials not configured. Please configure via Super Admin.');
        }

        const url = `https://graph.facebook.com/v18.0/oauth/access_token?grant_type=fb_exchange_token&client_id=${creds.appId}&client_secret=${creds.appSecret}&fb_exchange_token=${shortLivedToken}`;

        try {
            const response = await fetch(url);
            const data = await response.json();

            if (data.error) {
                throw new Error(data.error.message);
            }

            return data.access_token;
        } catch (error) {
            Logger.error('Failed to exchange Meta token', { error });
            throw error;
        }
    }

    /**
     * Fetch Meta Ads campaign-level insights.
     * Uses Facebook Graph API to retrieve campaign breakdown.
     */
    static async getMetaCampaignInsights(adAccountId: string, days: number = 30): Promise<CampaignInsight[]> {
        const adAccount = await prisma.adAccount.findUnique({
            where: { id: adAccountId }
        });

        if (!adAccount || adAccount.platform !== 'META' || !adAccount.accessToken || !adAccount.externalId) {
            throw new Error('Invalid Meta Ad Account');
        }

        const actId = adAccount.externalId.startsWith('act_') ? adAccount.externalId : `act_${adAccount.externalId}`;

        // Calculate date range
        const endDate = new Date();
        const startDate = new Date();
        startDate.setDate(endDate.getDate() - days);

        const formatDate = (d: Date) => d.toISOString().split('T')[0];

        // Fetch campaigns with insights - only ACTIVE campaigns
        const fields = 'campaign_id,campaign_name,spend,impressions,clicks,actions,action_values';
        const timeRange = JSON.stringify({
            since: formatDate(startDate),
            until: formatDate(endDate)
        });
        const filtering = JSON.stringify([{ field: 'campaign.effective_status', operator: 'IN', value: ['ACTIVE'] }]);
        const url = `https://graph.facebook.com/v18.0/${actId}/insights?fields=${fields}&level=campaign&time_range=${encodeURIComponent(timeRange)}&filtering=${encodeURIComponent(filtering)}&access_token=${adAccount.accessToken}`;

        try {
            const response = await fetch(url);
            const data = await response.json();

            if (data.error) {
                Logger.error('Meta API Error (campaigns)', { error: data.error });
                throw new Error(data.error.message);
            }

            const campaigns: CampaignInsight[] = (data.data || []).map((row: any) => {
                const spend = parseFloat(row.spend || '0');
                const impressions = parseInt(row.impressions || '0');
                const clicks = parseInt(row.clicks || '0');

                // Get conversions from actions
                let conversions = 0;
                let conversionsValue = 0;

                if (row.actions && Array.isArray(row.actions)) {
                    const purchaseAction = row.actions.find(
                        (a: any) => a.action_type === 'purchase' || a.action_type === 'omni_purchase'
                    );
                    if (purchaseAction?.value) {
                        conversions = parseFloat(purchaseAction.value);
                    }
                }

                if (row.action_values && Array.isArray(row.action_values)) {
                    const purchaseValue = row.action_values.find(
                        (a: any) => a.action_type === 'purchase' || a.action_type === 'omni_purchase'
                    );
                    if (purchaseValue?.value) {
                        conversionsValue = parseFloat(purchaseValue.value);
                    }
                }

                const roas = spend > 0 ? conversionsValue / spend : 0;
                const ctr = impressions > 0 ? (clicks / impressions) * 100 : 0;
                const cpc = clicks > 0 ? spend / clicks : 0;
                const cpa = conversions > 0 ? spend / conversions : 0;

                return {
                    campaignId: row.campaign_id || '',
                    campaignName: row.campaign_name || 'Unknown Campaign',
                    status: 'ACTIVE', // Graph API doesn't return status in insights
                    spend,
                    impressions,
                    clicks,
                    conversions,
                    conversionsValue,
                    roas,
                    ctr,
                    cpc,
                    cpa,
                    currency: adAccount.currency || 'USD',
                    dateStart: formatDate(startDate),
                    dateStop: formatDate(endDate)
                };
            });

            // Sort by spend descending
            return campaigns.sort((a, b) => b.spend - a.spend);

        } catch (error) {
            Logger.error('Failed to fetch Meta Campaign Insights', { error });
            throw error;
        }
    }

    /**
     * Fetch daily performance trends for a Meta Ads account.
     */
    static async getMetaDailyTrends(adAccountId: string, days: number = 30): Promise<DailyTrend[]> {
        const adAccount = await prisma.adAccount.findUnique({
            where: { id: adAccountId }
        });

        if (!adAccount || adAccount.platform !== 'META' || !adAccount.accessToken || !adAccount.externalId) {
            throw new Error('Invalid Meta Ad Account');
        }

        const actId = adAccount.externalId.startsWith('act_') ? adAccount.externalId : `act_${adAccount.externalId}`;

        const endDate = new Date();
        const startDate = new Date();
        startDate.setDate(endDate.getDate() - days);

        const formatDate = (d: Date) => d.toISOString().split('T')[0];

        const fields = 'spend,impressions,clicks,actions,action_values';
        const timeRange = JSON.stringify({
            since: formatDate(startDate),
            until: formatDate(endDate)
        });
        const url = `https://graph.facebook.com/v18.0/${actId}/insights?fields=${fields}&time_increment=1&time_range=${encodeURIComponent(timeRange)}&access_token=${adAccount.accessToken}`;

        try {
            const response = await fetch(url);
            const data = await response.json();

            if (data.error) {
                Logger.error('Meta API Error (trends)', { error: data.error });
                throw new Error(data.error.message);
            }

            return (data.data || []).map((row: any) => {
                let conversions = 0;
                let conversionsValue = 0;

                if (row.actions && Array.isArray(row.actions)) {
                    const purchaseAction = row.actions.find(
                        (a: any) => a.action_type === 'purchase' || a.action_type === 'omni_purchase'
                    );
                    if (purchaseAction?.value) {
                        conversions = parseFloat(purchaseAction.value);
                    }
                }

                if (row.action_values && Array.isArray(row.action_values)) {
                    const purchaseValue = row.action_values.find(
                        (a: any) => a.action_type === 'purchase' || a.action_type === 'omni_purchase'
                    );
                    if (purchaseValue?.value) {
                        conversionsValue = parseFloat(purchaseValue.value);
                    }
                }

                return {
                    date: row.date_start || '',
                    spend: parseFloat(row.spend || '0'),
                    impressions: parseInt(row.impressions || '0'),
                    clicks: parseInt(row.clicks || '0'),
                    conversions,
                    conversionsValue
                };
            });

        } catch (error) {
            Logger.error('Failed to fetch Meta Daily Trends', { error });
            throw error;
        }
    }

    // ──────────────────────────────────────────────────────────────
    // GOOGLE ADS - Google Ads API v17
    // ──────────────────────────────────────────────────────────────

    /**
     * Fetch Google Ads insights for the last 30 days.
     * Uses GAQL to query cost, impressions, clicks, and conversion value.
     */
    static async getGoogleInsights(adAccountId: string): Promise<AdMetric | null> {
        const adAccount = await prisma.adAccount.findUnique({
            where: { id: adAccountId }
        });

        if (!adAccount || adAccount.platform !== 'GOOGLE' || !adAccount.refreshToken || !adAccount.externalId) {
            throw new Error('Invalid Google Ad Account');
        }

        // Get Google Ads credentials from database (with env fallback)
        const creds = await getCredentials('GOOGLE_ADS');
        if (!creds?.clientId || !creds?.clientSecret || !creds?.developerToken) {
            Logger.warn('Google Ads credentials not configured. Configure via Super Admin.');
            return null;
        }

        const { clientId, clientSecret, developerToken } = creds;

        try {
            const client = new GoogleAdsApi({
                client_id: clientId,
                client_secret: clientSecret,
                developer_token: developerToken
            });

            // For Manager (MCC) accounts, we need to specify login_customer_id
            // This is the MCC account ID that has access to the client account
            const loginCustomerId = creds.loginCustomerId; // Optional: MCC account ID

            const customerConfig: any = {
                customer_id: adAccount.externalId.replace(/-/g, ''),
                refresh_token: adAccount.refreshToken
            };

            // If accessing through an MCC, add the login_customer_id
            if (loginCustomerId) {
                customerConfig.login_customer_id = loginCustomerId.replace(/-/g, '');
            }

            const customer = client.Customer(customerConfig);

            // Calculate date range for last 30 days
            const endDate = new Date();
            const startDate = new Date();
            startDate.setDate(startDate.getDate() - 30);

            const formatDate = (d: Date) => d.toISOString().split('T')[0].replace(/-/g, '');

            // GAQL query for account-level metrics
            const query = `
                SELECT
                    metrics.cost_micros,
                    metrics.impressions,
                    metrics.clicks,
                    metrics.conversions_value,
                    customer.currency_code
                FROM customer
                WHERE segments.date BETWEEN '${formatDate(startDate)}' AND '${formatDate(endDate)}'
            `;

            const [response] = await customer.query(query);

            if (!response || !response.metrics) {
                return null;
            }

            // Google Ads returns cost in micros (1/1,000,000 of currency unit)
            const spend = (response.metrics.cost_micros || 0) / 1_000_000;
            const conversionsValue = response.metrics.conversions_value || 0;
            const roas = spend > 0 ? conversionsValue / spend : 0;

            return {
                accountId: adAccountId,
                spend,
                impressions: response.metrics.impressions || 0,
                clicks: response.metrics.clicks || 0,
                roas,
                currency: response.customer?.currency_code || adAccount.currency || 'USD',
                date_start: startDate.toISOString().split('T')[0],
                date_stop: endDate.toISOString().split('T')[0]
            };

        } catch (error: any) {
            // Parse Google Ads API specific errors for better diagnostics
            const errorMessage = error.message || '';
            const errorCode = error.code;

            let userFriendlyMessage = errorMessage;

            // GRPC error code 12 = UNIMPLEMENTED
            if (errorCode === 12 || errorMessage.includes('UNIMPLEMENTED') || errorMessage.includes('GRPC target method')) {
                userFriendlyMessage = 'Google Ads API access denied. Possible causes: ' +
                    '(1) Developer token at "Test Account" level - upgrade to "Explorer Access" at https://ads.google.com/aw/apicenter. ' +
                    '(2) Missing Manager Account ID (MCC) - if accessing client accounts through an MCC, add the Manager Account ID in Super Admin > Credentials > Google Ads.';
            }
            // GRPC error code 7 = PERMISSION_DENIED
            else if (errorCode === 7 || errorMessage.includes('PERMISSION_DENIED')) {
                userFriendlyMessage = 'Permission denied. Ensure the connected Google account has access to this Google Ads account (Customer ID: ' +
                    adAccount.externalId + '). The user must be linked to this account in Google Ads.';
            }
            // GRPC error code 16 = UNAUTHENTICATED
            else if (errorCode === 16 || errorMessage.includes('UNAUTHENTICATED') || errorMessage.includes('invalid_grant')) {
                userFriendlyMessage = 'Authentication expired. Please disconnect and reconnect your Google Ads account to refresh the OAuth tokens.';
            }
            // Invalid customer ID format
            else if (errorMessage.includes('INVALID_CUSTOMER_ID') || errorMessage.includes('customer_id')) {
                userFriendlyMessage = 'Invalid Customer ID format. Please verify the Customer ID is correct (format: 123-456-7890 or 1234567890).';
            }

            Logger.error('Failed to fetch Google Ads Insights', {
                error: errorMessage,
                code: errorCode,
                adAccountId,
                customerId: adAccount.externalId,
                userMessage: userFriendlyMessage
            });

            throw new Error(userFriendlyMessage);
        }
    }

    /**
     * Fetch Google Ads campaign-level insights for the last 30 days.
     * Returns detailed metrics for each campaign including spend, ROAS, CTR, CPC, CPA.
     */
    static async getGoogleCampaignInsights(adAccountId: string, days: number = 30): Promise<CampaignInsight[]> {
        const adAccount = await prisma.adAccount.findUnique({
            where: { id: adAccountId }
        });

        if (!adAccount || adAccount.platform !== 'GOOGLE' || !adAccount.refreshToken || !adAccount.externalId) {
            throw new Error('Invalid Google Ad Account');
        }

        const creds = await getCredentials('GOOGLE_ADS');
        if (!creds?.clientId || !creds?.clientSecret || !creds?.developerToken) {
            Logger.warn('Google Ads credentials not configured.');
            return [];
        }

        const { clientId, clientSecret, developerToken } = creds;

        try {
            const client = new GoogleAdsApi({
                client_id: clientId,
                client_secret: clientSecret,
                developer_token: developerToken
            });

            const loginCustomerId = creds.loginCustomerId;
            const customerConfig: any = {
                customer_id: adAccount.externalId.replace(/-/g, ''),
                refresh_token: adAccount.refreshToken
            };
            if (loginCustomerId) {
                customerConfig.login_customer_id = loginCustomerId.replace(/-/g, '');
            }

            const customer = client.Customer(customerConfig);

            // Calculate date range
            const endDate = new Date();
            const startDate = new Date();
            startDate.setDate(startDate.getDate() - days);

            const formatDate = (d: Date) => d.toISOString().split('T')[0].replace(/-/g, '');

            // GAQL query for campaign-level metrics - only ENABLED campaigns
            const query = `
                SELECT
                    campaign.id,
                    campaign.name,
                    campaign.status,
                    metrics.cost_micros,
                    metrics.impressions,
                    metrics.clicks,
                    metrics.conversions,
                    metrics.conversions_value
                FROM campaign
                WHERE segments.date BETWEEN '${formatDate(startDate)}' AND '${formatDate(endDate)}'
                    AND campaign.status = 'ENABLED'
                ORDER BY metrics.cost_micros DESC
            `;

            const results = await customer.query(query);

            const campaigns: CampaignInsight[] = results.map((row: any) => {
                const spend = (row.metrics?.cost_micros || 0) / 1_000_000;
                const impressions = row.metrics?.impressions || 0;
                const clicks = row.metrics?.clicks || 0;
                const conversions = row.metrics?.conversions || 0;
                const conversionsValue = row.metrics?.conversions_value || 0;

                return {
                    campaignId: row.campaign?.id?.toString() || '',
                    campaignName: row.campaign?.name || 'Unknown',
                    status: row.campaign?.status || 'UNKNOWN',
                    spend,
                    impressions,
                    clicks,
                    conversions,
                    conversionsValue,
                    roas: spend > 0 ? conversionsValue / spend : 0,
                    ctr: impressions > 0 ? (clicks / impressions) * 100 : 0,
                    cpc: clicks > 0 ? spend / clicks : 0,
                    cpa: conversions > 0 ? spend / conversions : 0,
                    currency: adAccount.currency || 'USD',
                    dateStart: startDate.toISOString().split('T')[0],
                    dateStop: endDate.toISOString().split('T')[0]
                };
            });

            return campaigns;

        } catch (error: any) {
            Logger.error('Failed to fetch Google Ads Campaign Insights', {
                error: error.message,
                adAccountId
            });
            throw error;
        }
    }

    /**
     * Fetch daily performance trends for a Google Ads account.
     * Returns spend, impressions, clicks, conversions per day.
     */
    static async getGoogleDailyTrends(adAccountId: string, days: number = 30): Promise<DailyTrend[]> {
        const adAccount = await prisma.adAccount.findUnique({
            where: { id: adAccountId }
        });

        if (!adAccount || adAccount.platform !== 'GOOGLE' || !adAccount.refreshToken || !adAccount.externalId) {
            throw new Error('Invalid Google Ad Account');
        }

        const creds = await getCredentials('GOOGLE_ADS');
        if (!creds?.clientId || !creds?.clientSecret || !creds?.developerToken) {
            return [];
        }

        const { clientId, clientSecret, developerToken } = creds;

        try {
            const client = new GoogleAdsApi({
                client_id: clientId,
                client_secret: clientSecret,
                developer_token: developerToken
            });

            const loginCustomerId = creds.loginCustomerId;
            const customerConfig: any = {
                customer_id: adAccount.externalId.replace(/-/g, ''),
                refresh_token: adAccount.refreshToken
            };
            if (loginCustomerId) {
                customerConfig.login_customer_id = loginCustomerId.replace(/-/g, '');
            }

            const customer = client.Customer(customerConfig);

            const endDate = new Date();
            const startDate = new Date();
            startDate.setDate(startDate.getDate() - days);

            const formatDate = (d: Date) => d.toISOString().split('T')[0].replace(/-/g, '');

            // GAQL query for daily metrics
            const query = `
                SELECT
                    segments.date,
                    metrics.cost_micros,
                    metrics.impressions,
                    metrics.clicks,
                    metrics.conversions,
                    metrics.conversions_value
                FROM customer
                WHERE segments.date BETWEEN '${formatDate(startDate)}' AND '${formatDate(endDate)}'
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
            Logger.error('Failed to fetch Google Ads Daily Trends', {
                error: error.message,
                adAccountId
            });
            throw error;
        }
    }

    /**
     * Exchange Google OAuth authorization code for access/refresh tokens.
     * Called after user completes OAuth consent flow.
     */
    static async exchangeGoogleCode(
        code: string,
        redirectUri: string
    ): Promise<{ accessToken: string; refreshToken: string }> {
        const creds = await getCredentials('GOOGLE_ADS');
        if (!creds?.clientId || !creds?.clientSecret) {
            throw new Error('Google Ads credentials not configured. Please configure via Super Admin.');
        }

        const { clientId, clientSecret } = creds;

        const tokenUrl = 'https://oauth2.googleapis.com/token';
        const params = new URLSearchParams({
            code,
            client_id: clientId,
            client_secret: clientSecret,
            redirect_uri: redirectUri,
            grant_type: 'authorization_code'
        });

        try {
            Logger.info('Exchanging Google OAuth code', { redirectUri, hasCode: !!code });

            const response = await fetch(tokenUrl, {
                method: 'POST',
                headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
                body: params.toString()
            });

            const data = await response.json();

            Logger.info('Google token exchange response', {
                hasAccessToken: !!data.access_token,
                hasRefreshToken: !!data.refresh_token,
                error: data.error,
                tokenType: data.token_type
            });

            if (data.error) {
                throw new Error(data.error_description || data.error);
            }

            if (!data.access_token) {
                throw new Error('No access token received from Google');
            }

            // Refresh token may not be returned if user previously authorized
            // We still proceed but log the warning
            if (!data.refresh_token) {
                Logger.warn('No refresh token received from Google. User may need to revoke app access at https://myaccount.google.com/permissions and re-authorize.');
            }

            return {
                accessToken: data.access_token,
                refreshToken: data.refresh_token || ''
            };
        } catch (error) {
            Logger.error('Failed to exchange Google OAuth code', { error });
            throw error;
        }
    }

    /**
     * Get the Google OAuth authorization URL for user consent.
     */
    static async getGoogleAuthUrl(redirectUri: string, state: string): Promise<string> {
        const creds = await getCredentials('GOOGLE_ADS');
        if (!creds?.clientId) {
            throw new Error('Google Ads credentials not configured. Please configure via Super Admin.');
        }

        const { clientId } = creds;

        const scopes = [
            'https://www.googleapis.com/auth/adwords'
        ];

        const params = new URLSearchParams({
            client_id: clientId,
            redirect_uri: redirectUri,
            response_type: 'code',
            scope: scopes.join(' '),
            access_type: 'offline',
            prompt: 'consent',
            state
        });

        return `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`;
    }

    /**
     * Fetch all accessible Google Ads customer accounts after OAuth.
     * Used to let user select which ad account to connect.
     */
    static async listGoogleCustomers(refreshToken: string): Promise<Array<{ id: string; name: string }>> {
        const creds = await getCredentials('GOOGLE_ADS');
        if (!creds?.clientId || !creds?.clientSecret || !creds?.developerToken) {
            throw new Error('Google Ads credentials not configured. Please configure via Super Admin.');
        }

        const { clientId, clientSecret, developerToken } = creds;

        try {
            const client = new GoogleAdsApi({
                client_id: clientId,
                client_secret: clientSecret,
                developer_token: developerToken
            });

            const response = await client.listAccessibleCustomers(refreshToken);

            // listAccessibleCustomers returns { resource_names: string[] }
            const customerResourceNames = response.resource_names || [];

            // Extract customer IDs from resource names (format: "customers/1234567890")
            const customerIds = customerResourceNames.map((rn: string) => rn.replace('customers/', ''));

            // Fetch descriptive names for each customer
            const results: Array<{ id: string; name: string }> = [];

            for (const customerId of customerIds) {
                try {
                    const customer = client.Customer({
                        customer_id: customerId.replace(/-/g, ''),
                        refresh_token: refreshToken
                    });

                    const [info] = await customer.query(`
                        SELECT customer.descriptive_name, customer.id
                        FROM customer
                        LIMIT 1
                    `);

                    results.push({
                        id: customerId,
                        name: (info as any)?.customer?.descriptive_name || `Account ${customerId}`
                    });
                } catch {
                    // Skip accounts we can't access
                    results.push({ id: customerId, name: `Account ${customerId}` });
                }
            }

            return results;
        } catch (error) {
            Logger.error('Failed to list Google Ads customers', { error });
            throw error;
        }
    }

    /**
     * Fetch Google Shopping product-level performance data.
     * Returns product performance within Shopping campaigns for AI analysis.
     * Only includes active campaigns with actual impressions, limited to top products.
     */
    static async getGoogleShoppingProducts(adAccountId: string, days: number = 30, limit: number = 200): Promise<ShoppingProductInsight[]> {
        const adAccount = await prisma.adAccount.findUnique({
            where: { id: adAccountId }
        });

        if (!adAccount || adAccount.platform !== 'GOOGLE' || !adAccount.refreshToken || !adAccount.externalId) {
            throw new Error('Invalid Google Ad Account');
        }

        const creds = await getCredentials('GOOGLE_ADS');
        if (!creds?.clientId || !creds?.clientSecret || !creds?.developerToken) {
            Logger.warn('Google Ads credentials not configured.');
            return [];
        }

        const { clientId, clientSecret, developerToken } = creds;

        try {
            const client = new GoogleAdsApi({
                client_id: clientId,
                client_secret: clientSecret,
                developer_token: developerToken
            });

            const loginCustomerId = creds.loginCustomerId;
            const customerConfig: any = {
                customer_id: adAccount.externalId.replace(/-/g, ''),
                refresh_token: adAccount.refreshToken
            };
            if (loginCustomerId) {
                customerConfig.login_customer_id = loginCustomerId.replace(/-/g, '');
            }

            const customer = client.Customer(customerConfig);

            // Calculate date range
            const endDate = new Date();
            const startDate = new Date();
            startDate.setDate(startDate.getDate() - days);

            const formatDate = (d: Date) => d.toISOString().split('T')[0].replace(/-/g, '');

            // GAQL query for shopping product performance
            // Only active campaigns with impressions, ordered by spend
            const query = `
                SELECT
                    campaign.id,
                    campaign.name,
                    segments.product_item_id,
                    segments.product_title,
                    segments.product_brand,
                    segments.product_type_l1,
                    metrics.cost_micros,
                    metrics.impressions,
                    metrics.clicks,
                    metrics.conversions,
                    metrics.conversions_value
                FROM shopping_performance_view
                WHERE segments.date BETWEEN '${formatDate(startDate)}' AND '${formatDate(endDate)}'
                    AND campaign.status = 'ENABLED'
                    AND metrics.impressions > 0
                ORDER BY metrics.cost_micros DESC
                LIMIT ${limit}
            `;

            const results = await customer.query(query);

            const products: ShoppingProductInsight[] = results.map((row: any) => {
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
                    spend,
                    impressions,
                    clicks,
                    conversions,
                    conversionsValue,
                    roas: spend > 0 ? conversionsValue / spend : 0,
                    ctr: impressions > 0 ? (clicks / impressions) * 100 : 0,
                    cpc: clicks > 0 ? spend / clicks : 0,
                    currency: adAccount.currency || 'USD',
                    dateStart: startDate.toISOString().split('T')[0],
                    dateStop: endDate.toISOString().split('T')[0]
                };
            });

            return products;

        } catch (error: any) {
            // Handle case where account has no Shopping campaigns
            if (error.message?.includes('UNIMPLEMENTED') || error.message?.includes('not enabled')) {
                Logger.info('Shopping performance view not available for this account', { adAccountId });
                return [];
            }
            Logger.error('Failed to fetch Google Shopping Products', {
                error: error.message,
                adAccountId
            });
            throw error;
        }
    }

    // ──────────────────────────────────────────────────────────────
    // COMMON ACCOUNT MANAGEMENT
    // ──────────────────────────────────────────────────────────────

    /**
     * Get all connected ad accounts for a store account.
     */
    static async getAdAccounts(accountId: string) {
        return prisma.adAccount.findMany({
            where: { accountId }
        });
    }

    /**
     * Connect a new ad account (manual token entry).
     */
    static async connectAccount(
        accountId: string,
        data: {
            platform: string;
            externalId: string;
            accessToken: string;
            refreshToken?: string;
            name?: string;
            currency?: string;
        }
    ) {
        return prisma.adAccount.create({
            data: {
                accountId,
                platform: data.platform,
                externalId: data.externalId,
                accessToken: data.accessToken,
                refreshToken: data.refreshToken,
                name: data.name || `${data.platform} Account`,
                currency: data.currency
            }
        });
    }

    /**
     * Update an existing ad account (e.g., refresh token rotation).
     */
    static async updateAccount(
        adAccountId: string,
        data: Partial<{ accessToken: string; refreshToken: string; name: string }>
    ) {
        return prisma.adAccount.update({
            where: { id: adAccountId },
            data
        });
    }

    /**
     * Delete a connected ad account.
     */
    static async disconnectAccount(adAccountId: string) {
        return prisma.adAccount.delete({
            where: { id: adAccountId }
        });
    }
}
