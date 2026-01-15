/**
 * Ads Route - Fastify Plugin
 */

import { FastifyPluginAsync } from 'fastify';
import { AdsService } from '../services/ads';
import { requireAuthFastify } from '../middleware/auth';
import { Logger } from '../utils/logger';
import { prisma } from '../utils/prisma';

interface AdAccountBody {
    platform?: string;
    externalId?: string;
    accessToken?: string;
    refreshToken?: string;
    name?: string;
    currency?: string;
}

const adsRoutes: FastifyPluginAsync = async (fastify) => {
    fastify.addHook('preHandler', requireAuthFastify);

    // GET /api/ads - List all connected ad accounts
    fastify.get('/', async (request, reply) => {
        const accountId = request.accountId;
        if (!accountId) return reply.code(400).send({ error: 'No account selected' });

        try {
            const accounts = await AdsService.getAdAccounts(accountId);
            const safeAccounts = accounts.map(a => ({
                ...a,
                accessToken: a.accessToken ? `${a.accessToken.substring(0, 10)}...` : null,
                refreshToken: a.refreshToken ? '********' : null
            }));
            return safeAccounts;
        } catch (error: any) {
            Logger.error('Failed to list ad accounts', { error });
            return reply.code(500).send({ error: 'Failed to list ad accounts' });
        }
    });

    // PATCH /api/ads/:adAccountId - Edit ad account credentials
    fastify.patch<{ Params: { adAccountId: string }; Body: AdAccountBody }>('/:adAccountId', async (request, reply) => {
        const accountId = request.accountId;
        if (!accountId) return reply.code(400).send({ error: 'No account selected' });

        try {
            const { adAccountId } = request.params;
            const { name, accessToken, externalId, refreshToken } = request.body;

            const accounts = await AdsService.getAdAccounts(accountId);
            const adAccount = accounts.find(a => a.id === adAccountId);

            if (!adAccount) {
                return reply.code(404).send({ error: 'Ad account not found' });
            }

            const updateData: { name?: string; accessToken?: string; refreshToken?: string } = {};
            if (name !== undefined) updateData.name = name;
            if (accessToken !== undefined) updateData.accessToken = accessToken;
            if (refreshToken !== undefined) updateData.refreshToken = refreshToken;

            const updated = await AdsService.updateAccount(adAccountId, updateData);

            if (externalId !== undefined) {
                await prisma.adAccount.update({
                    where: { id: adAccountId },
                    data: { externalId }
                });
            }

            Logger.info('Ad account updated', { adAccountId, fields: Object.keys(updateData) });

            return {
                ...updated,
                externalId: externalId || adAccount.externalId,
                accessToken: updated.accessToken ? `${updated.accessToken.substring(0, 10)}...` : null,
                refreshToken: updated.refreshToken ? '********' : null
            };
        } catch (error: any) {
            Logger.error('Failed to update ad account', { error });
            return reply.code(500).send({ error: 'Failed to update ad account' });
        }
    });

    // POST /api/ads/connect - Connect a new ad account
    fastify.post<{ Body: AdAccountBody }>('/connect', async (request, reply) => {
        const accountId = request.accountId;
        if (!accountId) return reply.code(400).send({ error: 'No account selected' });

        try {
            const { platform, externalId, accessToken, refreshToken, name, currency } = request.body;

            if (!platform || !externalId || !accessToken) {
                return reply.code(400).send({ error: 'Missing required fields: platform, externalId, accessToken' });
            }

            const adAccount = await AdsService.connectAccount(accountId, {
                platform,
                externalId,
                accessToken,
                refreshToken,
                name,
                currency
            });

            return {
                ...adAccount,
                accessToken: `${adAccount.accessToken.substring(0, 10)}...`,
                refreshToken: adAccount.refreshToken ? '********' : null
            };
        } catch (error: any) {
            Logger.error('Failed to connect ad account', { error });
            return reply.code(500).send({ error: 'Failed to connect ad account' });
        }
    });

    // DELETE /api/ads/:adAccountId - Disconnect ad account
    fastify.delete<{ Params: { adAccountId: string } }>('/:adAccountId', async (request, reply) => {
        const accountId = request.accountId;
        if (!accountId) return reply.code(400).send({ error: 'No account selected' });

        try {
            const { adAccountId } = request.params;
            await AdsService.disconnectAccount(adAccountId);
            return { success: true };
        } catch (error: any) {
            Logger.error('Failed to disconnect ad account', { error });
            return reply.code(500).send({ error: 'Failed to disconnect ad account' });
        }
    });

    // GET /api/ads/:adAccountId/insights - Fetch insights
    fastify.get<{ Params: { adAccountId: string } }>('/:adAccountId/insights', async (request, reply) => {
        try {
            const { adAccountId } = request.params;
            const accountId = request.accountId!;

            const accounts = await AdsService.getAdAccounts(accountId);
            const adAccount = accounts.find(a => a.id === adAccountId);

            if (!adAccount) {
                return reply.code(404).send({ error: 'Ad account not found' });
            }

            let insights = null;
            if (adAccount.platform === 'META') {
                insights = await AdsService.getMetaInsights(adAccountId);
            } else if (adAccount.platform === 'GOOGLE') {
                insights = await AdsService.getGoogleInsights(adAccountId);
            } else {
                return reply.code(400).send({ error: `Unsupported platform: ${adAccount.platform}` });
            }

            return insights || { spend: 0, impressions: 0, clicks: 0, roas: 0 };
        } catch (error: any) {
            Logger.error('Failed to fetch ad insights', { error });
            return reply.code(500).send({ error: error.message });
        }
    });

    // GET /api/ads/:adAccountId/campaigns
    fastify.get<{ Params: { adAccountId: string } }>('/:adAccountId/campaigns', async (request, reply) => {
        try {
            const { adAccountId } = request.params;
            const { days } = request.query as { days?: string };
            const daysNum = parseInt(days || '30');
            const accountId = request.accountId!;

            const accounts = await AdsService.getAdAccounts(accountId);
            const adAccount = accounts.find(a => a.id === adAccountId);

            if (!adAccount) {
                return reply.code(404).send({ error: 'Ad account not found' });
            }

            let campaigns = null;
            if (adAccount.platform === 'GOOGLE') {
                campaigns = await AdsService.getGoogleCampaignInsights(adAccountId, daysNum);
            } else if (adAccount.platform === 'META') {
                campaigns = await AdsService.getMetaCampaignInsights(adAccountId, daysNum);
            } else {
                return reply.code(400).send({ error: `Campaign breakdown not supported for platform: ${adAccount.platform}` });
            }

            return campaigns;
        } catch (error: any) {
            Logger.error('Failed to fetch campaign insights', { error });
            return reply.code(500).send({ error: error.message });
        }
    });

    // GET /api/ads/:adAccountId/trends
    fastify.get<{ Params: { adAccountId: string } }>('/:adAccountId/trends', async (request, reply) => {
        try {
            const { adAccountId } = request.params;
            const { days } = request.query as { days?: string };
            const daysNum = parseInt(days || '30');
            const accountId = request.accountId!;

            const accounts = await AdsService.getAdAccounts(accountId);
            const adAccount = accounts.find(a => a.id === adAccountId);

            if (!adAccount) {
                return reply.code(404).send({ error: 'Ad account not found' });
            }

            let trends = null;
            if (adAccount.platform === 'GOOGLE') {
                trends = await AdsService.getGoogleDailyTrends(adAccountId, daysNum);
            } else if (adAccount.platform === 'META') {
                trends = await AdsService.getMetaDailyTrends(adAccountId, daysNum);
            } else {
                return reply.code(400).send({ error: `Trend data not supported for platform: ${adAccount.platform}` });
            }

            return trends;
        } catch (error: any) {
            Logger.error('Failed to fetch daily trends', { error });
            return reply.code(500).send({ error: error.message });
        }
    });

    // GET /api/ads/:adAccountId/shopping-products
    fastify.get<{ Params: { adAccountId: string } }>('/:adAccountId/shopping-products', async (request, reply) => {
        try {
            const { adAccountId } = request.params;
            const { days, limit } = request.query as { days?: string; limit?: string };
            const daysNum = parseInt(days || '30');
            const limitNum = Math.min(parseInt(limit || '200'), 500);
            const accountId = request.accountId!;

            const accounts = await AdsService.getAdAccounts(accountId);
            const adAccount = accounts.find(a => a.id === adAccountId);

            if (!adAccount) {
                return reply.code(404).send({ error: 'Ad account not found' });
            }

            if (adAccount.platform !== 'GOOGLE') {
                return reply.code(400).send({ error: 'Shopping product data is only available for Google Ads accounts' });
            }

            const products = await AdsService.getGoogleShoppingProducts(adAccountId, daysNum, limitNum);
            return products;
        } catch (error: any) {
            Logger.error('Failed to fetch shopping products', { error });
            return reply.code(500).send({ error: error.message });
        }
    });

    // GET /api/ads/campaigns/:campaignId/adgroups - Fetch Ad Groups for a specific campaign (searches all Google accounts)
    fastify.get<{ Params: { campaignId: string } }>('/campaigns/:campaignId/adgroups', async (request, reply) => {
        const accountId = request.accountId;
        if (!accountId) return reply.code(400).send({ error: 'No account selected' });

        try {
            const { campaignId } = request.params;
            const accounts = await AdsService.getAdAccounts(accountId);
            // Prioritize Google for now as ad groups are a Google concept (AdSets in Meta)
            const googleAccounts = accounts.filter(a => a.platform === 'GOOGLE');

            for (const account of googleAccounts) {
                try {
                    const adGroups = await AdsService.getGoogleCampaignAdGroups(account.id, campaignId);
                    if (adGroups && adGroups.length > 0) {
                        return adGroups;
                    }
                } catch (e) {
                    // Continue to next account if this one fails or campaign not found
                    Logger.warn(`Campaign ${campaignId} not found in account ${account.id}`, { error: e });
                }
            }

            // If we are here, we didn't find the campaign or it has no ad groups.
            return [];

        } catch (error: any) {
            Logger.error('Failed to fetch ad groups', { error });
            return reply.code(500).send({ error: error.message });
        }
    });

    // GET /api/ads/:adAccountId/campaigns/:campaignId/products - Fetch products for a specific campaign
    fastify.get<{ Params: { adAccountId: string; campaignId: string } }>('/:adAccountId/campaigns/:campaignId/products', async (request, reply) => {
        try {
            const { adAccountId, campaignId } = request.params;
            const { days } = request.query as { days?: string };
            const daysNum = parseInt(days || '30');
            const accountId = request.accountId!;

            const accounts = await AdsService.getAdAccounts(accountId);
            const adAccount = accounts.find(a => a.id === adAccountId);

            if (!adAccount) {
                return reply.code(404).send({ error: 'Ad account not found' });
            }

            if (adAccount.platform !== 'GOOGLE') {
                return reply.code(400).send({ error: 'Campaign products are only available for Google Ads accounts' });
            }

            const products = await AdsService.getGoogleCampaignProducts(adAccountId, campaignId, daysNum);
            return products;
        } catch (error: any) {
            Logger.error('Failed to fetch campaign products', { error });
            return reply.code(500).send({ error: error.message });
        }
    });

    // GET /api/ads/:adAccountId/analysis
    fastify.get<{ Params: { adAccountId: string } }>('/:adAccountId/analysis', async (request, reply) => {
        try {
            const accountId = request.accountId;
            if (!accountId) return reply.code(400).send({ error: 'No account selected' });

            const { AdsTools } = await import('../services/tools/AdsTools');
            const suggestions = await AdsTools.getAdOptimizationSuggestions(accountId);

            return suggestions;
        } catch (error: any) {
            Logger.error('Failed to fetch ad analysis', { error });
            return reply.code(500).send({ error: error.message });
        }
    });

    // PATCH /api/ads/:adAccountId/complete-setup
    fastify.patch<{ Params: { adAccountId: string }; Body: { customerId: string; name?: string } }>('/:adAccountId/complete-setup', async (request, reply) => {
        const accountId = request.accountId;
        if (!accountId) return reply.code(400).send({ error: 'No account selected' });

        try {
            const { adAccountId } = request.params;
            const { customerId, name } = request.body;

            if (!customerId) {
                return reply.code(400).send({ error: 'Customer ID is required' });
            }

            const accounts = await AdsService.getAdAccounts(accountId);
            const adAccount = accounts.find(a => a.id === adAccountId);

            if (!adAccount) {
                return reply.code(404).send({ error: 'Ad account not found' });
            }

            if (adAccount.externalId !== 'PENDING_SETUP') {
                return reply.code(400).send({ error: 'Account is already configured' });
            }

            await AdsService.updateAccount(adAccountId, {
                name: name || `Google Ads (${customerId})`
            });

            await prisma.adAccount.update({
                where: { id: adAccountId },
                data: { externalId: customerId.replace(/-/g, '') }
            });

            Logger.info('Google Ads account setup completed', { adAccountId, customerId });

            return { success: true, message: 'Google Ads account configured successfully' };
        } catch (error: any) {
            Logger.error('Failed to complete ad account setup', { error });
            return reply.code(500).send({ error: error.message });
        }
    });
    // POST /api/ads/execute-action - Execute an actionable recommendation
    fastify.post<{ Body: { actionType: string; platform: 'google' | 'meta'; campaignId: string; parameters: any } }>('/execute-action', async (request, reply) => {
        const accountId = request.accountId;
        if (!accountId) return reply.code(400).send({ error: 'No account selected' });

        try {
            const { actionType, platform, campaignId, parameters } = request.body;
            const { amount, status } = parameters || {};

            Logger.info('Executing Ad Action', { accountId, actionType, platform, campaignId, parameters });

            // 1. Find the specific Ad Account for this campaign
            // We need to find which ad account owns this campaign.
            // Since we don't pass adAccountId explicitly in the action payload from UI (yet), 
            // we have to look it up or rely on the UI passing it.
            // The ActionableRecommendation currently has 'campaignId' but 'adAccountId' might be missing in `BudgetAction`.
            // However, `campaignId` in the recommendations is usually globally unique-ish BUT for safety we need the adAccountId.
            // ActionableType `BudgetAction` has `campaignId`. 
            // The UI ActionableRecommendationCard usually has context.
            // Let's assume the UI passes `adAccountId` in `parameters` or we search for it.

            // RECOMMENDATION: Update UI/Type to include adAccountId.
            // For now, let's search all connected accounts of that platform for the campaign.
            // This is inefficient but works for Phase 1.

            const accounts = await AdsService.getAdAccounts(accountId);
            const platformAccounts = accounts.filter(a => a.platform === platform.toUpperCase());

            if (platformAccounts.length === 0) {
                return reply.code(400).send({ error: `No connected ${platform} accounts found` });
            }

            let targetAccount = null;
            // Iterate to find which account owns this campaign (if we have to).
            // But actually, for Google, "campaignId" is unique enough within a customer, but we need the customer ID (adAccount.externalId).
            // Let's assume the UI sends 'adAccountId' if available, otherwise we default to the first one or try all.
            // BETTER APPROACH: The `campaignId` in `MultiPeriodAnalyzer` came from `GoogleAdsTools` or `MetaAdsTools`. 
            // In `GoogleAdsTools`, `allCampaigns` objects had keys.
            // The `ActionableRecommendation` doesn't explicitly store `adAccountId`.
            // We'll try to execute against the first matching account or iterate.

            // Simplification for Phase 1: Try the first account of that platform, or require adAccountId in parameters.
            let adAccountId = parameters.adAccountId;

            if (!adAccountId) {
                // Heuristic: If only 1 account, use it.
                if (platformAccounts.length === 1) {
                    targetAccount = platformAccounts[0];
                    adAccountId = targetAccount.id;
                } else {
                    // If multiple, we really need the ID.
                    // For now, try all (sequence) until success? That's risky for writes.
                    // Return error.
                    return reply.code(400).send({ error: 'Multiple ad accounts found. Please specify adAccountId.' });
                }
            } else {
                targetAccount = platformAccounts.find(a => a.id === adAccountId);
            }

            if (!targetAccount) {
                return reply.code(404).send({ error: 'Target ad account not found' });
            }

            let success = false;

            if (platform === 'meta') {
                if (actionType === 'budget_increase' || actionType === 'budget_decrease') {
                    if (!amount) return reply.code(400).send({ error: 'Amount is required for budget update' });
                    success = await AdsService.updateMetaCampaignBudget(targetAccount.id, campaignId, amount);
                } else if (actionType === 'pause') {
                    success = await AdsService.updateMetaCampaignStatus(targetAccount.id, campaignId, 'PAUSED');
                } else if (actionType === 'enable') {
                    success = await AdsService.updateMetaCampaignStatus(targetAccount.id, campaignId, 'ACTIVE');
                }
            } else if (platform === 'google') {
                if (actionType === 'budget_increase' || actionType === 'budget_decrease') {
                    if (!amount) return reply.code(400).send({ error: 'Amount is required for budget update' });
                    success = await AdsService.updateGoogleCampaignBudget(targetAccount.id, campaignId, amount);
                } else if (actionType === 'pause') {
                    success = await AdsService.updateGoogleCampaignStatus(targetAccount.id, campaignId, 'PAUSED');
                } else if (actionType === 'enable') {
                    success = await AdsService.updateGoogleCampaignStatus(targetAccount.id, campaignId, 'ENABLED');
                } else if (actionType === 'keyword_add') {
                    // Parameters for keyword add
                    // We need adGroupId, keywordText, matchType, cpcBid
                    const { adGroupId, keyword, matchType, bid } = parameters;
                    if (!adGroupId || !keyword || !matchType) {
                        return reply.code(400).send({ error: 'Missing required fields for keyword add: adGroupId, keyword, matchType' });
                    }
                    success = await AdsService.addGoogleSearchKeyword(
                        targetAccount.id,
                        campaignId,
                        adGroupId,
                        keyword,
                        matchType,
                        bid ? parseFloat(bid) : undefined
                    );
                }
            }

            if (success) {
                Logger.info('Ad Action Executed Successfully', { campaignId, actionType });
                // TODO: Insert into ActionLog
                return { success: true };
            } else {
                return reply.code(500).send({ error: 'Failed to execute action' });
            }

        } catch (error: any) {
            Logger.error('Ad Action Execution Failed', { error });
            return reply.code(500).send({ error: error.message });
        }
    });

    // POST /api/ads/schedule-action - Schedule an action for later execution
    interface ScheduleActionBody {
        actionType: string;
        platform: 'google' | 'meta';
        campaignId: string;
        campaignName?: string;
        parameters: {
            currentBudget?: number;
            newBudget?: number;
            changeAmount?: number;
            adAccountId?: string;
        };
        scheduledFor: string; // ISO date string
        recommendationId?: string;
    }

    fastify.post<{ Body: ScheduleActionBody }>('/schedule-action', async (request, reply) => {
        const accountId = request.accountId;
        if (!accountId) return reply.code(400).send({ error: 'No account selected' });

        try {
            const { actionType, platform, campaignId, campaignName, parameters, scheduledFor, recommendationId } = request.body;

            if (!scheduledFor) {
                return reply.code(400).send({ error: 'scheduledFor date is required' });
            }

            const scheduledDate = new Date(scheduledFor);
            if (scheduledDate <= new Date()) {
                return reply.code(400).send({ error: 'Scheduled time must be in the future' });
            }

            // Find ad account
            const accounts = await AdsService.getAdAccounts(accountId);
            const platformAccounts = accounts.filter(a => a.platform === platform.toUpperCase());

            let adAccountId = parameters.adAccountId;
            if (!adAccountId && platformAccounts.length === 1) {
                adAccountId = platformAccounts[0].id;
            }

            // Create scheduled action
            const scheduled = await prisma.scheduledAdAction.create({
                data: {
                    accountId,
                    actionType,
                    platform,
                    adAccountId,
                    campaignId,
                    campaignName,
                    parameters: parameters as any,
                    scheduledFor: scheduledDate,
                    status: 'pending',
                    recommendationId
                }
            });

            Logger.info('Ad Action Scheduled', {
                id: scheduled.id,
                accountId,
                actionType,
                campaignId,
                scheduledFor: scheduledDate.toISOString()
            });

            return {
                success: true,
                scheduledAction: {
                    id: scheduled.id,
                    scheduledFor: scheduled.scheduledFor,
                    status: scheduled.status
                }
            };

        } catch (error: any) {
            Logger.error('Failed to schedule ad action', { error });
            return reply.code(500).send({ error: error.message });
        }
    });

    // GET /api/ads/scheduled-actions - List scheduled actions
    fastify.get('/scheduled-actions', async (request, reply) => {
        const accountId = request.accountId;
        if (!accountId) return reply.code(400).send({ error: 'No account selected' });

        try {
            const actions = await prisma.scheduledAdAction.findMany({
                where: { accountId },
                orderBy: { scheduledFor: 'asc' },
                take: 50
            });

            return actions;
        } catch (error: any) {
            Logger.error('Failed to list scheduled actions', { error });
            return reply.code(500).send({ error: error.message });
        }
    });

    // DELETE /api/ads/scheduled-actions/:id - Cancel a scheduled action
    fastify.delete<{ Params: { id: string } }>('/scheduled-actions/:id', async (request, reply) => {
        const accountId = request.accountId;
        if (!accountId) return reply.code(400).send({ error: 'No account selected' });

        try {
            const { id } = request.params;

            const action = await prisma.scheduledAdAction.findFirst({
                where: { id, accountId, status: 'pending' }
            });

            if (!action) {
                return reply.code(404).send({ error: 'Scheduled action not found or already executed' });
            }

            await prisma.scheduledAdAction.update({
                where: { id },
                data: { status: 'cancelled' }
            });

            Logger.info('Scheduled action cancelled', { id, accountId });

            return { success: true };
        } catch (error: any) {
            Logger.error('Failed to cancel scheduled action', { error });
            return reply.code(500).send({ error: error.message });
        }
    });

    // POST /api/ads/create-campaign - Create a new ad campaign (Wizard)
    fastify.post<{ Body: { type: 'SEARCH' | 'PMAX'; name: string; budget: number; keywords?: any[]; adCopy?: any; productIds?: string[] } }>('/create-campaign', async (request, reply) => {
        const accountId = request.accountId;
        if (!accountId) return reply.code(400).send({ error: 'No account selected' });

        try {
            const { type, name, budget, keywords, adCopy, productIds } = request.body;
            const { CampaignBuilderService } = await import('../services/ads/CampaignBuilderService');

            // We need to resolve the adAccountId. 
            // Phase 3 Wizard should ideally pass it. For now, find Google Account.
            // Simplification: Pick the first Google account.
            const accounts = await AdsService.getAdAccounts(accountId);
            const googleAccount = accounts.find(a => a.platform === 'GOOGLE');

            if (!googleAccount) {
                return reply.code(400).send({ error: 'No Google Ads account connected' });
            }

            if (type === 'SEARCH') {
                if (!keywords || !adCopy) {
                    return reply.code(400).send({ error: 'Keywords and Ad Copy are required for Search campaigns' });
                }
                const result = await CampaignBuilderService.createSearchCampaign(
                    googleAccount.id,
                    { name, dailyBudget: budget },
                    keywords,
                    adCopy
                );
                return result;
            } else if (type === 'PMAX') {
                // Placeholder for PMax
                return reply.code(501).send({ error: 'Performance Max creation not yet enabled' });
            }

            return reply.code(400).send({ error: 'Invalid campaign type' });

        } catch (error: any) {
            Logger.error('Failed to create campaign', { error });
            return reply.code(500).send({ error: error.message });
        }
    });

};

export default adsRoutes;
