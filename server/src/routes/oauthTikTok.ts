/**
 * TikTok OAuth Routes - Fastify Plugin
 * TikTok Business Messaging OAuth.
 */

import { FastifyPluginAsync } from 'fastify';
import { requireAuthFastify } from '../middleware/auth';
import { Logger } from '../utils/logger';
import { prisma } from '../utils/prisma';
import { TikTokMessagingService } from '../services/messaging/TikTokMessagingService';

const oauthTikTokRoutes: FastifyPluginAsync = async (fastify) => {
    /**
     * GET /tiktok/authorize - Initiate TikTok OAuth
     */
    fastify.get('/tiktok/authorize', { preHandler: requireAuthFastify }, async (request, reply) => {
        try {
            const accountId = request.accountId;
            const query = request.query as { redirect?: string };
            const frontendRedirect = query.redirect || '/settings?tab=channels';

            if (!accountId) return reply.code(400).send({ error: 'No account selected' });

            const credentials = await prisma.platformCredentials.findUnique({ where: { platform: 'TIKTOK_MESSAGING' } });
            if (!credentials) return reply.code(400).send({ error: 'TikTok messaging not configured' });

            const { clientKey } = credentials.credentials as any;
            const state = Buffer.from(JSON.stringify({ accountId, frontendRedirect })).toString('base64');

            const apiUrl = process.env.API_URL?.replace(/\/+$/, '');
            const callbackUrl = apiUrl
                ? `${apiUrl}/api/oauth/tiktok/callback`
                : `${request.protocol}://${request.hostname}/api/oauth/tiktok/callback`;

            const scopes = 'user.info.basic,dm.manage';
            const authUrl = `https://www.tiktok.com/v2/auth/authorize?client_key=${clientKey}&redirect_uri=${encodeURIComponent(callbackUrl)}&scope=${scopes}&response_type=code&state=${state}`;
            return { authUrl };
        } catch (error: any) {
            Logger.error('TikTok OAuth init failed', { error });
            return reply.code(500).send({ error: error.message });
        }
    });

    /**
     * GET /tiktok/callback - Handle TikTok OAuth callback
     */
    fastify.get('/tiktok/callback', async (request, reply) => {
        let frontendRedirect = '/settings?tab=channels';

        try {
            const query = request.query as { code?: string; state?: string; error?: string; error_description?: string };
            const { code, state, error, error_description } = query;

            if (error) {
                Logger.warn('TikTok OAuth denied', { error, error_description });
                return reply.redirect(`${frontendRedirect}&error=oauth_denied`);
            }

            if (!code || !state) return reply.redirect(`${frontendRedirect}&error=missing_params`);

            const stateData = JSON.parse(Buffer.from(state, 'base64').toString('utf-8'));
            frontendRedirect = stateData.frontendRedirect || frontendRedirect;
            const accountId = stateData.accountId;

            const credentials = await prisma.platformCredentials.findUnique({ where: { platform: 'TIKTOK_MESSAGING' } });
            if (!credentials) return reply.redirect(`${frontendRedirect}&error=not_configured`);

            const { clientKey, clientSecret } = credentials.credentials as any;

            const apiUrl = process.env.API_URL?.replace(/\/+$/, '');
            const callbackUrl = apiUrl
                ? `${apiUrl}/api/oauth/tiktok/callback`
                : `${request.protocol}://${request.hostname}/api/oauth/tiktok/callback`;

            const tokens = await TikTokMessagingService.exchangeAuthCode(code, clientKey, clientSecret, callbackUrl);
            if (!tokens) return reply.redirect(`${frontendRedirect}&error=token_exchange_failed`);

            const expiresAt = new Date(Date.now() + tokens.expiresIn * 1000);

            await prisma.socialAccount.upsert({
                where: { accountId_platform_externalId: { accountId, platform: 'TIKTOK', externalId: tokens.openId } },
                create: { accountId, platform: 'TIKTOK', externalId: tokens.openId, name: 'TikTok Business', accessToken: tokens.accessToken, refreshToken: tokens.refreshToken, tokenExpiry: expiresAt, metadata: { openId: tokens.openId } },
                update: { accessToken: tokens.accessToken, refreshToken: tokens.refreshToken, tokenExpiry: expiresAt, isActive: true },
            });

            Logger.info('TikTok messaging connected', { accountId, openId: tokens.openId });
            return reply.redirect(`${frontendRedirect}&success=tiktok_connected`);

        } catch (error: any) {
            Logger.error('TikTok OAuth callback failed', { error });
            return reply.redirect(`${frontendRedirect}&error=oauth_failed&message=${encodeURIComponent(error.message)}`);
        }
    });
};

export default oauthTikTokRoutes;
