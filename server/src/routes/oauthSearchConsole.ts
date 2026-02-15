/**
 * Google Search Console OAuth Routes — Fastify Plugin
 *
 * Handles the separate OAuth flow for Google Search Console.
 * Reuses the same GCP project credentials (clientId/clientSecret) as Google Ads
 * but requests the `webmasters.readonly` scope instead.
 */

import { FastifyPluginAsync } from 'fastify';
import crypto from 'crypto';
import { requireAuthFastify } from '../middleware/auth';
import { Logger } from '../utils/logger';
import { prisma } from '../utils/prisma';
import { buildCallbackUrl, buildFrontendUrl } from './oauthHelpers';
import { getCredentials } from '../services/ads/types';

/** Why HMAC: prevent forged state params — an attacker could craft a state to link SC to their account */
const STATE_SECRET = process.env.JWT_SECRET || process.env.SESSION_SECRET || 'overseek-oauth-state';

/** Sign a state payload with HMAC-SHA256 */
function signState(payload: object): string {
    const data = Buffer.from(JSON.stringify(payload)).toString('base64url');
    const sig = crypto.createHmac('sha256', STATE_SECRET).update(data).digest('base64url');
    return `${data}.${sig}`;
}

/** Verify and parse a signed state string. Returns null on tamper/expiry. */
function verifyState(state: string): { accountId: string; frontendRedirect: string } | null {
    const [data, sig] = state.split('.');
    if (!data || !sig) return null;
    const expected = crypto.createHmac('sha256', STATE_SECRET).update(data).digest('base64url');
    if (!crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) return null;
    try {
        return JSON.parse(Buffer.from(data, 'base64url').toString('utf-8'));
    } catch {
        return null;
    }
}

/** Only allow relative paths to prevent open-redirect attacks */
function sanitizeRedirect(path: string | undefined): string {
    if (!path || !path.startsWith('/') || path.startsWith('//')) return '/seo';
    return path;
}

/** Scope required for read-only Search Console access */
const SEARCH_CONSOLE_SCOPE = 'https://www.googleapis.com/auth/webmasters.readonly';

/**
 * Exchange an authorization code for tokens using the standard Google OAuth2 endpoint.
 * Why separate from GoogleAdsAuth: different scopes, different token storage.
 */
async function exchangeCodeForTokens(
    code: string,
    redirectUri: string,
    clientId: string,
    clientSecret: string
): Promise<{ accessToken: string; refreshToken: string }> {
    const response = await fetch('https://oauth2.googleapis.com/token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
            code,
            client_id: clientId,
            client_secret: clientSecret,
            redirect_uri: redirectUri,
            grant_type: 'authorization_code'
        }).toString()
    });

    const data = await response.json();
    if (data.error) throw new Error(data.error_description || data.error);
    if (!data.access_token) throw new Error('No access token received');

    return {
        accessToken: data.access_token,
        refreshToken: data.refresh_token || ''
    };
}

/**
 * List verified sites from Google Search Console using the Webmasters API.
 */
async function listVerifiedSites(accessToken: string): Promise<Array<{ siteUrl: string; permissionLevel: string }>> {
    const response = await fetch('https://www.googleapis.com/webmasters/v3/sites', {
        headers: { Authorization: `Bearer ${accessToken}` }
    });

    if (!response.ok) {
        const err = await response.text();
        throw new Error(`Failed to list sites: ${err}`);
    }

    const data = await response.json();
    return (data.siteEntry || []).map((entry: any) => ({
        siteUrl: entry.siteUrl,
        permissionLevel: entry.permissionLevel
    }));
}

const oauthSearchConsoleRoutes: FastifyPluginAsync = async (fastify) => {
    /**
     * GET /search-console/authorize — Start the OAuth flow
     */
    fastify.get('/search-console/authorize', { preHandler: requireAuthFastify }, async (request, reply) => {
        try {
            const accountId = request.accountId;
            if (!accountId) return reply.code(400).send({ error: 'No account selected' });

            const creds = await getCredentials('GOOGLE_ADS');
            if (!creds?.clientId) {
                return reply.code(400).send({ error: 'Google credentials not configured. Set up Google Ads credentials first.' });
            }

            const query = request.query as { redirect?: string };
            const frontendRedirect = sanitizeRedirect(query.redirect);

            const state = signState({ accountId, frontendRedirect });

            const redirectUri = buildCallbackUrl(request, 'search-console/callback');

            const params = new URLSearchParams({
                client_id: creds.clientId,
                redirect_uri: redirectUri,
                response_type: 'code',
                scope: SEARCH_CONSOLE_SCOPE,
                access_type: 'offline',
                prompt: 'consent',
                state
            });

            return { authUrl: `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}` };
        } catch (error: any) {
            Logger.error('Failed to generate Search Console OAuth URL', { error });
            return reply.code(500).send({ error: error.message });
        }
    });

    /**
     * GET /search-console/callback — Handle OAuth callback, list sites, store tokens
     */
    fastify.get('/search-console/callback', async (request, reply) => {
        let frontendRedirect = '/settings/integrations';

        try {
            const query = request.query as { code?: string; state?: string; error?: string };
            if (query.error) {
                Logger.warn('Search Console OAuth denied', { error: query.error });
                return reply.redirect(buildFrontendUrl(frontendRedirect, { error: 'oauth_denied' }));
            }

            if (!query.code || !query.state) {
                return reply.redirect(buildFrontendUrl(frontendRedirect, { error: 'missing_params' }));
            }

            const stateData = verifyState(query.state);
            if (!stateData) {
                Logger.warn('OAuth state verification failed — possible CSRF attempt');
                return reply.redirect(buildFrontendUrl(frontendRedirect, { error: 'invalid_state' }));
            }
            if (stateData.frontendRedirect) {
                frontendRedirect = sanitizeRedirect(stateData.frontendRedirect);
            }

            const creds = await getCredentials('GOOGLE_ADS');
            if (!creds?.clientId || !creds?.clientSecret) {
                return reply.redirect(buildFrontendUrl(frontendRedirect, { error: 'missing_credentials' }));
            }

            const redirectUri = buildCallbackUrl(request, 'search-console/callback');

            const tokens = await exchangeCodeForTokens(query.code, redirectUri, creds.clientId, creds.clientSecret);

            if (!tokens.refreshToken) {
                Logger.warn('No refresh token from Search Console OAuth. User may need to revoke at https://myaccount.google.com/permissions');
            }

            // List verified sites and auto-connect the first one (or store tokens for site selection)
            const sites = await listVerifiedSites(tokens.accessToken);

            if (sites.length === 0) {
                return reply.redirect(buildFrontendUrl(frontendRedirect, { error: 'no_sites' }));
            }

            // Store all verified sites so the user can select later
            for (const site of sites) {
                await prisma.searchConsoleAccount.upsert({
                    where: {
                        accountId_siteUrl: {
                            accountId: stateData.accountId,
                            siteUrl: site.siteUrl
                        }
                    },
                    update: {
                        accessToken: tokens.accessToken,
                        refreshToken: tokens.refreshToken
                    },
                    create: {
                        accountId: stateData.accountId,
                        siteUrl: site.siteUrl,
                        accessToken: tokens.accessToken,
                        refreshToken: tokens.refreshToken
                    }
                });
            }

            Logger.info('Search Console connected', {
                accountId: stateData.accountId,
                siteCount: sites.length
            });

            return reply.redirect(buildFrontendUrl(frontendRedirect, { success: 'search_console_connected' }));

        } catch (error: any) {
            Logger.error('Search Console OAuth callback failed', { error: error.message });
            return reply.redirect(buildFrontendUrl(frontendRedirect, { error: 'oauth_failed', message: error.message }));
        }
    });

    /**
     * GET /search-console/status — Connection status for current account
     */
    fastify.get('/search-console/status', { preHandler: requireAuthFastify }, async (request, reply) => {
        try {
            const accountId = request.accountId;
            if (!accountId) return reply.code(400).send({ error: 'No account selected' });

            const [accounts, account] = await Promise.all([
                prisma.searchConsoleAccount.findMany({
                    where: { accountId },
                    select: { id: true, siteUrl: true, createdAt: true }
                }),
                prisma.account.findUnique({
                    where: { id: accountId },
                    select: { defaultSearchConsoleSiteUrl: true }
                })
            ]);

            return {
                connected: accounts.length > 0,
                sites: accounts,
                defaultSiteUrl: account?.defaultSearchConsoleSiteUrl ?? null
            };
        } catch (error: any) {
            Logger.error('Failed to get Search Console status', { error });
            return reply.code(500).send({ error: error.message });
        }
    });

    /**
     * PUT /search-console/default-site — Persist which GSC property the account uses by default.
     * Validates that the siteUrl is actually connected before persisting.
     */
    fastify.put('/search-console/default-site', { preHandler: requireAuthFastify }, async (request, reply) => {
        try {
            const accountId = request.accountId;
            if (!accountId) return reply.code(400).send({ error: 'No account selected' });

            const { siteUrl } = request.body as { siteUrl: string };
            if (!siteUrl) return reply.code(400).send({ error: 'siteUrl is required' });

            // Validate the siteUrl belongs to this account
            const exists = await prisma.searchConsoleAccount.findFirst({
                where: { accountId, siteUrl }
            });
            if (!exists) return reply.code(404).send({ error: 'Site not connected to this account' });

            await prisma.account.update({
                where: { id: accountId },
                data: { defaultSearchConsoleSiteUrl: siteUrl }
            });

            return { success: true, defaultSiteUrl: siteUrl };
        } catch (error: any) {
            Logger.error('Failed to set default Search Console site', { error });
            return reply.code(500).send({ error: error.message });
        }
    });

    /**
     * DELETE /search-console/disconnect — Remove Search Console connection
     */
    fastify.delete('/search-console/disconnect', { preHandler: requireAuthFastify }, async (request, reply) => {
        try {
            const accountId = request.accountId;
            const body = request.body as { siteUrl?: string } | undefined;

            if (!accountId) return reply.code(400).send({ error: 'No account selected' });

            if (body?.siteUrl) {
                await prisma.searchConsoleAccount.deleteMany({
                    where: { accountId, siteUrl: body.siteUrl }
                });
            } else {
                await prisma.searchConsoleAccount.deleteMany({
                    where: { accountId }
                });
            }

            return { success: true };
        } catch (error: any) {
            Logger.error('Failed to disconnect Search Console', { error });
            return reply.code(500).send({ error: error.message });
        }
    });

    /**
     * GET /search-console/callback-url — Return the callback URL for GCP setup
     */
    fastify.get('/search-console/callback-url', { preHandler: requireAuthFastify }, async (request) => {
        return { callbackUrl: buildCallbackUrl(request, 'search-console/callback') };
    });
};

export default oauthSearchConsoleRoutes;
