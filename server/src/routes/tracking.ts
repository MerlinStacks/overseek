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

            const healthUrl = `${account.wooUrl}/wp-json/overseek/v1/health?account_id=${accountId}`;

            try {
                const controller = new AbortController();
                const timeout = setTimeout(() => controller.abort(), 10000);

                const response = await fetch(healthUrl, {
                    method: 'GET',
                    headers: { 'Accept': 'application/json' },
                    signal: controller.signal
                });

                clearTimeout(timeout);

                if (!response.ok) {
                    return {
                        success: false,
                        storeUrl: account.wooUrl,
                        storeReachable: true,
                        pluginInstalled: response.status !== 404,
                        error: response.status === 404
                            ? 'OverSeek plugin not detected'
                            : `Store returned status ${response.status}`
                    };
                }

                const data = await response.json() as any;

                return {
                    success: true,
                    storeUrl: account.wooUrl,
                    storeName: account.name,
                    storeReachable: true,
                    pluginInstalled: true,
                    pluginVersion: data.version || 'unknown',
                    configured: data.configured,
                    accountMatch: data.accountMatch,
                    trackingEnabled: data.trackingEnabled,
                    chatEnabled: data.chatEnabled,
                    woocommerceActive: data.woocommerceActive,
                    woocommerceVersion: data.woocommerceVersion
                };

            } catch (fetchError: any) {
                return {
                    success: false,
                    storeUrl: account.wooUrl,
                    storeReachable: false,
                    pluginInstalled: false,
                    error: fetchError.name === 'AbortError'
                        ? 'Connection timed out'
                        : `Failed to connect: ${fetchError.message}`
                };
            }

        } catch (error) {
            Logger.error('Store Verification Error', { error });
            return reply.code(500).send({ error: 'Failed to verify store connection' });
        }
    });
};

export default trackingRoutes;
