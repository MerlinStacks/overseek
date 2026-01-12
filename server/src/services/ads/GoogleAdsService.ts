/**
 * Google Ads Service
 * 
 * Handles Google Ads API v17 interactions for ad insights.
 * Auth methods are delegated to GoogleAdsAuth.
 */

import { prisma } from '../../utils/prisma';
import { Logger } from '../../utils/logger';
import { AdMetric, CampaignInsight, DailyTrend, ShoppingProductInsight, formatDateISO, formatDateGAQL } from './types';
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
    static async getCampaignProducts(adAccountId: string, campaignId: string, days: number = 30): Promise<ShoppingProductInsight[]> {
        const allProducts = await this.getShoppingProducts(adAccountId, days, 500);
        return allProducts.filter(p => p.campaignId === campaignId);
    }

    // Delegated auth methods for backward compatibility
    static exchangeCode = GoogleAdsAuth.exchangeCode;
    static getAuthUrl = GoogleAdsAuth.getAuthUrl;
    static listCustomers = GoogleAdsAuth.listCustomers;
}
