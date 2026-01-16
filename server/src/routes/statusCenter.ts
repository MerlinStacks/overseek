/**
 * Status Center Route - Fastify Plugin
 *
 * Provides a unified endpoint for system health aggregation:
 * - Sync status and failure rates
 * - Webhook delivery health
 * - WooCommerce store connectivity
 * - Revenue anomaly detection
 */

import { FastifyPluginAsync } from 'fastify';
import { prisma } from '../utils/prisma';
import { Logger } from '../utils/logger';
import { requireAuthFastify } from '../middleware/auth';
import { AnomalyDetection } from '../services/analytics/AnomalyDetection';
import { redisClient } from '../utils/redis';
import WooCommerceRestApi from '@woocommerce/woocommerce-rest-api';

/** Health status levels */
type HealthLevel = 'healthy' | 'warning' | 'critical';

/** Individual status section */
interface StatusSection {
    status: HealthLevel;
    message: string;
    lastChecked: string;
    details?: Record<string, unknown>;
}

/** Full status center response */
interface StatusCenterResponse {
    overallHealth: HealthLevel;
    lastUpdated: string;
    sync: StatusSection;
    webhooks: StatusSection;
    storeHealth: StatusSection;
    revenueAlerts: StatusSection;
}

/**
 * Determines overall health from individual sections.
 * Critical in any = critical, Warning in any = warning, else healthy.
 */
function calculateOverallHealth(sections: StatusSection[]): HealthLevel {
    if (sections.some((s) => s.status === 'critical')) return 'critical';
    if (sections.some((s) => s.status === 'warning')) return 'warning';
    return 'healthy';
}

const statusCenterRoutes: FastifyPluginAsync = async (fastify) => {
    /**
     * GET /api/status-center
     * Returns aggregated health status for the current account.
     */
    fastify.get('/', { preHandler: [requireAuthFastify] }, async (request, reply) => {
        const accountId = request.accountId;
        if (!accountId) {
            return reply.code(400).send({ error: 'Account ID required' });
        }

        const now = new Date().toISOString();

        // Parallel fetch all status data
        const [syncStatus, webhookStatus, storeStatus, revenueStatus] = await Promise.all([
            getSyncStatus(accountId),
            getWebhookStatus(accountId),
            getStoreHealth(accountId),
            getRevenueAlertStatus(accountId),
        ]);

        const overallHealth = calculateOverallHealth([
            syncStatus,
            webhookStatus,
            storeStatus,
            revenueStatus,
        ]);

        const response: StatusCenterResponse = {
            overallHealth,
            lastUpdated: now,
            sync: syncStatus,
            webhooks: webhookStatus,
            storeHealth: storeStatus,
            revenueAlerts: revenueStatus,
        };

        return response;
    });
};

/**
 * Get sync status and failure rate for the account.
 */
async function getSyncStatus(accountId: string): Promise<StatusSection> {
    try {
        const twentyFourHoursAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);

        const [recentLogs, failedCount, lastSuccess] = await Promise.all([
            prisma.syncLog.count({
                where: { accountId, startedAt: { gte: twentyFourHoursAgo } },
            }),
            prisma.syncLog.count({
                where: { accountId, status: 'FAILED', startedAt: { gte: twentyFourHoursAgo } },
            }),
            prisma.syncLog.findFirst({
                where: { accountId, status: 'SUCCESS' },
                orderBy: { completedAt: 'desc' },
                select: { completedAt: true, entityType: true },
            }),
        ]);

        const failureRate = recentLogs > 0 ? (failedCount / recentLogs) * 100 : 0;

        let status: HealthLevel = 'healthy';
        let message = 'All syncs running smoothly';

        if (failureRate >= 50) {
            status = 'critical';
            message = `High failure rate: ${Math.round(failureRate)}% of syncs failed`;
        } else if (failureRate >= 20) {
            status = 'warning';
            message = `Elevated failures: ${Math.round(failureRate)}% failed`;
        } else if (!lastSuccess) {
            status = 'warning';
            message = 'No successful syncs recorded';
        }

        return {
            status,
            message,
            lastChecked: new Date().toISOString(),
            details: {
                failureRate24h: Math.round(failureRate),
                totalSyncs24h: recentLogs,
                failedSyncs24h: failedCount,
                lastSuccessAt: lastSuccess?.completedAt?.toISOString() || null,
                lastSuccessType: lastSuccess?.entityType || null,
            },
        };
    } catch (error) {
        Logger.error('[StatusCenter] Sync status fetch failed', { accountId, error });
        return {
            status: 'warning',
            message: 'Unable to fetch sync status',
            lastChecked: new Date().toISOString(),
        };
    }
}

/**
 * Get webhook delivery health for the account.
 */
async function getWebhookStatus(accountId: string): Promise<StatusSection> {
    try {
        const twentyFourHoursAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);

        const [totalDeliveries, failedDeliveries, lastDelivery] = await Promise.all([
            prisma.webhookDelivery.count({
                where: { accountId, receivedAt: { gte: twentyFourHoursAgo } },
            }),
            prisma.webhookDelivery.count({
                where: { accountId, status: 'FAILED', receivedAt: { gte: twentyFourHoursAgo } },
            }),
            prisma.webhookDelivery.findFirst({
                where: { accountId },
                orderBy: { receivedAt: 'desc' },
                select: { receivedAt: true, status: true, topic: true },
            }),
        ]);

        const failureRate = totalDeliveries > 0 ? (failedDeliveries / totalDeliveries) * 100 : 0;

        let status: HealthLevel = 'healthy';
        let message = 'Webhooks processing normally';

        if (totalDeliveries === 0) {
            // No webhooks = suggest configuration
            status = 'warning';
            message = 'No webhooks received - configure in WooCommerce';
        } else if (failedDeliveries >= 5 || failureRate >= 50) {
            status = 'critical';
            message = `${failedDeliveries} webhook${failedDeliveries > 1 ? 's' : ''} failed in last 24h`;
        } else if (failedDeliveries > 0) {
            status = 'warning';
            message = `${failedDeliveries} minor webhook failure${failedDeliveries > 1 ? 's' : ''}`;
        }

        return {
            status,
            message,
            lastChecked: new Date().toISOString(),
            details: {
                totalDeliveries24h: totalDeliveries,
                failedDeliveries24h: failedDeliveries,
                failureRate24h: Math.round(failureRate),
                lastWebhookAt: lastDelivery?.receivedAt?.toISOString() || null,
                lastWebhookTopic: lastDelivery?.topic || null,
                lastWebhookStatus: lastDelivery?.status || null,
            },
        };
    } catch (error) {
        Logger.error('[StatusCenter] Webhook status fetch failed', { accountId, error });
        return {
            status: 'warning',
            message: 'Unable to fetch webhook status',
            lastChecked: new Date().toISOString(),
        };
    }
}

/**
 * Check WooCommerce store connectivity.
 */
async function getStoreHealth(accountId: string): Promise<StatusSection> {
    try {
        const account = await prisma.account.findUnique({
            where: { id: accountId },
            select: {
                wooUrl: true,
                wooConsumerKey: true,
                wooConsumerSecret: true,
                name: true,
            },
        });

        if (!account?.wooUrl || !account.wooConsumerKey || !account.wooConsumerSecret) {
            return {
                status: 'critical',
                message: 'WooCommerce credentials not configured',
                lastChecked: new Date().toISOString(),
                details: { configured: false },
            };
        }

        // Use Redis cache to avoid hammering the store API
        const cacheKey = `store-health:${accountId}`;
        const cached = await redisClient.get(cacheKey);

        if (cached) {
            const parsed = JSON.parse(cached);
            return {
                ...parsed,
                lastChecked: parsed.lastChecked, // Return cached check time
            };
        }

        // Perform actual health check
        const woo = new WooCommerceRestApi({
            url: account.wooUrl,
            consumerKey: account.wooConsumerKey,
            consumerSecret: account.wooConsumerSecret,
            version: 'wc/v3',
        });

        try {
            const startTime = Date.now();
            const response = await woo.get('system_status');
            const responseTime = Date.now() - startTime;

            const systemStatus = response.data;
            const environment = systemStatus.environment || {};

            let status: HealthLevel = 'healthy';
            let message = 'Store connection healthy';

            // Check response time
            if (responseTime > 5000) {
                status = 'warning';
                message = `Store responding slowly (${Math.round(responseTime / 1000)}s)`;
            }

            // Check WooCommerce version
            const wcVersion = environment.version || 'unknown';

            const result: StatusSection = {
                status,
                message,
                lastChecked: new Date().toISOString(),
                details: {
                    configured: true,
                    connected: true,
                    responseTimeMs: responseTime,
                    storeUrl: account.wooUrl,
                    wcVersion,
                    phpVersion: environment.php_version || 'unknown',
                    wpVersion: environment.wp_version || 'unknown',
                },
            };

            // Cache for 5 minutes
            await redisClient.set(cacheKey, JSON.stringify(result), 'EX', 300);

            return result;
        } catch (wooError) {
            const errorMessage = wooError instanceof Error ? wooError.message : 'Connection failed';

            const result: StatusSection = {
                status: 'critical',
                message: `Cannot connect to store: ${errorMessage.slice(0, 50)}`,
                lastChecked: new Date().toISOString(),
                details: {
                    configured: true,
                    connected: false,
                    error: errorMessage,
                    storeUrl: account.wooUrl,
                },
            };

            // Cache failures for 1 minute (allow faster retry)
            await redisClient.set(cacheKey, JSON.stringify(result), 'EX', 60);

            return result;
        }
    } catch (error) {
        Logger.error('[StatusCenter] Store health check failed', { accountId, error });
        return {
            status: 'warning',
            message: 'Unable to check store health',
            lastChecked: new Date().toISOString(),
        };
    }
}

/**
 * Get revenue anomaly status for the account.
 */
async function getRevenueAlertStatus(accountId: string): Promise<StatusSection> {
    try {
        const anomaly = await AnomalyDetection.getRevenueAnomaly(accountId);

        let status: HealthLevel = 'healthy';
        let message = 'Revenue tracking normally';

        if (anomaly.isAnomaly) {
            if (anomaly.direction === 'above') {
                // Positive anomaly - still mark as healthy but with alert info
                status = 'healthy';
                message = anomaly.message || `Revenue ${anomaly.percentChange}% above expected`;
            } else if (anomaly.direction === 'below') {
                // Negative anomaly - warning or critical based on severity
                if (Math.abs(anomaly.percentChange) >= 50) {
                    status = 'critical';
                } else {
                    status = 'warning';
                }
                message = anomaly.message || `Revenue ${Math.abs(anomaly.percentChange)}% below expected`;
            }
        }

        return {
            status,
            message,
            lastChecked: new Date().toISOString(),
            details: {
                isAnomaly: anomaly.isAnomaly,
                direction: anomaly.direction,
                todayRevenue: anomaly.todayRevenue,
                baselineRevenue: anomaly.baselineRevenue,
                percentChange: anomaly.percentChange,
            },
        };
    } catch (error) {
        Logger.error('[StatusCenter] Revenue alert check failed', { accountId, error });
        return {
            status: 'healthy',
            message: 'Revenue data unavailable',
            lastChecked: new Date().toISOString(),
            details: { error: 'Could not calculate anomaly' },
        };
    }
}

export default statusCenterRoutes;
