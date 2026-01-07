/**
 * Meta OAuth Routes
 * 
 * Meta Ads token exchange and Messaging OAuth (Facebook/Instagram).
 */

import { Router, Response, Request } from 'express';
import { AuthenticatedRequest } from '../types/express';
import { AdsService } from '../services/ads';
import { requireAuth } from '../middleware/auth';
import { Logger } from '../utils/logger';
import { prisma } from '../utils/prisma';
import { MetaMessagingService } from '../services/messaging/MetaMessagingService';

const router = Router();

/**
 * POST /meta/exchange - Exchange short-lived token for long-lived
 */
router.post('/meta/exchange', requireAuth, async (req: AuthenticatedRequest, res: Response) => {
    try {
        const { shortLivedToken } = req.body;
        if (!shortLivedToken) {
            return res.status(400).json({ error: 'Missing shortLivedToken' });
        }
        const longLivedToken = await AdsService.exchangeMetaToken(shortLivedToken);
        res.json({ accessToken: longLivedToken });
    } catch (error: any) {
        Logger.error('Meta token exchange failed', { error });
        res.status(500).json({ error: error.message });
    }
});

/**
 * GET /meta/messaging/authorize - Initiate Meta Messaging OAuth
 */
router.get('/meta/messaging/authorize', requireAuth, async (req: AuthenticatedRequest, res: Response) => {
    try {
        const accountId = (req as any).accountId;
        const frontendRedirect = req.query.redirect as string || '/settings?tab=channels';

        if (!accountId) return res.status(400).json({ error: 'No account selected' });

        const credentials = await prisma.platformCredentials.findUnique({ where: { platform: 'META_MESSAGING' } });
        if (!credentials) return res.status(400).json({ error: 'Meta messaging not configured' });

        const { appId } = credentials.credentials as any;
        const state = Buffer.from(JSON.stringify({ accountId, frontendRedirect })).toString('base64');

        const apiUrl = process.env.API_URL?.replace(/\/+$/, '');
        const callbackUrl = apiUrl
            ? `${apiUrl}/api/oauth/meta/messaging/callback`
            : `${req.protocol}://${req.get('host')}/api/oauth/meta/messaging/callback`;

        const scopes = 'pages_messaging,pages_manage_metadata,pages_show_list,instagram_basic,instagram_manage_messages';
        const authUrl = `https://www.facebook.com/v18.0/dialog/oauth?client_id=${appId}&redirect_uri=${encodeURIComponent(callbackUrl)}&scope=${scopes}&state=${state}`;
        res.json({ authUrl });
    } catch (error: any) {
        Logger.error('Meta messaging OAuth init failed', { error });
        res.status(500).json({ error: error.message });
    }
});

/**
 * GET /meta/messaging/callback - Handle Meta Messaging OAuth callback
 */
router.get('/meta/messaging/callback', async (req: Request, res: Response) => {
    let frontendRedirect = '/settings?tab=channels';

    try {
        const { code, state, error } = req.query;

        if (error) return res.redirect(`${frontendRedirect}&error=oauth_denied`);
        if (!code || !state) return res.redirect(`${frontendRedirect}&error=missing_params`);

        const stateData = JSON.parse(Buffer.from(state as string, 'base64').toString('utf-8'));
        frontendRedirect = stateData.frontendRedirect || frontendRedirect;
        const accountId = stateData.accountId;

        const credentials = await prisma.platformCredentials.findUnique({ where: { platform: 'META_MESSAGING' } });
        if (!credentials) return res.redirect(`${frontendRedirect}&error=not_configured`);

        const { appId, appSecret } = credentials.credentials as any;

        const apiUrl = process.env.API_URL?.replace(/\/+$/, '');
        const callbackUrl = apiUrl
            ? `${apiUrl}/api/oauth/meta/messaging/callback`
            : `${req.protocol}://${req.get('host')}/api/oauth/meta/messaging/callback`;

        const tokenResponse = await fetch(
            `https://graph.facebook.com/v18.0/oauth/access_token?client_id=${appId}&redirect_uri=${encodeURIComponent(callbackUrl)}&client_secret=${appSecret}&code=${code}`
        );
        const tokenData = await tokenResponse.json();
        if (tokenData.error) throw new Error(tokenData.error.message);

        const pages = await MetaMessagingService.listUserPages(tokenData.access_token);
        if (pages.length === 0) return res.redirect(`${frontendRedirect}&error=no_pages`);

        const page = pages[0];
        const igAccount = await MetaMessagingService.getInstagramBusinessAccount(page.accessToken, page.id);

        // Store Facebook page
        await prisma.socialAccount.upsert({
            where: { accountId_platform_externalId: { accountId, platform: 'FACEBOOK', externalId: page.id } },
            create: { accountId, platform: 'FACEBOOK', externalId: page.id, name: page.name, accessToken: page.accessToken, metadata: { userAccessToken: tokenData.access_token } },
            update: { name: page.name, accessToken: page.accessToken, metadata: { userAccessToken: tokenData.access_token }, isActive: true },
        });

        // Store Instagram if linked
        if (igAccount) {
            await prisma.socialAccount.upsert({
                where: { accountId_platform_externalId: { accountId, platform: 'INSTAGRAM', externalId: igAccount.igUserId } },
                create: { accountId, platform: 'INSTAGRAM', externalId: igAccount.igUserId, name: `@${igAccount.username}`, accessToken: page.accessToken, metadata: { username: igAccount.username, linkedPageId: page.id } },
                update: { name: `@${igAccount.username}`, accessToken: page.accessToken, metadata: { username: igAccount.username, linkedPageId: page.id }, isActive: true },
            });
        }

        Logger.info('Meta messaging connected', { accountId, pageId: page.id, hasInstagram: !!igAccount });
        return res.redirect(`${frontendRedirect}&success=meta_connected${igAccount ? '&instagram=connected' : ''}`);

    } catch (error: any) {
        Logger.error('Meta messaging OAuth callback failed', { error });
        res.redirect(`${frontendRedirect}&error=oauth_failed&message=${encodeURIComponent(error.message)}`);
    }
});

export default router;
