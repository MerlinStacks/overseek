import { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { MarketingDraftService } from '../services/MarketingDraftService';
import { PermissionService } from '../services/PermissionService';
import { HTTP_LIMITS } from '../config/limits';
import { MarketingAudienceService } from '../services/MarketingAudienceService';
import { getDefaultEmailAccount } from '../utils/getDefaultEmailAccount';
import { prisma } from '../utils/prisma';
import { automationContextService } from '../services/AutomationContextService';
import { simulateFlow } from '../services/automation/FlowSimulation';
import { marketingPressureConfig } from '../utils/marketingExperiment';

const revisionSchema = z.object({ revision: z.number().int().nonnegative() });
const nodeSchema = z.object({
    id: z.string().min(1).max(200), type: z.string().min(1).max(80),
    data: z.object({ config: z.record(z.string(), z.any()).optional() }).catchall(z.any()).optional(),
}).catchall(z.any());
const edgeSchema = z.object({ source: z.string().min(1).max(200), target: z.string().min(1).max(200) }).catchall(z.any());
const draftSchema = revisionSchema.extend({
    name: z.string().trim().min(1).max(200).optional(),
    flowDefinition: z.object({ nodes: z.array(nodeSchema).max(500), edges: z.array(edgeSchema).max(1000) }),
});

export const marketingWorkspaceRoutes: FastifyPluginAsync = async fastify => {
    const drafts = new MarketingDraftService();
    fastify.addHook('preHandler', async (request, reply) => {
        if (!request.accountId || !request.user?.id) return reply.code(400).send({ error: 'Select an account' });
        if (!await PermissionService.hasPermission(request.user.id, request.accountId, request.method === 'GET' || request.url.endsWith('/simulate') ? 'view_marketing' : 'manage_marketing')) {
            return reply.code(403).send({ error: 'Marketing permission required' });
        }
    });
    fastify.get<{ Params: { id: string } }>('/automations/:id/workspace', async (request, reply) => {
        const result = await drafts.workspace(request.accountId!, request.params.id);
        return result || reply.code(404).send({ error: 'Flow not found' });
    });
    fastify.get<{ Params: { id: string } }>('/campaigns/:id/audience-readiness', async (request, reply) => {
        const result = await new MarketingAudienceService().explain(request.accountId!, request.params.id);
        if (!result) return reply.code(404).send({ error: 'Campaign not found' });
        const sender = await getDefaultEmailAccount(request.accountId!);
        return { ...result, sender: sender ? { name: sender.name, email: sender.email } : null };
    });
    fastify.get('/delivery-health', async request => {
        const accountId = request.accountId!;
        const end = new Date(); const start = new Date(end.getTime() - 30 * 86400000);
        const [groups, suppressions, sender] = await Promise.all([
            prisma.emailLog.groupBy({ by: ['status'], where: { accountId, createdAt: { gte: start, lte: end }, source: { in: ['AUTOMATION', 'CAMPAIGN'] } }, _count: true }),
            prisma.emailUnsubscribe.count({ where: { accountId, scope: { in: ['MARKETING', 'ALL'] } } }),
            getDefaultEmailAccount(accountId),
        ]);
        return { start, end, statuses: groups.map(group => ({ status: group.status, count: group._count })), suppressions, sender: sender ? { name: sender.name, email: sender.email } : null, pressureCap: marketingPressureConfig(), note: '30-day rolling flow/broadcast email log-status distribution, including transactional flow emails. Not inbox-placement or verified delivery rates. Suppressions count records, not necessarily distinct contacts. DNS authentication is not verified here.' };
    });
    fastify.put<{ Params: { id: string } }>('/campaigns/:id/experiment', async (request, reply) => {
        const parsed = z.object({ subjectB: z.string().trim().max(500).nullable() }).safeParse(request.body);
        if (!parsed.success) return reply.code(400).send({ error: 'Invalid B subject' });
        const result = await prisma.marketingCampaign.updateMany({ where: { accountId: request.accountId!, id: request.params.id, status: 'DRAFT', sentAt: null }, data: { subjectB: parsed.data.subjectB || null } });
        if (!result.count) return reply.code(409).send({ error: 'Experiments can only change on an unsent draft. Unschedule first.' });
        return { success: true };
    });
    fastify.get<{ Params: { id: string } }>('/campaigns/:id/experiment', async (request, reply) => {
        const accountId = request.accountId!, id = request.params.id;
        if (!await prisma.marketingCampaign.findFirst({ where: { accountId, id }, select: { id: true } })) return reply.code(404).send({ error: 'Campaign not found' });
        const variants = await Promise.all((['A', 'B'] as const).map(async variant => {
            const where = { accountId, source: 'CAMPAIGN', sourceId: id, campaignVariant: variant, status: { in: ['SUCCESS', 'RETRIED', 'BOUNCED', 'COMPLAINED'] } };
            const [accepted, opened, clicked] = await Promise.all([prisma.emailLog.count({ where }), prisma.emailLog.count({ where: { ...where, firstOpenedAt: { not: null } } }), prisma.emailLog.count({ where: { ...where, trackingEvents: { some: { eventType: 'CLICK' } } } })]);
            return { variant, accepted, opened, clicked };
        }));
        return { variants, note: 'Exploratory 50/50 hash allocation, not a guaranteed equal sample or statistically established winner. Opens and clicks can include proxy/bot activity. No automatic winner selection.' };
    });
    fastify.get<{ Params: { id: string } }>('/automations/:id/contact-history', async (request, reply) => {
        const parsed = z.object({ email: z.string().email().max(320) }).safeParse(request.query);
        if (!parsed.success) return reply.code(400).send({ error: 'Enter a valid customer email' });
        const accountId = request.accountId!;
        if (!await drafts.workspace(accountId, request.params.id)) return reply.code(404).send({ error: 'Flow not found' });
        const enrollments = await prisma.automationEnrollment.findMany({
            where: { accountId, automationId: request.params.id, email: { equals: parsed.data.email, mode: 'insensitive' } },
            orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], take: 11,
            select: { id: true, email: true, status: true, statusReason: true, nextRunAt: true, createdAt: true,
                runEvents: { orderBy: [{ createdAt: 'asc' }, { id: 'asc' }], take: 101, select: { id: true, nodeId: true, eventType: true, outcome: true, metadata: true, createdAt: true } } },
        });
        return { hasMore: enrollments.length > 10, enrollments: enrollments.slice(0, 10).map(row => ({ ...row, eventsTruncated: row.runEvents.length > 100, runEvents: row.runEvents.slice(0, 100) })) };
    });
    fastify.post<{ Params: { id: string } }>('/automations/:id/simulate', { bodyLimit: HTTP_LIMITS.AUTOMATION_FLOW_BODY_LIMIT_BYTES }, async (request, reply) => {
        const parsed = z.object({ email: z.string().email().max(320).optional(), flowDefinition: draftSchema.shape.flowDefinition }).safeParse(request.body);
        if (!parsed.success) return reply.code(400).send({ error: 'Invalid simulation input' });
        const accountId = request.accountId!;
        if (!await drafts.workspace(accountId, request.params.id)) return reply.code(404).send({ error: 'Flow not found' });
        let context: Record<string, any> = { customer: { firstName: 'Alex', email: 'alex@example.com' }, order: { number: '1001', total: '49.00', status: 'processing' } };
        if (parsed.data.email) {
            const customer = await prisma.wooCustomer.findFirst({ where: { accountId, email: { equals: parsed.data.email, mode: 'insensitive' } }, select: { wooId: true, email: true } });
            if (!customer) return reply.code(404).send({ error: 'Customer not found in this account' });
            const requiredFields = parsed.data.flowDefinition.nodes.flatMap((node: any) => {
                const config = node?.data?.config || {};
                return (Array.isArray(config.conditions) ? config.conditions : [config]).map((condition: any) => condition?.field).filter((field: unknown): field is string => typeof field === 'string');
            });
            context = await automationContextService.buildContext({ accountId, wooCustomerId: customer.wooId, email: customer.email, requiredFields });
        }
        const flow = parsed.data.flowDefinition as any;
        if (flow.nodes.some((node: any) => !node || typeof node.id !== 'string' || typeof node.type !== 'string') || flow.edges.some((edge: any) => !edge || typeof edge.source !== 'string' || typeof edge.target !== 'string')) return reply.code(400).send({ error: 'Invalid flow graph' });
        return simulateFlow(flow, context);
    });
    fastify.put<{ Params: { id: string } }>('/automations/:id/draft', { bodyLimit: HTTP_LIMITS.AUTOMATION_FLOW_BODY_LIMIT_BYTES }, async (request, reply) => {
        const parsed = draftSchema.safeParse(request.body);
        if (!parsed.success) return reply.code(400).send({ error: 'Invalid draft' });
        try {
            return await drafts.save(request.accountId!, request.params.id, parsed.data.revision, parsed.data.flowDefinition, parsed.data.name);
        } catch (error) {
            if ((error as any).statusCode === 400) return reply.code(400).send({ error: (error as Error).message });
            if ((error as any).statusCode === 409) return reply.code(409).send({ error: (error as Error).message });
            throw error;
        }
    });
    fastify.post<{ Params: { id: string } }>('/automations/:id/publish', async (request, reply) => {
        const parsed = revisionSchema.safeParse(request.body);
        if (!parsed.success) return reply.code(400).send({ error: 'Invalid draft revision' });
        try {
            return await drafts.publish(request.accountId!, request.params.id, parsed.data.revision);
        } catch (error) {
            if ((error as any).statusCode === 409) return reply.code(409).send({ error: (error as Error).message });
            if ((error as Error).name === 'FlowValidationError') return reply.code(400).send({ error: (error as Error).message, issues: (error as any).issues });
            throw error;
        }
    });
};
