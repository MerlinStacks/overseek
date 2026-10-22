import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { requireAuthFastify } from '../middleware/auth';
import { isAccountFeatureEnabled } from '../utils/accountFeatures';
import { AiManagerService } from '../services/ai/AiManagerService';
import { PermissionService } from '../services/PermissionService';
import { prisma } from '../utils/prisma';
const aiManagerRoutes: FastifyPluginAsync = async fastify => {
    fastify.addHook('preHandler', requireAuthFastify);
    fastify.addHook('preHandler', async (request, reply) => {
        if (!request.accountId || !request.user?.id) return reply.code(400).send({ error: 'Select an account' });
        if (!await isAccountFeatureEnabled(request.accountId, 'AI_MANAGER', false)) return reply.code(403).send({ error: 'AI Manager disabled' });
        if (!await PermissionService.hasPermission(request.user.id, request.accountId, request.method === 'GET' ? 'view_marketing' : 'manage_marketing')) return reply.code(403).send({ error: 'Marketing permission required' });
    });
    fastify.get('/health', async request => {
        const accountId = request.accountId!;
        const [searchConsole, googleAds, metaAds] = await Promise.all([prisma.searchConsoleAccount.count({ where: { accountId } }), prisma.adAccount.count({ where: { accountId, platform: 'GOOGLE' } }), prisma.adAccount.count({ where: { accountId, platform: 'META' } })]);
        return { configured: { searchConsole, googleAds, metaAds }, providerHealth: 'unverified' };
    });
    fastify.get('/suggestions', async (request, reply) => {
        const query = z.object({ status: z.enum(['pending', 'implemented', 'dismissed', 'expired']).optional(), limit: z.string().regex(/^[1-9]\d*$/).transform(Number).refine(value => value <= 100).default(50) }).strict().safeParse(request.query);
        if (!query.success) return reply.code(400).send({ error: 'Invalid status or limit' });
        const { status, limit } = query.data;
        const rows = await prisma.recommendationLog.findMany({ where: { accountId: request.accountId, recommendationId: { startsWith: 'ai_manager_' }, ...(status ? { status } : {}) }, orderBy: [{ createdAt: 'desc' }, { id: 'asc' }], take: limit + 1 });
        return { items: rows.slice(0, limit).map(item => ({ id: item.id, title: item.campaignName || 'Review suggestion', text: item.text, type: item.category, source: item.platform || 'UNKNOWN', priority: item.priority, confidence: null, status: item.status, createdAt: item.createdAt, version: item.updatedAt.toISOString(), dataPoints: Array.isArray(item.dataPoints) ? item.dataPoints.filter(value => typeof value === 'string').slice(0, 30) : [], basis: 'uncalibrated-review-only' })), coverage: { truncated: rows.length > limit, limit } };
    });
    fastify.post('/suggestions/refresh', async (request, reply) => {
        const input = z.object({ occurrence: z.string().uuid() }).strict().safeParse(request.body);
        if (!input.success) return reply.code(400).send({ error: 'Stable refresh occurrence required' });
        return AiManagerService.generateSuggestions(request.accountId!, request.user!.id, input.data.occurrence);
    });
    fastify.post<{ Params: { id: string } }>('/suggestions/:id/status', async (request, reply) => {
        const input = z.object({ status: z.enum(['implemented', 'dismissed']), version: z.string().datetime() }).strict().safeParse(request.body);
        const id = z.string().trim().min(1).max(200).safeParse(request.params.id);
        if (!input.success || !id.success) return reply.code(400).send({ error: 'Valid status and current version required' });
        const { version, status } = input.data, now = new Date(Math.max(Date.now(), Date.parse(version) + 1));
        const changed = await prisma.recommendationLog.updateMany({ where: { id: id.data, accountId: request.accountId, recommendationId: { startsWith: 'ai_manager_' }, status: 'pending', updatedAt: new Date(version) }, data: { status, updatedAt: now, ...(status === 'implemented' ? { implementedAt: now } : { dismissedAt: now }) } });
        if (changed.count !== 1) return reply.code(409).send({ error: 'Suggestion changed or unavailable' });
        return { success: true, version: now.toISOString() };
    });
};
export default aiManagerRoutes;
