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
        console.error('Admin stats error:', e);
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
        console.error('Admin list accounts error:', e);
        res.status(500).json({ error: 'Failed to fetch accounts' });
    }
});

/**
 * GET /api/admin/accounts/:accountId
 * Get a single account by ID with details.
 */
router.get('/accounts/:accountId', async (req: AuthenticatedRequest, res: Response) => {
    try {
        const { accountId } = req.params;

        const account = await prisma.account.findUnique({
            where: { id: accountId },
            include: {
                _count: { select: { users: true } },
                features: true,
                users: {
                    include: {
                        user: {
                            select: { id: true, email: true, fullName: true }
                        }
                    }
                }
            }
        });

        if (!account) {
            return res.status(404).json({ error: 'Account not found' });
        }

        res.json(account);
    } catch (e) {
        console.error('Failed to fetch account:', e);
        res.status(500).json({ error: 'Failed to fetch account' });
    }
});

/**
 * DELETE /api/admin/accounts/:accountId
 * Delete an account with double confirmation (must provide exact account name).
 * Body: { confirmAccountName: string }
 */
router.delete('/accounts/:accountId', async (req: AuthenticatedRequest, res: Response) => {
    try {
        const { accountId } = req.params;
        const { confirmAccountName } = req.body;

        if (!confirmAccountName || typeof confirmAccountName !== 'string') {
            return res.status(400).json({ error: 'confirmAccountName is required' });
        }

        const account = await prisma.account.findUnique({
            where: { id: accountId },
            select: { id: true, name: true }
        });

        if (!account) {
            return res.status(404).json({ error: 'Account not found' });
        }

        // Double confirmation: name must match exactly
        if (account.name !== confirmAccountName) {
            return res.status(400).json({ error: 'Account name does not match. Deletion cancelled.' });
        }

        // Delete account (Prisma cascades handle related data)
        await prisma.account.delete({
            where: { id: accountId }
        });

        res.json({ success: true, message: `Account "${account.name}" has been deleted.` });
    } catch (e: any) {
        console.error('Failed to delete account:', e?.message || e, e?.stack);
        res.status(500).json({ error: 'Failed to delete account', details: e?.message || String(e) });
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

// ──────────────────────────────────────────────────────────────
// PLATFORM CREDENTIALS MANAGEMENT
// ──────────────────────────────────────────────────────────────

/**
 * GET /api/admin/platform-credentials
 * List all platform credentials (full values for Super Admin verification).
 * This endpoint is protected by requireSuperAdmin middleware.
 */
router.get('/platform-credentials', async (req: AuthenticatedRequest, res: Response) => {
    try {
        const credentials = await prisma.platformCredentials.findMany({
            orderBy: { platform: 'asc' }
        });

        // Return full credentials for Super Admin verification
        // This is safe because the route is protected by requireSuperAdmin
        res.json(credentials);
    } catch (e) {
        res.status(500).json({ error: 'Failed to fetch platform credentials' });
    }
});

/**
 * GET /api/admin/platform-credentials/:platform
 * Get credentials for a specific platform (masked).
 */
router.get('/platform-credentials/:platform', async (req: AuthenticatedRequest, res: Response) => {
    try {
        const { platform } = req.params;
        const cred = await prisma.platformCredentials.findUnique({
            where: { platform }
        });

        if (!cred) {
            return res.status(404).json({ error: 'Platform credentials not found' });
        }

        res.json({
            ...cred,
            credentials: maskCredentials(cred.credentials as Record<string, string>)
        });
    } catch (e) {
        res.status(500).json({ error: 'Failed to fetch platform credentials' });
    }
});

/**
 * PUT /api/admin/platform-credentials/:platform
 * Create or update credentials for a platform.
 * Body: { credentials: { clientId, clientSecret, ... }, notes? }
 */
router.put('/platform-credentials/:platform', async (req: AuthenticatedRequest, res: Response) => {
    try {
        const { platform } = req.params;
        const { credentials, notes } = req.body;

        if (!credentials || typeof credentials !== 'object') {
            return res.status(400).json({ error: 'Invalid credentials format' });
        }

        const cred = await prisma.platformCredentials.upsert({
            where: { platform },
            update: { credentials, notes },
            create: { platform, credentials, notes }
        });

        res.json({
            ...cred,
            credentials: maskCredentials(cred.credentials as Record<string, string>)
        });
    } catch (e) {
        res.status(500).json({ error: 'Failed to save platform credentials' });
    }
});

/**
 * DELETE /api/admin/platform-credentials/:platform
 * Delete credentials for a platform.
 */
router.delete('/platform-credentials/:platform', async (req: AuthenticatedRequest, res: Response) => {
    try {
        const { platform } = req.params;
        await prisma.platformCredentials.delete({
            where: { platform }
        });
        res.json({ success: true });
    } catch (e) {
        res.status(500).json({ error: 'Failed to delete platform credentials' });
    }
});

/**
 * Mask credential values for safe display.
 * Shows first 4 chars + "..." for each value.
 */
function maskCredentials(creds: Record<string, string>): Record<string, string> {
    const masked: Record<string, string> = {};
    for (const [key, value] of Object.entries(creds)) {
        if (typeof value === 'string' && value.length > 4) {
            masked[key] = value.substring(0, 4) + '********';
        } else {
            masked[key] = '********';
        }
    }
    return masked;
}

// ──────────────────────────────────────────────────────────────
// PLATFORM SMTP TEST
// ──────────────────────────────────────────────────────────────

import { platformEmailService } from '../services/PlatformEmailService';

/**
 * POST /api/admin/platform-smtp/test
 * Test SMTP connection with provided credentials before saving.
 * Body: { host, port, username, password, secure? }
 */
router.post('/platform-smtp/test', async (req: AuthenticatedRequest, res: Response) => {
    try {
        const { host, port, username, password, secure } = req.body;

        if (!host || !port || !username || !password) {
            return res.status(400).json({
                success: false,
                error: 'Missing required fields: host, port, username, password'
            });
        }

        const result = await platformEmailService.testConnection({
            host,
            port: parseInt(port),
            username,
            password,
            secure: Boolean(secure)
        });

        if (result.success) {
            res.json({ success: true });
        } else {
            res.status(400).json({ success: false, error: result.error });
        }
    } catch (e: any) {
        res.status(500).json({ success: false, error: e.message || 'SMTP test failed' });
    }
});

// ──────────────────────────────────────────────────────────────
// VAPID KEY GENERATION
// ──────────────────────────────────────────────────────────────

import webpush from 'web-push';

/**
 * POST /api/admin/generate-vapid-keys
 * Generate new VAPID keys for Web Push notifications.
 */
router.post('/generate-vapid-keys', async (req: AuthenticatedRequest, res: Response) => {
    try {
        const keys = webpush.generateVAPIDKeys();
        res.json({
            publicKey: keys.publicKey,
            privateKey: keys.privateKey
        });
    } catch (e: any) {
        res.status(500).json({ error: e.message || 'Failed to generate VAPID keys' });
    }
});

// ──────────────────────────────────────────────────────────────
// AI PROMPTS MANAGEMENT
// ──────────────────────────────────────────────────────────────

/**
 * GET /api/admin/ai-prompts
 * List all configured AI prompts.
 */
router.get('/ai-prompts', async (req: AuthenticatedRequest, res: Response) => {
    try {
        const prompts = await prisma.aIPrompt.findMany({
            orderBy: { promptId: 'asc' }
        });

        // Map to expected format
        const formatted = prompts.map(p => ({
            id: p.promptId,
            name: p.name,
            content: p.content,
            updatedAt: p.updatedAt
        }));

        res.json(formatted);
    } catch (e) {
        console.error('Failed to fetch AI prompts:', e);
        res.status(500).json({ error: 'Failed to fetch AI prompts' });
    }
});

/**
 * GET /api/admin/ai-prompts/:promptId
 * Get a specific AI prompt by ID.
 */
router.get('/ai-prompts/:promptId', async (req: AuthenticatedRequest, res: Response) => {
    try {
        const { promptId } = req.params;
        const prompt = await prisma.aIPrompt.findUnique({
            where: { promptId }
        });

        if (!prompt) {
            return res.status(404).json({ error: 'Prompt not found' });
        }

        res.json({
            id: prompt.promptId,
            name: prompt.name,
            content: prompt.content,
            updatedAt: prompt.updatedAt
        });
    } catch (e) {
        console.error('Failed to fetch AI prompt:', e);
        res.status(500).json({ error: 'Failed to fetch AI prompt' });
    }
});

/**
 * PUT /api/admin/ai-prompts/:promptId
 * Create or update an AI prompt.
 * Body: { content: string, name?: string }
 */
router.put('/ai-prompts/:promptId', async (req: AuthenticatedRequest, res: Response) => {
    try {
        const { promptId } = req.params;
        const { content, name } = req.body;

        if (!content || typeof content !== 'string') {
            return res.status(400).json({ error: 'Content is required' });
        }

        const prompt = await prisma.aIPrompt.upsert({
            where: { promptId },
            update: { content, name },
            create: { promptId, content, name }
        });

        res.json({
            id: prompt.promptId,
            name: prompt.name,
            content: prompt.content,
            updatedAt: prompt.updatedAt
        });
    } catch (e) {
        console.error('Failed to save AI prompt:', e);
        res.status(500).json({ error: 'Failed to save AI prompt' });
    }
});

/**
 * DELETE /api/admin/ai-prompts/:promptId
 * Delete an AI prompt.
 */
router.delete('/ai-prompts/:promptId', async (req: AuthenticatedRequest, res: Response) => {
    try {
        const { promptId } = req.params;
        await prisma.aIPrompt.delete({
            where: { promptId }
        });
        res.json({ success: true });
    } catch (e) {
        console.error('Failed to delete AI prompt:', e);
        res.status(500).json({ error: 'Failed to delete AI prompt' });
    }
});

export default router;

