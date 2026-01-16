/**
 * Tracking Dashboard Routes - Fastify Plugin
 * Protected analytics endpoints: live visitors, stats, funnel, revenue, etc.
 */

import { FastifyPluginAsync } from 'fastify';
import { TrackingService } from '../services/TrackingService';
import { requireAuthFastify } from '../middleware/auth';
import { Logger } from '../utils/logger';
import { prisma } from '../utils/prisma';

const trackingDashboardRoutes: FastifyPluginAsync = async (fastify) => {
    fastify.addHook('preHandler', requireAuthFastify);

    const getAccountId = (request: any): string | null => request.accountId || null;

    fastify.get('/live', async (request, reply) => {
        try {
            const accountId = getAccountId(request);
            if (!accountId) return reply.code(400).send({ error: 'Account ID required' });
            return await TrackingService.getLiveVisitors(accountId);
        } catch (error) {
            Logger.error('Live Users Error', { error });
            return reply.code(500).send({ error: 'Failed to fetch live users' });
        }
    });

    fastify.get('/carts', async (request, reply) => {
        try {
            const accountId = getAccountId(request);
            if (!accountId) return reply.code(400).send({ error: 'Account ID required' });
            return await TrackingService.getLiveCarts(accountId);
        } catch (error) {
            Logger.error('Live Carts Error', { error });
            return reply.code(500).send({ error: 'Failed to fetch live carts' });
        }
    });

    fastify.get<{ Params: { sessionId: string } }>('/session/:sessionId', async (request, reply) => {
        try {
            return await TrackingService.getSessionHistory(request.params.sessionId);
        } catch (error) {
            Logger.error('Session History Error', { error });
            return reply.code(500).send({ error: 'Failed to fetch session history' });
        }
    });

    fastify.get('/status', async (request, reply) => {
        try {
            const accountId = getAccountId(request);
            if (!accountId) return reply.code(400).send({ error: 'Account ID required' });

            const lastSession = await prisma.analyticsSession.findFirst({
                where: { accountId },
                orderBy: { lastActiveAt: 'desc' },
                select: { lastActiveAt: true }
            });

            return { connected: !!lastSession, lastSignal: lastSession?.lastActiveAt || null };
        } catch (error) {
            Logger.error('Status Check Error', { error });
            return reply.code(500).send({ error: 'Failed to check status' });
        }
    });

    fastify.get('/stats', async (request, reply) => {
        try {
            const accountId = getAccountId(request);
            if (!accountId) return reply.code(400).send({ error: 'Account ID required' });
            const query = request.query as { days?: string };
            const days = parseInt(query.days || '30');
            return await TrackingService.getStats(accountId, days);
        } catch (error) {
            Logger.error('Stats Error', { error });
            return reply.code(500).send({ error: 'Failed to fetch stats' });
        }
    });

    fastify.get('/funnel', async (request, reply) => {
        try {
            const accountId = getAccountId(request);
            if (!accountId) return reply.code(400).send({ error: 'Account ID required' });
            const query = request.query as { days?: string };
            const days = parseInt(query.days || '30');
            return await TrackingService.getFunnel(accountId, days);
        } catch (error) {
            Logger.error('Funnel Error', { error });
            return reply.code(500).send({ error: 'Failed to fetch funnel' });
        }
    });

    fastify.get('/revenue', async (request, reply) => {
        try {
            const accountId = getAccountId(request);
            if (!accountId) return reply.code(400).send({ error: 'Account ID required' });
            const query = request.query as { days?: string };
            const days = parseInt(query.days || '30');
            return await TrackingService.getRevenue(accountId, days);
        } catch (error) {
            Logger.error('Revenue Error', { error });
            return reply.code(500).send({ error: 'Failed to fetch revenue' });
        }
    });

    fastify.get('/attribution', async (request, reply) => {
        try {
            const accountId = getAccountId(request);
            if (!accountId) return reply.code(400).send({ error: 'Account ID required' });
            const query = request.query as { days?: string };
            const days = parseInt(query.days || '30');
            return await TrackingService.getAttribution(accountId, days);
        } catch (error) {
            Logger.error('Attribution Error', { error });
            return reply.code(500).send({ error: 'Failed to fetch attribution' });
        }
    });

    fastify.get('/abandonment', async (request, reply) => {
        try {
            const accountId = getAccountId(request);
            if (!accountId) return reply.code(400).send({ error: 'Account ID required' });
            const query = request.query as { days?: string };
            const days = parseInt(query.days || '30');
            return await TrackingService.getAbandonmentRate(accountId, days);
        } catch (error) {
            Logger.error('Abandonment Error', { error });
            return reply.code(500).send({ error: 'Failed to fetch abandonment' });
        }
    });

    fastify.get('/searches', async (request, reply) => {
        try {
            const accountId = getAccountId(request);
            if (!accountId) return reply.code(400).send({ error: 'Account ID required' });
            const query = request.query as { days?: string };
            const days = parseInt(query.days || '30');
            return await TrackingService.getSearches(accountId, days);
        } catch (error) {
            Logger.error('Searches Error', { error });
            return reply.code(500).send({ error: 'Failed to fetch searches' });
        }
    });

    fastify.get('/exits', async (request, reply) => {
        try {
            const accountId = getAccountId(request);
            if (!accountId) return reply.code(400).send({ error: 'Account ID required' });
            const query = request.query as { days?: string };
            const days = parseInt(query.days || '30');
            return await TrackingService.getExitPages(accountId, days);
        } catch (error) {
            Logger.error('Exits Error', { error });
            return reply.code(500).send({ error: 'Failed to fetch exits' });
        }
    });

    fastify.get('/cohorts', async (request, reply) => {
        try {
            const accountId = getAccountId(request);
            if (!accountId) return reply.code(400).send({ error: 'Account ID required' });
            return await TrackingService.getCohorts(accountId);
        } catch (error) {
            Logger.error('Cohorts Error', { error });
            return reply.code(500).send({ error: 'Failed to fetch cohorts' });
        }
    });

    fastify.get('/ltv', async (request, reply) => {
        try {
            const accountId = getAccountId(request);
            if (!accountId) return reply.code(400).send({ error: 'Account ID required' });
            return await TrackingService.getLTV(accountId);
        } catch (error) {
            Logger.error('LTV Error', { error });
            return reply.code(500).send({ error: 'Failed to fetch LTV' });
        }
    });

    fastify.get('/export', async (request, reply) => {
        try {
            const accountId = getAccountId(request);
            if (!accountId) return reply.code(400).send({ error: 'Account ID required' });
            const query = request.query as { days?: string };
            const days = parseInt(query.days || '30');

            const [stats, funnel, revenue, attribution, abandonment, cohorts, ltv] = await Promise.all([
                TrackingService.getStats(accountId, days),
                TrackingService.getFunnel(accountId, days),
                TrackingService.getRevenue(accountId, days),
                TrackingService.getAttribution(accountId, days),
                TrackingService.getAbandonmentRate(accountId, days),
                TrackingService.getCohorts(accountId),
                TrackingService.getLTV(accountId)
            ]);

            reply.header('Content-Disposition', 'attachment; filename="analytics-export.json"');
            return { exportedAt: new Date().toISOString(), dateRange: `Last ${days} days`, stats, funnel, revenue, attribution, abandonment, cohorts, ltv };
        } catch (error) {
            Logger.error('Export Error', { error });
            return reply.code(500).send({ error: 'Failed to export data' });
        }
    });
};

export default trackingDashboardRoutes;
