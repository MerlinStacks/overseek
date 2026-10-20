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
import { z } from 'zod';

const requiredText = z.string().trim().min(1);
const connectionSchema = z.object({
    platform: z.enum(['META', 'GOOGLE']),
    externalId: requiredText,
    accessToken: requiredText,
    refreshToken: z.string().optional(),
    name: z.string().trim().optional(),
    currency: z.string().trim().toUpperCase().regex(/^[A-Z]{3}$/).optional(),
}).strict();
const updateSchema = z.object({
    accessToken: requiredText.optional(), refreshToken: z.string().optional(),
    name: z.string().trim().optional(), externalId: requiredText.optional(),
}).strict();

function validated<T>(schema: z.ZodType<T>, input: unknown): T {
    const result = schema.safeParse(input);
    if (!result.success) throw Object.assign(new Error('Invalid ad account input'), { statusCode: 400 });
    return result.data;
}

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
        accountId = validated(requiredText, accountId);
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
        accountId = validated(requiredText, accountId);
        const input = validated(connectionSchema, data);
        return prisma.adAccount.create({
            data: {
                accountId,
                platform: input.platform,
                externalId: validated(requiredText, input.platform === 'GOOGLE' ? input.externalId.replace(/-/g, '') : input.externalId),
                accessToken: input.accessToken,
                refreshToken: input.refreshToken,
                name: input.name || `${input.platform} Account`,
                currency: input.currency
            }
        });
    }

    /**
     * Update an existing ad account (e.g., refresh token rotation).
     */
    static async updateAccount(
        accountId: string,
        adAccountId: string,
        data: Partial<{ accessToken: string; refreshToken: string; name: string; externalId: string }>
    ) {
        accountId = validated(requiredText, accountId);
        adAccountId = validated(requiredText, adAccountId);
        const input = validated(updateSchema, data);
        return prisma.adAccount.update({
            where: { id: adAccountId, accountId },
            data: input
        });
    }

    /**
     * Update tokens for an existing ad account (alias for updateAccount).
     * Used by OAuth reconnection flow.
     */
    static updateAccountTokens = AdsService.updateAccount;

    /**
     * Delete a connected ad account.
     */
    static async disconnectAccount(accountId: string, adAccountId: string) {
        accountId = validated(requiredText, accountId);
        adAccountId = validated(requiredText, adAccountId);
        return prisma.adAccount.delete({
            where: { id: adAccountId, accountId }
        });
    }
}
