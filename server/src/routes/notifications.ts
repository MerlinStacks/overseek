import { Router, Request, Response } from 'express';
import { prisma } from '../utils/prisma';
import { Logger } from '../utils/logger';

import { requireAuth } from '../middleware/auth';

const router = Router();

router.use(requireAuth);

// GET / - List notifications for account
router.get('/', async (req: Request, res: Response) => {
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
router.post('/read-all', async (req: Request, res: Response) => {
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
router.post('/:id/read', async (req: Request, res: Response) => {
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

export default router;
