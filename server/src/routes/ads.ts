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

/**
 * GET /api/ads/:adAccountId/campaigns
 * Fetch campaign-level breakdown for an ad account.
 * Supports both Google Ads and Meta Ads.
 * Query params: days (default: 30)
 */
router.get('/:adAccountId/campaigns', async (req: AuthenticatedRequest, res: Response) => {
    try {
        const { adAccountId } = req.params;
        const days = parseInt(req.query.days as string) || 30;

        // Get account to determine platform
        const accounts = await AdsService.getAdAccounts((req as any).accountId);
        const adAccount = accounts.find(a => a.id === adAccountId);

        if (!adAccount) {
            return res.status(404).json({ error: 'Ad account not found' });
        }

        let campaigns = null;
        if (adAccount.platform === 'GOOGLE') {
            campaigns = await AdsService.getGoogleCampaignInsights(adAccountId, days);
        } else if (adAccount.platform === 'META') {
            campaigns = await AdsService.getMetaCampaignInsights(adAccountId, days);
        } else {
            return res.status(400).json({ error: `Campaign breakdown not supported for platform: ${adAccount.platform}` });
        }

        res.json(campaigns);
    } catch (error: any) {
        Logger.error('Failed to fetch campaign insights', { error });
        res.status(500).json({ error: error.message });
    }
});

/**
 * GET /api/ads/:adAccountId/trends
 * Fetch daily performance trends for an ad account.
 * Supports both Google Ads and Meta Ads.
 * Query params: days (default: 30)
 */
router.get('/:adAccountId/trends', async (req: AuthenticatedRequest, res: Response) => {
    try {
        const { adAccountId } = req.params;
        const days = parseInt(req.query.days as string) || 30;

        // Get account to determine platform
        const accounts = await AdsService.getAdAccounts((req as any).accountId);
        const adAccount = accounts.find(a => a.id === adAccountId);

        if (!adAccount) {
            return res.status(404).json({ error: 'Ad account not found' });
        }

        let trends = null;
        if (adAccount.platform === 'GOOGLE') {
            trends = await AdsService.getGoogleDailyTrends(adAccountId, days);
        } else if (adAccount.platform === 'META') {
            trends = await AdsService.getMetaDailyTrends(adAccountId, days);
        } else {
            return res.status(400).json({ error: `Trend data not supported for platform: ${adAccount.platform}` });
        }

        res.json(trends);
    } catch (error: any) {
        Logger.error('Failed to fetch daily trends', { error });
        res.status(500).json({ error: error.message });
    }
});

/**
 * GET /api/ads/:adAccountId/shopping-products
 * Fetch product-level performance data for Shopping campaigns.
 * Only available for Google Ads accounts with Shopping campaigns.
 * Query params: days (default: 30), limit (default: 200)
 */
router.get('/:adAccountId/shopping-products', async (req: AuthenticatedRequest, res: Response) => {
    try {
        const { adAccountId } = req.params;
        const days = parseInt(req.query.days as string) || 30;
        const limit = Math.min(parseInt(req.query.limit as string) || 200, 500); // Cap at 500

        // Get account to determine platform
        const accounts = await AdsService.getAdAccounts((req as any).accountId);
        const adAccount = accounts.find(a => a.id === adAccountId);

        if (!adAccount) {
            return res.status(404).json({ error: 'Ad account not found' });
        }

        if (adAccount.platform !== 'GOOGLE') {
            return res.status(400).json({ error: 'Shopping product data is only available for Google Ads accounts' });
        }

        const products = await AdsService.getGoogleShoppingProducts(adAccountId, days, limit);
        res.json(products);
    } catch (error: any) {
        Logger.error('Failed to fetch shopping products', { error });
        res.status(500).json({ error: error.message });
    }
});

/**
 * GET /api/ads/:adAccountId/analysis
 * Get AI-powered analysis and optimization suggestions for a Google Ads account.
 */
router.get('/:adAccountId/analysis', async (req: AuthenticatedRequest, res: Response) => {
    try {
        const accountId = (req as any).accountId;
        if (!accountId) return res.status(400).json({ error: 'No account selected' });

        // Import AdsTools for analysis
        const { AdsTools } = await import('../services/tools/AdsTools');
        const suggestions = await AdsTools.getAdOptimizationSuggestions(accountId);

        res.json(suggestions);
    } catch (error: any) {
        Logger.error('Failed to fetch ad analysis', { error });
        res.status(500).json({ error: error.message });
    }
});

/**
 * PATCH /api/ads/:adAccountId/complete-setup
 * Complete setup for a pending Google Ads account by providing the Customer ID.
 * Body: { customerId: string, name?: string }
 */
router.patch('/:adAccountId/complete-setup', async (req: AuthenticatedRequest, res: Response) => {
    const accountId = (req as any).accountId;
    if (!accountId) return res.status(400).json({ error: 'No account selected' });

    try {
        const { adAccountId } = req.params;
        const { customerId, name } = req.body;

        if (!customerId) {
            return res.status(400).json({ error: 'Customer ID is required' });
        }

        // Verify the ad account exists and belongs to this account
        const accounts = await AdsService.getAdAccounts(accountId);
        const adAccount = accounts.find(a => a.id === adAccountId);

        if (!adAccount) {
            return res.status(404).json({ error: 'Ad account not found' });
        }

        if (adAccount.externalId !== 'PENDING_SETUP') {
            return res.status(400).json({ error: 'Account is already configured' });
        }

        // Update the account with the provided Customer ID
        const updatedAccount = await AdsService.updateAccount(adAccountId, {
            name: name || `Google Ads (${customerId})`
        });

        // Also update the externalId (need to use prisma directly)
        const { prisma } = await import('../utils/prisma');
        await prisma.adAccount.update({
            where: { id: adAccountId },
            data: { externalId: customerId.replace(/-/g, '') } // Remove dashes if present
        });

        Logger.info('Google Ads account setup completed', { adAccountId, customerId });

        res.json({ success: true, message: 'Google Ads account configured successfully' });
    } catch (error: any) {
        Logger.error('Failed to complete ad account setup', { error });
        res.status(500).json({ error: error.message });
    }
});

export default router;

