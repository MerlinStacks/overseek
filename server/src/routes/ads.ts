import { Router, Response } from 'express';
import { AuthenticatedRequest } from '../types/express';
import { AdsService } from '../services/ads';
import { requireAuth } from '../middleware/auth';
import { Logger } from '../utils/logger';

const router = Router();

router.use(requireAuth);

/**
 * GET /api/ads
 * List all connected ad accounts for the current store account.
 */
router.get('/', async (req: AuthenticatedRequest, res: Response) => {
    const accountId = (req as any).accountId;
    if (!accountId) return res.status(400).json({ error: 'No account selected' });

    try {
        const accounts = await AdsService.getAdAccounts(accountId);
        // Mask access tokens for security
        const safeAccounts = accounts.map(a => ({
            ...a,
            accessToken: a.accessToken ? `${a.accessToken.substring(0, 10)}...` : null,
            refreshToken: a.refreshToken ? '********' : null
        }));
        res.json(safeAccounts);
    } catch (error: any) {
        Logger.error('Failed to list ad accounts', { error });
        res.status(500).json({ error: 'Failed to list ad accounts' });
    }
});

/**
 * POST /api/ads/connect
 * Connect a new ad account manually (Meta Ads with access token).
 * For Google Ads, use the OAuth flow via /api/oauth/google/authorize instead.
 */
router.post('/connect', async (req: AuthenticatedRequest, res: Response) => {
    const accountId = (req as any).accountId;
    if (!accountId) return res.status(400).json({ error: 'No account selected' });

    try {
        const { platform, externalId, accessToken, refreshToken, name, currency } = req.body;

        if (!platform || !externalId || !accessToken) {
            return res.status(400).json({ error: 'Missing required fields: platform, externalId, accessToken' });
        }

        const adAccount = await AdsService.connectAccount(accountId, {
            platform,
            externalId,
            accessToken,
            refreshToken,
            name,
            currency
        });

        res.json({
            ...adAccount,
            accessToken: `${adAccount.accessToken.substring(0, 10)}...`,
            refreshToken: adAccount.refreshToken ? '********' : null
        });
    } catch (error: any) {
        Logger.error('Failed to connect ad account', { error });
        res.status(500).json({ error: 'Failed to connect ad account' });
    }
});

/**
 * DELETE /api/ads/:adAccountId
 * Disconnect (delete) an ad account.
 */
router.delete('/:adAccountId', async (req: AuthenticatedRequest, res: Response) => {
    const accountId = (req as any).accountId;
    if (!accountId) return res.status(400).json({ error: 'No account selected' });

    try {
        const { adAccountId } = req.params;
        await AdsService.disconnectAccount(adAccountId);
        res.json({ success: true });
    } catch (error: any) {
        Logger.error('Failed to disconnect ad account', { error });
        res.status(500).json({ error: 'Failed to disconnect ad account' });
    }
});

/**
 * GET /api/ads/:adAccountId/insights
 * Fetch insights for a specific ad account (last 30 days).
 * Automatically routes to correct platform API.
 */
router.get('/:adAccountId/insights', async (req: AuthenticatedRequest, res: Response) => {
    try {
        const { adAccountId } = req.params;

        // Get account to determine platform
        const accounts = await AdsService.getAdAccounts((req as any).accountId);
        const adAccount = accounts.find(a => a.id === adAccountId);

        if (!adAccount) {
            return res.status(404).json({ error: 'Ad account not found' });
        }

        let insights = null;
        if (adAccount.platform === 'META') {
            insights = await AdsService.getMetaInsights(adAccountId);
        } else if (adAccount.platform === 'GOOGLE') {
            insights = await AdsService.getGoogleInsights(adAccountId);
        } else {
            return res.status(400).json({ error: `Unsupported platform: ${adAccount.platform}` });
        }

        res.json(insights || { spend: 0, impressions: 0, clicks: 0, roas: 0 });
    } catch (error: any) {
        Logger.error('Failed to fetch ad insights', { error });
        res.status(500).json({ error: error.message });
    }
});

export default router;
