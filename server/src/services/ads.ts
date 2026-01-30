/**
 * Unified Ads Service (Facade)
 * 
 * Provides backwards-compatible interface to Meta and Google Ads platforms.
 * Delegates all platform-specific logic to dedicated service modules.
 * 
 * @see MetaAdsService for Facebook/Instagram Graph API integration
 * @see GoogleAdsService for Google Ads API integration
 */

import { prisma } from '../utils/prisma';
import { MetaAdsService } from './ads/MetaAdsService';
import { GoogleAdsService } from './ads/GoogleAdsService';

// Re-export types for backwards compatibility
export { AdMetric, CampaignInsight, DailyTrend, ShoppingProductInsight, SearchKeywordInsight } from './ads/types';

/**
 * Unified Ads Service facade.
 * Maintains backwards compatibility while delegating to platform-specific services.
 */
export class AdsService {

    // ──────────────────────────────────────────────────────────────
    // META ADS (Facebook/Instagram) - Delegates to MetaAdsService
    // ──────────────────────────────────────────────────────────────

    /** @see MetaAdsService.getInsights */
    static getMetaInsights = MetaAdsService.getInsights;

    /** @see MetaAdsService.exchangeToken */
    static exchangeMetaToken = MetaAdsService.exchangeToken;

    /** @see MetaAdsService.getCampaignInsights */
    static getMetaCampaignInsights = MetaAdsService.getCampaignInsights;

    /** @see MetaAdsService.getDailyTrends */
    static getMetaDailyTrends = MetaAdsService.getDailyTrends;

    /** @see MetaAdsService.updateCampaignBudget */
    static updateMetaCampaignBudget = MetaAdsService.updateCampaignBudget;

    /** @see MetaAdsService.updateCampaignStatus */
    static updateMetaCampaignStatus = MetaAdsService.updateCampaignStatus;

    // ──────────────────────────────────────────────────────────────
    // GOOGLE ADS - Delegates to GoogleAdsService
    // ──────────────────────────────────────────────────────────────

    /** @see GoogleAdsService.getInsights */
    static getGoogleInsights = GoogleAdsService.getInsights;

    /** @see GoogleAdsService.getCampaignInsights */
    static getGoogleCampaignInsights = GoogleAdsService.getCampaignInsights;

    /** @see GoogleAdsService.getDailyTrends */
    static getGoogleDailyTrends = GoogleAdsService.getDailyTrends;

    /** @see GoogleAdsService.updateCampaignBudget */
    static updateGoogleCampaignBudget = GoogleAdsService.updateCampaignBudget;

    /** @see GoogleAdsService.updateCampaignStatus */
    static updateGoogleCampaignStatus = GoogleAdsService.updateCampaignStatus;

    /** @see GoogleAdsService.exchangeCode */
    static exchangeGoogleCode = GoogleAdsService.exchangeCode;

    /** @see GoogleAdsService.getAuthUrl */
    static getGoogleAuthUrl = GoogleAdsService.getAuthUrl;

    /** @see GoogleAdsService.listCustomers */
    static listGoogleCustomers = GoogleAdsService.listCustomers;

    /** @see GoogleAdsService.getShoppingProducts */
    static getGoogleShoppingProducts = GoogleAdsService.getShoppingProducts;

    /** @see GoogleAdsService.addSearchKeyword */
    static addGoogleSearchKeyword = GoogleAdsService.addSearchKeyword;

    /** @see GoogleAdsService.getCampaignProducts */
    static getGoogleCampaignProducts = GoogleAdsService.getCampaignProducts;

    /** @see GoogleAdsService.getSearchKeywords */
    static getGoogleSearchKeywords = GoogleAdsService.getSearchKeywords;

    /** @see GoogleAdsService.getCampaignAdGroups */
    static getGoogleCampaignAdGroups = GoogleAdsService.getCampaignAdGroups;

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
