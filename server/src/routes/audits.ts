import { Router } from 'express';
import { AuditService } from '../services/AuditService';
import { requireAuth } from '../middleware/auth';

const router = Router();

// Get logs for a specific resource
router.get('/:resource/:resourceId', requireAuth, async (req, res) => {
    try {
        const { resource, resourceId } = req.params;
        const accountId = (req as any).accountId || (req as any).user?.accountId || req.headers['x-account-id'] as string;

        if (!accountId) {
            return res.status(400).json({ error: 'No account context provided' });
        }

        const logs = await AuditService.getLogsForResource(accountId, resource.toUpperCase(), resourceId);
        res.json(logs);
    } catch (error) {
        console.error('[Audits] Failed to fetch audit logs:', error);
        res.status(500).json({ error: 'Failed to fetch audit logs' });
    }
});

// Get recent logs for the account
router.get('/recent', requireAuth, async (req, res) => {
    try {
        const accountId = req.headers['x-account-id'] as string;
        const limit = req.query.limit ? parseInt(req.query.limit as string) : 50;

        const logs = await AuditService.getRecentLogs(accountId, limit);
        res.json(logs);
    } catch (error) {
        res.status(500).json({ error: 'Failed to fetch recent audit logs' });
    }
});

export const auditsRouter = router;
