/**
 * Meta OAuth Routes - Fastify Plugin
 * Meta Ads token exchange and Messaging OAuth (Facebook/Instagram).
 * 
 * UPDATED 2026-02: Uses MetaTokenService for proper token lifecycle.
 * Fixed 24-hour expiration bug by removing silent fallback to short-lived tokens.
 */

import { FastifyPluginAsync } from 'fastify';
import { AdsService } from '../services/ads';
import { requireAuthFastify } from '../middleware/auth';
import { Logger } from '../utils/logger';
import { prisma } from '../utils/prisma';
import { MetaMessagingService } from '../services/messaging/MetaMessagingService';
import { MetaTokenService } from '../services/meta/MetaTokenService';

/** Current Meta Graph API version */
const API_VERSION = 'v24.0';

const oauthMetaRoutes: FastifyPluginAsync = async (fastify) => {
    /**
     * POST /meta/exchange - Exchange short-lived token for long-lived
     */
    fastify.post('/meta/exchange', { preHandler: requireAuthFastify }, async (request, reply) => {
        try {
            const { shortLivedToken } = request.body as { shortLivedToken?: string };
            if (!shortLivedToken) return reply.code(400).send({ error: 'Missing shortLivedToken' });

            // Use MetaTokenService for proper error handling
            const result = await MetaTokenService.exchangeForLongLived(shortLivedToken, 'META_ADS');
            return {
                accessToken: result.accessToken,
                expiresIn: result.expiresIn,
                expiresAt: result.expiresAt.toISOString()
            };
        } catch (error: any) {
            Logger.error('Meta token exchange failed', { error });
            return reply.code(500).send({ error: error.message });
        }
    });

    /**
     * GET /meta/ads/authorize - Initiate Meta Ads OAuth
     */
    fastify.get('/meta/ads/authorize', { preHandler: requireAuthFastify }, async (request, reply) => {
        try {
            const accountId = request.accountId;
            const query = request.query as { redirect?: string; reconnectId?: string };
            const frontendRedirect = query.redirect || '/settings?tab=ads';
            const reconnectId = query.reconnectId;

            if (!accountId) return reply.code(400).send({ error: 'No account selected' });

            const { appId } = await MetaTokenService.getCredentials('META_ADS');
            const state = Buffer.from(JSON.stringify({ accountId, frontendRedirect, reconnectId })).toString('base64');

            const apiUrl = process.env.API_URL?.replace(/\/+$/, '');
            const callbackUrl = apiUrl
                ? `${apiUrl}/api/oauth/meta/ads/callback`
                : `${request.protocol}://${request.hostname}/api/oauth/meta/ads/callback`;

            const scopes = 'ads_read,ads_management,business_management';
            const authUrl = `https://www.facebook.com/${API_VERSION}/dialog/oauth?client_id=${appId}&redirect_uri=${encodeURIComponent(callbackUrl)}&scope=${scopes}&state=${state}`;
            return { authUrl };
        } catch (error: any) {
            Logger.error('Meta Ads OAuth init failed', { error });
            return reply.code(500).send({ error: error.message });
        }
    });

    /**
     * GET /meta/ads/callback - Handle Meta Ads OAuth callback
     */
    fastify.get('/meta/ads/callback', async (request, reply) => {
        const appUrl = process.env.APP_URL?.replace(/\/+$/, '') || 'http://localhost:5173';
        let frontendRedirect = `${appUrl}/settings?tab=ads`;

        try {
            const query = request.query as { code?: string; state?: string; error?: string; error_description?: string };
            const { code, state, error, error_description } = query;

            if (error) {
                Logger.warn('[MetaAdsOAuth] OAuth denied by user', { error, error_description });
                return reply.redirect(`${frontendRedirect}&error=oauth_denied&message=${encodeURIComponent(error_description || error)}`);
            }
            if (!code || !state) return reply.redirect(`${frontendRedirect}&error=missing_params`);

            let stateData: { accountId: string; frontendRedirect: string; reconnectId?: string };
            try {
                stateData = JSON.parse(Buffer.from(state, 'base64').toString('utf-8'));
                // State contains relative path, prepend appUrl
                frontendRedirect = stateData.frontendRedirect
                    ? `${appUrl}${stateData.frontendRedirect}`
                    : frontendRedirect;
            } catch {
                return reply.redirect(`${frontendRedirect}&error=invalid_state`);
            }

            const { appId, appSecret } = await MetaTokenService.getCredentials('META_ADS');

            const apiUrl = process.env.API_URL?.replace(/\/+$/, '');
            const callbackUrl = apiUrl
                ? `${apiUrl}/api/oauth/meta/ads/callback`
                : `${request.protocol}://${request.hostname}/api/oauth/meta/ads/callback`;

            // Step 1: Exchange code for short-lived token
            Logger.info('[MetaAdsOAuth] Exchanging code for access token');
            const tokenResponse = await fetch(
                `https://graph.facebook.com/${API_VERSION}/oauth/access_token?client_id=${appId}&redirect_uri=${encodeURIComponent(callbackUrl)}&client_secret=${appSecret}&code=${code}`
            );
            const tokenData = await tokenResponse.json() as any;

            if (tokenData.error) {
                Logger.error('[MetaAdsOAuth] Code exchange failed', { error: tokenData.error });
                throw new Error(tokenData.error.message);
            }

            // Step 2: Exchange for long-lived token
            Logger.info('[MetaAdsOAuth] Exchanging for long-lived token');
            const tokenResult = await MetaTokenService.exchangeForLongLived(tokenData.access_token, 'META_ADS');

            // If reconnecting an existing account, update its tokens
            if (stateData.reconnectId) {
                await AdsService.updateAccountTokens(stateData.reconnectId, {
                    accessToken: tokenResult.accessToken
                });
                Logger.info('[MetaAdsOAuth] Reconnected existing account', { accountId: stateData.reconnectId });
                return reply.redirect(`${frontendRedirect}&success=meta_ads_reconnected`);
            }

            // Step 3: Get ad accounts for user selection
            const adAccountsResponse = await fetch(
                `https://graph.facebook.com/${API_VERSION}/me/adaccounts?fields=id,name,account_status,currency&access_token=${tokenResult.accessToken}`
            );
            const adAccountsData = await adAccountsResponse.json() as any;

            if (!adAccountsData.data || adAccountsData.data.length === 0) {
                return reply.redirect(`${frontendRedirect}&error=no_ad_accounts&message=${encodeURIComponent('No ad accounts found. Make sure you have access to Meta Ads.')}`);
            }

            // For now, connect the first active ad account (status 1 = active)
            const activeAccount = adAccountsData.data.find((acc: any) => acc.account_status === 1) || adAccountsData.data[0];

            await AdsService.connectAccount(stateData.accountId, {
                platform: 'META',
                externalId: activeAccount.id,
                accessToken: tokenResult.accessToken,
                name: activeAccount.name || `Meta Ads (${activeAccount.id})`,
                currency: activeAccount.currency
            });

            Logger.info('[MetaAdsOAuth] Meta Ads account connected', {
                accountId: stateData.accountId,
                adAccountId: activeAccount.id
            });
            return reply.redirect(`${frontendRedirect}&success=meta_ads_connected`);

        } catch (error: any) {
            Logger.error('[MetaAdsOAuth] Callback failed', { error: error.message });
            return reply.redirect(`${frontendRedirect}&error=oauth_failed&message=${encodeURIComponent(error.message)}`);
        }
    });

    /**
     * GET /meta/messaging/authorize - Initiate Meta Messaging OAuth
     */
    fastify.get('/meta/messaging/authorize', { preHandler: requireAuthFastify }, async (request, reply) => {
        try {
            const accountId = request.accountId;
            const query = request.query as { redirect?: string };
            const frontendRedirect = query.redirect || '/settings?tab=channels';

            if (!accountId) return reply.code(400).send({ error: 'No account selected' });

            // Use MetaTokenService for unified credential access
            const { appId } = await MetaTokenService.getCredentials('META_MESSAGING');
            const state = Buffer.from(JSON.stringify({ accountId, frontendRedirect })).toString('base64');

            const apiUrl = process.env.API_URL?.replace(/\/+$/, '');
            const callbackUrl = apiUrl
                ? `${apiUrl}/api/oauth/meta/messaging/callback`
                : `${request.protocol}://${request.hostname}/api/oauth/meta/messaging/callback`;

            const scopes = 'pages_messaging,pages_manage_metadata,pages_show_list,instagram_basic,instagram_manage_messages';
            const authUrl = `https://www.facebook.com/${API_VERSION}/dialog/oauth?client_id=${appId}&redirect_uri=${encodeURIComponent(callbackUrl)}&scope=${scopes}&state=${state}`;
            return { authUrl };
        } catch (error: any) {
            Logger.error('Meta messaging OAuth init failed', { error });
            return reply.code(500).send({ error: error.message });
        }
    });

    /**
     * GET /meta/messaging/callback - Handle Meta Messaging OAuth callback
     */
    fastify.get('/meta/messaging/callback', async (request, reply) => {
        const appUrl = process.env.APP_URL?.replace(/\/+$/, '') || 'http://localhost:5173';
        let frontendRedirect = `${appUrl}/settings?tab=channels`;

        try {
            const query = request.query as { code?: string; state?: string; error?: string; error_description?: string };
            const { code, state, error, error_description } = query;

            if (error) {
                Logger.warn('[MetaOAuth] OAuth denied by user', { error, error_description });
                return reply.redirect(`${frontendRedirect}&error=oauth_denied&message=${encodeURIComponent(error_description || error)}`);
            }
            if (!code || !state) return reply.redirect(`${frontendRedirect}&error=missing_params`);

            const stateData = JSON.parse(Buffer.from(state, 'base64').toString('utf-8'));
            // State contains relative path, prepend appUrl
            frontendRedirect = stateData.frontendRedirect
                ? `${appUrl}${stateData.frontendRedirect}`
                : frontendRedirect;
            const accountId = stateData.accountId;

            // Get credentials via unified service
            const { appId, appSecret } = await MetaTokenService.getCredentials('META_MESSAGING');

            const apiUrl = process.env.API_URL?.replace(/\/+$/, '');
            const callbackUrl = apiUrl
                ? `${apiUrl}/api/oauth/meta/messaging/callback`
                : `${request.protocol}://${request.hostname}/api/oauth/meta/messaging/callback`;

            // Step 1: Exchange code for short-lived token
            Logger.info('[MetaOAuth] Exchanging code for access token');
            const tokenResponse = await fetch(
                `https://graph.facebook.com/${API_VERSION}/oauth/access_token?client_id=${appId}&redirect_uri=${encodeURIComponent(callbackUrl)}&client_secret=${appSecret}&code=${code}`
            );
            const tokenData = await tokenResponse.json() as any;

            if (tokenData.error) {
                Logger.error('[MetaOAuth] Code exchange failed', { error: tokenData.error });
                throw new Error(tokenData.error.message);
            }

            // Step 2: Exchange for long-lived token - NO SILENT FALLBACK
            // This is the critical fix - will throw on failure instead of falling back
            Logger.info('[MetaOAuth] Exchanging for long-lived token');
            let tokenResult;
            try {
                tokenResult = await MetaTokenService.exchangeForLongLived(tokenData.access_token, 'META_MESSAGING');
            } catch (exchangeError: any) {
                // Log detailed error and redirect with informative message
                Logger.error('[MetaOAuth] Long-lived token exchange FAILED - cannot proceed', {
                    error: exchangeError.message
                });
                return reply.redirect(
                    `${frontendRedirect}&error=token_exchange_failed&message=${encodeURIComponent(exchangeError.message)}`
                );
            }

            const userAccessToken = tokenResult.accessToken;
            const tokenExpiresAt = tokenResult.expiresAt;

            Logger.info('[MetaOAuth] Long-lived token acquired successfully', {
                tokenType: tokenResult.tokenType,
                expiresIn: tokenResult.expiresIn,
                expiresAt: tokenExpiresAt.toISOString()
            });

            // Step 3: Get pages and set up social accounts
            const pages = await MetaMessagingService.listUserPages(userAccessToken);
            if (pages.length === 0) return reply.redirect(`${frontendRedirect}&error=no_pages`);

            const page = pages[0];
            const igAccount = await MetaMessagingService.getInstagramBusinessAccount(page.accessToken, page.id);

            // Store with proper token metadata
            await prisma.socialAccount.upsert({
                where: { accountId_platform_externalId: { accountId, platform: 'FACEBOOK', externalId: page.id } },
                create: {
                    accountId,
                    platform: 'FACEBOOK',
                    externalId: page.id,
                    name: page.name,
                    accessToken: page.accessToken,
                    tokenExpiry: tokenExpiresAt,
                    metadata: {
                        userAccessToken,
                        tokenType: 'long_lived',
                        tokenExpiresAt: tokenExpiresAt.toISOString(),
                        apiVersion: API_VERSION
                    }
                },
                update: {
                    name: page.name,
                    accessToken: page.accessToken,
                    tokenExpiry: tokenExpiresAt,
                    metadata: {
                        userAccessToken,
                        tokenType: 'long_lived',
                        tokenExpiresAt: tokenExpiresAt.toISOString(),
                        apiVersion: API_VERSION
                    },
                    isActive: true
                },
            });

            if (igAccount) {
                await prisma.socialAccount.upsert({
                    where: { accountId_platform_externalId: { accountId, platform: 'INSTAGRAM', externalId: igAccount.igUserId } },
                    create: {
                        accountId,
                        platform: 'INSTAGRAM',
                        externalId: igAccount.igUserId,
                        name: `@${igAccount.username}`,
                        accessToken: page.accessToken,
                        tokenExpiry: tokenExpiresAt,
                        metadata: {
                            username: igAccount.username,
                            linkedPageId: page.id,
                            userAccessToken,
                            tokenType: 'long_lived',
                            tokenExpiresAt: tokenExpiresAt.toISOString(),
                            apiVersion: API_VERSION
                        }
                    },
                    update: {
                        name: `@${igAccount.username}`,
                        accessToken: page.accessToken,
                        tokenExpiry: tokenExpiresAt,
                        metadata: {
                            username: igAccount.username,
                            linkedPageId: page.id,
                            userAccessToken,
                            tokenType: 'long_lived',
                            tokenExpiresAt: tokenExpiresAt.toISOString(),
                            apiVersion: API_VERSION
                        },
                        isActive: true
                    },
                });
            }

            Logger.info('Meta messaging connected successfully', {
                accountId,
                pageId: page.id,
                hasInstagram: !!igAccount,
                tokenExpiresAt: tokenExpiresAt.toISOString()
            });
            return reply.redirect(`${frontendRedirect}&success=meta_connected${igAccount ? '&instagram=connected' : ''}`);

        } catch (error: any) {
            Logger.error('Meta messaging OAuth callback failed', { error });
            return reply.redirect(`${frontendRedirect}&error=oauth_failed&message=${encodeURIComponent(error.message)}`);
        }
    });
};

export default oauthMetaRoutes;

