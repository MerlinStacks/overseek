/**
 * Meta Ads Service (Facebook/Instagram)
 * Handles Meta Graph API v18.0 interactions for ad insights.
 */

import { prisma } from '../../utils/prisma';
import { Logger } from '../../utils/logger';
import { AdMetric, CampaignInsight, DailyTrend, getCredentials, formatDateISO } from './types';

/**
 * Service for Meta (Facebook/Instagram) Ads integration.
 * Uses Facebook Graph API v18.0.
 */
export class MetaAdsService {

    /**
     * Fetch Meta Ads insights for the last 30 days.
     * Uses Facebook Graph API to retrieve spend, impressions, clicks, and ROAS.
     */
    static async getInsights(adAccountId: string): Promise<AdMetric | null> {
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
            Logger.info('[MetaAds] Fetching insights', { actId, hasToken: !!adAccount.accessToken });

            const response = await fetch(url);
            const data = await response.json();

            if (data.error) {
                Logger.error('[MetaAds] API Error', {
                    actId,
                    errorCode: data.error.code,
                    errorType: data.error.type,
                    errorMessage: data.error.message,
                    errorSubcode: data.error.error_subcode
                });
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
    static async exchangeToken(shortLivedToken: string): Promise<string> {
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
    static async getCampaignInsights(adAccountId: string, days: number = 30): Promise<CampaignInsight[]> {
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

        // Fetch campaigns with insights - only ACTIVE campaigns
        const fields = 'campaign_id,campaign_name,spend,impressions,clicks,actions,action_values';
        const timeRange = JSON.stringify({
            since: formatDateISO(startDate),
            until: formatDateISO(endDate)
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
                    dateStart: formatDateISO(startDate),
                    dateStop: formatDateISO(endDate)
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
    static async getDailyTrends(adAccountId: string, days: number = 30): Promise<DailyTrend[]> {
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

        const fields = 'spend,impressions,clicks,actions,action_values';
        const timeRange = JSON.stringify({
            since: formatDateISO(startDate),
            until: formatDateISO(endDate)
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

    /**
     * Update a Meta Ads campaign's daily budget.
     */
    static async updateCampaignBudget(adAccountId: string, campaignId: string, dailyBudget: number): Promise<boolean> {
        const adAccount = await prisma.adAccount.findUnique({
            where: { id: adAccountId }
        });

        if (!adAccount || adAccount.platform !== 'META' || !adAccount.accessToken) {
            throw new Error('Invalid Meta Ad Account');
        }

        // Meta Ads API requires budget in cents (basic unit) usually, but Graph API v18 takes 'daily_budget' in basic unit (e.g. 1000 for $10.00).
        // Actually, for most currencies, it's the "offset" unit. For USD, it's cents.
        // We will assume the input 'dailyBudget' is in DOLLARS (e.g. 50.00).
        // So we multiply by 100.
        const budgetInCents = Math.round(dailyBudget * 100);

        const url = `https://graph.facebook.com/v18.0/${campaignId}?access_token=${adAccount.accessToken}`;

        try {
            Logger.info('[MetaAds] Updating budget', { campaignId, dailyBudget, budgetInCents });

            const response = await fetch(url, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    daily_budget: budgetInCents
                })
            });

            const data = await response.json();

            if (data.error) {
                Logger.error('[MetaAds] Update Budget Error', { error: data.error });
                throw new Error(data.error.message);
            }

            return data.success === true;
        } catch (error) {
            Logger.error('Failed to update Meta campaign budget', { error });
            throw error;
        }
    }

    /**
     * Update a Meta Ads campaign's status (PAUSED or ACTIVE).
     */
    static async updateCampaignStatus(adAccountId: string, campaignId: string, status: 'ACTIVE' | 'PAUSED'): Promise<boolean> {
        const adAccount = await prisma.adAccount.findUnique({
            where: { id: adAccountId }
        });

        if (!adAccount || adAccount.platform !== 'META' || !adAccount.accessToken) {
            throw new Error('Invalid Meta Ad Account');
        }

        const url = `https://graph.facebook.com/v18.0/${campaignId}?access_token=${adAccount.accessToken}`;

        try {
            Logger.info('[MetaAds] Updating status', { campaignId, status });

            const response = await fetch(url, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    status: status
                })
            });

            const data = await response.json();

            if (data.error) {
                Logger.error('[MetaAds] Update Status Error', { error: data.error });
                throw new Error(data.error.message);
            }

            return data.success === true;
        } catch (error) {
            Logger.error('Failed to update Meta campaign status', { error });
            throw error;
        }
    }
}
