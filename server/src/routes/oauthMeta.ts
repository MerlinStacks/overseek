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
import { buildCallbackUrl, buildFrontendUrl, createSignedOauthState, verifySignedOauthState, assertOauthPermission } from './oauthHelpers';
import { getOauthAccountIdOrReply } from './oauthRouteHelpers';

/** Current Meta Graph API version */
const API_VERSION = 'v24.0';

const oauthMetaRoutes: FastifyPluginAsync = async (fastify) => {
    /**
     * POST /meta/exchange - Exchange short-lived token for long-lived
     */
    fastify.post('/meta/exchange', { preHandler: requireAuthFastify }, async (request, reply) => {
        try {
            const { shortLivedToken } = request.body as { shortLivedToken?: string };
            if (typeof shortLivedToken !== 'string' || !shortLivedToken || shortLivedToken.length > 20000) return reply.code(400).send({ error: 'Invalid token' });
            if (!request.accountId || !request.user?.id) return reply.code(400).send({ error: 'Select an account' });
            await assertOauthPermission(request.user.id, request.accountId, 'META_ADS');

            // Use MetaTokenService for proper error handling
            const result = await MetaTokenService.exchangeForLongLived(shortLivedToken, 'META_ADS');
            return {
                accessToken: result.accessToken,
                expiresIn: result.expiresIn,
                expiresAt: result.expiresAt.toISOString()
            };
        } catch (error: any) {
            Logger.error('Meta token exchange failed', { error });
            return reply.code(503).send({ error: 'Meta operation unavailable' });
        }
    });

    /**
     * GET /meta/ads/authorize - Initiate Meta Ads OAuth
     */
    fastify.get('/meta/ads/authorize', { preHandler: requireAuthFastify }, async (request, reply) => {
        try {
            const accountId = getOauthAccountIdOrReply(request, reply);
            if (!accountId) return;
            const query = request.query as { redirect?: string; reconnectId?: string };
            const frontendRedirect = query.redirect || '/settings?tab=ads';
            const reconnectId = query.reconnectId;

            const { appId } = await MetaTokenService.getCredentials('META_ADS');
            const state = await createSignedOauthState({
                accountId,
                userId: request.user!.id,
                callbackUrl: buildCallbackUrl(request, 'meta/ads/callback'),
                frontendRedirect,
                reconnectId,
                provider: 'META_ADS'
            }, reply);

            const callbackUrl = buildCallbackUrl(request, 'meta/ads/callback');

            const scopes = 'ads_read,ads_management,business_management';
            const authUrl = `https://www.facebook.com/${API_VERSION}/dialog/oauth?client_id=${appId}&redirect_uri=${encodeURIComponent(callbackUrl)}&scope=${scopes}&state=${state}`;
            return { authUrl };
        } catch (error: any) {
            Logger.error('Meta Ads OAuth init failed', { error });
            return reply.code(503).send({ error: 'Could not start Meta connection' });
        }
    });

    /**
     * GET /meta/ads/callback - Handle Meta Ads OAuth callback
     */
    fastify.get('/meta/ads/callback', async (request, reply) => {
        const defaultPath = '/settings?tab=ads';
        let redirectPath = defaultPath;

        try {
            const query = request.query as { code?: string; state?: string; error?: string; error_description?: string };
            const { code, state, error } = query;
            if (!state || (!code && !error) || code && (typeof code !== 'string' || code.length > 4096)) return reply.redirect(buildFrontendUrl(defaultPath, { error: 'missing_params' }));

            const stateData = await verifySignedOauthState(state, request, reply, 'META_ADS');
            if (!stateData || stateData.provider !== 'META_ADS') {
                return reply.redirect(buildFrontendUrl(defaultPath, { error: 'invalid_state' }));
            }
            if (stateData.frontendRedirect) redirectPath = stateData.frontendRedirect;
            if (error) return reply.redirect(buildFrontendUrl(redirectPath, { error: 'oauth_denied' }));
            if (!code) return reply.redirect(buildFrontendUrl(defaultPath, { error: 'missing_params' }));

            const { appId, appSecret } = await MetaTokenService.getCredentials('META_ADS');
            const callbackUrl = stateData.callbackUrl;

            // Step 1: Exchange code for short-lived token
            Logger.info('[MetaAdsOAuth] Exchanging code for access token');
            const tokenResponse = await fetch(`https://graph.facebook.com/${API_VERSION}/oauth/access_token`, {
                signal: AbortSignal.timeout(20000),
                method: 'POST',
                headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
                body: new URLSearchParams({
                    client_id: appId,
                    redirect_uri: callbackUrl,
                    client_secret: appSecret,
                    code
                })
            });
            const tokenData = await tokenResponse.json() as any;

            if (!tokenResponse.ok || tokenData.error || typeof tokenData.access_token !== 'string' || !tokenData.access_token || tokenData.access_token.length > 20000) {
                Logger.error('[MetaAdsOAuth] Code exchange failed', { error: tokenData.error });
                throw new Error('Token exchange failed');
            }

            // Step 2: Exchange for long-lived token
            Logger.info('[MetaAdsOAuth] Exchanging for long-lived token');
            const tokenResult = await MetaTokenService.exchangeForLongLived(tokenData.access_token, 'META_ADS');

            // If reconnecting an existing account, update its tokens
            if (stateData.reconnectId) {
                await assertOauthPermission(stateData.userId, stateData.accountId, stateData.provider);
                await AdsService.updateAccountTokens(stateData.accountId, stateData.reconnectId, {
                    accessToken: tokenResult.accessToken
                });
                Logger.info('[MetaAdsOAuth] Reconnected existing account', { accountId: stateData.reconnectId });
                return reply.redirect(buildFrontendUrl(redirectPath, { success: 'meta_ads_reconnected' }));
            }

            // Step 3: Get ad accounts for user selection
            const adAccountsResponse = await fetch(
                `https://graph.facebook.com/${API_VERSION}/me/adaccounts?fields=id,name,account_status,currency`,
                { headers: { Authorization: `Bearer ${tokenResult.accessToken}` } }
            );
            const adAccountsData = await adAccountsResponse.json() as any;

            if (!adAccountsData.data || adAccountsData.data.length === 0) {
                return reply.redirect(buildFrontendUrl(redirectPath, {
                    error: 'no_ad_accounts',
                    message: 'No ad accounts found. Make sure you have access to Meta Ads.'
                }));
            }

            // For now, connect the first active ad account (status 1 = active)
            const activeAccount = adAccountsData.data.find((acc: any) => acc.account_status === 1) || adAccountsData.data[0];

            await assertOauthPermission(stateData.userId, stateData.accountId, stateData.provider);
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
            return reply.redirect(buildFrontendUrl(redirectPath, { success: 'meta_ads_connected' }));

        } catch (error: any) {
            Logger.error('[MetaAdsOAuth] Callback failed', { error: error.message });
            return reply.redirect(buildFrontendUrl(redirectPath, { error: 'oauth_failed' }));
        }
    });

    /**
     * GET /meta/messaging/authorize - Initiate Meta Messaging OAuth
     */
    fastify.get('/meta/messaging/authorize', { preHandler: requireAuthFastify }, async (request, reply) => {
        try {
            const accountId = getOauthAccountIdOrReply(request, reply);
            if (!accountId) return;
            const query = request.query as { redirect?: string };
            const frontendRedirect = query.redirect || '/settings?tab=channels';

            // Use MetaTokenService for unified credential access
            const { appId } = await MetaTokenService.getCredentials('META_MESSAGING');
            const state = await createSignedOauthState({
                accountId,
                frontendRedirect,
                userId: request.user!.id,
                callbackUrl: buildCallbackUrl(request, 'meta/messaging/callback'),
                provider: 'META_MESSAGING'
            }, reply);

            const callbackUrl = buildCallbackUrl(request, 'meta/messaging/callback');

            const scopes = 'pages_messaging,pages_manage_metadata,pages_show_list,instagram_basic,instagram_manage_messages';
            const authUrl = `https://www.facebook.com/${API_VERSION}/dialog/oauth?client_id=${appId}&redirect_uri=${encodeURIComponent(callbackUrl)}&scope=${scopes}&state=${state}`;
            return { authUrl };
        } catch (error: any) {
            Logger.error('Meta messaging OAuth init failed', { error });
            return reply.code(503).send({ error: 'Could not start Meta connection' });
        }
    });

    /**
     * GET /meta/messaging/callback - Handle Meta Messaging OAuth callback
     */
    fastify.get('/meta/messaging/callback', async (request, reply) => {
        const defaultPath = '/settings?tab=channels';
        let redirectPath = defaultPath;

        try {
            const query = request.query as { code?: string; state?: string; error?: string; error_description?: string };
            const { code, state, error } = query;
            if (!state || (!code && !error) || code && (typeof code !== 'string' || code.length > 4096)) return reply.redirect(buildFrontendUrl(defaultPath, { error: 'missing_params' }));

            const stateData = await verifySignedOauthState(state, request, reply, 'META_MESSAGING');
            if (!stateData || stateData.provider !== 'META_MESSAGING') {
                return reply.redirect(buildFrontendUrl(defaultPath, { error: 'invalid_state' }));
            }
            if (stateData.frontendRedirect) redirectPath = stateData.frontendRedirect;
            const accountId = stateData.accountId;
            if (error) return reply.redirect(buildFrontendUrl(redirectPath, { error: 'oauth_denied' }));
            if (!code) return reply.redirect(buildFrontendUrl(defaultPath, { error: 'missing_params' }));

            // Get credentials via unified service
            const { appId, appSecret } = await MetaTokenService.getCredentials('META_MESSAGING');
            const callbackUrl = stateData.callbackUrl;

            // Step 1: Exchange code for short-lived token
            Logger.info('[MetaOAuth] Exchanging code for access token');
            const tokenResponse = await fetch(`https://graph.facebook.com/${API_VERSION}/oauth/access_token`, {
                signal: AbortSignal.timeout(20000),
                method: 'POST',
                headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
                body: new URLSearchParams({
                    client_id: appId,
                    redirect_uri: callbackUrl,
                    client_secret: appSecret,
                    code
                })
            });
            const tokenData = await tokenResponse.json() as any;

            if (!tokenResponse.ok || tokenData.error || typeof tokenData.access_token !== 'string' || !tokenData.access_token || tokenData.access_token.length > 20000) {
                Logger.error('[MetaOAuth] Code exchange failed', { error: tokenData.error });
                throw new Error('Token exchange failed');
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
                return reply.redirect(buildFrontendUrl(redirectPath, {
                    error: 'token_exchange_failed',
                    message: 'Could not acquire a long-lived token'
                }));
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
            if (pages.length === 0) return reply.redirect(buildFrontendUrl(redirectPath, { error: 'no_pages' }));

            const page = pages[0];
            const igAccount = await MetaMessagingService.getInstagramBusinessAccount(page.accessToken, page.id);

            // Store Facebook + Instagram accounts atomically
            await assertOauthPermission(stateData.userId, stateData.accountId, stateData.provider);
            await prisma.$transaction(async (tx) => {
                await tx.socialAccount.upsert({
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
                    await tx.socialAccount.upsert({
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
            });

            Logger.info('Meta messaging connected successfully', {
                accountId,
                pageId: page.id,
                hasInstagram: !!igAccount,
                tokenExpiresAt: tokenExpiresAt.toISOString()
            });

            const successParams: Record<string, string> = { success: 'meta_connected' };
            if (igAccount) successParams.instagram = 'connected';
            return reply.redirect(buildFrontendUrl(redirectPath, successParams));

        } catch (error: any) {
            Logger.error('Meta messaging OAuth callback failed', { error });
            return reply.redirect(buildFrontendUrl(redirectPath, { error: 'oauth_failed' }));
        }
    });
};

export default oauthMetaRoutes;
