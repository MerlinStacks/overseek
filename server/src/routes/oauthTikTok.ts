/**
 * TikTok OAuth Routes
 * 
 * TikTok Business Messaging OAuth.
 */

import { Router, Response, Request } from 'express';
import { AuthenticatedRequest } from '../types/express';
import { requireAuth } from '../middleware/auth';
import { Logger } from '../utils/logger';
import { prisma } from '../utils/prisma';
import { TikTokMessagingService } from '../services/messaging/TikTokMessagingService';

const router = Router();

/**
 * GET /tiktok/authorize - Initiate TikTok OAuth
 */
router.get('/tiktok/authorize', requireAuth, async (req: AuthenticatedRequest, res: Response) => {
    try {
        const accountId = (req as any).accountId;
        const frontendRedirect = req.query.redirect as string || '/settings?tab=channels';

        if (!accountId) return res.status(400).json({ error: 'No account selected' });

        const credentials = await prisma.platformCredentials.findUnique({ where: { platform: 'TIKTOK_MESSAGING' } });
        if (!credentials) return res.status(400).json({ error: 'TikTok messaging not configured' });

        const { clientKey } = credentials.credentials as any;
        const state = Buffer.from(JSON.stringify({ accountId, frontendRedirect })).toString('base64');

        const apiUrl = process.env.API_URL?.replace(/\/+$/, '');
        const callbackUrl = apiUrl
            ? `${apiUrl}/api/oauth/tiktok/callback`
            : `${req.protocol}://${req.get('host')}/api/oauth/tiktok/callback`;

        const scopes = 'user.info.basic,dm.manage';
        const authUrl = `https://www.tiktok.com/v2/auth/authorize?client_key=${clientKey}&redirect_uri=${encodeURIComponent(callbackUrl)}&scope=${scopes}&response_type=code&state=${state}`;
        res.json({ authUrl });
    } catch (error: any) {
        Logger.error('TikTok OAuth init failed', { error });
        res.status(500).json({ error: error.message });
    }
});

/**
 * GET /tiktok/callback - Handle TikTok OAuth callback
 */
router.get('/tiktok/callback', async (req: Request, res: Response) => {
    let frontendRedirect = '/settings?tab=channels';

    try {
        const { code, state, error, error_description } = req.query;

        if (error) {
            Logger.warn('TikTok OAuth denied', { error, error_description });
            return res.redirect(`${frontendRedirect}&error=oauth_denied`);
        }

        if (!code || !state) return res.redirect(`${frontendRedirect}&error=missing_params`);

        const stateData = JSON.parse(Buffer.from(state as string, 'base64').toString('utf-8'));
        frontendRedirect = stateData.frontendRedirect || frontendRedirect;
        const accountId = stateData.accountId;

        const credentials = await prisma.platformCredentials.findUnique({ where: { platform: 'TIKTOK_MESSAGING' } });
        if (!credentials) return res.redirect(`${frontendRedirect}&error=not_configured`);

        const { clientKey, clientSecret } = credentials.credentials as any;

        const apiUrl = process.env.API_URL?.replace(/\/+$/, '');
        const callbackUrl = apiUrl
            ? `${apiUrl}/api/oauth/tiktok/callback`
            : `${req.protocol}://${req.get('host')}/api/oauth/tiktok/callback`;

        const tokens = await TikTokMessagingService.exchangeAuthCode(code as string, clientKey, clientSecret, callbackUrl);
        if (!tokens) return res.redirect(`${frontendRedirect}&error=token_exchange_failed`);

        const expiresAt = new Date(Date.now() + tokens.expiresIn * 1000);

        await prisma.socialAccount.upsert({
            where: { accountId_platform_externalId: { accountId, platform: 'TIKTOK', externalId: tokens.openId } },
            create: { accountId, platform: 'TIKTOK', externalId: tokens.openId, name: 'TikTok Business', accessToken: tokens.accessToken, refreshToken: tokens.refreshToken, tokenExpiry: expiresAt, metadata: { openId: tokens.openId } },
            update: { accessToken: tokens.accessToken, refreshToken: tokens.refreshToken, tokenExpiry: expiresAt, isActive: true },
        });

        Logger.info('TikTok messaging connected', { accountId, openId: tokens.openId });
        return res.redirect(`${frontendRedirect}&success=tiktok_connected`);

    } catch (error: any) {
        Logger.error('TikTok OAuth callback failed', { error });
        res.redirect(`${frontendRedirect}&error=oauth_failed&message=${encodeURIComponent(error.message)}`);
    }
});

export default router;
