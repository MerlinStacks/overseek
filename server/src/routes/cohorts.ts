/**
 * Cohort Analysis Routes - Fastify Plugin
 * 
 * Endpoints for customer cohort analysis.
 */

import { FastifyPluginAsync } from 'fastify';
import { CustomerCohortService } from '../services/analytics/CustomerCohortService';
import { Logger } from '../utils/logger';

const cohortRoutes: FastifyPluginAsync = async (fastify) => {

    /**
     * GET /cohorts/retention
     * Customer retention cohorts by first purchase month
     */
    fastify.get<{
        Querystring: { months?: string }
    }>('/retention', async (request, reply) => {
        try {
            const accountId = request.accountId;
            const months = parseInt(request.query.months || '6', 10);

            const cohorts = await CustomerCohortService.getRetentionCohorts(accountId, months);
            return cohorts;
        } catch (e: any) {
            Logger.error('[Cohorts] Retention error', { error: e });
            return reply.code(500).send({ error: e.message });
        }
    });

    /**
     * GET /cohorts/acquisition
     * Customer cohorts by acquisition source (UTM/referrer)
     */
    fastify.get('/acquisition', async (request, reply) => {
        try {
            const accountId = request.accountId;

            const cohorts = await CustomerCohortService.getAcquisitionCohorts(accountId);
            return cohorts;
        } catch (e: any) {
            Logger.error('[Cohorts] Acquisition error', { error: e });
            return reply.code(500).send({ error: e.message });
        }
    });

    /**
     * GET /cohorts/product
     * Customer cohorts by first purchased product category
     */
    fastify.get('/product', async (request, reply) => {
        try {
            const accountId = request.accountId;

            const cohorts = await CustomerCohortService.getProductCohorts(accountId);
            return cohorts;
        } catch (e: any) {
            Logger.error('[Cohorts] Product error', { error: e });
            return reply.code(500).send({ error: e.message });
        }
    });

    /**
     * GET /cohorts/summary
     * Summary overview of all cohort data
     */
    fastify.get('/summary', async (request, reply) => {
        try {
            const accountId = request.accountId;

            const [retention, acquisition, product] = await Promise.all([
                CustomerCohortService.getRetentionCohorts(accountId, 6),
                CustomerCohortService.getAcquisitionCohorts(accountId),
                CustomerCohortService.getProductCohorts(accountId)
            ]);

            // Calculate summary stats
            const totalCustomers = retention.reduce((sum, c) => sum + c.totalCustomers, 0);
            const latestCohort = retention[retention.length - 1];
            const avgRetention30d = latestCohort?.retention[0]?.retentionRate || 0;

            const topSource = acquisition[0];
            const topProduct = product[0];

            return {
                overview: {
                    totalCohortsAnalyzed: retention.length,
                    totalCustomersTracked: totalCustomers,
                    latestCohortRetention: avgRetention30d
                },
                topAcquisitionSource: topSource ? {
                    source: topSource.source,
                    customers: topSource.totalCustomers,
                    avgLTV: topSource.avgLTV,
                    repeatRate: topSource.repeatRate
                } : null,
                topProductCategory: topProduct ? {
                    category: topProduct.productCategory,
                    customers: topProduct.totalCustomers,
                    repeatRate: topProduct.repeatRate
                } : null,
                retentionCohorts: retention,
                acquisitionCohorts: acquisition,
                productCohorts: product
            };
        } catch (e: any) {
            Logger.error('[Cohorts] Summary error', { error: e });
            return reply.code(500).send({ error: e.message });
        }
    });
};

export default cohortRoutes;
