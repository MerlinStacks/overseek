import { Router, Response, Request } from 'express';
import { AuthenticatedRequest } from '../types/express';
import { AdsService } from '../services/ads';
import { requireAuth } from '../middleware/auth';
import { Logger } from '../utils/logger';

const router = Router();

// ──────────────────────────────────────────────────────────────
// GOOGLE ADS OAUTH FLOW
// ──────────────────────────────────────────────────────────────

/**
 * GET /api/oauth/google/authorize
 * Initiates Google OAuth flow - redirects user to Google consent screen.
 * Query params:
 * - accountId: The OverSeek account to connect the ad account to
 * - redirectUri: Where to redirect after callback (frontend URL)
 */
router.get('/google/authorize', requireAuth, async (req: AuthenticatedRequest, res: Response) => {
    try {
        const accountId = (req as any).accountId;
        const frontendRedirect = req.query.redirect as string || '/settings/integrations';

        if (!accountId) {
            return res.status(400).json({ error: 'No account selected' });
        }

        // Build state parameter to pass through OAuth flow
        const state = Buffer.from(JSON.stringify({
            accountId,
            frontendRedirect
        })).toString('base64');

        // Get the callback URL using API_URL env var (required for Docker environments)
        // Falls back to request headers for local development
        const apiUrl = process.env.API_URL?.replace(/\/+$/, ''); // Strip trailing slashes
        let callbackUrl: string;
        if (apiUrl) {
            callbackUrl = `${apiUrl}/api/oauth/google/callback`;
        } else {
            const protocol = req.headers['x-forwarded-proto'] || req.protocol;
            const host = req.headers['x-forwarded-host'] || req.get('host');
            callbackUrl = `${protocol}://${host}/api/oauth/google/callback`;
        }

        const authUrl = await AdsService.getGoogleAuthUrl(callbackUrl, state);

        res.json({ authUrl });
    } catch (error: any) {
        Logger.error('Failed to generate Google OAuth URL', { error });
        res.status(500).json({ error: error.message });
    }
});

/**
 * GET /api/oauth/google/callback
 * Handles Google OAuth callback after user grants consent.
 * Exchanges authorization code for tokens and creates AdAccount.
 */
router.get('/google/callback', async (req: Request, res: Response) => {
    let frontendRedirect = '/marketing?tab=ads'; // Default fallback

    try {
        const { code, state, error } = req.query;

        Logger.info('Google OAuth callback received', {
            hasCode: !!code,
            hasState: !!state,
            error
        });

        if (error) {
            Logger.warn('Google OAuth denied', { error });
            return res.redirect(`${frontendRedirect}?error=oauth_denied`);
        }

        if (!code || !state) {
            Logger.warn('Missing code or state in OAuth callback');
            return res.redirect(`${frontendRedirect}?error=missing_params`);
        }

        // Decode state
        let stateData: { accountId: string; frontendRedirect: string };
        try {
            stateData = JSON.parse(Buffer.from(state as string, 'base64').toString('utf-8'));
            frontendRedirect = stateData.frontendRedirect || frontendRedirect;
            Logger.info('OAuth state decoded', {
                accountId: stateData.accountId,
                frontendRedirect: stateData.frontendRedirect
            });
        } catch (e) {
            Logger.error('Failed to decode OAuth state', { state, error: e });
            return res.redirect(`${frontendRedirect}?error=invalid_state`);
        }

        // Build redirect URI (must match exactly what was used in authorize)
        // Use API_URL env var for Docker environments, fallback to request headers
        const apiUrl = process.env.API_URL?.replace(/\/+$/, ''); // Strip trailing slashes
        let redirectUri: string;
        if (apiUrl) {
            redirectUri = `${apiUrl}/api/oauth/google/callback`;
        } else {
            const protocol = req.headers['x-forwarded-proto'] || req.protocol;
            const host = req.headers['x-forwarded-host'] || req.get('host');
            redirectUri = `${protocol}://${host}/api/oauth/google/callback`;
        }

        Logger.info('Exchanging OAuth code for tokens', { redirectUri });

        // Exchange code for tokens
        const tokens = await AdsService.exchangeGoogleCode(code as string, redirectUri);
        Logger.info('Token exchange successful', { hasAccessToken: !!tokens.accessToken, hasRefreshToken: !!tokens.refreshToken });

        // Skip listGoogleCustomers (requires Google Ads API access which may not be configured)
        // Instead, save tokens and redirect user to enter their Customer ID manually

        // Store tokens temporarily in a pending ad account
        // The user will complete setup by entering their Customer ID
        const pendingAccount = await AdsService.connectAccount(stateData.accountId, {
            platform: 'GOOGLE',
            externalId: 'PENDING_SETUP',
            accessToken: tokens.accessToken,
            refreshToken: tokens.refreshToken || '',
            name: 'Google Ads (Pending Setup)'
        });

        Logger.info('Google Ads tokens saved, pending customer ID entry', { pendingAccountId: pendingAccount.id });

        // Redirect with pending flag so frontend shows customer ID input
        return res.redirect(`${frontendRedirect}?success=google_pending&pendingId=${pendingAccount.id}`);

    } catch (error: any) {
        Logger.error('Google OAuth callback failed', {
            error: error.message,
            stack: error.stack,
            frontendRedirect
        });
        res.redirect(`${frontendRedirect}?error=oauth_failed&message=${encodeURIComponent(error.message || 'Unknown error')}`);
    }
});

// ──────────────────────────────────────────────────────────────
// META ADS TOKEN EXCHANGE
// ──────────────────────────────────────────────────────────────

/**
 * POST /api/oauth/meta/exchange
 * Exchange a short-lived Meta access token for a long-lived token.
 * Body: { shortLivedToken: string }
 */
router.post('/meta/exchange', requireAuth, async (req: AuthenticatedRequest, res: Response) => {
    try {
        const { shortLivedToken } = req.body;

        if (!shortLivedToken) {
            return res.status(400).json({ error: 'Missing shortLivedToken' });
        }

        // AdsService now fetches credentials from database
        const longLivedToken = await AdsService.exchangeMetaToken(shortLivedToken);

        res.json({ accessToken: longLivedToken });
    } catch (error: any) {
        Logger.error('Meta token exchange failed', { error });
        res.status(500).json({ error: error.message });
    }
});

// ──────────────────────────────────────────────────────────────
// META MESSAGING OAUTH FLOW (Facebook/Instagram)
// ──────────────────────────────────────────────────────────────

import { prisma } from '../utils/prisma';
import { MetaMessagingService } from '../services/messaging/MetaMessagingService';

/**
 * GET /api/oauth/meta/messaging/authorize
 * Initiates Meta OAuth for Messenger/Instagram messaging permissions.
 */
router.get('/meta/messaging/authorize', requireAuth, async (req: AuthenticatedRequest, res: Response) => {
    try {
        const accountId = (req as any).accountId;
        const frontendRedirect = req.query.redirect as string || '/settings?tab=channels';

        if (!accountId) {
            return res.status(400).json({ error: 'No account selected' });
        }

        // Get Meta app credentials
        const credentials = await prisma.platformCredentials.findUnique({
            where: { platform: 'META_MESSAGING' },
        });

        if (!credentials) {
            return res.status(400).json({ error: 'Meta messaging not configured. Contact admin.' });
        }

        const { appId } = credentials.credentials as any;

        const state = Buffer.from(JSON.stringify({
            accountId,
            frontendRedirect
        })).toString('base64');

        // Build callback URL
        const apiUrl = process.env.API_URL?.replace(/\/+$/, '');
        const callbackUrl = apiUrl
            ? `${apiUrl}/api/oauth/meta/messaging/callback`
            : `${req.protocol}://${req.get('host')}/api/oauth/meta/messaging/callback`;

        // Request messaging permissions
        const scopes = [
            'pages_messaging',
            'pages_manage_metadata',
            'pages_show_list',
            'instagram_basic',
            'instagram_manage_messages'
        ].join(',');

        const authUrl = `https://www.facebook.com/v18.0/dialog/oauth?` +
            `client_id=${appId}` +
            `&redirect_uri=${encodeURIComponent(callbackUrl)}` +
            `&scope=${scopes}` +
            `&state=${state}`;

        res.json({ authUrl });
    } catch (error: any) {
        Logger.error('Meta messaging OAuth init failed', { error });
        res.status(500).json({ error: error.message });
    }
});

/**
 * GET /api/oauth/meta/messaging/callback
 * Handles callback after user grants messaging permissions.
 */
router.get('/meta/messaging/callback', async (req: Request, res: Response) => {
    let frontendRedirect = '/settings?tab=channels';

    try {
        const { code, state, error } = req.query;

        if (error) {
            Logger.warn('Meta messaging OAuth denied', { error });
            return res.redirect(`${frontendRedirect}&error=oauth_denied`);
        }

        if (!code || !state) {
            return res.redirect(`${frontendRedirect}&error=missing_params`);
        }

        // Decode state
        const stateData = JSON.parse(Buffer.from(state as string, 'base64').toString('utf-8'));
        frontendRedirect = stateData.frontendRedirect || frontendRedirect;
        const accountId = stateData.accountId;

        // Get credentials
        const credentials = await prisma.platformCredentials.findUnique({
            where: { platform: 'META_MESSAGING' },
        });

        if (!credentials) {
            return res.redirect(`${frontendRedirect}&error=not_configured`);
        }

        const { appId, appSecret } = credentials.credentials as any;

        // Build callback URL for token exchange
        const apiUrl = process.env.API_URL?.replace(/\/+$/, '');
        const callbackUrl = apiUrl
            ? `${apiUrl}/api/oauth/meta/messaging/callback`
            : `${req.protocol}://${req.get('host')}/api/oauth/meta/messaging/callback`;

        // Exchange code for user access token
        const tokenResponse = await fetch(
            `https://graph.facebook.com/v18.0/oauth/access_token?` +
            `client_id=${appId}` +
            `&redirect_uri=${encodeURIComponent(callbackUrl)}` +
            `&client_secret=${appSecret}` +
            `&code=${code}`
        );
        const tokenData = await tokenResponse.json();

        if (tokenData.error) {
            throw new Error(tokenData.error.message);
        }

        const userAccessToken = tokenData.access_token;

        // Get list of pages user manages
        const pages = await MetaMessagingService.listUserPages(userAccessToken);

        if (pages.length === 0) {
            return res.redirect(`${frontendRedirect}&error=no_pages`);
        }

        // For now, auto-connect the first page (TODO: show page selector UI)
        const page = pages[0];

        // Check for linked Instagram account
        const igAccount = await MetaMessagingService.getInstagramBusinessAccount(
            page.accessToken,
            page.id
        );

        // Store Facebook page as social account
        await prisma.socialAccount.upsert({
            where: {
                accountId_platform_externalId: {
                    accountId,
                    platform: 'FACEBOOK',
                    externalId: page.id,
                },
            },
            create: {
                accountId,
                platform: 'FACEBOOK',
                externalId: page.id,
                name: page.name,
                accessToken: page.accessToken,
                metadata: { userAccessToken },
            },
            update: {
                name: page.name,
                accessToken: page.accessToken,
                metadata: { userAccessToken },
                isActive: true,
            },
        });

        // Store Instagram if linked
        if (igAccount) {
            await prisma.socialAccount.upsert({
                where: {
                    accountId_platform_externalId: {
                        accountId,
                        platform: 'INSTAGRAM',
                        externalId: igAccount.igUserId,
                    },
                },
                create: {
                    accountId,
                    platform: 'INSTAGRAM',
                    externalId: igAccount.igUserId,
                    name: `@${igAccount.username}`,
                    accessToken: page.accessToken, // Same page token works for IG
                    metadata: {
                        username: igAccount.username,
                        linkedPageId: page.id
                    },
                },
                update: {
                    name: `@${igAccount.username}`,
                    accessToken: page.accessToken,
                    metadata: {
                        username: igAccount.username,
                        linkedPageId: page.id
                    },
                    isActive: true,
                },
            });
        }

        Logger.info('Meta messaging connected', {
            accountId,
            pageId: page.id,
            hasInstagram: !!igAccount
        });

        const igStatus = igAccount ? '&instagram=connected' : '';
        return res.redirect(`${frontendRedirect}&success=meta_connected${igStatus}`);

    } catch (error: any) {
        Logger.error('Meta messaging OAuth callback failed', { error });
        res.redirect(`${frontendRedirect}&error=oauth_failed&message=${encodeURIComponent(error.message)}`);
    }
});

// ──────────────────────────────────────────────────────────────
// TIKTOK MESSAGING OAUTH FLOW
// ──────────────────────────────────────────────────────────────

import { TikTokMessagingService } from '../services/messaging/TikTokMessagingService';

/**
 * GET /api/oauth/tiktok/authorize
 * Initiates TikTok OAuth for Business Messaging.
 */
router.get('/tiktok/authorize', requireAuth, async (req: AuthenticatedRequest, res: Response) => {
    try {
        const accountId = (req as any).accountId;
        const frontendRedirect = req.query.redirect as string || '/settings?tab=channels';

        if (!accountId) {
            return res.status(400).json({ error: 'No account selected' });
        }

        const credentials = await prisma.platformCredentials.findUnique({
            where: { platform: 'TIKTOK_MESSAGING' },
        });

        if (!credentials) {
            return res.status(400).json({ error: 'TikTok messaging not configured. Contact admin.' });
        }

        const { clientKey } = credentials.credentials as any;

        const state = Buffer.from(JSON.stringify({
            accountId,
            frontendRedirect
        })).toString('base64');

        const apiUrl = process.env.API_URL?.replace(/\/+$/, '');
        const callbackUrl = apiUrl
            ? `${apiUrl}/api/oauth/tiktok/callback`
            : `${req.protocol}://${req.get('host')}/api/oauth/tiktok/callback`;

        // TikTok Business scope for messaging
        const scopes = 'user.info.basic,dm.manage';

        const authUrl = `https://www.tiktok.com/v2/auth/authorize?` +
            `client_key=${clientKey}` +
            `&redirect_uri=${encodeURIComponent(callbackUrl)}` +
            `&scope=${scopes}` +
            `&response_type=code` +
            `&state=${state}`;

        res.json({ authUrl });
    } catch (error: any) {
        Logger.error('TikTok OAuth init failed', { error });
        res.status(500).json({ error: error.message });
    }
});

/**
 * GET /api/oauth/tiktok/callback
 * Handles TikTok OAuth callback.
 */
router.get('/tiktok/callback', async (req: Request, res: Response) => {
    let frontendRedirect = '/settings?tab=channels';

    try {
        const { code, state, error, error_description } = req.query;

        if (error) {
            Logger.warn('TikTok OAuth denied', { error, error_description });
            return res.redirect(`${frontendRedirect}&error=oauth_denied`);
        }

        if (!code || !state) {
            return res.redirect(`${frontendRedirect}&error=missing_params`);
        }

        const stateData = JSON.parse(Buffer.from(state as string, 'base64').toString('utf-8'));
        frontendRedirect = stateData.frontendRedirect || frontendRedirect;
        const accountId = stateData.accountId;

        const credentials = await prisma.platformCredentials.findUnique({
            where: { platform: 'TIKTOK_MESSAGING' },
        });

        if (!credentials) {
            return res.redirect(`${frontendRedirect}&error=not_configured`);
        }

        const { clientKey, clientSecret } = credentials.credentials as any;

        const apiUrl = process.env.API_URL?.replace(/\/+$/, '');
        const callbackUrl = apiUrl
            ? `${apiUrl}/api/oauth/tiktok/callback`
            : `${req.protocol}://${req.get('host')}/api/oauth/tiktok/callback`;

        // Exchange code for tokens
        const tokens = await TikTokMessagingService.exchangeAuthCode(
            code as string,
            clientKey,
            clientSecret,
            callbackUrl
        );

        if (!tokens) {
            return res.redirect(`${frontendRedirect}&error=token_exchange_failed`);
        }

        // Store TikTok account
        const expiresAt = new Date(Date.now() + tokens.expiresIn * 1000);

        await prisma.socialAccount.upsert({
            where: {
                accountId_platform_externalId: {
                    accountId,
                    platform: 'TIKTOK',
                    externalId: tokens.openId,
                },
            },
            create: {
                accountId,
                platform: 'TIKTOK',
                externalId: tokens.openId,
                name: 'TikTok Business',
                accessToken: tokens.accessToken,
                refreshToken: tokens.refreshToken,
                tokenExpiry: expiresAt,
                metadata: { openId: tokens.openId },
            },
            update: {
                accessToken: tokens.accessToken,
                refreshToken: tokens.refreshToken,
                tokenExpiry: expiresAt,
                isActive: true,
            },
        });

        Logger.info('TikTok messaging connected', { accountId, openId: tokens.openId });
        return res.redirect(`${frontendRedirect}&success=tiktok_connected`);

    } catch (error: any) {
        Logger.error('TikTok OAuth callback failed', { error });
        res.redirect(`${frontendRedirect}&error=oauth_failed&message=${encodeURIComponent(error.message)}`);
    }
});

// ──────────────────────────────────────────────────────────────
// SOCIAL ACCOUNTS API
// ──────────────────────────────────────────────────────────────

/**
 * GET /api/oauth/social-accounts
 * List all connected social messaging accounts.
 */
router.get('/social-accounts', requireAuth, async (req: AuthenticatedRequest, res: Response) => {
    try {
        const accountId = (req as any).accountId;

        const socialAccounts = await prisma.socialAccount.findMany({
            where: { accountId, isActive: true },
            select: {
                id: true,
                platform: true,
                name: true,
                externalId: true,
                tokenExpiry: true,
                createdAt: true,
            },
        });

        res.json({ socialAccounts });
    } catch (error: any) {
        Logger.error('Failed to list social accounts', { error });
        res.status(500).json({ error: error.message });
    }
});

/**
 * DELETE /api/oauth/social-accounts/:id
 * Disconnect a social messaging account.
 */
router.delete('/social-accounts/:id', requireAuth, async (req: AuthenticatedRequest, res: Response) => {
    try {
        const accountId = (req as any).accountId;
        const { id } = req.params;

        await prisma.socialAccount.updateMany({
            where: { id, accountId },
            data: { isActive: false },
        });

        res.json({ success: true });
    } catch (error: any) {
        Logger.error('Failed to disconnect social account', { error });
        res.status(500).json({ error: error.message });
    }
});

export default router;

