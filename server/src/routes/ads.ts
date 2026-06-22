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
import { adCopyRoutes } from './ads/copy';
import intelligenceRoutes from './ads/intelligence';
import { getAdsAccountIdOrReply, parsePositiveInt } from './ads/routeHelpers';

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

    const getAdAccountOrReply = async (
        accountId: string,
        adAccountId: string,
        reply: any,
    ) => {
        const accounts = await AdsService.getAdAccounts(accountId);
        const adAccount = accounts.find((account) => account.id === adAccountId);
        if (!adAccount) {
            reply.code(404).send({ error: 'Ad account not found' });
            return null;
        }
        return adAccount;
    };

    const ensureGoogleAdAccountOrReply = (
        adAccount: { platform: string },
        reply: any,
        notGoogleError: string,
    ) => {
        if (adAccount.platform !== 'GOOGLE') {
            reply.code(400).send({ error: notGoogleError });
            return null;
        }
        return adAccount;
    };

    const runByPlatformOrReply = async <T>(
        adAccount: { platform: string },
        handlers: {
            google: () => Promise<T>;
            meta: () => Promise<T>;
            unsupportedMessage: string;
        },
        reply: any,
    ): Promise<T | null> => {
        if (adAccount.platform === 'GOOGLE') return handlers.google();
        if (adAccount.platform === 'META') return handlers.meta();
        reply.code(400).send({ error: `${handlers.unsupportedMessage}: ${adAccount.platform}` });
        return null;
    };

    const resolveAdAccountFromParamsOrReply = async (
        request: { params: { adAccountId: string } },
        reply: any,
    ) => {
        const accountId = getAdsAccountIdOrReply(request, reply);
        if (!accountId) return null;

        const { adAccountId } = request.params;
        const adAccount = await getAdAccountOrReply(accountId, adAccountId, reply);
        if (!adAccount) return null;

        return { accountId, adAccountId, adAccount };
    };

    const parseDaysQuery = (request: { query: { days?: string } }, fallback: number = 30) =>
        parsePositiveInt(request.query.days, fallback);

    const parseDaysAndLimitQuery = (
        request: { query: { days?: string; limit?: string } },
        defaults: { days?: number; limit?: number } = {},
    ) => {
        const days = parsePositiveInt(request.query.days, defaults.days ?? 30);
        const limit = Math.min(parsePositiveInt(request.query.limit, defaults.limit ?? 200), 500);
        return { days, limit };
    };

    const resolveGoogleAdAccountFromParamsOrReply = async (
        request: { params: { adAccountId: string } },
        reply: any,
        notGoogleError: string,
    ) => {
        const resolved = await resolveAdAccountFromParamsOrReply(request, reply);
        if (!resolved) return null;
        const googleAdAccount = ensureGoogleAdAccountOrReply(resolved.adAccount, reply, notGoogleError);
        if (!googleAdAccount) return null;
        return { ...resolved, adAccount: googleAdAccount };
    };

    const maskAdAccountTokens = <T extends { accessToken?: string | null; refreshToken?: string | null }>(adAccount: T) => ({
        ...adAccount,
        accessToken: adAccount.accessToken ? `${adAccount.accessToken.substring(0, 10)}...` : null,
        refreshToken: adAccount.refreshToken ? '********' : null,
    });

    const getGoogleAccounts = async (accountId: string) => {
        const accounts = await AdsService.getAdAccounts(accountId);
        return accounts.filter((account) => account.platform === 'GOOGLE');
    };

    // Register action sub-routes
    await fastify.register(adsActionsRoutes);

    // Register ad copy generation routes
    await fastify.register(adCopyRoutes, { prefix: '/copy' });


    // Register SC↔Ads intelligence routes (Phase 6: Search Intelligence)
    await fastify.register(intelligenceRoutes, { prefix: '/intelligence' });

    // =====================================================
    // AD ACCOUNT MANAGEMENT
    // =====================================================



    // GET /api/ads - List all connected ad accounts
    fastify.get('/', async (request, reply) => {
        const accountId = getAdsAccountIdOrReply(request, reply);
        if (!accountId) return;

        try {
            const accounts = await AdsService.getAdAccounts(accountId);
            const safeAccounts = accounts.map(maskAdAccountTokens);
            return safeAccounts;
        } catch (error: any) {
            Logger.error('Failed to list ad accounts', { error });
            return reply.code(500).send({ error: 'Failed to list ad accounts' });
        }
    });

    // PATCH /api/ads/:adAccountId - Edit ad account credentials
    fastify.patch<{ Params: { adAccountId: string }; Body: AdAccountBody }>('/:adAccountId', async (request, reply) => {
        const accountId = getAdsAccountIdOrReply(request, reply);
        if (!accountId) return;

        try {
            const { adAccountId } = request.params;
            const { name, accessToken, externalId, refreshToken } = request.body;

            const adAccount = await getAdAccountOrReply(accountId, adAccountId, reply);
            if (!adAccount) return;

            const updateData: { name?: string; accessToken?: string; refreshToken?: string } = {};
            if (name !== undefined) updateData.name = name;
            if (accessToken !== undefined) updateData.accessToken = accessToken;
            if (refreshToken !== undefined) updateData.refreshToken = refreshToken;

            const updated = await AdsService.updateAccount(adAccountId, updateData);

            if (externalId !== undefined) {
                // Normalize Google externalId: strip dashes for consistency with complete-setup
                const normalizedExtId = adAccount.platform === 'GOOGLE'
                    ? externalId.replace(/-/g, '')
                    : externalId;
                await prisma.adAccount.update({
                    where: { id: adAccountId },
                    data: { externalId: normalizedExtId }
                });
            }

            Logger.info('Ad account updated', { adAccountId, fields: Object.keys(updateData) });

            return {
                ...maskAdAccountTokens(updated),
                externalId: externalId || adAccount.externalId,
            };
        } catch (error: any) {
            Logger.error('Failed to update ad account', { error });
            return reply.code(500).send({ error: 'Failed to update ad account' });
        }
    });

    // POST /api/ads/connect - Connect a new ad account
    fastify.post<{ Body: AdAccountBody }>('/connect', async (request, reply) => {
        const accountId = getAdsAccountIdOrReply(request, reply);
        if (!accountId) return;

        try {
            const { platform, externalId, accessToken, refreshToken, name, currency } = request.body;

            if (!platform || !externalId || !accessToken) {
                return reply.code(400).send({ error: 'Missing required fields: platform, externalId, accessToken' });
            }

            // Normalize Google externalId: strip dashes for consistency with complete-setup
            const normalizedExternalId = platform === 'GOOGLE' ? externalId.replace(/-/g, '') : externalId;

            const adAccount = await AdsService.connectAccount(accountId, {
                platform, externalId: normalizedExternalId, accessToken, refreshToken, name, currency
            });

            return maskAdAccountTokens(adAccount);
        } catch (error: any) {
            Logger.error('Failed to connect ad account', { error });
            return reply.code(500).send({ error: 'Failed to connect ad account' });
        }
    });

    // DELETE /api/ads/:adAccountId - Disconnect ad account
    fastify.delete<{ Params: { adAccountId: string } }>('/:adAccountId', async (request, reply) => {
        const accountId = getAdsAccountIdOrReply(request, reply);
        if (!accountId) return;

        try {
            const { adAccountId } = request.params;

            const adAccount = await getAdAccountOrReply(accountId, adAccountId, reply);
            if (!adAccount) return;

            await AdsService.disconnectAccount(adAccountId);
            return { success: true };
        } catch (error: any) {
            Logger.error('Failed to disconnect ad account', { error });
            return reply.code(500).send({ error: 'Failed to disconnect ad account' });
        }
    });

    // PATCH /api/ads/:adAccountId/complete-setup
    fastify.patch<{ Params: { adAccountId: string }; Body: { customerId: string; name?: string } }>('/:adAccountId/complete-setup', async (request, reply) => {
        const accountId = getAdsAccountIdOrReply(request, reply);
        if (!accountId) return;

        try {
            const { adAccountId } = request.params;
            const { customerId, name } = request.body;

            if (!customerId) {
                return reply.code(400).send({ error: 'Customer ID is required' });
            }

            const adAccount = await getAdAccountOrReply(accountId, adAccountId, reply);
            if (!adAccount) return;

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
            const resolved = await resolveAdAccountFromParamsOrReply(request, reply);
            if (!resolved) return;
            const { adAccountId, adAccount } = resolved;

            const insights = await runByPlatformOrReply(
                adAccount,
                {
                    google: () => AdsService.getGoogleInsights(adAccountId),
                    meta: () => AdsService.getMetaInsights(adAccountId),
                    unsupportedMessage: 'Unsupported platform',
                },
                reply,
            );

            return insights || { spend: 0, impressions: 0, clicks: 0, roas: 0 };
        } catch (error: any) {
            Logger.error('Failed to fetch ad insights', { error });
            return reply.code(500).send({ error: error.message });
        }
    });

    // GET /api/ads/:adAccountId/campaigns
    fastify.get<{ Params: { adAccountId: string } }>('/:adAccountId/campaigns', async (request, reply) => {
        try {
            const resolved = await resolveAdAccountFromParamsOrReply(request, reply);
            if (!resolved) return;
            const { adAccountId, adAccount } = resolved;
            const daysNum = parseDaysQuery(request);

            const campaigns = await runByPlatformOrReply(
                adAccount,
                {
                    google: () => AdsService.getGoogleCampaignInsights(adAccountId, daysNum),
                    meta: () => AdsService.getMetaCampaignInsights(adAccountId, daysNum),
                    unsupportedMessage: 'Campaign breakdown not supported for platform',
                },
                reply,
            );
            if (!campaigns) return;

            return campaigns;
        } catch (error: any) {
            Logger.error('Failed to fetch campaign insights', { error });
            return reply.code(500).send({ error: error.message });
        }
    });

    // GET /api/ads/:adAccountId/trends
    fastify.get<{ Params: { adAccountId: string } }>('/:adAccountId/trends', async (request, reply) => {
        try {
            const resolved = await resolveAdAccountFromParamsOrReply(request, reply);
            if (!resolved) return;
            const { adAccountId, adAccount } = resolved;
            const daysNum = parseDaysQuery(request);

            const trends = await runByPlatformOrReply(
                adAccount,
                {
                    google: () => AdsService.getGoogleDailyTrends(adAccountId, daysNum),
                    meta: () => AdsService.getMetaDailyTrends(adAccountId, daysNum),
                    unsupportedMessage: 'Trend data not supported for platform',
                },
                reply,
            );
            if (!trends) return;

            return trends;
        } catch (error: any) {
            Logger.error('Failed to fetch daily trends', { error });
            return reply.code(500).send({ error: error.message });
        }
    });

    // GET /api/ads/:adAccountId/shopping-products
    fastify.get<{ Params: { adAccountId: string } }>('/:adAccountId/shopping-products', async (request, reply) => {
        try {
            const { days: daysNum, limit: limitNum } = parseDaysAndLimitQuery(request);
            const resolved = await resolveGoogleAdAccountFromParamsOrReply(
                request,
                reply,
                'Shopping product data is only available for Google Ads accounts',
            );
            if (!resolved) return;
            const { adAccountId } = resolved;

            const products = await AdsService.getGoogleShoppingProducts(adAccountId, daysNum, limitNum);
            return products;
        } catch (error: any) {
            Logger.error('Failed to fetch shopping products', { error });
            return reply.code(500).send({ error: error.message });
        }
    });

    // GET /api/ads/campaigns/:campaignId/adgroups
    fastify.get<{ Params: { campaignId: string } }>('/campaigns/:campaignId/adgroups', async (request, reply) => {
        const accountId = getAdsAccountIdOrReply(request, reply);
        if (!accountId) return;

        try {
            const { campaignId } = request.params;
            const googleAccounts = await getGoogleAccounts(accountId);

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
            const { campaignId } = request.params;
            const daysNum = parseDaysQuery(request);
            const resolved = await resolveGoogleAdAccountFromParamsOrReply(
                request,
                reply,
                'Campaign products are only available for Google Ads accounts',
            );
            if (!resolved) return;
            const { adAccountId } = resolved;

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
            const accountId = getAdsAccountIdOrReply(request, reply);
            if (!accountId) return;

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
