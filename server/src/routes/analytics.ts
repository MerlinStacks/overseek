import { Router, Request, Response } from 'express';
import { SalesAnalytics } from '../services/analytics/sales';
import { AcquisitionAnalytics } from '../services/analytics/acquisition';
import { BehaviourAnalytics } from '../services/analytics/behaviour';
import { CustomerAnalytics } from '../services/analytics/customer';
import { AdsService } from '../services/ads';
import { requireAuth } from '../middleware/auth';
import { esClient } from '../utils/elastic';
import { prisma } from '../utils/prisma';

const router = Router();
// const prisma = new PrismaClient(); // Removed local instantiation

router.use(requireAuth);

router.get('/visitors/log', async (req: Request, res: Response) => {
    try {
        const accountId = (req as any).accountId;
        const page = parseInt(req.query.page as string) || 1;
        const limit = parseInt(req.query.limit as string) || 50;
        const data = await AnalyticsService.getVisitorLog(accountId, page, limit);
        res.json(data);
    } catch (e: any) { res.status(500).json({ error: e.message }); }
});

router.get('/ecommerce/log', async (req: Request, res: Response) => {
    try {
        const accountId = (req as any).accountId;
        const page = parseInt(req.query.page as string) || 1;
        const limit = parseInt(req.query.limit as string) || 50;
        const data = await AnalyticsService.getEcommerceLog(accountId, page, limit);
        res.json(data);
    } catch (e: any) { res.status(500).json({ error: e.message }); }
});

router.get('/visitors/:id', async (req: Request, res: Response) => {
    try {
        const accountId = (req as any).accountId;
        const data = await AnalyticsService.getVisitorProfile(req.params.id, accountId);
        if (!data) return res.status(404).json({ error: 'Visitor not found' });
        res.json(data);
    } catch (e: any) { res.status(500).json({ error: e.message }); }
});

router.get('/channels', async (req: Request, res: Response) => {
    try {
        const accountId = (req as any).accountId;
        const data = await AnalyticsService.getChannelBreakdown(accountId);
        res.json(data);
    } catch (e: any) { res.status(500).json({ error: e.message }); }
});

router.get('/search-terms', async (req: Request, res: Response) => {
    try {
        const accountId = (req as any).accountId;
        const data = await AnalyticsService.getSearchTerms(accountId);
        res.json(data);
    } catch (e: any) { res.status(500).json({ error: e.message }); }
});

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


// --- Template & Schedule Endpoints ---

router.get('/templates', async (req: Request, res: Response) => {
    try {
        const accountId = (req as any).accountId;

        // 1. User Templates
        const userTemplates = await prisma.reportTemplate.findMany({
            where: { accountId },
            orderBy: { createdAt: 'desc' }
        });

        // 2. System Templates (Hardcoded)
        const systemTemplates = [
            {
                id: 'sys_overview',
                name: 'Overview',
                type: 'SYSTEM',
                config: { dimension: 'day', metrics: ['sales', 'orders', 'aov'], dateRange: '30d' }
            },
            {
                id: 'sys_products',
                name: 'Product Performance',
                type: 'SYSTEM',
                config: { dimension: 'product', metrics: ['quantity', 'sales'], dateRange: '30d' }
            },
            {
                id: 'sys_top_sellers',
                name: 'Top Sellers (90d)',
                type: 'SYSTEM',
                config: { dimension: 'product', metrics: ['sales'], dateRange: '90d' }
            },
            {
                id: 'sys_bought_together',
                name: 'Frequent Orders (Proxy)',
                type: 'SYSTEM',
                config: { dimension: 'product', metrics: ['orders'], dateRange: '90d' }
            }
        ];

        res.json([...systemTemplates, ...userTemplates]);
    } catch (e: any) { res.status(500).json({ error: e.message }); }
});

router.post('/templates', async (req: Request, res: Response) => {
    try {
        const accountId = (req as any).accountId;
        const { name, config } = req.body;

        const template = await prisma.reportTemplate.create({
            data: {
                accountId,
                name,
                config,
                type: 'CUSTOM'
            }
        });
        res.json(template);
    } catch (e: any) { res.status(500).json({ error: e.message }); }
});

router.delete('/templates/:id', async (req: Request, res: Response) => {
    try {
        const accountId = (req as any).accountId;
        await prisma.reportTemplate.delete({
            where: { id: req.params.id, accountId } // Ensure ownership
        });
        res.json({ success: true });
    } catch (e: any) { res.status(500).json({ error: e.message }); }
});

// Schedules
router.get('/schedules', async (req: Request, res: Response) => {
    try {
        const accountId = (req as any).accountId;
        const schedules = await prisma.reportSchedule.findMany({
            where: { accountId },
            include: { template: true }
        });
        res.json(schedules);
    } catch (e: any) { res.status(500).json({ error: e.message }); }
});

router.post('/schedules', async (req: Request, res: Response) => {
    try {
        const accountId = (req as any).accountId;
        const { templateId, frequency, dayOfWeek, dayOfMonth, time, emailRecipients, isActive } = req.body;

        // Clone System Templates if needed
        let targetTemplateId = templateId;

        if (templateId.startsWith('sys_')) {
            const sysConfigs: any = {
                'sys_overview': { dimension: 'day', metrics: ['sales', 'orders', 'aov'], dateRange: '30d' },
                'sys_products': { dimension: 'product', metrics: ['quantity', 'sales'], dateRange: '30d' },
                'sys_top_sellers': { dimension: 'product', metrics: ['sales'], dateRange: '90d' },
                // sys_stock_velocity removed
                'sys_bought_together': { dimension: 'product', metrics: ['orders'], dateRange: '90d' },
            };

            const config = sysConfigs[templateId];
            if (!config) return res.status(400).json({ error: 'Invalid System Template' });

            const clone = await prisma.reportTemplate.create({
                data: {
                    accountId,
                    name: `System Clone: ${templateId}`,
                    type: 'SYSTEM_CLONE',
                    config
                }
            });
            targetTemplateId = clone.id;
        }

        const schedule = await prisma.reportSchedule.create({
            data: {
                accountId,
                reportTemplateId: targetTemplateId,
                frequency,
                dayOfWeek,
                dayOfMonth,
                time,
                emailRecipients,
                isActive: isActive ?? true
            }
        });

        res.json(schedule);

    } catch (e: any) { res.status(500).json({ error: e.message }); }
});

// --- Dedicated Reports ---

router.get('/stock-velocity', async (req: Request, res: Response) => {
    try {
        const accountId = (req as any).accountId;

        // 1. Fetch Products with stock data from Postgres
        // We use queryRaw to extract JSON fields efficiently
        const products: any[] = await prisma.$queryRaw`
            SELECT 
                id, 
                name, 
                sku, 
                "mainImage", 
                "price", 
                CAST("rawData"->>'stock_quantity' AS INTEGER) as stock_quantity
            FROM "WooProduct"
            WHERE "accountId" = ${accountId}
            AND "rawData"->>'manage_stock' = 'true'
            AND "rawData"->>'stock_quantity' IS NOT NULL
        `;

        if (!products.length) {
            return res.json([]);
        }

        // 2. Fetch Sales History (Last 30 Days) from Elasticsearch
        const endDate = new Date();
        const startDate = new Date();
        startDate.setDate(startDate.getDate() - 30);

        const response = await esClient.search({
            index: 'orders',
            size: 0,
            body: {
                query: {
                    bool: {
                        must: [
                            { term: { accountId } },
                            { range: { date_created: { gte: startDate.toISOString(), lte: endDate.toISOString() } } },
                            { terms: { status: ['completed', 'processing', 'on-hold'] } }
                        ]
                    }
                },
                aggs: {
                    products: {
                        nested: { path: 'line_items' },
                        aggs: {
                            by_product: {
                                terms: { field: 'line_items.productId', size: 10000 },
                                aggs: {
                                    total_qty: { sum: { field: 'line_items.quantity' } }
                                }
                            }
                        }
                    }
                }
            }
        });

        // 3. Map Sales to Map<ProductId, QtySold>
        const salesMap = new Map<number, number>();
        const buckets = (response.aggregations as any)?.products?.by_product?.buckets || [];

        buckets.forEach((b: any) => {
            if (b.key) {
                salesMap.set(b.key, b.total_qty.value);
            }
        });

        // 4. Calculate Velocity & Days Remaining
        const report = products.map(p => {
            const stock = p.stock_quantity || 0;
            const sold30d = salesMap.get(p.id) || 0; // Match by Product ID

            // Daily Rate
            const dailyRate = sold30d / 30;

            // Days Remaining
            let daysRemaining = 999; // Default to 'plenty'
            if (stock === 0) {
                if (dailyRate > 0) {
                    daysRemaining = 0; // Urgent: Out of stock but selling!
                } else {
                    daysRemaining = 999; // Dead stock: No stock, no sales.
                }
            } else if (dailyRate > 0) {
                daysRemaining = Math.max(0, Math.round(stock / dailyRate));
            }

            return {
                id: p.id,
                name: p.name,
                sku: p.sku,
                image: p.mainImage,
                stock,
                soldLast30d: sold30d,
                dailyVelocity: parseFloat(dailyRate.toFixed(2)),
                daysRemaining
            };
        });

        // Sort by Days Remaining (Ascending - urgent first)
        report.sort((a, b) => {
            // If days remaining is 999 (infinity), move to bottom
            if (a.daysRemaining === 999 && b.daysRemaining !== 999) return 1;
            if (a.daysRemaining !== 999 && b.daysRemaining === 999) return -1;
            return a.daysRemaining - b.daysRemaining;
        });

        res.json(report);

    } catch (e: any) {
        console.error('Stock Velocity Error:', e);
        res.status(500).json({ error: e.message });
    }
});

export default router;
