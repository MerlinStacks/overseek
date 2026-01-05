import { Router, Request, Response } from 'express';
import { SalesAnalytics } from '../services/analytics/sales';
import { AcquisitionAnalytics } from '../services/analytics/acquisition';
import { BehaviourAnalytics } from '../services/analytics/behaviour';
import { CustomerAnalytics } from '../services/analytics/customer';
import { AdsService } from '../services/ads';
import { requireAuth } from '../middleware/auth';
import { esClient } from '../utils/elastic';
import { PrismaClient } from '@prisma/client';

const router = Router();
const prisma = new PrismaClient();

router.use(requireAuth);

router.get('/sales', async (req: Request, res: Response) => {
    try {
        const accountId = (req as any).accountId;
        if (!accountId) return res.status(400).json({ error: 'No account' });

        const { startDate, endDate } = req.query;

        const total = await SalesAnalytics.getTotalSales(accountId, startDate as string, endDate as string);

        const account = await prisma.account.findUnique({ where: { id: accountId } });
        const currency = account?.currency || 'USD';

        res.json({ total, currency });
    } catch (err: any) {
        console.error(err);
        res.status(500).json({ error: err.message });
    }
});

router.get('/recent-orders', async (req: Request, res: Response) => {
    try {
        const accountId = (req as any).accountId;
        if (!accountId) return res.status(400).json({ error: 'No account' });

        const orders = await SalesAnalytics.getRecentOrders(accountId);
        res.json(orders);
    } catch (err: any) {
        console.error(err);
        res.status(500).json({ error: err.message });
    }
});

// Aggregate Ad Spend across ALL connected accounts
router.get('/ads-summary', async (req: Request, res: Response) => {
    try {
        const accountId = (req as any).accountId;
        if (!accountId) return res.status(400).json({ error: 'No account' });

        const response = await esClient.search({
            index: 'ad_spend',
            body: {
                query: {
                    term: { accountId: accountId }
                },
                aggs: {
                    daily_spend: {
                        date_histogram: {
                            field: 'date',
                            calendar_interval: 'day'
                        },
                        aggs: {
                            daily_spend: {
                                sum: { field: 'spend' }
                            }
                        }
                    }
                },
                size: 0
            }
        });

        const adSpendBuckets = ((response as any).aggregations?.daily_spend as any)?.buckets || [];

        const totalAdSpend = adSpendBuckets.reduce((acc: number, b: any) => acc + (b.daily_spend.value || 0), 0);

        res.json({
            totalAdSpend,
            breakdown: adSpendBuckets // Optional: send daily breakdown if needed
        });
    } catch (error) {
        console.error(error);
        res.status(500).json({ error: 'Failed to fetch ad spend' });
    }
});

// --- New Reports Endpoints ---

router.get('/sales-chart', async (req: Request, res: Response) => {
    try {
        const accountId = (req as any).accountId;
        const { startDate, endDate, interval } = req.query;
        const data = await SalesAnalytics.getSalesOverTime(accountId, startDate as string, endDate as string, interval as any);
        res.json(data);
    } catch (e) { res.status(500).json({ error: 'Failed' }); }
});

router.get('/top-products', async (req: Request, res: Response) => {
    try {
        const accountId = (req as any).accountId;
        const { startDate, endDate } = req.query;
        const data = await SalesAnalytics.getTopProducts(accountId, startDate as string, endDate as string);
        res.json(data);
    } catch (e) { res.status(500).json({ error: 'Failed' }); }
});

router.get('/customer-growth', async (req: Request, res: Response) => {
    try {
        const accountId = (req as any).accountId;
        const { startDate, endDate } = req.query;
        const data = await CustomerAnalytics.getCustomerGrowth(accountId, startDate as string, endDate as string);
        res.json(data);
    } catch (e) { res.status(500).json({ error: 'Failed' }); }
});



router.get('/forecast', async (req: Request, res: Response) => {
    try {
        const accountId = (req as any).accountId;
        const days = parseInt(req.query.days as string) || 30;
        const data = await SalesAnalytics.getSalesForecast(accountId, days);
        res.json(data);
    } catch (e) { res.status(500).json({ error: 'Failed' }); }
});

router.post('/custom-report', async (req: Request, res: Response) => {
    try {
        const accountId = (req as any).accountId;
        // config expected: { metrics: [], dimension: '', startDate: '', endDate: '' }
        const config = req.body;
        const data = await SalesAnalytics.getCustomReport(accountId, config);
        res.json(data);
    } catch (e) { res.status(500).json({ error: 'Failed' }); }
});

router.get('/acquisition/channels', async (req: Request, res: Response) => {
    try {
        const accountId = (req as any).accountId;
        const { startDate, endDate } = req.query;
        const data = await AcquisitionAnalytics.getAcquisitionChannels(accountId, startDate as string, endDate as string);
        res.json(data);
    } catch (e) { res.status(500).json({ error: 'Failed' }); }
});

router.get('/acquisition/campaigns', async (req: Request, res: Response) => {
    try {
        const accountId = (req as any).accountId;
        const { startDate, endDate } = req.query;
        const data = await AcquisitionAnalytics.getAcquisitionCampaigns(accountId, startDate as string, endDate as string);
        res.json(data);
    } catch (e) { res.status(500).json({ error: 'Failed' }); }
});

router.get('/behaviour/pages', async (req: Request, res: Response) => {
    try {
        const accountId = (req as any).accountId;
        const { startDate, endDate } = req.query;
        const data = await BehaviourAnalytics.getBehaviourPages(accountId, startDate as string, endDate as string);
        res.json(data);
    } catch (e) { res.status(500).json({ error: 'Failed' }); }
});

router.get('/behaviour/search', async (req: Request, res: Response) => {
    try {
        const accountId = (req as any).accountId;
        const { startDate, endDate } = req.query;
        const data = await BehaviourAnalytics.getSiteSearch(accountId, startDate as string, endDate as string);
        res.json(data);
    } catch (e) { res.status(500).json({ error: 'Failed' }); }
});

router.get('/behaviour/entry', async (req: Request, res: Response) => {
    try {
        const accountId = (req as any).accountId;
        const { startDate, endDate } = req.query;
        const data = await BehaviourAnalytics.getEntryPages(accountId, startDate as string, endDate as string);
        res.json(data);
    } catch (e) { res.status(500).json({ error: 'Failed' }); }
});

router.get('/behaviour/exit', async (req: Request, res: Response) => {
    try {
        const accountId = (req as any).accountId;
        const { startDate, endDate } = req.query;
        const data = await BehaviourAnalytics.getExitPages(accountId, startDate as string, endDate as string);
        res.json(data);
    } catch (e) { res.status(500).json({ error: 'Failed' }); }
});

export default router;
