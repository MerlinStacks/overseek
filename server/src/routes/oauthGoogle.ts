/**
 * Google OAuth Routes
 * 
 * Google Ads OAuth authorization and callback.
 */

import { Router, Response, Request } from 'express';
import { AuthenticatedRequest } from '../types/express';
import { AdsService } from '../services/ads';
import { requireAuth } from '../middleware/auth';
import { Logger } from '../utils/logger';

const router = Router();

/**
 * GET /google/authorize - Initiate Google OAuth
 */
router.get('/google/authorize', requireAuth, async (req: AuthenticatedRequest, res: Response) => {
    try {
        const accountId = (req as any).accountId;
        const frontendRedirect = req.query.redirect as string || '/settings/integrations';

        if (!accountId) {
            return res.status(400).json({ error: 'No account selected' });
        }

        const state = Buffer.from(JSON.stringify({ accountId, frontendRedirect })).toString('base64');

        const apiUrl = process.env.API_URL?.replace(/\/+$/, '');
        const callbackUrl = apiUrl
            ? `${apiUrl}/api/oauth/google/callback`
            : `${req.protocol}://${req.get('host')}/api/oauth/google/callback`;

        const authUrl = await AdsService.getGoogleAuthUrl(callbackUrl, state);
        res.json({ authUrl });
    } catch (error: any) {
        Logger.error('Failed to generate Google OAuth URL', { error });
        res.status(500).json({ error: error.message });
    }
});

/**
 * GET /google/callback - Handle Google OAuth callback
 */
router.get('/google/callback', async (req: Request, res: Response) => {
    let frontendRedirect = '/marketing?tab=ads';

    try {
        const { code, state, error } = req.query;

        if (error) {
            Logger.warn('Google OAuth denied', { error });
            return res.redirect(`${frontendRedirect}?error=oauth_denied`);
        }

        if (!code || !state) {
            return res.redirect(`${frontendRedirect}?error=missing_params`);
        }

        let stateData: { accountId: string; frontendRedirect: string };
        try {
            stateData = JSON.parse(Buffer.from(state as string, 'base64').toString('utf-8'));
            frontendRedirect = stateData.frontendRedirect || frontendRedirect;
        } catch {
            return res.redirect(`${frontendRedirect}?error=invalid_state`);
        }

        const apiUrl = process.env.API_URL?.replace(/\/+$/, '');
        const redirectUri = apiUrl
            ? `${apiUrl}/api/oauth/google/callback`
            : `${req.protocol}://${req.get('host')}/api/oauth/google/callback`;

        const tokens = await AdsService.exchangeGoogleCode(code as string, redirectUri);

        const pendingAccount = await AdsService.connectAccount(stateData.accountId, {
            platform: 'GOOGLE',
            externalId: 'PENDING_SETUP',
            accessToken: tokens.accessToken,
            refreshToken: tokens.refreshToken || '',
            name: 'Google Ads (Pending Setup)'
        });

        return res.redirect(`${frontendRedirect}?success=google_pending&pendingId=${pendingAccount.id}`);

    } catch (error: any) {
        Logger.error('Google OAuth callback failed', { error: error.message });
        res.redirect(`${frontendRedirect}?error=oauth_failed&message=${encodeURIComponent(error.message)}`);
    }
});

export default router;
