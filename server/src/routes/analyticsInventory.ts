import { FastifyPluginAsync } from 'fastify';
import { prisma } from '../utils/prisma';
import { esClient } from '../utils/elastic';
import { Logger } from '../utils/logger';
import { InventoryService } from '../services/InventoryService';
import { InventoryForecastService } from '../services/analytics/InventoryForecastService';

const analyticsInventoryRoutes: FastifyPluginAsync = async (fastify) => {
    /**
     * GET /health
     * Returns products at risk based on sales velocity and inventory settings.
     */
    fastify.get('/health', async (request, reply) => {
        try {
            const accountId = request.accountId;
            const atRisk = await InventoryService.checkInventoryHealth(accountId!);
            return atRisk;
        } catch (e: any) {
            Logger.error('Inventory Health Check Error', { error: e });
            return reply.code(500).send({ error: e.message });
        }
    });

    /**
     * GET /stock-velocity
     * Calculates stock velocity and days remaining for products.
     */
    fastify.get('/stock-velocity', async (request, reply) => {
        try {
            const accountId = request.accountId;

            // Prioritize materialized DB field, fall back to rawData (Jan 29 fix)
            const products: any[] = await prisma.$queryRaw`
                SELECT id, "wooId", name, sku, "mainImage", "price", 
                       COALESCE("stockQuantity", CAST("rawData"->>'stock_quantity' AS INTEGER)) as stock_quantity
                FROM "WooProduct"
                WHERE "accountId" = ${accountId}
                AND ("manageStock" = true OR "rawData"->>'manage_stock' = 'true')
                AND COALESCE("stockQuantity", CAST("rawData"->>'stock_quantity' AS INTEGER)) IS NOT NULL
            `;

            // Also fetch variants with managed stock — variable products often only track stock at variant level
            const variantRows: any[] = await prisma.$queryRaw`
                SELECT pv.id, pv."wooId", pv.sku, pv."stockQuantity" as stock_quantity,
                       wp.name, wp."mainImage", wp."wooId" as "parentWooId"
                FROM "ProductVariation" pv
                JOIN "WooProduct" wp ON pv."productId" = wp.id
                WHERE wp."accountId" = ${accountId}
                AND pv."manageStock" = true
                AND pv."stockQuantity" IS NOT NULL
            `;

            if (!products.length && !variantRows.length) return [];

            const endDate = new Date();
            const startDate = new Date();
            startDate.setDate(startDate.getDate() - 30);

            const response = await esClient.search({
                index: 'orders',
                size: 0,
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
            });

            const salesMap = new Map<number, number>();
            const buckets = (response.aggregations as any)?.products?.by_product?.buckets || [];
            buckets.forEach((b: any) => { if (b.key) salesMap.set(b.key, b.total_qty.value); });

            const buildReportEntry = (id: string, name: string, sku: string | null, image: string | null, stock: number, wooId: number, salesWooId: number) => {
                const sold30d = salesMap.get(salesWooId) || 0;
                const dailyRate = sold30d / 30;

                let daysRemaining = 999;
                if (stock === 0) {
                    daysRemaining = dailyRate > 0 ? 0 : 999;
                } else if (dailyRate > 0) {
                    daysRemaining = Math.max(0, Math.round(stock / dailyRate));
                }

                return { id, name, sku, image, stock, soldLast30d: sold30d, dailyVelocity: parseFloat(dailyRate.toFixed(2)), daysRemaining };
            };

            const report = [
                ...products.map(p => buildReportEntry(p.id, p.name, p.sku, p.mainImage, p.stock_quantity || 0, p.wooId, p.wooId)),
                ...variantRows.map(v => buildReportEntry(v.id, v.sku ? `${v.name} (${v.sku})` : v.name, v.sku, v.mainImage, v.stock_quantity || 0, v.wooId, v.parentWooId))
            ];

            report.sort((a, b) => {
                if (a.daysRemaining === 999 && b.daysRemaining !== 999) return 1;
                if (a.daysRemaining !== 999 && b.daysRemaining === 999) return -1;
                return a.daysRemaining - b.daysRemaining;
            });

            return report;

        } catch (e: any) {
            Logger.error('Stock Velocity Error', { error: e });
            return reply.code(500).send({ error: e.message });
        }
    });

    // ========================================================================
    // Predictive Inventory Forecasting
    // ========================================================================

    /**
     * GET /sku-forecasts
     * Returns AI-powered demand forecasts for all managed-stock products.
     * Query: ?days=30 (forecast horizon)
     */
    fastify.get('/sku-forecasts', async (request, reply) => {
        try {
            const accountId = request.accountId!;
            const { days } = request.query as { days?: string };
            const forecastDays = days ? parseInt(days, 10) : 30;

            const forecasts = await InventoryForecastService.getSkuForecasts(accountId, forecastDays);
            return forecasts;
        } catch (e: any) {
            Logger.error('[InventoryRoutes] SKU Forecasts Error', { error: e });
            return reply.code(500).send({ error: e.message });
        }
    });

    /**
     * GET /stockout-alerts
     * Returns products at risk of stockout grouped by severity.
     * Query: ?threshold=14 (days threshold for medium risk)
     */
    fastify.get('/stockout-alerts', async (request, reply) => {
        try {
            const accountId = request.accountId!;
            const { threshold } = request.query as { threshold?: string };
            const thresholdDays = threshold ? parseInt(threshold, 10) : 30;

            const alerts = await InventoryForecastService.getStockoutAlerts(accountId, thresholdDays);
            return alerts;
        } catch (e: any) {
            Logger.error('[InventoryRoutes] Stockout Alerts Error', { error: e });
            return reply.code(500).send({ error: e.message });
        }
    });

    /**
     * GET /sku-forecasts/:wooId
     * Returns detailed forecast for a single product including forecast curve.
     */
    fastify.get('/sku-forecasts/:wooId', async (request, reply) => {
        try {
            const accountId = request.accountId!;
            const { wooId } = request.params as { wooId: string };
            const productWooId = parseInt(wooId, 10);

            if (isNaN(productWooId)) {
                return reply.code(400).send({ error: 'Invalid product ID' });
            }

            const detail = await InventoryForecastService.getSkuForecastDetail(accountId, productWooId);

            if (!detail) {
                return reply.code(404).send({ error: 'Product not found or not managed' });
            }

            return detail;
        } catch (e: any) {
            Logger.error('[InventoryRoutes] SKU Forecast Detail Error', { error: e });
            return reply.code(500).send({ error: e.message });
        }
    });
};

export default analyticsInventoryRoutes;
