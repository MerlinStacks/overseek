import { Router, Response } from 'express';
import { AuthenticatedRequest } from '../types/express';
import { AdsService } from '../services/ads';
import { requireAuth } from '../middleware/auth';

const router = Router();

router.use(requireAuth);

// LIST connected ad accounts
router.get('/', async (req: AuthenticatedRequest, res: Response) => {
    const accountId = (req as any).accountId;
    if (!accountId) return res.status(400).json({ error: 'No account selected' });

    const accounts = await AdsService.getAdAccounts(accountId);
    // Be careful not to expose full access tokens to frontend if possible, 
    // but for "Settings" page we might show masked.
    const safeAccounts = accounts.map(a => ({
        ...a,
        accessToken: `${a.accessToken.substring(0, 10)}...` // Mask
    }));
    res.json(safeAccounts);
});

// CONNECT a new ad account
router.post('/connect', async (req: AuthenticatedRequest, res: Response) => {
    const accountId = (req as any).accountId;
    if (!accountId) return res.status(400).json({ error: 'No account selected' });

    try {
        const { platform, externalId, accessToken, name } = req.body;
        const adAccount = await AdsService.connectAccount(accountId, { platform, externalId, accessToken, name });
        res.json(adAccount);
    } catch (error: any) {
        console.error(error);
        res.status(500).json({ error: 'Failed to connect ad account' });
    }
});

// GET INSIGHTS for a specific AdAccount
router.get('/:adAccountId/insights', async (req: AuthenticatedRequest, res: Response) => {
    try {
        const { adAccountId } = req.params;
        const insights = await AdsService.getMetaInsights(adAccountId);
        res.json(insights);
    } catch (error: any) {
        res.status(500).json({ error: error.message });
    }
});

export default router;
