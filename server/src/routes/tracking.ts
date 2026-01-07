/**
 * Tracking Routes
 * 
 * Composite router combining ingestion and dashboard endpoints.
 * Store verification is included here as it touches both public and auth concerns.
 */

import express from 'express';
import { requireAuth } from '../middleware/auth';
import { Logger } from '../utils/logger';
import { prisma } from '../utils/prisma';

// Import sub-routers
import trackingIngestion from './trackingIngestion';
import trackingDashboard from './trackingDashboard';

const router = express.Router();

// Mount sub-routers
router.use('/', trackingIngestion);   // Public ingestion: /events, /e, /p.gif, /custom
router.use('/', trackingDashboard);   // Protected dashboard: /live, /stats, /funnel, etc.

/**
 * GET /api/tracking/verify-store
 * Pings WooCommerce store to verify plugin installation.
 */
router.get('/verify-store', requireAuth, async (req: any, res) => {
    try {
        const accountId = req.headers['x-account-id'] as string;
        if (!accountId) return res.status(400).json({ error: 'Account ID required' });

        const account = await prisma.account.findUnique({
            where: { id: accountId },
            select: { wooUrl: true, name: true }
        });

        if (!account?.wooUrl) {
            return res.json({
                success: false, error: 'No store URL configured',
                storeReachable: false, pluginInstalled: false
            });
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
                return res.json({
                    success: false,
                    storeUrl: account.wooUrl,
                    storeReachable: true,
                    pluginInstalled: response.status !== 404,
                    error: response.status === 404
                        ? 'OverSeek plugin not detected'
                        : `Store returned status ${response.status}`
                });
            }

            const data = await response.json() as any;

            return res.json({
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
            });

        } catch (fetchError: any) {
            return res.json({
                success: false,
                storeUrl: account.wooUrl,
                storeReachable: false,
                pluginInstalled: false,
                error: fetchError.name === 'AbortError'
                    ? 'Connection timed out'
                    : `Failed to connect: ${fetchError.message}`
            });
        }

    } catch (error) {
        Logger.error('Store Verification Error', { error });
        res.status(500).json({ error: 'Failed to verify store connection' });
    }
});

export default router;
