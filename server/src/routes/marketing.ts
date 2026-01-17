/**
 * Marketing Route - Fastify Plugin
 */

import { FastifyPluginAsync } from 'fastify';
import { MarketingService } from '../services/MarketingService';
import { requireAuthFastify } from '../middleware/auth';
import { Logger } from '../utils/logger';
import { prisma } from '../utils/prisma';

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

    // Test Email (standalone, for flow builder)
    fastify.post<{ Body: { to: string; subject: string; content: string } }>('/test-email', async (request, reply) => {
        try {
            const { to, subject, content } = request.body;

            if (!to || !subject || !content) {
                return reply.code(400).send({ error: 'Missing required fields: to, subject, content' });
            }

            // Get the primary email account for this account
            const emailAccount = await prisma.emailAccount.findFirst({
                where: {
                    accountId: request.user!.accountId!,
                    smtpEnabled: true
                }
            });

            if (!emailAccount) {
                return reply.code(400).send({ error: 'No email account configured. Please set up an email account in Settings.' });
            }

            // Import email service to send the test
            const { EmailService } = await import('../services/EmailService');
            const emailService = new EmailService();

            await emailService.sendEmail(
                request.user!.accountId!,
                emailAccount.id,
                to,
                subject,
                content,
                undefined,
                { source: 'TEST' }
            );

            Logger.info('Test email sent', { to, subject: subject.substring(0, 50), accountId: request.user!.accountId });
            return { success: true };
        } catch (e) {
            Logger.error('Error sending test email', { error: e });
            return reply.code(500).send({ error: 'Failed to send test email', message: (e as Error).message });
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

    // =========================================================================
    // Marketing Learnings (AI Marketing Co-Pilot Phase 4)
    // =========================================================================

    /**
     * List learnings for the account
     */
    fastify.get<{ Querystring: { includeInactive?: string; includePending?: string } }>(
        '/learnings',
        async (request, reply) => {
            try {
                const { LearningService } = await import('../services/tools/knowledge/LearningService');
                const learnings = await LearningService.list(request.user!.accountId!, {
                    includeInactive: request.query.includeInactive === 'true',
                    includePending: request.query.includePending === 'true'
                });
                return learnings;
            } catch (e) {
                Logger.error('Error fetching learnings', { error: e });
                return reply.code(500).send({ error: e });
            }
        }
    );

    /**
     * Get pending AI-derived learnings awaiting approval
     */
    fastify.get('/learnings/pending', async (request, reply) => {
        try {
            const { LearningService } = await import('../services/tools/knowledge/LearningService');
            const pending = await LearningService.getPending(request.user!.accountId!);
            return pending;
        } catch (e) {
            Logger.error('Error fetching pending learnings', { error: e });
            return reply.code(500).send({ error: e });
        }
    });

    /**
     * Create a new learning
     */
    fastify.post<{ Body: { platform: string; category: string; condition: string; recommendation: string; explanation?: string } }>(
        '/learnings',
        async (request, reply) => {
            try {
                const { LearningService } = await import('../services/tools/knowledge/LearningService');
                const { platform, category, condition, recommendation, explanation } = request.body;

                if (!platform || !category || !condition || !recommendation) {
                    return reply.code(400).send({ error: 'Missing required fields' });
                }

                const learning = await LearningService.create(request.user!.accountId!, {
                    platform: platform as any,
                    category: category as any,
                    condition,
                    recommendation,
                    explanation,
                    source: 'user'
                });
                return learning;
            } catch (e) {
                Logger.error('Error creating learning', { error: e });
                return reply.code(500).send({ error: e });
            }
        }
    );

    /**
     * Update a learning
     */
    fastify.put<{ Params: { id: string }; Body: { condition?: string; recommendation?: string; explanation?: string; isActive?: boolean } }>(
        '/learnings/:id',
        async (request, reply) => {
            try {
                const { LearningService } = await import('../services/tools/knowledge/LearningService');
                const updated = await LearningService.update(
                    request.params.id,
                    request.user!.accountId!,
                    request.body
                );

                if (!updated) {
                    return reply.code(404).send({ error: 'Learning not found' });
                }
                return updated;
            } catch (e) {
                Logger.error('Error updating learning', { error: e });
                return reply.code(500).send({ error: e });
            }
        }
    );

    /**
     * Delete a learning
     */
    fastify.delete<{ Params: { id: string } }>('/learnings/:id', async (request, reply) => {
        try {
            const { LearningService } = await import('../services/tools/knowledge/LearningService');
            const deleted = await LearningService.delete(request.params.id, request.user!.accountId!);

            if (!deleted) {
                return reply.code(404).send({ error: 'Learning not found' });
            }
            return { success: true };
        } catch (e) {
            Logger.error('Error deleting learning', { error: e });
            return reply.code(500).send({ error: e });
        }
    });

    /**
     * Approve a pending AI-derived learning
     */
    fastify.post<{ Params: { id: string } }>('/learnings/:id/approve', async (request, reply) => {
        try {
            const { LearningService } = await import('../services/tools/knowledge/LearningService');
            const approved = await LearningService.approvePending(request.params.id, request.user!.accountId!);

            if (!approved) {
                return reply.code(404).send({ error: 'Pending learning not found' });
            }
            return { success: true };
        } catch (e) {
            Logger.error('Error approving learning', { error: e });
            return reply.code(500).send({ error: e });
        }
    });

    /**
     * Derive new learnings from successful recommendation patterns
     */
    fastify.post('/learnings/derive', async (request, reply) => {
        try {
            const { LearningService } = await import('../services/tools/knowledge/LearningService');
            const derived = await LearningService.deriveFromOutcomes(request.user!.accountId!);
            return { derived, count: derived.length };
        } catch (e) {
            Logger.error('Error deriving learnings', { error: e });
            return reply.code(500).send({ error: e });
        }
    });

    // =========================================================================
    // Ad Alerts (AI Marketing Co-Pilot Phase 6)
    // =========================================================================

    /**
     * Get recent ad alerts
     */
    fastify.get<{ Querystring: { limit?: string; unacknowledgedOnly?: string } }>(
        '/alerts',
        async (request, reply) => {
            try {
                const limit = parseInt(request.query.limit || '20', 10);
                const unacknowledgedOnly = request.query.unacknowledgedOnly === 'true';

                const alerts = await prisma.adAlert.findMany({
                    where: {
                        accountId: request.user!.accountId!,
                        ...(unacknowledgedOnly ? { isAcknowledged: false } : {})
                    },
                    orderBy: { createdAt: 'desc' },
                    take: limit
                });
                return alerts;
            } catch (e) {
                Logger.error('Error fetching alerts', { error: e });
                return reply.code(500).send({ error: e });
            }
        }
    );

    /**
     * Acknowledge an alert
     */
    fastify.post<{ Params: { id: string } }>('/alerts/:id/acknowledge', async (request, reply) => {
        try {
            const alert = await prisma.adAlert.findFirst({
                where: { id: request.params.id, accountId: request.user!.accountId! }
            });

            if (!alert) {
                return reply.code(404).send({ error: 'Alert not found' });
            }

            await prisma.adAlert.update({
                where: { id: request.params.id },
                data: {
                    isAcknowledged: true,
                    acknowledgedAt: new Date(),
                    acknowledgedBy: request.user!.id
                }
            });

            return { success: true };
        } catch (e) {
            Logger.error('Error acknowledging alert', { error: e });
            return reply.code(500).send({ error: e });
        }
    });

    /**
     * Get alert counts (for badge display)
     */
    fastify.get('/alerts/count', async (request, reply) => {
        try {
            const [total, unacknowledged, critical] = await Promise.all([
                prisma.adAlert.count({ where: { accountId: request.user!.accountId! } }),
                prisma.adAlert.count({ where: { accountId: request.user!.accountId!, isAcknowledged: false } }),
                prisma.adAlert.count({ where: { accountId: request.user!.accountId!, isAcknowledged: false, severity: 'critical' } })
            ]);
            return { total, unacknowledged, critical };
        } catch (e) {
            Logger.error('Error fetching alert counts', { error: e });
            return reply.code(500).send({ error: e });
        }
    });
};

export default marketingRoutes;

