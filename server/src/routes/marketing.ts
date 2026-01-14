/**
 * Marketing Route - Fastify Plugin
 */

import { FastifyPluginAsync } from 'fastify';
import { MarketingService } from '../services/MarketingService';
import { requireAuthFastify } from '../middleware/auth';
import { Logger } from '../utils/logger';

const service = new MarketingService();

const marketingRoutes: FastifyPluginAsync = async (fastify) => {
    fastify.addHook('preHandler', requireAuthFastify);

    // Campaigns
    fastify.get('/campaigns', async (request, reply) => {
        try {
            const campaigns = await service.listCampaigns(request.user!.accountId!);
            return campaigns;
        } catch (e) {
            return reply.code(500).send({ error: e });
        }
    });

    fastify.post('/campaigns', async (request, reply) => {
        try {
            const campaign = await service.createCampaign(request.user!.accountId!, request.body as any);
            return campaign;
        } catch (e) {
            Logger.error('Error creating campaign', { error: e });
            return reply.code(500).send({ error: e });
        }
    });

    fastify.get<{ Params: { id: string } }>('/campaigns/:id', async (request, reply) => {
        try {
            const campaign = await service.getCampaign(request.params.id, request.user!.accountId!);
            if (!campaign) return reply.code(404).send({ error: 'Not found' });
            return campaign;
        } catch (e) {
            return reply.code(500).send({ error: e });
        }
    });

    fastify.put<{ Params: { id: string } }>('/campaigns/:id', async (request, reply) => {
        try {
            await service.updateCampaign(request.params.id, request.user!.accountId!, request.body as any);
            return { success: true };
        } catch (e) {
            return reply.code(500).send({ error: e });
        }
    });

    fastify.delete<{ Params: { id: string } }>('/campaigns/:id', async (request, reply) => {
        try {
            await service.deleteCampaign(request.params.id, request.user!.accountId!);
            return { success: true };
        } catch (e) {
            return reply.code(500).send({ error: e });
        }
    });

    fastify.post<{ Params: { id: string }; Body: { email: string } }>('/campaigns/:id/test', async (request, reply) => {
        try {
            const { email } = request.body;
            await service.sendTestEmail(request.params.id, email);
            return { success: true };
        } catch (e) {
            return reply.code(500).send({ error: e });
        }
    });

    // Automations
    fastify.get('/automations', async (request, reply) => {
        try {
            const automations = await service.listAutomations(request.user!.accountId!);
            return automations;
        } catch (e) {
            return reply.code(500).send({ error: e });
        }
    });

    fastify.post('/automations', async (request, reply) => {
        try {
            const automation = await service.upsertAutomation(request.user!.accountId!, request.body as any);
            return automation;
        } catch (e) {
            return reply.code(500).send({ error: e });
        }
    });

    fastify.get<{ Params: { id: string } }>('/automations/:id', async (request, reply) => {
        try {
            const automation = await service.getAutomation(request.params.id, request.user!.accountId!);
            if (!automation) return reply.code(404).send({ error: 'Not found' });
            return automation;
        } catch (e) {
            return reply.code(500).send({ error: e });
        }
    });

    fastify.delete<{ Params: { id: string } }>('/automations/:id', async (request, reply) => {
        try {
            await service.deleteAutomation(request.params.id, request.user!.accountId!);
            return { success: true };
        } catch (e) {
            return reply.code(500).send({ error: e });
        }
    });

    // Templates
    fastify.get('/templates', async (request, reply) => {
        try {
            const templates = await service.listTemplates(request.user!.accountId!);
            return templates;
        } catch (e) {
            return reply.code(500).send({ error: e });
        }
    });

    fastify.post('/templates', async (request, reply) => {
        try {
            const template = await service.upsertTemplate(request.user!.accountId!, request.body as any);
            return template;
        } catch (e) {
            return reply.code(500).send({ error: e });
        }
    });

    fastify.delete<{ Params: { id: string } }>('/templates/:id', async (request, reply) => {
        try {
            await service.deleteTemplate(request.params.id, request.user!.accountId!);
            return { success: true };
        } catch (e) {
            return reply.code(500).send({ error: e });
        }
    });

    // Campaign Analytics / ROI Tracking
    fastify.get<{ Params: { id: string } }>('/campaigns/:id/analytics', async (request, reply) => {
        try {
            const { campaignTrackingService } = await import('../services/CampaignTrackingService');
            const analytics = await campaignTrackingService.getCampaignAnalytics(
                request.user!.accountId!,
                request.params.id
            );
            return analytics;
        } catch (e) {
            Logger.error('Error fetching campaign analytics', { error: e });
            return reply.code(500).send({ error: e });
        }
    });

    fastify.get<{ Querystring: { days?: string } }>('/analytics/overview', async (request, reply) => {
        try {
            const { campaignTrackingService } = await import('../services/CampaignTrackingService');
            const days = parseInt(request.query.days || '30', 10);
            const overview = await campaignTrackingService.getAccountCampaignOverview(
                request.user!.accountId!,
                days
            );
            return overview;
        } catch (e) {
            Logger.error('Error fetching campaign overview', { error: e });
            return reply.code(500).send({ error: e });
        }
    });

    // =========================================================================
    // AI Recommendation Tracking (AI Marketing Co-Pilot Phase 5)
    // =========================================================================

    /**
     * Get recommendation history
     */
    fastify.get<{ Querystring: { status?: string; limit?: string } }>(
        '/recommendations/history',
        async (request, reply) => {
            try {
                const { RecommendationTracker } = await import('../services/tools/knowledge/RecommendationTracker');
                const history = await RecommendationTracker.getHistory(
                    request.user!.accountId!,
                    {
                        status: request.query.status as any,
                        limit: request.query.limit ? parseInt(request.query.limit) : 50
                    }
                );
                return history;
            } catch (e) {
                Logger.error('Error fetching recommendation history', { error: e });
                return reply.code(500).send({ error: e });
            }
        }
    );

    /**
     * Get recommendation stats
     */
    fastify.get<{ Querystring: { days?: string } }>(
        '/recommendations/stats',
        async (request, reply) => {
            try {
                const { RecommendationTracker } = await import('../services/tools/knowledge/RecommendationTracker');
                const days = parseInt(request.query.days || '90', 10);
                const stats = await RecommendationTracker.getStats(request.user!.accountId!, days);
                return stats;
            } catch (e) {
                Logger.error('Error fetching recommendation stats', { error: e });
                return reply.code(500).send({ error: e });
            }
        }
    );

    /**
     * Record feedback on a recommendation (implemented/dismissed)
     */
    fastify.post<{ Params: { id: string }; Body: { status: string; dismissReason?: string } }>(
        '/recommendations/:id/feedback',
        async (request, reply) => {
            try {
                const { RecommendationTracker } = await import('../services/tools/knowledge/RecommendationTracker');
                const { status, dismissReason } = request.body;

                if (!['implemented', 'dismissed'].includes(status)) {
                    return reply.code(400).send({ error: 'Invalid status' });
                }

                const success = await RecommendationTracker.recordFeedback(
                    request.params.id,
                    { status: status as any, dismissReason: dismissReason as any }
                );

                if (!success) {
                    return reply.code(404).send({ error: 'Recommendation not found' });
                }
                return { success: true };
            } catch (e) {
                Logger.error('Error recording recommendation feedback', { error: e });
                return reply.code(500).send({ error: e });
            }
        }
    );

    /**
     * Record outcome of an implemented recommendation
     */
    fastify.post<{ Params: { id: string }; Body: { roasBefore: number; roasAfter: number; notes?: string } }>(
        '/recommendations/:id/outcome',
        async (request, reply) => {
            try {
                const { RecommendationTracker } = await import('../services/tools/knowledge/RecommendationTracker');
                const { roasBefore, roasAfter, notes } = request.body;

                const success = await RecommendationTracker.recordOutcome(
                    request.params.id,
                    { roasBefore, roasAfter, notes }
                );

                if (!success) {
                    return reply.code(404).send({ error: 'Recommendation not found' });
                }
                return { success: true };
            } catch (e) {
                Logger.error('Error recording recommendation outcome', { error: e });
                return reply.code(500).send({ error: e });
            }
        }
    );
};

export default marketingRoutes;

