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
import { applyPreviewText, resolveMergeTags, resolveMergeTagsWithDynamicProducts } from '../services/MergeTagResolver';
import { HTTP_LIMITS } from '../config/limits';
import { z } from 'zod';
import { PermissionService } from '../services/PermissionService';
import { EmailDashboardService } from '../services/EmailDashboardService';
import { feedbackSchema, outcomeSchema } from '../services/tools/knowledge/RecommendationTracker';
import { marketingWorkspaceRoutes } from './marketingWorkspace';
import { resolveMarketingSchedule } from '../utils/marketingSchedule';
import { compileEmailDesignV2, assertEmailDesign, EMAIL_RENDERER_VERSION } from '@overseek/core';
import { prepareEmail } from '../services/EmailPreparation';
import { EMAIL_PREVIEW_SCENARIOS, applyEmailPreviewScenario, type EmailPreviewScenario } from '../services/EmailPreviewScenarios';
import { marketingDesignerRoutes } from './marketingDesigner';
import { appendEmailUtm } from '../utils/emailUtm';
import type { EmailDeliveryPreviewOptions } from '@overseek/core';

const service = new MarketingService();

function parsePositiveInt(value: string | undefined, fallback: number, max?: number): number {
    const parsed = value ? parseInt(value, 10) : fallback;
    if (!Number.isFinite(parsed) || parsed < 1) return fallback;
    return max ? Math.min(parsed, max) : parsed;
}

function getAccountId(request: FastifyRequest): string {
    const accountId = request.accountId || request.user?.accountId;
    if (!accountId) {
        throw new Error('Account context required');
    }
    return accountId;
}

function sendInternalError(reply: FastifyReply, error: unknown, context: string) {
    if (error instanceof z.ZodError) return reply.code(400).send({ error: 'Invalid bounded request' });
    const status = (error as { statusCode?: number })?.statusCode;
    if (status === 400 || status === 403 || status === 409) return reply.code(status).send({ error: status === 403 ? 'Permission required' : (error as Error).message });
    Logger.error(context, { error });
    return reply.code(500).send({ error: 'Internal server error' });
}

function isFlowValidationError(error: unknown): error is { issues?: unknown[]; message: string; name?: string } {
    return Boolean(error && typeof error === 'object' && (error as { name?: string }).name === 'FlowValidationError');
}

function getHostFromUrl(value: string | null | undefined): string | null {
    if (!value) return null;
    const normalized = value.startsWith('http://') || value.startsWith('https://') ? value : `https://${value}`;
    try {
        return new URL(normalized).host.toLowerCase();
    } catch {
        return null;
    }
}

const marketingRoutes: FastifyPluginAsync = async (fastify) => {
    fastify.get<{ Params: { token: string } }>('/recover-cart/:token', async (request, reply) => {
        const payload = cartRecoveryService.verifyToken(request.params.token);
        if (!payload) {
            return reply.code(400).send({ error: 'Invalid or expired recovery link' });
        }

        const recoveryUrl = new URL(payload.checkoutUrl);
        const account = await prisma.account.findUnique({
            where: { id: payload.accountId },
            select: { wooUrl: true, domain: true }
        });
        const allowedHosts = [getHostFromUrl(account?.wooUrl), getHostFromUrl(account?.domain)].filter((host): host is string => Boolean(host));
        if (allowedHosts.length === 0 || !allowedHosts.includes(recoveryUrl.host.toLowerCase())) {
            return reply.code(400).send({ error: 'Recovery link destination is not allowed' });
        }

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
        if (/\/campaigns\/[^/]+\/(?:send|schedule|test)(?:\?|$)/.test(request.url) || request.method !== 'GET' && /\/automations(?:\/[^/]+\/status)?(?:\?|$)/.test(request.url)) {
            const accountId = request.accountId || request.user?.accountId;
            if (!accountId || !request.user?.id || !await PermissionService.hasPermission(request.user.id, accountId, 'manage_marketing')) return reply.code(403).send({ error: 'Marketing management permission required' });
        }
        if (request.url.includes('/preview-orders')) {
            const accountId = request.accountId || request.user?.accountId;
            if (!accountId || !request.user?.id || !await PermissionService.hasPermission(request.user.id, accountId, 'view_marketing')) return reply.code(403).send({ error: 'Marketing view permission required' });
        }
        if (request.url.includes('/recommendations/') || request.url.includes('/learnings') || request.url.includes('/analytics/email-dashboard')) {
            if (!request.accountId || !request.user?.id) return reply.code(400).send({ error: 'Select an account' });
            if (!await PermissionService.hasPermission(request.user.id, request.accountId, request.method === 'GET' ? 'view_marketing' : 'manage_marketing')) return reply.code(403).send({ error: 'Marketing permission required' });
        }
        const accountId = request.accountId || request.user?.accountId;
        if (!accountId) {
            return reply.code(400).send({ error: 'Account context required' });
        }

        const enabled = await isAccountFeatureEnabled(accountId, 'EMAIL', true);
        if (!enabled) {
            return reply.code(403).send({ error: 'Email feature is disabled for this account' });
        }
    });

    await fastify.register(marketingWorkspaceRoutes);
    await fastify.register(marketingDesignerRoutes);

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

    fastify.post<{ Params: { id: string }; Body: { email: string; variant?: 'A' | 'B' } }>('/campaigns/:id/test', async (request, reply) => {
        try {
            const { email } = request.body;
            if (request.body.variant !== undefined && request.body.variant !== 'A' && request.body.variant !== 'B') return reply.code(400).send({ error: 'Invalid variant' });
            const result = await service.sendTestEmail(request.params.id, getAccountId(request), email, request.body.variant);
            if (!result.success && result.skipped) {
                return reply.code(409).send(result);
            }
            return result;
        } catch (e) {
            const message = (e as Error).message;
            if (
                message === 'Campaign not found'
                || message === 'Campaign must have subject and content before testing'
                || message === 'Valid test email is required'
                || message === 'No sending-capable email account is configured'
            ) {
                return reply.code(message === 'Campaign not found' ? 404 : 400).send({ error: message });
            }
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
            if ((e as any)?.statusCode === 400 || (e as any)?.statusCode === 409) return sendInternalError(reply, e, 'Campaign readiness failed');
            const message = (e as Error).message;
            if (message === 'Campaign not found') {
                return reply.code(404).send({ error: message });
            }
            Logger.error('Error queueing campaign send', { error: e });
            return reply.code(500).send({ error: 'Failed to queue campaign send' });
        }
    });

    fastify.post<{ Params: { id: string }; Body: { scheduledAt?: string; localTime?: string; timezone?: string } }>('/campaigns/:id/schedule', async (request, reply) => {
        try {
            let scheduledAtValue = request.body?.scheduledAt;
            if (request.body?.localTime !== undefined) {
                try { scheduledAtValue = resolveMarketingSchedule(request.body.localTime, request.body.timezone || '').toISOString(); }
                catch (error) { return reply.code(400).send({ error: (error as Error).message }); }
            }
            if (!scheduledAtValue || typeof scheduledAtValue !== 'string') {
                return reply.code(400).send({ error: 'scheduledAt is required' });
            }

            const scheduledAt = new Date(scheduledAtValue);
            if (Number.isNaN(scheduledAt.getTime())) {
                return reply.code(400).send({ error: 'Invalid scheduledAt value' });
            }

            const result = await service.scheduleCampaign(request.params.id, getAccountId(request), scheduledAt, request.body.localTime ? request.body.timezone : 'UTC');
            return reply.code(202).send({ success: true, ...result });
        } catch (e) {
            if ((e as any)?.statusCode === 400 || (e as any)?.statusCode === 409) return sendInternalError(reply, e, 'Campaign readiness failed');
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
    fastify.get<{ Querystring: { days?: string } }>('/automations', async (request, reply) => {
        const days = request.query.days === undefined ? undefined : Number(request.query.days);
        if (days !== undefined && (!Number.isInteger(days) || days < 1 || days > 365)) {
            return reply.code(400).send({ error: 'days must be an integer between 1 and 365' });
        }
        try {
            const automations = await service.listAutomations(getAccountId(request), days);
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
            if (isFlowValidationError(e)) {
                return reply.code(400).send({ error: e.message, issues: e.issues || [] });
            }
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
            if (isFlowValidationError(e)) {
                return reply.code(400).send({ error: e.message, issues: e.issues || [] });
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
            const limit = parsePositiveInt(request.query.limit, 50, 100);
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
            const limit = parsePositiveInt(request.query.limit, 50, 100);
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
                const page = parsePositiveInt(request.query.page, 1);
                const perPage = parsePositiveInt(request.query.perPage, 10, 100);
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
                if (message === 'Node not found') {
                    return reply.code(404).send({ error: message });
                }
                return sendInternalError(reply, e, 'Marketing route failed');
            }
        }
    );

    fastify.get<{ Params: { id: string; enrollmentId: string } }>(
        '/automations/:id/enrollments/:enrollmentId/journey',
        async (request, reply) => {
            try {
                return await service.getAutomationEnrollmentJourney(
                    request.params.id,
                    getAccountId(request),
                    request.params.enrollmentId
                );
            } catch (e) {
                const message = (e as Error).message;
                if (message === 'Enrollment not found') {
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

    fastify.get('/preview-orders', async (request) => {
        const orders = await prisma.wooOrder.findMany({
            where: { accountId: getAccountId(request) }, orderBy: [{ dateCreated: 'desc' }, { id: 'desc' }], take: 30,
            select: { id: true, number: true, rawData: true },
        });
        return { orders: orders.map(order => {
            const billing = (order.rawData as any)?.billing;
            return { id: order.id, number: String(order.number), label: [billing?.first_name, billing?.last_name].filter(Boolean).join(' ') || 'Customer' };
        }) };
    });

    // Preview and test use the same sample context and production merge resolver.
    for (const route of ['/test-email', '/preview-email']) fastify.post<{ Body: { to?: string; subject: string; content: string; designJson?: unknown; deliveryOptions?: EmailDeliveryPreviewOptions; scenario?: EmailPreviewScenario; previewText?: string; category?: 'MARKETING' | 'TRANSACTIONAL'; orderId?: string | null } }>(route, async (request, reply) => {
        try {
            const isPreview = route === '/preview-email';
            const optionsSchema = z.object({ automationId: z.string().min(1).max(128).optional(), appendUtm: z.boolean().optional(), campaignSource: z.string().max(500).optional(), campaignMedium: z.string().max(500).optional(), campaignName: z.string().max(500).optional(), campaignTerm: z.string().max(500).optional(), campaignContent: z.string().max(500).optional(), overrideFrom: z.boolean().optional(), fromName: z.string().max(200).optional(), fromEmail: z.string().max(254).optional(), replyToEmail: z.string().max(254).optional() });
            const parsedOptions = optionsSchema.safeParse(request.body.deliveryOptions || {});
            if (!parsedOptions.success) return reply.code(400).send({ error: 'Invalid delivery options' });
            const deliveryOptions = parsedOptions.data;
            const { to, subject, previewText, category, orderId, scenario = 'standard' } = request.body;
            let content = request.body.content;
            if (request.body.designJson !== undefined) {
                try { assertEmailDesign(request.body.designJson); content = compileEmailDesignV2(request.body.designJson); }
                catch { return reply.code(400).send({ error: 'Invalid or unsupported email design' }); }
            }
            if (!EMAIL_PREVIEW_SCENARIOS.includes(scenario) || scenario !== 'standard' && orderId !== null) return reply.code(400).send({ error: 'Stress scenarios require explicit sample data (orderId: null)' });

            if ((!isPreview && (!to || !subject)) || !content) {
                return reply.code(400).send({ error: 'Missing required fields: to, subject, content' });
            }
            if (orderId !== undefined && orderId !== null && (
                typeof orderId !== 'string' || !orderId.length || orderId.length > 128
                || orderId.trim() !== orderId || /[\u0000-\u001f\u007f]/.test(orderId) // eslint-disable-line no-control-regex -- Reject control characters in identifiers.
            )) {
                return reply.code(400).send({ error: 'orderId must be null or a nonempty internal order ID of at most 128 characters' });
            }

            const accountId = request.accountId || getAccountId(request);
            const emailAccount = await getDefaultEmailAccount(accountId);
            const automation = deliveryOptions.automationId ? await prisma.marketingAutomation.findFirst({ where: { id: deliveryOptions.automationId, accountId }, select: { id: true, name: true } }) : null;
            if (deliveryOptions.automationId && !automation) return reply.code(404).send({ error: 'Automation not found' });
            const account = await prisma.account.findFirst({
                where: { id: accountId },
                select: { wooUrl: true, domain: true, currency: true }
            });
            // Pin explicit preview selections. Only legacy callers that omit the
            // field may sample the latest order; null intentionally has no order.
            const sampleOrder = orderId === null ? null : await prisma.wooOrder.findFirst({
                where: orderId === undefined ? { accountId } : { accountId, id: orderId },
                ...(orderId === undefined ? { orderBy: { dateCreated: 'desc' as const } } : {}),
                select: { id: true, number: true, status: true, currency: true, total: true, dateCreated: true, rawData: true, deliveryEstimateSnapshot: true }
            });
            if (typeof orderId === 'string' && !sampleOrder) {
                return reply.code(404).send({ error: 'Order not found' });
            }

            if (!isPreview && !emailAccount) {
                return reply.code(400).send({ error: 'No sending-capable email account is configured. Please set up a sending account in Settings.' });
            }

            const storeUrl = account?.wooUrl || account?.domain || '';
            const normalizedStoreUrl = storeUrl.startsWith('http://') || storeUrl.startsWith('https://')
                ? storeUrl
                : (storeUrl ? `https://${storeUrl}` : '');
            const orderRaw = (sampleOrder?.rawData && typeof sampleOrder.rawData === 'object' ? sampleOrder.rawData : {}) as Record<string, any>;
            const billing = orderRaw.billing || {};
            const firstLineItem = Array.isArray(orderRaw.line_items) ? orderRaw.line_items[0] : undefined;
            const sampleItems = orderRaw.line_items || orderRaw.lineItems || orderRaw.items || [{ name: 'Sample product', quantity: 1, price: '49.00', total: '49.00' }];
            const currency = sampleOrder?.currency || account?.currency || 'USD';
            const testContext = {
                customer: {
                    firstName: billing.first_name || 'Test',
                    lastName: billing.last_name || 'Customer',
                    email: billing.email || to || 'alex@example.com',
                    phone: billing.phone || ''
                },
                order: sampleOrder ? {
                    ...orderRaw,
                    deliveryEstimateSnapshot: sampleOrder.deliveryEstimateSnapshot ?? null,
                    id: sampleOrder.id,
                    orderNumber: sampleOrder.number,
                    status: sampleOrder.status,
                    currency: sampleOrder.currency,
                    total: sampleOrder.total,
                    dateCreated: sampleOrder.dateCreated,
                    lineItems: orderRaw.line_items || orderRaw.lineItems || orderRaw.items || []
                } : { number: '1001', status: 'processing', currency, total: '49.00', lineItems: sampleItems },
                product: firstLineItem ? {
                    name: firstLineItem.name,
                    price: firstLineItem.price || firstLineItem.total,
                    image: firstLineItem.image,
                    permalink: firstLineItem.permalink
                } : { name: 'Sample product', price: '49.00' },
                cart: {
                    items: sampleItems,
                    total: sampleOrder?.total || '49.00',
                    currency,
                    recoveryUrl: `${normalizedStoreUrl}/checkout/?recover_cart=preview`,
                    checkoutUrl: `${normalizedStoreUrl}/checkout/`,
                },
                coupon: { code: 'PREVIEW10', discountType: 'percent', amount: 10, description: 'Sample discount' },
                review: { reviewer: 'Test Customer', rating: 5, content: 'Great product!', productName: firstLineItem?.name || 'Sample product' },
                store: { url: normalizedStoreUrl },
                accountId,
                currency: account?.currency || 'USD',
                linkTriggerUrl: normalizedStoreUrl,
                // Keep recipient-specific placeholders for EmailService to resolve
                // after allocating the tracking ID, just like a live flow send.
                preferencesUrl: '{{preferences_url}}',
                unsubscribeUrl: '{{unsubscribe_url}}'
            };

            const selectedContext = applyEmailPreviewScenario(testContext, scenario);
            const resolvedSubject = resolveMergeTags(subject || '', selectedContext);
            const resolvedContent = await resolveMergeTagsWithDynamicProducts(content, selectedContext);
            const resolvedPreviewText = resolveMergeTags(previewText || '', selectedContext);
            const resolveField = (value?: string) => resolveMergeTags(value || '', selectedContext);
            const sender = {
                fromName: deliveryOptions.overrideFrom ? resolveField(deliveryOptions.fromName) || emailAccount?.name : emailAccount?.name,
                fromEmail: deliveryOptions.overrideFrom ? resolveField(deliveryOptions.fromEmail) || emailAccount?.email : emailAccount?.email,
                replyToEmail: deliveryOptions.overrideFrom ? resolveField(deliveryOptions.replyToEmail) || undefined : undefined,
            };
            if ([sender.fromName, sender.fromEmail, sender.replyToEmail].some(value => /[\r\n]/.test(value || '')) || [sender.fromEmail, sender.replyToEmail].some(value => value && !/^\S+@\S+\.\S+$/.test(value))) return reply.code(400).send({ error: 'Invalid sender or reply-to address' });
            const withPreviewText = applyPreviewText(resolvedContent, resolvedPreviewText);
            const contentWithPreviewText = request.body.deliveryOptions ? appendEmailUtm(withPreviewText, {
                ...deliveryOptions, campaignSource: resolveField(deliveryOptions.campaignSource), campaignMedium: resolveField(deliveryOptions.campaignMedium), campaignName: resolveField(deliveryOptions.campaignName), campaignTerm: resolveField(deliveryOptions.campaignTerm), campaignContent: resolveField(deliveryOptions.campaignContent),
            }, automation?.name || automation?.id || 'preview') : withPreviewText;

            if (isPreview) {
                const tags = [...new Set(`${subject || ''} ${previewText || ''} ${content}`.match(/\{\{\s*[\w.]+\s*\}\}/g) || [])];
                const missingTags = tags.filter(tag => {
                    if (/\{\{\s*(?:unsubscribe_url|unsubscribe_list_url|preferences_url)\s*\}\}/.test(tag)) return false;
                    const value = resolveMergeTags(tag, selectedContext).trim();
                    return !value || value === tag;
                });
                const prepared = prepareEmail({ html: contentWithPreviewText, subject: resolvedSubject, trackingId: 'preview-only-not-a-recipient', apiUrl: process.env.API_URL || 'http://localhost:3000', category: category === 'TRANSACTIONAL' ? 'TRANSACTIONAL' : 'MARKETING' });
                return { ...prepared, sender, canonicalHtml: contentWithPreviewText, rendererVersion: EMAIL_RENDERER_VERSION, previewText: resolvedPreviewText, orderId: sampleOrder?.id || null, missingTags, scenario, simulated: true };
            }

            const { EmailService } = await import('../services/EmailService');
            const emailService = new EmailService();
            const result = await emailService.sendEmail(
                accountId,
                emailAccount!.id,
                to!,
                resolvedSubject,
                contentWithPreviewText,
                undefined,
                { source: 'TEST', category: category === 'TRANSACTIONAL' ? 'TRANSACTIONAL' : 'MARKETING', ...sender }
            );

            if (result && typeof result === 'object' && 'skipped' in result && result.skipped) {
                const reason = 'reason' in result ? result.reason : 'email_skipped';
                const error = reason === 'unsubscribed_all' || reason === 'unsubscribed_marketing'
                    ? 'Test email not sent: this recipient has unsubscribed from marketing emails. Use another test address or restore their subscription if appropriate.'
                    : `Test email not sent (${reason}).`;
                return reply.code(409).send({ success: false, skipped: true, reason, error });
            }

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
            const days = parsePositiveInt(request.query.days, 30, 365);
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
            const days = z.string().regex(/^[1-9]\d*$/).transform(Number).refine(value => value <= 365).parse(request.query.days ?? '30');
            return await EmailDashboardService.get(request.accountId!, days);
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
                        limit: z.string().regex(/^[1-9]\d*$/).transform(Number).refine(value => value <= 100).parse(request.query.limit ?? '50')
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
                const days = z.string().regex(/^[1-9]\d*$/).transform(Number).refine(value => value <= 365).parse(request.query.days ?? '90');
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
                const success = await RecommendationTracker.recordFeedback(
                    request.accountId!, request.user!.id, request.params.id,
                    feedbackSchema.parse(request.body)
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
                const success = await RecommendationTracker.recordOutcome(
                    request.accountId!, request.user!.id, request.params.id,
                    outcomeSchema.parse(request.body)
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
                const query = z.object({ includeInactive: z.enum(['true', 'false']).optional(), includePending: z.enum(['true', 'false']).optional() }).strict().parse(request.query);
                const learnings = await LearningService.list(getAccountId(request), {
                    includeInactive: query.includeInactive === 'true',
                    includePending: query.includePending === 'true'
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
                const { LearningService, createLearningSchema } = await import('../services/tools/knowledge/LearningService');
                const learning = await LearningService.create(getAccountId(request), createLearningSchema.parse(request.body), request.user!.id);
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
                    request.body, request.user!.id
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
            const deleted = await LearningService.delete(request.params.id, getAccountId(request), request.body, request.user!.id);

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
            const approved = await LearningService.approvePending(request.params.id, getAccountId(request), request.body, request.user!.id);

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
            return await LearningService.deriveFromOutcomes(getAccountId(request), request.user!.id);
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
