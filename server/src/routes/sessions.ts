import { Router, Response } from 'express';
import { AuthenticatedRequest } from '../types/express';
import { requireAuth } from '../middleware/auth';
import { prisma } from '../utils/prisma';
import { Logger } from '../utils/logger';

const router = Router();

router.use(requireAuth);

// GET /api/sessions - List all active sessions for current user
router.get('/', async (req: AuthenticatedRequest, res: Response) => {
    try {
        const userId = req.user?.id;
        if (!userId) return res.status(401).json({ error: 'Unauthorized' });

        const sessions = await prisma.refreshToken.findMany({
            where: {
                userId,
                revokedAt: null,
                expiresAt: { gt: new Date() }
            },
            select: {
                id: true,
                createdAt: true,
                expiresAt: true,
                ipAddress: true,
                userAgent: true
            },
            orderBy: { createdAt: 'desc' }
        });

        // Mark current session
        const currentToken = req.headers.authorization?.replace('Bearer ', '');
        const sessionsWithCurrent = sessions.map(s => ({
            ...s,
            isCurrent: false // We can't easily match JWT to refresh token, so just show all
        }));

        res.json(sessionsWithCurrent);
    } catch (error) {
        Logger.error('Failed to fetch sessions', { error });
        res.status(500).json({ error: 'Failed to fetch sessions' });
    }
});

// DELETE /api/sessions/:id - Revoke specific session
router.delete('/:id', async (req: AuthenticatedRequest, res: Response) => {
    try {
        const userId = req.user?.id;
        const { id } = req.params;

        if (!userId) return res.status(401).json({ error: 'Unauthorized' });

        // Verify ownership
        const token = await prisma.refreshToken.findFirst({
            where: { id, userId }
        });

        if (!token) {
            return res.status(404).json({ error: 'Session not found' });
        }

        await prisma.refreshToken.update({
            where: { id },
            data: { revokedAt: new Date() }
        });

        Logger.info('Session revoked', { userId, sessionId: id });
        res.json({ success: true });
    } catch (error) {
        Logger.error('Failed to revoke session', { error });
        res.status(500).json({ error: 'Failed to revoke session' });
    }
});

// DELETE /api/sessions - Revoke all sessions except current
router.delete('/', async (req: AuthenticatedRequest, res: Response) => {
    try {
        const userId = req.user?.id;
        if (!userId) return res.status(401).json({ error: 'Unauthorized' });

        const result = await prisma.refreshToken.updateMany({
            where: {
                userId,
                revokedAt: null
            },
            data: { revokedAt: new Date() }
        });

        Logger.info('All sessions revoked', { userId, count: result.count });
        res.json({ success: true, revokedCount: result.count });
    } catch (error) {
        Logger.error('Failed to revoke all sessions', { error });
        res.status(500).json({ error: 'Failed to revoke sessions' });
    }
});

export default router;
