/**
 * Tracking Dashboard Routes
 * 
 * Protected analytics endpoints: live visitors, stats, funnel, revenue, etc.
 */

import express from 'express';
import { TrackingService } from '../services/TrackingService';
import { requireAuth } from '../middleware/auth';
import { Logger } from '../utils/logger';
import { prisma } from '../utils/prisma';

const router = express.Router();

// Helper to extract account ID from headers
const getAccountId = (req: any): string | null => req.headers['x-account-id'] as string || null;

router.get('/live', requireAuth, async (req: any, res) => {
    try {
        const accountId = getAccountId(req);
        if (!accountId) return res.status(400).json({ error: 'Account ID required' });
        res.json(await TrackingService.getLiveVisitors(accountId));
    } catch (error) {
        Logger.error('Live Users Error', { error });
        res.status(500).json({ error: 'Failed to fetch live users' });
    }
});

router.get('/carts', requireAuth, async (req: any, res) => {
    try {
        const accountId = getAccountId(req);
        if (!accountId) return res.status(400).json({ error: 'Account ID required' });
        res.json(await TrackingService.getLiveCarts(accountId));
    } catch (error) {
        Logger.error('Live Carts Error', { error });
        res.status(500).json({ error: 'Failed to fetch live carts' });
    }
});

router.get('/session/:sessionId', requireAuth, async (req: any, res) => {
    try {
        res.json(await TrackingService.getSessionHistory(req.params.sessionId));
    } catch (error) {
        Logger.error('Session History Error', { error });
        res.status(500).json({ error: 'Failed to fetch session history' });
    }
});

router.get('/status', requireAuth, async (req: any, res) => {
    try {
        const accountId = getAccountId(req);
        if (!accountId) return res.status(400).json({ error: 'Account ID required' });

        const lastSession = await prisma.analyticsSession.findFirst({
            where: { accountId },
            orderBy: { lastActiveAt: 'desc' },
            select: { lastActiveAt: true }
        });

        res.json({ connected: !!lastSession, lastSignal: lastSession?.lastActiveAt || null });
    } catch (error) {
        Logger.error('Status Check Error', { error });
        res.status(500).json({ error: 'Failed to check status' });
    }
});

router.get('/stats', requireAuth, async (req: any, res) => {
    try {
        const accountId = getAccountId(req);
        if (!accountId) return res.status(400).json({ error: 'Account ID required' });
        const days = parseInt(req.query.days as string) || 30;
        res.json(await TrackingService.getStats(accountId, days));
    } catch (error) {
        Logger.error('Stats Error', { error });
        res.status(500).json({ error: 'Failed to fetch stats' });
    }
});

router.get('/funnel', requireAuth, async (req: any, res) => {
    try {
        const accountId = getAccountId(req);
        if (!accountId) return res.status(400).json({ error: 'Account ID required' });
        const days = parseInt(req.query.days as string) || 30;
        res.json(await TrackingService.getFunnel(accountId, days));
    } catch (error) {
        Logger.error('Funnel Error', { error });
        res.status(500).json({ error: 'Failed to fetch funnel' });
    }
});

router.get('/revenue', requireAuth, async (req: any, res) => {
    try {
        const accountId = getAccountId(req);
        if (!accountId) return res.status(400).json({ error: 'Account ID required' });
        const days = parseInt(req.query.days as string) || 30;
        res.json(await TrackingService.getRevenue(accountId, days));
    } catch (error) {
        Logger.error('Revenue Error', { error });
        res.status(500).json({ error: 'Failed to fetch revenue' });
    }
});

router.get('/attribution', requireAuth, async (req: any, res) => {
    try {
        const accountId = getAccountId(req);
        if (!accountId) return res.status(400).json({ error: 'Account ID required' });
        const days = parseInt(req.query.days as string) || 30;
        res.json(await TrackingService.getAttribution(accountId, days));
    } catch (error) {
        Logger.error('Attribution Error', { error });
        res.status(500).json({ error: 'Failed to fetch attribution' });
    }
});

router.get('/abandonment', requireAuth, async (req: any, res) => {
    try {
        const accountId = getAccountId(req);
        if (!accountId) return res.status(400).json({ error: 'Account ID required' });
        const days = parseInt(req.query.days as string) || 30;
        res.json(await TrackingService.getAbandonmentRate(accountId, days));
    } catch (error) {
        Logger.error('Abandonment Error', { error });
        res.status(500).json({ error: 'Failed to fetch abandonment' });
    }
});

router.get('/searches', requireAuth, async (req: any, res) => {
    try {
        const accountId = getAccountId(req);
        if (!accountId) return res.status(400).json({ error: 'Account ID required' });
        const days = parseInt(req.query.days as string) || 30;
        res.json(await TrackingService.getSearches(accountId, days));
    } catch (error) {
        Logger.error('Searches Error', { error });
        res.status(500).json({ error: 'Failed to fetch searches' });
    }
});

router.get('/exits', requireAuth, async (req: any, res) => {
    try {
        const accountId = getAccountId(req);
        if (!accountId) return res.status(400).json({ error: 'Account ID required' });
        const days = parseInt(req.query.days as string) || 30;
        res.json(await TrackingService.getExitPages(accountId, days));
    } catch (error) {
        Logger.error('Exits Error', { error });
        res.status(500).json({ error: 'Failed to fetch exits' });
    }
});

router.get('/cohorts', requireAuth, async (req: any, res) => {
    try {
        const accountId = getAccountId(req);
        if (!accountId) return res.status(400).json({ error: 'Account ID required' });
        res.json(await TrackingService.getCohorts(accountId));
    } catch (error) {
        Logger.error('Cohorts Error', { error });
        res.status(500).json({ error: 'Failed to fetch cohorts' });
    }
});

router.get('/ltv', requireAuth, async (req: any, res) => {
    try {
        const accountId = getAccountId(req);
        if (!accountId) return res.status(400).json({ error: 'Account ID required' });
        res.json(await TrackingService.getLTV(accountId));
    } catch (error) {
        Logger.error('LTV Error', { error });
        res.status(500).json({ error: 'Failed to fetch LTV' });
    }
});

router.get('/export', requireAuth, async (req: any, res) => {
    try {
        const accountId = getAccountId(req);
        if (!accountId) return res.status(400).json({ error: 'Account ID required' });
        const days = parseInt(req.query.days as string) || 30;

        const [stats, funnel, revenue, attribution, abandonment, cohorts, ltv] = await Promise.all([
            TrackingService.getStats(accountId, days),
            TrackingService.getFunnel(accountId, days),
            TrackingService.getRevenue(accountId, days),
            TrackingService.getAttribution(accountId, days),
            TrackingService.getAbandonmentRate(accountId, days),
            TrackingService.getCohorts(accountId),
            TrackingService.getLTV(accountId)
        ]);

        res.setHeader('Content-Disposition', `attachment; filename="analytics-export.json"`);
        res.json({ exportedAt: new Date().toISOString(), dateRange: `Last ${days} days`, stats, funnel, revenue, attribution, abandonment, cohorts, ltv });
    } catch (error) {
        Logger.error('Export Error', { error });
        res.status(500).json({ error: 'Failed to export data' });
    }
});

export default router;
