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

        // Get the callback URL (this server's callback endpoint)
        const protocol = req.headers['x-forwarded-proto'] || req.protocol;
        const host = req.headers['x-forwarded-host'] || req.get('host');
        const callbackUrl = `${protocol}://${host}/api/oauth/google/callback`;

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
    try {
        const { code, state, error } = req.query;

        if (error) {
            Logger.warn('Google OAuth denied', { error });
            return res.redirect('/settings/integrations?error=oauth_denied');
        }

        if (!code || !state) {
            return res.status(400).json({ error: 'Missing code or state parameter' });
        }

        // Decode state
        let stateData: { accountId: string; frontendRedirect: string };
        try {
            stateData = JSON.parse(Buffer.from(state as string, 'base64').toString('utf-8'));
        } catch {
            return res.status(400).json({ error: 'Invalid state parameter' });
        }

        // Build redirect URI (must match exactly what was used in authorize)
        const protocol = req.headers['x-forwarded-proto'] || req.protocol;
        const host = req.headers['x-forwarded-host'] || req.get('host');
        const redirectUri = `${protocol}://${host}/api/oauth/google/callback`;

        // Exchange code for tokens
        const tokens = await AdsService.exchangeGoogleCode(code as string, redirectUri);

        // List available Google Ads customer accounts
        const customers = await AdsService.listGoogleCustomers(tokens.refreshToken);

        if (customers.length === 0) {
            return res.redirect(`${stateData.frontendRedirect}?error=no_google_accounts`);
        }

        // If only one account, auto-connect it
        if (customers.length === 1) {
            await AdsService.connectAccount(stateData.accountId, {
                platform: 'GOOGLE',
                externalId: customers[0].id,
                accessToken: tokens.accessToken,
                refreshToken: tokens.refreshToken,
                name: customers[0].name
            });

            return res.redirect(`${stateData.frontendRedirect}?success=google_connected`);
        }

        // Multiple accounts - redirect to selection page with data
        // Store tokens temporarily in session or pass via secure method
        // For simplicity, we'll connect the first account and let user manage via UI
        await AdsService.connectAccount(stateData.accountId, {
            platform: 'GOOGLE',
            externalId: customers[0].id,
            accessToken: tokens.accessToken,
            refreshToken: tokens.refreshToken,
            name: customers[0].name
        });

        return res.redirect(`${stateData.frontendRedirect}?success=google_connected&accounts=${customers.length}`);

    } catch (error: any) {
        Logger.error('Google OAuth callback failed', { error });
        res.redirect('/settings/integrations?error=oauth_failed');
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
