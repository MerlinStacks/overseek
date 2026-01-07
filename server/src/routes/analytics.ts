/**
 * Analytics Routes
 * 
 * Main analytics router combining visitor, sales, and behaviour endpoints.
 */

import { Router, Response } from 'express';
import { AuthenticatedRequest } from '../types/express';
import { SalesAnalytics } from '../services/analytics/sales';
import { AcquisitionAnalytics } from '../services/analytics/acquisition';
import { BehaviourAnalytics } from '../services/analytics/behaviour';
import { CustomerAnalytics } from '../services/analytics/customer';
import { RoadblockAnalytics } from '../services/analytics/roadblock';
import { AdsService } from '../services/ads';
import { requireAuth } from '../middleware/auth';
import { prisma } from '../utils/prisma';
import { Logger } from '../utils/logger';
import { AnalyticsService } from '../services/AnalyticsService';

// Import sub-routers
import analyticsReports from './analyticsReports';
import analyticsInventory from './analyticsInventory';

const router = Router();

router.use(requireAuth);

// Mount sub-routers
router.use('/', analyticsReports);     // /templates, /schedules
router.use('/', analyticsInventory);   // /stock-velocity

// --- Visitor & Channel Endpoints ---
router.get('/visitors/log', async (req: AuthenticatedRequest, res: Response) => {
    try {
        const accountId = (req as any).accountId;
        const page = parseInt(req.query.page as string) || 1;
        const limit = parseInt(req.query.limit as string) || 50;
        const liveMode = req.query.live === 'true';
        res.json(await AnalyticsService.getVisitorLog(accountId, page, limit, liveMode));
    } catch (e: any) { res.status(500).json({ error: e.message }); }
});

router.get('/ecommerce/log', async (req: AuthenticatedRequest, res: Response) => {
    try {
        const accountId = (req as any).accountId;
        const page = parseInt(req.query.page as string) || 1;
        const limit = parseInt(req.query.limit as string) || 50;
        const liveMode = req.query.live === 'true';
        res.json(await AnalyticsService.getEcommerceLog(accountId, page, limit, liveMode));
    } catch (e: any) { res.status(500).json({ error: e.message }); }
});

router.get('/visitors/:id', async (req: AuthenticatedRequest, res: Response) => {
    try {
        const accountId = (req as any).accountId;
        const data = await AnalyticsService.getVisitorProfile(req.params.id, accountId);
        if (!data) return res.status(404).json({ error: 'Visitor not found' });
        res.json(data);
    } catch (e: any) { res.status(500).json({ error: e.message }); }
});

router.get('/channels', async (req: AuthenticatedRequest, res: Response) => {
    try { res.json(await AnalyticsService.getChannelBreakdown((req as any).accountId)); }
    catch (e: any) { res.status(500).json({ error: e.message }); }
});

router.get('/search-terms', async (req: AuthenticatedRequest, res: Response) => {
    try { res.json(await AnalyticsService.getSearchTerms((req as any).accountId)); }
    catch (e: any) { res.status(500).json({ error: e.message }); }
});

// --- Sales Endpoints ---
router.get('/sales', async (req: AuthenticatedRequest, res: Response) => {
    try {
        const accountId = (req as any).accountId;
        const { startDate, endDate } = req.query;
        const total = await SalesAnalytics.getTotalSales(accountId, startDate as string, endDate as string);
        const account = await prisma.account.findUnique({ where: { id: accountId } });
        res.json({ total, currency: account?.currency || 'USD' });
    } catch (err: any) { Logger.error('Error', { error: err }); res.status(500).json({ error: err.message }); }
});

router.get('/recent-orders', async (req: AuthenticatedRequest, res: Response) => {
    try { res.json(await SalesAnalytics.getRecentOrders((req as any).accountId)); }
    catch (err: any) { Logger.error('Error', { error: err }); res.status(500).json({ error: err.message }); }
});

router.get('/sales-chart', async (req: AuthenticatedRequest, res: Response) => {
    try {
        const { startDate, endDate, interval } = req.query;
        res.json(await SalesAnalytics.getSalesOverTime((req as any).accountId, startDate as string, endDate as string, interval as any));
    } catch (e) { Logger.error('Sales Chart Error', { error: e }); res.status(500).json({ error: 'Failed' }); }
});

router.get('/top-products', async (req: AuthenticatedRequest, res: Response) => {
    try {
        const { startDate, endDate } = req.query;
        res.json(await SalesAnalytics.getTopProducts((req as any).accountId, startDate as string, endDate as string));
    } catch (e) { Logger.error('Top Products Error', { error: e }); res.status(500).json({ error: 'Failed' }); }
});

router.get('/customer-growth', async (req: AuthenticatedRequest, res: Response) => {
    try {
        const { startDate, endDate } = req.query;
        res.json(await CustomerAnalytics.getCustomerGrowth((req as any).accountId, startDate as string, endDate as string));
    } catch (e) { Logger.error('Customer Growth Error', { error: e }); res.status(500).json({ error: 'Failed' }); }
});

router.get('/forecast', async (req: AuthenticatedRequest, res: Response) => {
    try {
        const days = parseInt(req.query.days as string) || 30;
        res.json(await SalesAnalytics.getSalesForecast((req as any).accountId, days));
    } catch (e) { Logger.error('Forecast Error', { error: e }); res.status(500).json({ error: 'Failed' }); }
});

router.post('/custom-report', async (req: AuthenticatedRequest, res: Response) => {
    try { res.json(await SalesAnalytics.getCustomReport((req as any).accountId, req.body)); }
    catch (e) { Logger.error('Custom Report Error', { error: e }); res.status(500).json({ error: 'Failed' }); }
});

// --- Ads Summary ---
router.get('/ads-summary', async (req: AuthenticatedRequest, res: Response) => {
    try {
        const accountId = (req as any).accountId;
        const account = await prisma.account.findUnique({ where: { id: accountId } });
        const currency = account?.currency || 'USD';
        const adAccounts = await AdsService.getAdAccounts(accountId);

        if (!adAccounts.length) return res.json({ spend: 0, roas: 0, clicks: 0, impressions: 0, currency });

        let totalSpend = 0, totalClicks = 0, totalImpressions = 0, totalRevenue = 0;

        for (const adAccount of adAccounts) {
            try {
                const metrics = adAccount.platform === 'META'
                    ? await AdsService.getMetaInsights(adAccount.id)
                    : adAccount.platform === 'GOOGLE' ? await AdsService.getGoogleInsights(adAccount.id) : null;

                if (metrics) {
                    totalSpend += metrics.spend;
                    totalClicks += metrics.clicks;
                    totalImpressions += metrics.impressions;
                    totalRevenue += metrics.spend * metrics.roas;
                }
            } catch (err) { Logger.warn('Failed to fetch insights', { adAccountId: adAccount.id }); }
        }

        res.json({ spend: totalSpend, roas: totalSpend > 0 ? totalRevenue / totalSpend : 0, clicks: totalClicks, impressions: totalImpressions, currency });
    } catch (error) { Logger.error('Error fetching ad summary', { error }); res.status(500).json({ error: 'Failed' }); }
});

// --- Acquisition & Behaviour ---
router.get('/acquisition/channels', async (req: AuthenticatedRequest, res: Response) => {
    try { const { startDate, endDate } = req.query; res.json(await AcquisitionAnalytics.getAcquisitionChannels((req as any).accountId, startDate as string, endDate as string)); }
    catch (e) { Logger.error('Acquisition Channels Error', { error: e }); res.status(500).json({ error: 'Failed' }); }
});

router.get('/acquisition/campaigns', async (req: AuthenticatedRequest, res: Response) => {
    try { const { startDate, endDate } = req.query; res.json(await AcquisitionAnalytics.getAcquisitionCampaigns((req as any).accountId, startDate as string, endDate as string)); }
    catch (e) { Logger.error('Acquisition Campaigns Error', { error: e }); res.status(500).json({ error: 'Failed' }); }
});

router.get('/behaviour/pages', async (req: AuthenticatedRequest, res: Response) => {
    try { const { startDate, endDate } = req.query; res.json(await BehaviourAnalytics.getBehaviourPages((req as any).accountId, startDate as string, endDate as string)); }
    catch (e) { Logger.error('Behaviour Pages Error', { error: e }); res.status(500).json({ error: 'Failed' }); }
});

router.get('/behaviour/search', async (req: AuthenticatedRequest, res: Response) => {
    try { const { startDate, endDate } = req.query; res.json(await BehaviourAnalytics.getSiteSearch((req as any).accountId, startDate as string, endDate as string)); }
    catch (e) { Logger.error('Site Search Error', { error: e }); res.status(500).json({ error: 'Failed' }); }
});

router.get('/behaviour/entry', async (req: AuthenticatedRequest, res: Response) => {
    try { const { startDate, endDate } = req.query; res.json(await BehaviourAnalytics.getEntryPages((req as any).accountId, startDate as string, endDate as string)); }
    catch (e) { Logger.error('Entry Pages Error', { error: e }); res.status(500).json({ error: 'Failed' }); }
});

router.get('/behaviour/exit', async (req: AuthenticatedRequest, res: Response) => {
    try { const { startDate, endDate } = req.query; res.json(await BehaviourAnalytics.getExitPages((req as any).accountId, startDate as string, endDate as string)); }
    catch (e) { Logger.error('Exit Pages Error', { error: e }); res.status(500).json({ error: 'Failed' }); }
});

router.get('/behaviour/roadblocks', async (req: AuthenticatedRequest, res: Response) => {
    try { const { startDate, endDate } = req.query; res.json(await RoadblockAnalytics.getRoadblockPages((req as any).accountId, startDate as string, endDate as string)); }
    catch (e) { Logger.error('Roadblocks Error', { error: e }); res.status(500).json({ error: 'Failed to fetch roadblocks' }); }
});

router.get('/behaviour/funnel-dropoff', async (req: AuthenticatedRequest, res: Response) => {
    try { const { startDate, endDate } = req.query; res.json(await RoadblockAnalytics.getDropOffFunnel((req as any).accountId, startDate as string, endDate as string)); }
    catch (e) { Logger.error('Funnel Error', { error: e }); res.status(500).json({ error: 'Failed to fetch funnel' }); }
});

export default router;
