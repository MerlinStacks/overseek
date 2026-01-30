/**
 * Meta OAuth Routes - Fastify Plugin
 * Meta Ads token exchange and Messaging OAuth (Facebook/Instagram).
 */

import { FastifyPluginAsync } from 'fastify';
import { AdsService } from '../services/ads';
import { requireAuthFastify } from '../middleware/auth';
import { Logger } from '../utils/logger';
import { prisma } from '../utils/prisma';
import { MetaMessagingService } from '../services/messaging/MetaMessagingService';

const oauthMetaRoutes: FastifyPluginAsync = async (fastify) => {
    /**
     * POST /meta/exchange - Exchange short-lived token for long-lived
     */
    fastify.post('/meta/exchange', { preHandler: requireAuthFastify }, async (request, reply) => {
        try {
            const { shortLivedToken } = request.body as { shortLivedToken?: string };
            if (!shortLivedToken) return reply.code(400).send({ error: 'Missing shortLivedToken' });
            const longLivedToken = await AdsService.exchangeMetaToken(shortLivedToken);
            return { accessToken: longLivedToken };
        } catch (error: any) {
            Logger.error('Meta token exchange failed', { error });
            return reply.code(500).send({ error: error.message });
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

            const credentials = await prisma.platformCredentials.findUnique({ where: { platform: 'META_MESSAGING' } });
            if (!credentials) return reply.code(400).send({ error: 'Meta messaging not configured' });

            const { appId } = credentials.credentials as any;
            const state = Buffer.from(JSON.stringify({ accountId, frontendRedirect })).toString('base64');

            const apiUrl = process.env.API_URL?.replace(/\/+$/, '');
            const callbackUrl = apiUrl
                ? `${apiUrl}/api/oauth/meta/messaging/callback`
                : `${request.protocol}://${request.hostname}/api/oauth/meta/messaging/callback`;

            const scopes = 'pages_messaging,pages_manage_metadata,pages_show_list,instagram_basic,instagram_manage_messages';
            const authUrl = `https://www.facebook.com/v18.0/dialog/oauth?client_id=${appId}&redirect_uri=${encodeURIComponent(callbackUrl)}&scope=${scopes}&state=${state}`;
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
        let frontendRedirect = '/settings?tab=channels';

        try {
            const query = request.query as { code?: string; state?: string; error?: string };
            const { code, state, error } = query;

            if (error) return reply.redirect(`${frontendRedirect}&error=oauth_denied`);
            if (!code || !state) return reply.redirect(`${frontendRedirect}&error=missing_params`);

            const stateData = JSON.parse(Buffer.from(state, 'base64').toString('utf-8'));
            frontendRedirect = stateData.frontendRedirect || frontendRedirect;
            const accountId = stateData.accountId;

            const credentials = await prisma.platformCredentials.findUnique({ where: { platform: 'META_MESSAGING' } });
            if (!credentials) return reply.redirect(`${frontendRedirect}&error=not_configured`);

            const { appId, appSecret } = credentials.credentials as any;

            const apiUrl = process.env.API_URL?.replace(/\/+$/, '');
            const callbackUrl = apiUrl
                ? `${apiUrl}/api/oauth/meta/messaging/callback`
                : `${request.protocol}://${request.hostname}/api/oauth/meta/messaging/callback`;

            const tokenResponse = await fetch(
                `https://graph.facebook.com/v18.0/oauth/access_token?client_id=${appId}&redirect_uri=${encodeURIComponent(callbackUrl)}&client_secret=${appSecret}&code=${code}`
            );
            const tokenData = await tokenResponse.json() as any;
            if (tokenData.error) throw new Error(tokenData.error.message);

            // Exchange short-lived user token for long-lived (~60 days)
            Logger.info('[MetaOAuth] Exchanging for long-lived token');
            const longLivedResponse = await fetch(
                `https://graph.facebook.com/v18.0/oauth/access_token?grant_type=fb_exchange_token&client_id=${appId}&client_secret=${appSecret}&fb_exchange_token=${tokenData.access_token}`
            );
            const longLivedData = await longLivedResponse.json() as any;
            if (longLivedData.error) {
                Logger.warn('[MetaOAuth] Long-lived token exchange failed, using short-lived', { error: longLivedData.error });
            }

            // Use long-lived token if available, otherwise fall back to short-lived
            const userAccessToken = longLivedData.access_token || tokenData.access_token;
            const tokenExpiresIn = longLivedData.expires_in || 3600; // Default 1 hour if short-lived
            const tokenExpiresAt = new Date(Date.now() + (tokenExpiresIn * 1000));

            Logger.info('[MetaOAuth] Token acquired', {
                isLongLived: !!longLivedData.access_token,
                expiresIn: tokenExpiresIn,
                expiresAt: tokenExpiresAt.toISOString()
            });

            const pages = await MetaMessagingService.listUserPages(userAccessToken);
            if (pages.length === 0) return reply.redirect(`${frontendRedirect}&error=no_pages`);

            const page = pages[0];
            const igAccount = await MetaMessagingService.getInstagramBusinessAccount(page.accessToken, page.id);

            await prisma.socialAccount.upsert({
                where: { accountId_platform_externalId: { accountId, platform: 'FACEBOOK', externalId: page.id } },
                create: { accountId, platform: 'FACEBOOK', externalId: page.id, name: page.name, accessToken: page.accessToken, metadata: { userAccessToken, tokenExpiresAt: tokenExpiresAt.toISOString() } },
                update: { name: page.name, accessToken: page.accessToken, metadata: { userAccessToken, tokenExpiresAt: tokenExpiresAt.toISOString() }, isActive: true },
            });

            if (igAccount) {
                await prisma.socialAccount.upsert({
                    where: { accountId_platform_externalId: { accountId, platform: 'INSTAGRAM', externalId: igAccount.igUserId } },
                    create: { accountId, platform: 'INSTAGRAM', externalId: igAccount.igUserId, name: `@${igAccount.username}`, accessToken: page.accessToken, metadata: { username: igAccount.username, linkedPageId: page.id, userAccessToken, tokenExpiresAt: tokenExpiresAt.toISOString() } },
                    update: { name: `@${igAccount.username}`, accessToken: page.accessToken, metadata: { username: igAccount.username, linkedPageId: page.id, userAccessToken, tokenExpiresAt: tokenExpiresAt.toISOString() }, isActive: true },
                });
            }

            Logger.info('Meta messaging connected', { accountId, pageId: page.id, hasInstagram: !!igAccount });
            return reply.redirect(`${frontendRedirect}&success=meta_connected${igAccount ? '&instagram=connected' : ''}`);

        } catch (error: any) {
            Logger.error('Meta messaging OAuth callback failed', { error });
            return reply.redirect(`${frontendRedirect}&error=oauth_failed&message=${encodeURIComponent(error.message)}`);
        }
    });
};

export default oauthMetaRoutes;
