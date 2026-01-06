import { Router, Response } from 'express';
import { AuthenticatedRequest } from '../types/express';
import { prisma } from '../utils/prisma';
import { requireAuth, requireSuperAdmin } from '../middleware/auth';
import { generateToken } from '../utils/auth';

const router = Router();

// Protect all admin routes
router.use(requireAuth, requireSuperAdmin);

// Verify Admin Status
router.get('/verify', (req: AuthenticatedRequest, res: Response) => {
    res.json({ isAdmin: true });
});

// System Stats
router.get('/stats', async (req: AuthenticatedRequest, res: Response) => {
    try {
        const [
            totalAccounts,
            totalUsers,
            activeSyncs,
            failedSyncs24h
        ] = await Promise.all([
            prisma.account.count(),
            prisma.user.count(),
            prisma.syncLog.count({ where: { status: 'IN_PROGRESS' } }),
            prisma.syncLog.count({
                where: {
                    status: 'FAILED',
                    startedAt: { gte: new Date(Date.now() - 24 * 60 * 60 * 1000) }
                }
            })
        ]);

        res.json({
            totalAccounts,
            totalUsers,
            activeSyncs,
            failedSyncs24h
        });
    } catch (e) {
        res.status(500).json({ error: 'Failed to fetch stats' });
    }
});

// List Accounts
router.get('/accounts', async (req: AuthenticatedRequest, res: Response) => {
    try {
        const accounts = await prisma.account.findMany({
            include: {
                _count: { select: { users: true } },
                features: true
            },
            orderBy: { createdAt: 'desc' }
        });
        res.json(accounts);
    } catch (e) {
        res.status(500).json({ error: 'Failed to fetch accounts' });
    }
});

// Toggle Feature Flag
router.post('/accounts/:accountId/toggle-feature', async (req: AuthenticatedRequest, res: Response) => {
    try {
        const { accountId } = req.params;
        const { featureKey, isEnabled } = req.body;

        const feature = await prisma.accountFeature.upsert({
            where: { accountId_featureKey: { accountId, featureKey } },
            update: { isEnabled },
            create: { accountId, featureKey, isEnabled }
        });

        res.json(feature);
    } catch (e) {
        res.status(500).json({ error: 'Failed to toggle feature' });
    }
});

// System Logs
router.get('/logs', async (req: AuthenticatedRequest, res: Response) => {
    try {
        const page = parseInt(req.query.page as string) || 1;
        const limit = parseInt(req.query.limit as string) || 20;
        const skip = (page - 1) * limit;

        const logs = await prisma.syncLog.findMany({
            orderBy: { startedAt: 'desc' },
            take: limit,
            skip,
            include: {
                account: { select: { name: true } }
            }
        });

        const total = await prisma.syncLog.count();

        res.json({ logs, total, page, totalPages: Math.ceil(total / limit) });
    } catch (e) {
        res.status(500).json({ error: 'Failed to fetch logs' });
    }
});

// Impersonate User
router.post('/impersonate', async (req: AuthenticatedRequest, res: Response) => {
    try {
        const { targetUserId } = req.body;

        const user = await prisma.user.findUnique({ where: { id: targetUserId } });
        if (!user) return res.status(404).json({ error: 'User not found' });

        const token = generateToken({ userId: user.id });

        res.json({ token, user: { id: user.id, email: user.email, fullName: user.fullName } });
    } catch (e) {
        res.status(500).json({ error: 'Impersonation failed' });
    }
});

// Broadcast Notification
router.post('/broadcast', async (req: AuthenticatedRequest, res: Response) => {
    try {
        const { title, message, type, link } = req.body;

        const accounts = await prisma.account.findMany({ select: { id: true } });

        // Batch create notifications
        await prisma.notification.createMany({
            data: accounts.map(acc => ({
                accountId: acc.id,
                title,
                message,
                type: type || 'INFO',
                link
            }))
        });

        res.json({ success: true, count: accounts.length });
    } catch (e) {
        res.status(500).json({ error: 'Broadcast failed' });
    }
});

export default router;
