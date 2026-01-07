/**
 * OAuth Routes
 * 
 * Composite router combining platform-specific OAuth flows.
 */

import { Router, Response } from 'express';
import { AuthenticatedRequest } from '../types/express';
import { requireAuth } from '../middleware/auth';
import { Logger } from '../utils/logger';
import { prisma } from '../utils/prisma';

// Import sub-routers
import oauthGoogle from './oauthGoogle';
import oauthMeta from './oauthMeta';
import oauthTikTok from './oauthTikTok';

const router = Router();

// Mount platform-specific OAuth routes
router.use('/', oauthGoogle);    // /google/authorize, /google/callback
router.use('/', oauthMeta);      // /meta/exchange, /meta/messaging/...
router.use('/', oauthTikTok);    // /tiktok/authorize, /tiktok/callback

// ──────────────────────────────────────────────────────────────
// SOCIAL ACCOUNTS API
// ──────────────────────────────────────────────────────────────

/**
 * GET /api/oauth/social-accounts
 * List all connected social messaging accounts.
 */
router.get('/social-accounts', requireAuth, async (req: AuthenticatedRequest, res: Response) => {
    try {
        const accountId = (req as any).accountId;

        const socialAccounts = await prisma.socialAccount.findMany({
            where: { accountId, isActive: true },
            select: {
                id: true,
                platform: true,
                name: true,
                externalId: true,
                tokenExpiry: true,
                createdAt: true,
            },
        });

        res.json({ socialAccounts });
    } catch (error: any) {
        Logger.error('Failed to list social accounts', { error });
        res.status(500).json({ error: error.message });
    }
});

/**
 * DELETE /api/oauth/social-accounts/:id
 * Disconnect a social messaging account.
 */
router.delete('/social-accounts/:id', requireAuth, async (req: AuthenticatedRequest, res: Response) => {
    try {
        const accountId = (req as any).accountId;
        const { id } = req.params;

        await prisma.socialAccount.updateMany({
            where: { id, accountId },
            data: { isActive: false },
        });

        res.json({ success: true });
    } catch (error: any) {
        Logger.error('Failed to disconnect social account', { error });
        res.status(500).json({ error: error.message });
    }
});

export default router;
