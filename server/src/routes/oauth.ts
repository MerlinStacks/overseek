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

export default router;
