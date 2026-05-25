/**
 * Marketing Route - Fastify Plugin
 */

import { FastifyPluginAsync, FastifyReply, FastifyRequest } from 'fastify';
import { MarketingService } from '../services/MarketingService';
import { requireAuthFastify } from '../middleware/auth';
import { Logger } from '../utils/logger';
import { prisma } from '../utils/prisma';
import { getDefaultEmailAccount } from '../utils/getDefaultEmailAccount';
import { cartRecoveryService } from '../services/CartRecoveryService';
import { isAccountFeatureEnabled } from '../utils/accountFeatures';
import { resolveMergeTags } from '../services/MergeTagResolver';
import { HTTP_LIMITS } from '../config/limits';

const service = new MarketingService();

function getAccountId(request: FastifyRequest): string {
    const accountId = request.accountId || request.user?.accountId;
    if (!accountId) {
        throw new Error('Account context required');
    }
    return accountId;
}

function sendInternalError(reply: FastifyReply, error: unknown, context: string) {
    Logger.error(context, { error });
    return reply.code(500).send({ error: 'Internal server error' });
}

const marketingRoutes: FastifyPluginAsync = async (fastify) => {
    fastify.get<{ Params: { token: string } }>('/recover-cart/:token', async (request, reply) => {
        const payload = cartRecoveryService.verifyToken(request.params.token);
        if (!payload) {
            return reply.code(400).send({ error: 'Invalid or expired recovery link' });
        }

        const recoveryUrl = new URL(payload.checkoutUrl);
        recoveryUrl.searchParams.set('overseek_recover_cart', '1');
        recoveryUrl.searchParams.set('overseek_recovery_token', request.params.token);

        return reply.redirect(recoveryUrl.toString());
    });

    fastify.get<{ Params: { token: string } }>('/recover-cart/:token/details', async (request, reply) => {
        const details = await cartRecoveryService.getRecoveryDetails(request.params.token);
        if (!details) {
            return reply.code(400).send({ error: 'Invalid or expired recovery link' });
        }

        return details;
    });

    fastify.addHook('preHandler', requireAuthFastify);
    fastify.addHook('preHandler', async (request, reply) => {
        const accountId = request.accountId || request.user?.accountId;
        if (!accountId) {
            return reply.code(400).send({ error: 'Account context required' });
        }

        const enabled = await isAccountFeatureEnabled(accountId, 'EMAIL', true);
        if (!enabled) {
            return reply.code(403).send({ error: 'Email feature is disabled for this account' });
        }
    });

    // Campaigns
    fastify.get('/campaigns', async (request, reply) => {
        try {
            const campaigns = await service.listCampaigns(getAccountId(request));
            return campaigns;
        } catch (e) {
            return sendInternalError(reply, e, 'Marketing route failed');
        }
    });

    fastify.post('/campaigns', async (request, reply) => {
        try {
            const campaign = await service.createCampaign(getAccountId(request), request.body as any);
            return campaign;
        } catch (e) {
            Logger.error('Error creating campaign', { error: e });
            return sendInternalError(reply, e, 'Marketing route failed');
        }
    });

    fastify.get<{ Params: { id: string } }>('/campaigns/:id', async (request, reply) => {
        try {
            const campaign = await service.getCampaign(request.params.id, getAccountId(request));
            if (!campaign) return reply.code(404).send({ error: 'Not found' });
            return campaign;
        } catch (e) {
            return sendInternalError(reply, e, 'Marketing route failed');
        }
    });

    fastify.put<{ Params: { id: string } }>('/campaigns/:id', async (request, reply) => {
        try {
            await service.updateCampaign(request.params.id, getAccountId(request), request.body as any);
            return { success: true };
        } catch (e) {
            return sendInternalError(reply, e, 'Marketing route failed');
        }
    });

    fastify.delete<{ Params: { id: string } }>('/campaigns/:id', async (request, reply) => {
        try {
            await service.deleteCampaign(request.params.id, getAccountId(request));
            return { success: true };
        } catch (e) {
            return sendInternalError(reply, e, 'Marketing route failed');
        }
    });

    fastify.post<{ Params: { id: string }; Body: { email: string } }>('/campaigns/:id/test', async (request, reply) => {
        try {
            const { email } = request.body;
            await service.sendTestEmail(request.params.id, email);
            return { success: true };
        } catch (e) {
            return sendInternalError(reply, e, 'Marketing route failed');
        }
    });

    fastify.post<{ Params: { id: string } }>('/campaigns/:id/send', async (request, reply) => {
        try {
            const result = await service.enqueueCampaignSend(request.params.id, getAccountId(request));
            if (!result.queued) {
                return reply.code(409).send({ success: false, error: 'Campaign is already sending' });
            }

            return reply.code(202).send({ success: true, queued: true, jobId: result.jobId });
        } catch (e) {
            const message = (e as Error).message;
            if (message === 'Campaign not found') {
                return reply.code(404).send({ error: message });
            }
            Logger.error('Error queueing campaign send', { error: e });
            return reply.code(500).send({ error: 'Failed to queue campaign send' });
        }
    });

    fastify.post<{ Params: { id: string }; Body: { scheduledAt: string } }>('/campaigns/:id/schedule', async (request, reply) => {
        try {
            const scheduledAtValue = request.body?.scheduledAt;
            if (!scheduledAtValue || typeof scheduledAtValue !== 'string') {
                return reply.code(400).send({ error: 'scheduledAt is required' });
            }

            const scheduledAt = new Date(scheduledAtValue);
            if (Number.isNaN(scheduledAt.getTime())) {
                return reply.code(400).send({ error: 'Invalid scheduledAt value' });
            }

            const result = await service.scheduleCampaign(request.params.id, getAccountId(request), scheduledAt);
            return reply.code(202).send({ success: true, ...result });
        } catch (e) {
            const message = (e as Error).message;
            if (message === 'Campaign not found') {
                return reply.code(404).send({ error: message });
            }
            if (
                message === 'Campaign already sent'
                || message === 'Campaign must have subject and content before scheduling'
                || message === 'Scheduled time must be in the future'
            ) {
                return reply.code(400).send({ error: message });
            }
            Logger.error('Error scheduling campaign send', { error: e });
            return reply.code(500).send({ error: 'Failed to schedule campaign send' });
        }
    });

    fastify.delete<{ Params: { id: string } }>('/campaigns/:id/schedule', async (request, reply) => {
        try {
            const result = await service.unscheduleCampaign(request.params.id, getAccountId(request));
            if (!result.unscheduled && result.reason === 'not_scheduled') {
                return reply.code(409).send({ success: false, error: 'Campaign is not scheduled' });
            }

            return { success: true };
        } catch (e) {
            const message = (e as Error).message;
            if (message === 'Campaign not found') {
                return reply.code(404).send({ error: message });
            }
            Logger.error('Error unscheduling campaign send', { error: e });
            return reply.code(500).send({ error: 'Failed to unschedule campaign send' });
        }
    });

    // Automations
    fastify.get('/automations', async (request, reply) => {
        try {
            const automations = await service.listAutomations(getAccountId(request));
            return automations;
        } catch (e) {
            return sendInternalError(reply, e, 'Marketing route failed');
        }
    });

    fastify.post('/automations', { bodyLimit: HTTP_LIMITS.AUTOMATION_FLOW_BODY_LIMIT_BYTES }, async (request, reply) => {
        try {
            const automation = await service.upsertAutomation(getAccountId(request), request.body as any);
            return automation;
        } catch (e) {
            return sendInternalError(reply, e, 'Marketing route failed');
        }
    });

    fastify.get<{ Params: { id: string } }>('/automations/:id', async (request, reply) => {
        try {
            const automation = await service.getAutomation(request.params.id, getAccountId(request));
            if (!automation) return reply.code(404).send({ error: 'Not found' });
            return automation;
        } catch (e) {
            return sendInternalError(reply, e, 'Marketing route failed');
        }
    });

    fastify.patch<{ Params: { id: string }; Body: { isActive: boolean } }>('/automations/:id/status', async (request, reply) => {
        try {
            if (typeof request.body?.isActive !== 'boolean') {
                return reply.code(400).send({ error: 'isActive boolean is required' });
            }

            return await service.setAutomationEnabled(
                request.params.id,
                getAccountId(request),
                request.body.isActive
            );
        } catch (e) {
            const message = (e as Error).message;
            if (message === 'Automation not found') {
                return reply.code(404).send({ error: message });
            }
            return sendInternalError(reply, e, 'Marketing route failed');
        }
    });

    fastify.get<{ Params: { id: string } }>('/automations/:id/analytics', async (request, reply) => {
        try {
            return await service.getAutomationAnalytics(request.params.id, getAccountId(request));
        } catch (e) {
            const message = (e as Error).message;
            if (message === 'Automation not found') {
                return reply.code(404).send({ error: message });
            }
            return sendInternalError(reply, e, 'Marketing route failed');
        }
    });

    fastify.get<{ Params: { id: string }; Querystring: { limit?: string } }>('/automations/:id/enrollments', async (request, reply) => {
        try {
            const limit = request.query.limit ? parseInt(request.query.limit, 10) : 50;
            return await service.listAutomationEnrollments(request.params.id, getAccountId(request), limit);
        } catch (e) {
            const message = (e as Error).message;
            if (message === 'Automation not found') {
                return reply.code(404).send({ error: message });
            }
            return sendInternalError(reply, e, 'Marketing route failed');
        }
    });

    fastify.get<{ Params: { id: string }; Querystring: { limit?: string } }>('/automations/:id/run-events', async (request, reply) => {
        try {
            const limit = request.query.limit ? parseInt(request.query.limit, 10) : 50;
            return await service.listAutomationRunEvents(request.params.id, getAccountId(request), limit);
        } catch (e) {
            const message = (e as Error).message;
            if (message === 'Automation not found') {
                return reply.code(404).send({ error: message });
            }
            return sendInternalError(reply, e, 'Marketing route failed');
        }
    });

    fastify.get<{ Params: { id: string }; Querystring: { nodeIds?: string } }>(
        '/automations/:id/node-stats',
        async (request, reply) => {
            try {
                const nodeIds = request.query.nodeIds
                    ? request.query.nodeIds.split(',').map((value) => value.trim()).filter(Boolean)
                    : undefined;
                return await service.getAutomationNodeStats(request.params.id, getAccountId(request), nodeIds);
            } catch (e) {
                const message = (e as Error).message;
                if (message === 'Automation not found') {
                    return reply.code(404).send({ error: message });
                }
                return sendInternalError(reply, e, 'Marketing route failed');
            }
        }
    );

    fastify.get<{ Params: { id: string; nodeId: string }; Querystring: { status?: string; page?: string; perPage?: string } }>(
        '/automations/:id/nodes/:nodeId/analytics',
        async (request, reply) => {
            try {
                const page = request.query.page ? parseInt(request.query.page, 10) : 1;
                const perPage = request.query.perPage ? parseInt(request.query.perPage, 10) : 10;
                return await service.getAutomationNodeAnalytics(
                    request.params.id,
                    getAccountId(request),
                    request.params.nodeId,
                    request.query.status,
                    page,
                    perPage
                );
            } catch (e) {
                const message = (e as Error).message;
                if (message === 'Automation not found') {
                    return reply.code(404).send({ error: message });
                }
                return sendInternalError(reply, e, 'Marketing route failed');
            }
        }
    );

    fastify.delete<{ Params: { id: string } }>('/automations/:id', async (request, reply) => {
        try {
            await service.deleteAutomation(request.params.id, getAccountId(request));
            return { success: true };
        } catch (e) {
            return sendInternalError(reply, e, 'Marketing route failed');
        }
    });

    // Templates
    fastify.get('/templates', async (request, reply) => {
        try {
            const templates = await service.listTemplates(getAccountId(request));
            return templates;
        } catch (e) {
            return sendInternalError(reply, e, 'Marketing route failed');
        }
    });

    fastify.post('/templates', async (request, reply) => {
        try {
            const template = await service.upsertTemplate(getAccountId(request), request.body as any);
            return template;
        } catch (e) {
            return sendInternalError(reply, e, 'Marketing route failed');
        }
    });

    fastify.delete<{ Params: { id: string } }>('/templates/:id', async (request, reply) => {
        try {
            await service.deleteTemplate(request.params.id, getAccountId(request));
            return { success: true };
        } catch (e) {
            return sendInternalError(reply, e, 'Marketing route failed');
        }
    });

    // Test Email (standalone, for flow builder)
    fastify.post<{ Body: { to: string; subject: string; content: string } }>('/test-email', async (request, reply) => {
        try {
            const { to, subject, content } = request.body;

            if (!to || !subject || !content) {
                return reply.code(400).send({ error: 'Missing required fields: to, subject, content' });
            }

            const accountId = request.accountId || getAccountId(request);
            const emailAccount = await getDefaultEmailAccount(accountId);
            const account = await prisma.account.findFirst({
                where: { id: accountId },
                select: { wooUrl: true, domain: true }
            });
            const latestOrder = await prisma.wooOrder.findFirst({
                where: { accountId },
                orderBy: { dateCreated: 'desc' },
                select: { id: true, number: true, status: true, currency: true, total: true, dateCreated: true, rawData: true }
            });

            if (!emailAccount) {
                return reply.code(400).send({ error: 'No sending-capable email account is configured. Please set up a sending account in Settings.' });
            }

            // Import email service to send the test
            const { EmailService } = await import('../services/EmailService');
            const emailService = new EmailService();

            const storeUrl = account?.wooUrl || account?.domain || '';
            const normalizedStoreUrl = storeUrl.startsWith('http://') || storeUrl.startsWith('https://')
                ? storeUrl
                : (storeUrl ? `https://${storeUrl}` : '');
            const orderRaw = (latestOrder?.rawData && typeof latestOrder.rawData === 'object' ? latestOrder.rawData : {}) as Record<string, any>;
            const billing = orderRaw.billing || {};
            const firstLineItem = Array.isArray(orderRaw.line_items) ? orderRaw.line_items[0] : undefined;
            const testContext = {
                customer: {
                    firstName: billing.first_name || 'Test',
                    lastName: billing.last_name || 'Customer',
                    email: billing.email || to,
                    phone: billing.phone || ''
                },
                order: latestOrder ? {
                    ...orderRaw,
                    id: latestOrder.id,
                    orderNumber: latestOrder.number,
                    status: latestOrder.status,
                    currency: latestOrder.currency,
                    total: latestOrder.total,
                    dateCreated: latestOrder.dateCreated,
                    lineItems: orderRaw.line_items || orderRaw.lineItems || orderRaw.items || []
                } : undefined,
                product: firstLineItem ? {
                    name: firstLineItem.name,
                    price: firstLineItem.price || firstLineItem.total,
                    image: firstLineItem.image,
                    permalink: firstLineItem.permalink
                } : undefined,
                store: { url: normalizedStoreUrl },
                linkTriggerUrl: normalizedStoreUrl,
                preferencesUrl: normalizedStoreUrl ? `${normalizedStoreUrl.replace(/\/$/, '')}/my-account/edit-account/` : '',
                unsubscribeUrl: normalizedStoreUrl ? `${normalizedStoreUrl.replace(/\/$/, '')}/?unsubscribe=1` : ''
            };

            const resolvedSubject = resolveMergeTags(subject, testContext);
            const resolvedContent = resolveMergeTags(content, testContext);

            await emailService.sendEmail(
                accountId,
                emailAccount.id,
                to,
                resolvedSubject,
                resolvedContent,
                undefined,
                { source: 'TEST' }
            );

            Logger.info('Test email sent', { to, subject: subject.substring(0, 50), accountId });
            return { success: true };
        } catch (e) {
            Logger.error('Error sending test email', { error: e });
            return reply.code(500).send({ error: 'Failed to send test email' });
        }
    });

    // Campaign Analytics / ROI Tracking
    fastify.get<{ Params: { id: string } }>('/campaigns/:id/analytics', async (request, reply) => {
        try {
            const { campaignTrackingService } = await import('../services/CampaignTrackingService');
            const analytics = await campaignTrackingService.getCampaignAnalytics(
                getAccountId(request),
                request.params.id
            );
            return analytics;
        } catch (e) {
            Logger.error('Error fetching campaign analytics', { error: e });
            return sendInternalError(reply, e, 'Marketing route failed');
        }
    });

    fastify.get<{ Querystring: { days?: string } }>('/analytics/overview', async (request, reply) => {
        try {
            const { campaignTrackingService } = await import('../services/CampaignTrackingService');
            const days = parseInt(request.query.days || '30', 10);
            const overview = await campaignTrackingService.getAccountCampaignOverview(
                getAccountId(request),
                days
            );
            return overview;
        } catch (e) {
            Logger.error('Error fetching campaign overview', { error: e });
            return sendInternalError(reply, e, 'Marketing route failed');
        }
    });

    fastify.get<{ Querystring: { days?: string } }>('/analytics/email-dashboard', async (request, reply) => {
        try {
            const days = parseInt(request.query.days || '30', 10);
            const safeDays = Number.isFinite(days) && days > 0 ? days : 30;
            const since = new Date(Date.now() - safeDays * 24 * 60 * 60 * 1000);
            const accountId = getAccountId(request);

            const [campaignEvents, emailLogStats, recentUnsubscribes, emailLogsForTrend, unsubscribesForTrend] = await Promise.all([
                prisma.campaignEvent.groupBy({
                    by: ['campaignType', 'eventType'],
                    where: {
                        accountId,
                        createdAt: { gte: since }
                    },
                    _count: true,
                    _sum: { revenue: true }
                }),
                prisma.emailLog.groupBy({
                    by: ['status'],
                    where: {
                        accountId,
                        createdAt: { gte: since }
                    },
                    _count: true
                }),
                prisma.emailUnsubscribe.findMany({
                    where: { accountId },
                    orderBy: { createdAt: 'desc' },
                    take: 10,
                    select: {
                        id: true,
                        email: true,
                        scope: true,
                        reason: true,
                        createdAt: true
                    }
                }),
                prisma.emailLog.findMany({
                    where: {
                        accountId,
                        createdAt: { gte: since }
                    },
                    select: {
                        status: true,
                        createdAt: true
                    }
                }),
                prisma.emailUnsubscribe.findMany({
                    where: {
                        accountId,
                        createdAt: { gte: since }
                    },
                    select: {
                        createdAt: true
                    }
                })
            ]);

            let flowRevenue = 0;
            let broadcastRevenue = 0;
            let flowSends = 0;
            let broadcastSends = 0;
            let totalUnsubscribes = 0;

            for (const event of campaignEvents) {
                if (event.eventType === 'purchase') {
                    const revenue = event._sum.revenue || 0;
                    if (event.campaignType === 'automation') flowRevenue += revenue;
                    if (event.campaignType === 'broadcast') broadcastRevenue += revenue;
                }

                if (event.eventType === 'send') {
                    if (event.campaignType === 'automation') flowSends += event._count;
                    if (event.campaignType === 'broadcast') broadcastSends += event._count;
                }

                if (event.eventType === 'unsubscribe') {
                    totalUnsubscribes += event._count;
                }
            }

            const sentCount = emailLogStats.reduce((sum, row) => sum + row._count, 0);
            const failedCount = emailLogStats
                .filter((row) => row.status === 'FAILED')
                .reduce((sum, row) => sum + row._count, 0);
            const bounceRate = sentCount > 0 ? (failedCount / sentCount) * 100 : 0;

            const dayLabels: string[] = [];
            const trendMap = new Map<string, { sent: number; failed: number; unsubscribes: number }>();

            for (let i = safeDays - 1; i >= 0; i -= 1) {
                const date = new Date();
                date.setHours(0, 0, 0, 0);
                date.setDate(date.getDate() - i);
                const key = date.toISOString().slice(0, 10);
                dayLabels.push(key);
                trendMap.set(key, { sent: 0, failed: 0, unsubscribes: 0 });
            }

            for (const log of emailLogsForTrend) {
                const key = log.createdAt.toISOString().slice(0, 10);
                const bucket = trendMap.get(key);
                if (!bucket) continue;
                bucket.sent += 1;
                if (log.status === 'FAILED') bucket.failed += 1;
            }

            for (const unsub of unsubscribesForTrend) {
                const key = unsub.createdAt.toISOString().slice(0, 10);
                const bucket = trendMap.get(key);
                if (!bucket) continue;
                bucket.unsubscribes += 1;
            }

            const trends = dayLabels.map((date) => {
                const bucket = trendMap.get(date) || { sent: 0, failed: 0, unsubscribes: 0 };
                return {
                    date,
                    unsubscribes: bucket.unsubscribes,
                    bounceRate: bucket.sent > 0 ? (bucket.failed / bucket.sent) * 100 : 0
                };
            });

            return {
                days: safeDays,
                rangeStart: since.toISOString(),
                kpis: {
                    flowRevenue,
                    broadcastRevenue,
                    flowSends,
                    broadcastSends,
                    totalUnsubscribes,
                    bounceRate,
                    sentCount,
                    failedCount
                },
                recentUnsubscribes,
                trends
            };
        } catch (e) {
            Logger.error('Error fetching email dashboard analytics', { error: e });
            return sendInternalError(reply, e, 'Marketing route failed');
        }
    });

    // =========================================================================
    // AI Recommendation Tracking (AI Marketing Intelligence Phase 5)
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
                    getAccountId(request),
                    {
                        status: request.query.status as any,
                        limit: request.query.limit ? parseInt(request.query.limit, 10) : 50
                    }
                );
                return history;
            } catch (e) {
                Logger.error('Error fetching recommendation history', { error: e });
                return sendInternalError(reply, e, 'Marketing route failed');
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
                const stats = await RecommendationTracker.getStats(getAccountId(request), days);
                return stats;
            } catch (e) {
                Logger.error('Error fetching recommendation stats', { error: e });
                return sendInternalError(reply, e, 'Marketing route failed');
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
                return sendInternalError(reply, e, 'Marketing route failed');
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
                return sendInternalError(reply, e, 'Marketing route failed');
            }
        }
    );

    // =========================================================================
    // Marketing Learnings (AI Marketing Intelligence Phase 4)
    // =========================================================================

    /**
     * List learnings for the account
     */
    fastify.get<{ Querystring: { includeInactive?: string; includePending?: string } }>(
        '/learnings',
        async (request, reply) => {
            try {
                const { LearningService } = await import('../services/tools/knowledge/LearningService');
                const learnings = await LearningService.list(getAccountId(request), {
                    includeInactive: request.query.includeInactive === 'true',
                    includePending: request.query.includePending === 'true'
                });
                return learnings;
            } catch (e) {
                Logger.error('Error fetching learnings', { error: e });
                return sendInternalError(reply, e, 'Marketing route failed');
            }
        }
    );

    /**
     * Get pending AI-derived learnings awaiting approval
     */
    fastify.get('/learnings/pending', async (request, reply) => {
        try {
            const { LearningService } = await import('../services/tools/knowledge/LearningService');
            const pending = await LearningService.getPending(getAccountId(request));
            return pending;
        } catch (e) {
            Logger.error('Error fetching pending learnings', { error: e });
            return sendInternalError(reply, e, 'Marketing route failed');
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

                const learning = await LearningService.create(getAccountId(request), {
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
                return sendInternalError(reply, e, 'Marketing route failed');
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
                    getAccountId(request),
                    request.body
                );

                if (!updated) {
                    return reply.code(404).send({ error: 'Learning not found' });
                }
                return updated;
            } catch (e) {
                Logger.error('Error updating learning', { error: e });
                return sendInternalError(reply, e, 'Marketing route failed');
            }
        }
    );

    /**
     * Delete a learning
     */
    fastify.delete<{ Params: { id: string } }>('/learnings/:id', async (request, reply) => {
        try {
            const { LearningService } = await import('../services/tools/knowledge/LearningService');
            const deleted = await LearningService.delete(request.params.id, getAccountId(request));

            if (!deleted) {
                return reply.code(404).send({ error: 'Learning not found' });
            }
            return { success: true };
        } catch (e) {
            Logger.error('Error deleting learning', { error: e });
            return sendInternalError(reply, e, 'Marketing route failed');
        }
    });

    /**
     * Approve a pending AI-derived learning
     */
    fastify.post<{ Params: { id: string } }>('/learnings/:id/approve', async (request, reply) => {
        try {
            const { LearningService } = await import('../services/tools/knowledge/LearningService');
            const approved = await LearningService.approvePending(request.params.id, getAccountId(request));

            if (!approved) {
                return reply.code(404).send({ error: 'Pending learning not found' });
            }
            return { success: true };
        } catch (e) {
            Logger.error('Error approving learning', { error: e });
            return sendInternalError(reply, e, 'Marketing route failed');
        }
    });

    /**
     * Derive new learnings from successful recommendation patterns
     */
    fastify.post('/learnings/derive', async (request, reply) => {
        try {
            const { LearningService } = await import('../services/tools/knowledge/LearningService');
            const derived = await LearningService.deriveFromOutcomes(getAccountId(request));
            return { derived, count: derived.length };
        } catch (e) {
            Logger.error('Error deriving learnings', { error: e });
            return sendInternalError(reply, e, 'Marketing route failed');
        }
    });

    // =========================================================================
    // Ad Alerts (AI Marketing Intelligence Phase 6)
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
                        accountId: getAccountId(request),
                        ...(unacknowledgedOnly ? { isAcknowledged: false } : {})
                    },
                    orderBy: { createdAt: 'desc' },
                    take: limit
                });
                return alerts;
            } catch (e) {
                Logger.error('Error fetching alerts', { error: e });
                return sendInternalError(reply, e, 'Marketing route failed');
            }
        }
    );

    /**
     * Acknowledge an alert
     */
    fastify.post<{ Params: { id: string } }>('/alerts/:id/acknowledge', async (request, reply) => {
        try {
            const alert = await prisma.adAlert.findFirst({
                where: { id: request.params.id, accountId: getAccountId(request) }
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
            return sendInternalError(reply, e, 'Marketing route failed');
        }
    });

    /**
     * Get alert counts (for badge display)
     */
    fastify.get('/alerts/count', async (request, reply) => {
        try {
            const [total, unacknowledged, critical] = await Promise.all([
                prisma.adAlert.count({ where: { accountId: getAccountId(request) } }),
                prisma.adAlert.count({ where: { accountId: getAccountId(request), isAcknowledged: false } }),
                prisma.adAlert.count({ where: { accountId: getAccountId(request), isAcknowledged: false, severity: 'critical' } })
            ]);
            return { total, unacknowledged, critical };
        } catch (e) {
            Logger.error('Error fetching alert counts', { error: e });
            return sendInternalError(reply, e, 'Marketing route failed');
        }
    });
};

export default marketingRoutes;
