/**
 * Analytics Inventory Routes
 * 
 * Stock velocity and inventory analytics.
 */

import { Router, Response } from 'express';
import { AuthenticatedRequest } from '../types/express';
import { prisma } from '../utils/prisma';
import { esClient } from '../utils/elastic';
import { Logger } from '../utils/logger';

const router = Router();

/**
 * GET /stock-velocity
 * Calculates stock velocity and days remaining for products.
 */
router.get('/stock-velocity', async (req: AuthenticatedRequest, res: Response) => {
    try {
        const accountId = (req as any).accountId;

        // Fetch Products with stock data
        const products: any[] = await prisma.$queryRaw`
            SELECT id, "wooId", name, sku, "mainImage", "price", 
                   CAST("rawData"->>'stock_quantity' AS INTEGER) as stock_quantity
            FROM "WooProduct"
            WHERE "accountId" = ${accountId}
            AND "rawData"->>'manage_stock' = 'true'
            AND "rawData"->>'stock_quantity' IS NOT NULL
        `;

        if (!products.length) return res.json([]);

        // Fetch Sales (Last 30 Days)
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
                        aggs: { by_product: { terms: { field: 'line_items.productId', size: 10000 }, aggs: { total_qty: { sum: { field: 'line_items.quantity' } } } } }
                    }
                }
            }
        });

        // Map Sales
        const salesMap = new Map<number, number>();
        const buckets = (response.aggregations as any)?.products?.by_product?.buckets || [];
        buckets.forEach((b: any) => { if (b.key) salesMap.set(b.key, b.total_qty.value); });

        // Calculate Velocity
        const report = products.map(p => {
            const stock = p.stock_quantity || 0;
            const sold30d = salesMap.get(p.wooId) || 0;
            const dailyRate = sold30d / 30;

            let daysRemaining = 999;
            if (stock === 0) {
                daysRemaining = dailyRate > 0 ? 0 : 999;
            } else if (dailyRate > 0) {
                daysRemaining = Math.max(0, Math.round(stock / dailyRate));
            }

            return { id: p.id, name: p.name, sku: p.sku, image: p.mainImage, stock, soldLast30d: sold30d, dailyVelocity: parseFloat(dailyRate.toFixed(2)), daysRemaining };
        });

        // Sort by urgency
        report.sort((a, b) => {
            if (a.daysRemaining === 999 && b.daysRemaining !== 999) return 1;
            if (a.daysRemaining !== 999 && b.daysRemaining === 999) return -1;
            return a.daysRemaining - b.daysRemaining;
        });

        res.json(report);

    } catch (e: any) {
        Logger.error('Stock Velocity Error', { error: e });
        res.status(500).json({ error: e.message });
    }
});

export default router;
