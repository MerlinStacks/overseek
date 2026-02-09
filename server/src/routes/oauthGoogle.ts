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
     * GET /google/callback-url - Return the actual callback URL the server uses.
     * Why: Frontend needs to display this to admins for Google Cloud Console setup,
     * and it may differ from window.location.origin when API_URL is set.
     */
    fastify.get('/google/callback-url', { preHandler: requireAuthFastify }, async (request) => {
        const apiUrl = process.env.API_URL?.replace(/\/+$/, '');
        return {
            callbackUrl: apiUrl
                ? `${apiUrl}/api/oauth/google/callback`
                : `${request.protocol}://${request.hostname}/api/oauth/google/callback`
        };
    });

    /**
     * GET /google/authorize - Initiate Google OAuth
     */
    fastify.get('/google/authorize', { preHandler: requireAuthFastify }, async (request, reply) => {
        try {
            const accountId = request.accountId;
            const query = request.query as { redirect?: string; reconnectId?: string };
            const frontendRedirect = query.redirect || '/settings/integrations';
            const reconnectId = query.reconnectId;

            if (!accountId) return reply.code(400).send({ error: 'No account selected' });

            const state = Buffer.from(JSON.stringify({ accountId, frontendRedirect, reconnectId })).toString('base64');

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
        const appUrl = process.env.APP_URL?.replace(/\/+$/, '') || 'http://localhost:5173';
        let frontendRedirect = `${appUrl}/marketing?tab=ads`;

        try {
            const query = request.query as { code?: string; state?: string; error?: string };
            const { code, state, error } = query;

            if (error) {
                Logger.warn('Google OAuth denied', { error });
                return reply.redirect(`${frontendRedirect}&error=oauth_denied`);
            }

            if (!code || !state) {
                return reply.redirect(`${frontendRedirect}&error=missing_params`);
            }

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

            const apiUrl = process.env.API_URL?.replace(/\/+$/, '');
            const redirectUri = apiUrl
                ? `${apiUrl}/api/oauth/google/callback`
                : `${request.protocol}://${request.hostname}/api/oauth/google/callback`;

            const tokens = await AdsService.exchangeGoogleCode(code, redirectUri);

            // If reconnecting an existing account, update its tokens
            if (stateData.reconnectId) {
                await AdsService.updateAccountTokens(stateData.reconnectId, {
                    accessToken: tokens.accessToken,
                    refreshToken: tokens.refreshToken || ''
                });
                return reply.redirect(`${frontendRedirect}&success=google_reconnected`);
            }

            // Otherwise create new pending account
            const pendingAccount = await AdsService.connectAccount(stateData.accountId, {
                platform: 'GOOGLE',
                externalId: 'PENDING_SETUP',
                accessToken: tokens.accessToken,
                refreshToken: tokens.refreshToken || '',
                name: 'Google Ads (Pending Setup)'
            });

            return reply.redirect(`${frontendRedirect}&success=google_pending&pendingId=${pendingAccount.id}`);

        } catch (error: any) {
            Logger.error('Google OAuth callback failed', { error: error.message });
            return reply.redirect(`${frontendRedirect}&error=oauth_failed&message=${encodeURIComponent(error.message)}`);
        }
    });
};

export default oauthGoogleRoutes;
