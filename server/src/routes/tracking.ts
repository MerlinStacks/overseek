/**
 * Tracking Routes - Fastify Plugin
 * Composite router combining ingestion and dashboard endpoints.
 */

import { FastifyPluginAsync } from 'fastify';
import { requireAuthFastify } from '../middleware/auth';
import { Logger } from '../utils/logger';
import { prisma } from '../utils/prisma';

// Import sub-plugins
import trackingIngestionRoutes from './trackingIngestion';
import trackingDashboardRoutes from './trackingDashboard';

const trackingRoutes: FastifyPluginAsync = async (fastify) => {
    // Mount sub-routers as nested plugins
    await fastify.register(trackingIngestionRoutes);   // Public ingestion: /events, /e, /p.gif, /custom
    await fastify.register(trackingDashboardRoutes);   // Protected dashboard: /live, /stats, /funnel, etc.

    /**
     * GET /verify-store
     * Pings WooCommerce store to verify plugin installation.
     */
    fastify.get('/verify-store', { preHandler: requireAuthFastify }, async (request, reply) => {
        try {
            const accountId = request.accountId;
            if (!accountId) return reply.code(400).send({ error: 'Account ID required' });

            const account = await prisma.account.findUnique({
                where: { id: accountId },
                select: { wooUrl: true, name: true }
            });

            if (!account?.wooUrl) {
                return {
                    success: false, error: 'No store URL configured',
                    storeReachable: false, pluginInstalled: false
                };
            }

            const healthUrl = new URL(`${account.wooUrl.replace(/\/+$/, '')}/wp-json/overseek/v1/health`);
            healthUrl.searchParams.set('account_id', accountId);

            let storeReachable = false;
            const controller = new AbortController();
            const timeout = setTimeout(() => controller.abort(), 10000);
            try {
                const response = await fetch(healthUrl.toString(), {
                    method: 'GET',
                    headers: { 'Accept': 'application/json' },
                    signal: controller.signal
                });

                storeReachable = true;

                if (!response.ok) {
                    return {
                        success: false,
                        storeUrl: account.wooUrl,
                        storeReachable: true,
                        pluginInstalled: false,
                        error: response.status === 404
                            ? 'OverSeek plugin not detected'
                            : `Store returned status ${response.status}`
                    };
                }

                const data = await response.json() as unknown;
                const health = data as Record<string, unknown> | null;
                // Current plugins identify themselves even when configuration details are private.
                // Older plugins exposed only a version and configuration flags.
                const identified = health && !Array.isArray(health) && health.success !== false && (
                    (health.plugin === 'overseek-wc' && health.success === true) ||
                    (health.plugin === undefined && typeof health.version === 'string' && health.version.trim() && typeof health.configured === 'boolean')
                );
                if (!identified) {
                    return {
                        success: false, storeUrl: account.wooUrl, storeReachable: true,
                        pluginInstalled: false, error: 'Store returned an invalid OverSeek health response'
                    };
                }

                return {
                    success: true,
                    storeUrl: account.wooUrl,
                    storeName: account.name,
                    storeReachable: true,
                    pluginInstalled: true,
                    pluginVersion: typeof health.version === 'string' && health.version.trim() ? health.version : 'unknown',
                    configured: health.configured,
                    accountMatch: health.accountMatch,
                    trackingEnabled: health.trackingEnabled,
                    chatEnabled: health.chatEnabled,
                    woocommerceActive: health.woocommerceActive,
                    woocommerceVersion: health.woocommerceVersion
                };

            } catch (fetchError: any) {
                return {
                    success: false,
                    storeUrl: account.wooUrl,
                    storeReachable,
                    pluginInstalled: false,
                    error: controller.signal.aborted || fetchError?.name === 'AbortError'
                        ? 'Connection timed out'
                        : storeReachable ? 'Store returned an invalid OverSeek health response'
                        : `Failed to connect: ${fetchError.message}`
                };
            } finally {
                clearTimeout(timeout);
            }

        } catch (error) {
            Logger.error('Store Verification Error', { error });
            return reply.code(500).send({ error: 'Failed to verify store connection' });
        }
    });
};

export default trackingRoutes;
