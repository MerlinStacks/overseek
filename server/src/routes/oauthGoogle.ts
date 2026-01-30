/**
 * Google OAuth Routes - Fastify Plugin
 * Google Ads OAuth authorization and callback.
 */

import { FastifyPluginAsync } from 'fastify';
import { AdsService } from '../services/ads';
import { requireAuthFastify } from '../middleware/auth';
import { Logger } from '../utils/logger';

const oauthGoogleRoutes: FastifyPluginAsync = async (fastify) => {
    /**
     * GET /google/authorize - Initiate Google OAuth
     */
    fastify.get('/google/authorize', { preHandler: requireAuthFastify }, async (request, reply) => {
        try {
            const accountId = request.accountId;
            const query = request.query as { redirect?: string };
            const frontendRedirect = query.redirect || '/settings/integrations';

            if (!accountId) return reply.code(400).send({ error: 'No account selected' });

            const state = Buffer.from(JSON.stringify({ accountId, frontendRedirect })).toString('base64');

            const apiUrl = process.env.API_URL?.replace(/\/+$/, '');
            const callbackUrl = apiUrl
                ? `${apiUrl}/api/oauth/google/callback`
                : `${request.protocol}://${request.hostname}/api/oauth/google/callback`;

            const authUrl = await AdsService.getGoogleAuthUrl(callbackUrl, state);
            return { authUrl };
        } catch (error: any) {
            Logger.error('Failed to generate Google OAuth URL', { error });
            return reply.code(500).send({ error: error.message });
        }
    });

    /**
     * GET /google/callback - Handle Google OAuth callback
     */
    fastify.get('/google/callback', async (request, reply) => {
        let frontendRedirect = '/marketing?tab=ads';

        try {
            const query = request.query as { code?: string; state?: string; error?: string };
            const { code, state, error } = query;

            if (error) {
                Logger.warn('Google OAuth denied', { error });
                return reply.redirect(`${frontendRedirect}?error=oauth_denied`);
            }

            if (!code || !state) {
                return reply.redirect(`${frontendRedirect}?error=missing_params`);
            }

            let stateData: { accountId: string; frontendRedirect: string };
            try {
                stateData = JSON.parse(Buffer.from(state, 'base64').toString('utf-8'));
                frontendRedirect = stateData.frontendRedirect || frontendRedirect;
            } catch {
                return reply.redirect(`${frontendRedirect}?error=invalid_state`);
            }

            const apiUrl = process.env.API_URL?.replace(/\/+$/, '');
            const redirectUri = apiUrl
                ? `${apiUrl}/api/oauth/google/callback`
                : `${request.protocol}://${request.hostname}/api/oauth/google/callback`;

            const tokens = await AdsService.exchangeGoogleCode(code, redirectUri);

            const pendingAccount = await AdsService.connectAccount(stateData.accountId, {
                platform: 'GOOGLE',
                externalId: 'PENDING_SETUP',
                accessToken: tokens.accessToken,
                refreshToken: tokens.refreshToken || '',
                name: 'Google Ads (Pending Setup)'
            });

            return reply.redirect(`${frontendRedirect}?success=google_pending&pendingId=${pendingAccount.id}`);

        } catch (error: any) {
            Logger.error('Google OAuth callback failed', { error: error.message });
            return reply.redirect(`${frontendRedirect}?error=oauth_failed&message=${encodeURIComponent(error.message)}`);
        }
    });
};

export default oauthGoogleRoutes;
