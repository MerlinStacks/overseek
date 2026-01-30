/**
 * Analytics Routes - Fastify Plugin
 * Main analytics router combining visitor, sales, and behaviour endpoints.
 */

import { FastifyPluginAsync } from 'fastify';
import { SalesAnalytics } from '../services/analytics/sales';
import { AcquisitionAnalytics } from '../services/analytics/acquisition';
import { BehaviourAnalytics } from '../services/analytics/behaviour';
import { CustomerAnalytics } from '../services/analytics/customer';
import { RoadblockAnalytics } from '../services/analytics/roadblock';
import { ProductRankingService } from '../services/analytics/ProductRankingService';
import { AdsService } from '../services/ads';
import { requireAuthFastify } from '../middleware/auth';
import { prisma } from '../utils/prisma';
import { Logger } from '../utils/logger';
import { AnalyticsService } from '../services/AnalyticsService';

import analyticsReportsRoutes from './analyticsReports';
import analyticsInventoryRoutes from './analyticsInventory';
import cohortRoutes from './cohorts';
import { AnomalyDetection } from '../services/analytics/AnomalyDetection';
import { PermissionService } from '../services/PermissionService';

// Simple in-memory cache for product view counts (5 minute TTL)
const productViewsCache = new Map<string, { data: { views7d: number; views30d: number }; expiresAt: number }>();
const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

const analyticsRoutes: FastifyPluginAsync = async (fastify) => {
    fastify.addHook('preHandler', requireAuthFastify);

    // Mount sub-routers as nested plugins
    await fastify.register(analyticsReportsRoutes);     // /templates, /schedules, /digests
    await fastify.register(analyticsInventoryRoutes, { prefix: '/inventory' });   // /inventory/health, /inventory/stock-velocity, /inventory/sku-forecasts
    await fastify.register(cohortRoutes, { prefix: '/cohorts' }); // /cohorts/retention, /cohorts/acquisition, /cohorts/product

    // --- Visitor & Channel Endpoints ---
    fastify.get('/visitors/log', async (request, reply) => {
        try {
            const accountId = request.accountId!;
            const query = request.query as { page?: string; limit?: string; live?: string; startDate?: string; endDate?: string };
            const page = parseInt(query.page || '1');
            const limit = parseInt(query.limit || '50');
            const liveMode = query.live === 'true';
            return await AnalyticsService.getVisitorLog(accountId, page, limit, liveMode, query.startDate, query.endDate);
        } catch (e: any) { return reply.code(500).send({ error: e.message }); }
    });

    fastify.get('/ecommerce/log', async (request, reply) => {
        try {
            const accountId = request.accountId!;
            const query = request.query as { page?: string; limit?: string; live?: string };
            const page = parseInt(query.page || '1');
            const limit = parseInt(query.limit || '50');
            const liveMode = query.live === 'true';
            return await AnalyticsService.getEcommerceLog(accountId, page, limit, liveMode);
        } catch (e: any) { return reply.code(500).send({ error: e.message }); }
    });

    fastify.get<{ Params: { id: string } }>('/visitors/:id', async (request, reply) => {
        try {
            const accountId = request.accountId!;
            const data = await AnalyticsService.getVisitorProfile(request.params.id, accountId);
            if (!data) return reply.code(404).send({ error: 'Visitor not found' });
            return data;
        } catch (e: any) { return reply.code(500).send({ error: e.message }); }
    });

    fastify.get('/channels', async (request, reply) => {
        try { return await AnalyticsService.getChannelBreakdown(request.accountId!); }
        catch (e: any) { return reply.code(500).send({ error: e.message }); }
    });

    fastify.get('/search-terms', async (request, reply) => {
        try { return await AnalyticsService.getSearchTerms(request.accountId!); }
        catch (e: any) { return reply.code(500).send({ error: e.message }); }
    });

    // --- Sales Endpoints ---
    fastify.get('/sales', async (request, reply) => {
        try {
            const accountId = request.accountId!;
            const query = request.query as { startDate?: string; endDate?: string };
            const { total, count } = await SalesAnalytics.getTotalSales(accountId, query.startDate, query.endDate);
            const account = await prisma.account.findUnique({ where: { id: accountId } });
            return { total, count, currency: account?.currency || 'USD' };
        } catch (err: any) { Logger.error('Error', { error: err }); return reply.code(500).send({ error: err.message }); }
    });

    fastify.get('/recent-orders', async (request, reply) => {
        try { return await SalesAnalytics.getRecentOrders(request.accountId!); }
        catch (err: any) { Logger.error('Error', { error: err }); return reply.code(500).send({ error: err.message }); }
    });

    fastify.get('/sales-chart', async (request, reply) => {
        try {
            const query = request.query as { startDate?: string; endDate?: string; interval?: string };
            const timezone = request.headers['x-timezone'] as string || 'UTC';
            return await SalesAnalytics.getSalesOverTime(request.accountId!, query.startDate, query.endDate, query.interval as any, timezone);
        } catch (e) { Logger.error('Sales Chart Error', { error: e }); return reply.code(500).send({ error: 'Failed' }); }
    });

    fastify.get('/top-products', async (request, reply) => {
        try {
            const query = request.query as { startDate?: string; endDate?: string };
            return await SalesAnalytics.getTopProducts(request.accountId!, query.startDate, query.endDate);
        } catch (e) { Logger.error('Top Products Error', { error: e }); return reply.code(500).send({ error: 'Failed' }); }
    });

    // Product Rankings (enhanced)
    fastify.get('/products/ranking', async (request, reply) => {
        try {
            const query = request.query as { period?: string; sortBy?: string; limit?: string };
            const period = (query.period || '30d') as '7d' | '30d' | '90d' | 'ytd';
            const sortBy = (query.sortBy || 'revenue') as 'revenue' | 'units' | 'orders' | 'margin';
            const limit = parseInt(query.limit || '10', 10);
            return await ProductRankingService.getProductRankings(request.accountId!, period, sortBy, limit);
        } catch (e) { Logger.error('Product Ranking Error', { error: e }); return reply.code(500).send({ error: 'Failed' }); }
    });

    fastify.get('/customer-growth', async (request, reply) => {
        try {
            const query = request.query as { startDate?: string; endDate?: string };
            return await CustomerAnalytics.getCustomerGrowth(request.accountId!, query.startDate, query.endDate);
        } catch (e) { Logger.error('Customer Growth Error', { error: e }); return reply.code(500).send({ error: 'Failed' }); }
    });

    fastify.get('/forecast', async (request, reply) => {
        try {
            const query = request.query as { days?: string };
            const days = parseInt(query.days || '30');
            return await SalesAnalytics.getSalesForecast(request.accountId!, days);
        } catch (e) { Logger.error('Forecast Error', { error: e }); return reply.code(500).send({ error: 'Failed' }); }
    });

    fastify.get('/profitability', async (request, reply) => {
        try {
            const query = request.query as { startDate?: string; endDate?: string };
            const startDate = query.startDate ? new Date(query.startDate) : new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
            const endDate = query.endDate ? new Date(query.endDate) : new Date();
            return await AnalyticsService.getProfitabilityReport(request.accountId!, startDate, endDate);
        } catch (e) { Logger.error('Profitability Error', { error: e }); return reply.code(500).send({ error: 'Failed' }); }
    });

    fastify.post('/custom-report', async (request, reply) => {
        try { return await SalesAnalytics.getCustomReport(request.accountId!, request.body as any); }
        catch (e) { Logger.error('Custom Report Error', { error: e }); return reply.code(500).send({ error: 'Failed' }); }
    });

    // --- Ads Summary ---
    fastify.get('/ads-summary', async (request, reply) => {
        try {
            const accountId = request.accountId!;
            const account = await prisma.account.findUnique({ where: { id: accountId } });
            const currency = account?.currency || 'USD';
            const adAccounts = await AdsService.getAdAccounts(accountId);

            if (!adAccounts.length) return { spend: 0, roas: 0, clicks: 0, impressions: 0, currency };

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

            return { spend: totalSpend, roas: totalSpend > 0 ? totalRevenue / totalSpend : 0, clicks: totalClicks, impressions: totalImpressions, currency };
        } catch (error) { Logger.error('Error fetching ad summary', { error }); return reply.code(500).send({ error: 'Failed' }); }
    });

    // --- Acquisition & Behaviour ---
    fastify.get('/acquisition/channels', async (request, reply) => {
        try { const query = request.query as any; return await AcquisitionAnalytics.getAcquisitionChannels(request.accountId!, query.startDate, query.endDate); }
        catch (e) { Logger.error('Acquisition Channels Error', { error: e }); return reply.code(500).send({ error: 'Failed' }); }
    });

    fastify.get('/acquisition/campaigns', async (request, reply) => {
        try { const query = request.query as any; return await AcquisitionAnalytics.getAcquisitionCampaigns(request.accountId!, query.startDate, query.endDate); }
        catch (e) { Logger.error('Acquisition Campaigns Error', { error: e }); return reply.code(500).send({ error: 'Failed' }); }
    });

    fastify.get('/behaviour/pages', async (request, reply) => {
        try { const query = request.query as any; return await BehaviourAnalytics.getBehaviourPages(request.accountId!, query.startDate, query.endDate); }
        catch (e) { Logger.error('Behaviour Pages Error', { error: e }); return reply.code(500).send({ error: 'Failed' }); }
    });

    fastify.get('/behaviour/search', async (request, reply) => {
        try { const query = request.query as any; return await BehaviourAnalytics.getSiteSearch(request.accountId!, query.startDate, query.endDate); }
        catch (e) { Logger.error('Site Search Error', { error: e }); return reply.code(500).send({ error: 'Failed' }); }
    });

    fastify.get('/behaviour/entry', async (request, reply) => {
        try { const query = request.query as any; return await BehaviourAnalytics.getEntryPages(request.accountId!, query.startDate, query.endDate); }
        catch (e) { Logger.error('Entry Pages Error', { error: e }); return reply.code(500).send({ error: 'Failed' }); }
    });

    fastify.get('/behaviour/exit', async (request, reply) => {
        try { const query = request.query as any; return await BehaviourAnalytics.getExitPages(request.accountId!, query.startDate, query.endDate); }
        catch (e) { Logger.error('Exit Pages Error', { error: e }); return reply.code(500).send({ error: 'Failed' }); }
    });

    fastify.get('/behaviour/roadblocks', async (request, reply) => {
        try { const query = request.query as any; return await RoadblockAnalytics.getRoadblockPages(request.accountId!, query.startDate, query.endDate); }
        catch (e) { Logger.error('Roadblocks Error', { error: e }); return reply.code(500).send({ error: 'Failed to fetch roadblocks' }); }
    });

    fastify.get('/behaviour/funnel-dropoff', async (request, reply) => {
        try { const query = request.query as any; return await RoadblockAnalytics.getDropOffFunnel(request.accountId!, query.startDate, query.endDate); }
        catch (e) { Logger.error('Funnel Error', { error: e }); return reply.code(500).send({ error: 'Failed to fetch funnel' }); }
    });

    // --- Revenue Anomaly Detection ---
    fastify.get('/anomalies', async (request, reply) => {
        try {
            return await AnomalyDetection.getRevenueAnomaly(request.accountId!);
        } catch (e: any) {
            Logger.error('Anomaly Detection Error', { error: e });
            return reply.code(500).send({ error: e.message });
        }
    });

    // --- Product-specific Page Views ---
    fastify.get<{ Params: { productId: string } }>('/product-views/:productId', async (request, reply) => {
        try {
            const accountId = request.accountId!;
            const userId = request.user!.id;
            const { productId } = request.params;

            // RBAC: Require view_products permission
            const canView = await PermissionService.hasPermission(userId, accountId, 'view_products');
            if (!canView) {
                return reply.code(403).send({ error: 'You do not have permission to view product analytics' });
            }

            // Check cache first
            const cacheKey = `${accountId}:${productId}`;
            const cached = productViewsCache.get(cacheKey);
            if (cached && cached.expiresAt > Date.now()) {
                return cached.data;
            }

            // Get the product to find its permalink
            const product = await prisma.wooProduct.findFirst({
                where: { id: productId, accountId },
                select: { permalink: true }
            });

            if (!product?.permalink) {
                return { views7d: 0, views30d: 0 };
            }

            const viewData = await BehaviourAnalytics.getProductPageViews(accountId, product.permalink);

            // Cache the result
            productViewsCache.set(cacheKey, {
                data: viewData,
                expiresAt: Date.now() + CACHE_TTL_MS
            });

            return viewData;
        } catch (e: any) {
            Logger.error('Product Views Error', { error: e });
            return reply.code(500).send({ error: e.message });
        }
    });
};

export default analyticsRoutes;
