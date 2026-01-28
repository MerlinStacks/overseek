/**
 * Ads Route - Fastify Plugin
 * 
 * Ad account management, insights, and campaign data endpoints.
 * Action execution delegated to ads/actions.ts sub-route.
 */

import { FastifyPluginAsync } from 'fastify';
import { AdsService } from '../services/ads';
import { requireAuthFastify } from '../middleware/auth';
import { Logger } from '../utils/logger';
import { prisma } from '../utils/prisma';
import { adsActionsRoutes } from './ads/actions';

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

    // Register action sub-routes
    await fastify.register(adsActionsRoutes);

    // =====================================================
    // AD ACCOUNT MANAGEMENT
    // =====================================================

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
                platform, externalId, accessToken, refreshToken, name, currency
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

    // =====================================================
    // INSIGHTS AND PERFORMANCE DATA
    // =====================================================

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

    // GET /api/ads/campaigns/:campaignId/adgroups
    fastify.get<{ Params: { campaignId: string } }>('/campaigns/:campaignId/adgroups', async (request, reply) => {
        const accountId = request.accountId;
        if (!accountId) return reply.code(400).send({ error: 'No account selected' });

        try {
            const { campaignId } = request.params;
            const accounts = await AdsService.getAdAccounts(accountId);
            const googleAccounts = accounts.filter(a => a.platform === 'GOOGLE');

            for (const account of googleAccounts) {
                try {
                    const adGroups = await AdsService.getGoogleCampaignAdGroups(account.id, campaignId);
                    if (adGroups && adGroups.length > 0) {
                        return adGroups;
                    }
                } catch (e) {
                    Logger.warn(`Campaign ${campaignId} not found in account ${account.id}`, { error: e });
                }
            }

            return [];
        } catch (error: any) {
            Logger.error('Failed to fetch ad groups', { error });
            return reply.code(500).send({ error: error.message });
        }
    });

    // GET /api/ads/:adAccountId/campaigns/:campaignId/products
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
};

export default adsRoutes;
