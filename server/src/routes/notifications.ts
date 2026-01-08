import { Router, Request, Response } from 'express';
import { AuthenticatedRequest } from '../types/express';
import { prisma } from '../utils/prisma';
import { Logger } from '../utils/logger';

import { requireAuth } from '../middleware/auth';

const router = Router();

router.use(requireAuth);

// GET / - List notifications for account
router.get('/', async (req: AuthenticatedRequest, res: Response) => {
    try {
        const accountId = req.headers['x-account-id'] as string;
        if (!accountId) return res.status(400).json({ error: 'Account ID required' });

        const limit = parseInt(req.query.limit as string) || 20;

        const notifications = await prisma.notification.findMany({
            where: { accountId },
            orderBy: { createdAt: 'desc' },
            take: limit
        });

        // Count unread
        const unreadCount = await prisma.notification.count({
            where: { accountId, isRead: false }
        });

        res.json({ notifications, unreadCount });
    } catch (error) {
        Logger.error('Fetch notifications error', { error });
        res.status(500).json({ error: 'Failed to fetch notifications' });
    }
});

// POST /read-all - Mark all as read
router.post('/read-all', async (req: AuthenticatedRequest, res: Response) => {
    try {
        const accountId = req.headers['x-account-id'] as string;
        if (!accountId) return res.status(400).json({ error: 'Account ID required' });

        await prisma.notification.updateMany({
            where: { accountId, isRead: false },
            data: { isRead: true }
        });

        res.json({ success: true });
    } catch (error) {
        res.status(500).json({ error: 'Failed to mark all read' });
    }
});

// POST /:id/read - Mark single as read
router.post('/:id/read', async (req: AuthenticatedRequest, res: Response) => {
    try {
        const { id } = req.params;
        const accountId = req.headers['x-account-id'] as string;

        await prisma.notification.updateMany({
            where: { id, accountId }, // Ensure ownership
            data: { isRead: true }
        });

        res.json({ success: true });
    } catch (error) {
        res.status(500).json({ error: 'Failed' });
    }
});

// --------------------------------------
// Web Push Notifications
// --------------------------------------

import { PushNotificationService } from '../services/PushNotificationService';

/**
 * GET /vapid-public-key - Returns the public VAPID key for client subscription.
 */
router.get('/vapid-public-key', async (req: AuthenticatedRequest, res: Response) => {
    try {
        const publicKey = await PushNotificationService.getVapidPublicKey();
        if (!publicKey) {
            return res.status(503).json({ error: 'Push notifications not configured' });
        }
        res.json({ publicKey });
    } catch (error) {
        Logger.error('[notifications] Failed to get VAPID key', { error });
        res.status(500).json({ error: 'Failed to get VAPID key' });
    }
});

/**
 * GET /push/subscription - Get current subscription status for user.
 */
router.get('/push/subscription', async (req: AuthenticatedRequest, res: Response) => {
    try {
        const accountId = req.headers['x-account-id'] as string;
        const userId = req.user?.id;
        if (!accountId || !userId) {
            return res.status(400).json({ error: 'Account ID and user required' });
        }

        const status = await PushNotificationService.getSubscription(userId, accountId);
        res.json(status);
    } catch (error) {
        Logger.error('[notifications] Failed to get subscription', { error });
        res.status(500).json({ error: 'Failed to get subscription status' });
    }
});

/**
 * POST /push/subscribe - Register a push subscription for the current user/device.
 */
router.post('/push/subscribe', async (req: AuthenticatedRequest, res: Response) => {
    try {
        const accountId = req.headers['x-account-id'] as string;
        const userId = req.user?.id;
        if (!accountId || !userId) {
            return res.status(400).json({ error: 'Account ID and user required' });
        }

        const { subscription, preferences } = req.body;
        if (!subscription?.endpoint || !subscription?.keys?.p256dh || !subscription?.keys?.auth) {
            return res.status(400).json({ error: 'Invalid subscription format' });
        }

        const result = await PushNotificationService.subscribe(userId, accountId, subscription, preferences);
        if (!result.success) {
            return res.status(500).json({ error: result.error });
        }

        res.json({ success: true, id: result.id });
    } catch (error) {
        Logger.error('[notifications] Subscribe failed', { error });
        res.status(500).json({ error: 'Failed to subscribe' });
    }
});

/**
 * DELETE /push/subscribe - Unsubscribe from push notifications.
 */
router.delete('/push/subscribe', async (req: AuthenticatedRequest, res: Response) => {
    try {
        const userId = req.user?.id;
        if (!userId) {
            return res.status(400).json({ error: 'User required' });
        }

        const { endpoint } = req.body;
        if (!endpoint) {
            return res.status(400).json({ error: 'Endpoint required' });
        }

        const success = await PushNotificationService.unsubscribe(userId, endpoint);
        res.json({ success });
    } catch (error) {
        Logger.error('[notifications] Unsubscribe failed', { error });
        res.status(500).json({ error: 'Failed to unsubscribe' });
    }
});

/**
 * PATCH /push/preferences - Update notification preferences for a subscription.
 */
router.patch('/push/preferences', async (req: AuthenticatedRequest, res: Response) => {
    try {
        const userId = req.user?.id;
        if (!userId) {
            return res.status(400).json({ error: 'User required' });
        }

        const { endpoint, preferences } = req.body;
        if (!endpoint) {
            return res.status(400).json({ error: 'Endpoint required' });
        }

        const success = await PushNotificationService.updatePreferences(userId, endpoint, preferences);
        res.json({ success });
    } catch (error) {
        Logger.error('[notifications] Update preferences failed', { error });
        res.status(500).json({ error: 'Failed to update preferences' });
    }
});

/**
 * POST /push/test - Send a test notification to verify setup.
 */
router.post('/push/test', async (req: AuthenticatedRequest, res: Response) => {
    try {
        const accountId = req.headers['x-account-id'] as string;
        const userId = req.user?.id;
        if (!accountId || !userId) {
            return res.status(400).json({ error: 'Account ID and user required' });
        }

        const result = await PushNotificationService.sendTestNotification(userId, accountId);
        if (!result.success) {
            return res.status(400).json({ error: result.error || 'Failed to send test notification' });
        }

        res.json({ success: true, sent: result.sent, failed: result.failed });
    } catch (error) {
        Logger.error('[notifications] Test notification failed', { error });
        res.status(500).json({ error: 'Failed to send test notification' });
    }
});

export default router;
