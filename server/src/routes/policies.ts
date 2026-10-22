import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { requireAuthFastify } from '../middleware/auth';
import { PermissionService } from '../services/PermissionService';
import { prisma } from '../utils/prisma';
import { cacheDelete } from '../utils/cache';

const idSchema = z.string().trim().min(1).max(200), version = z.string().datetime();
const fields = z.object({ title: z.string().trim().min(1).max(200), content: z.string().max(100000), type: z.enum(['POLICY', 'SOP', 'TRAINING']), category: z.string().trim().max(100).nullable(), isPublished: z.boolean() }).strict();
const createSchema = fields.extend({ id: z.string().uuid() }).strict(), updateSchema = fields.extend({ version }).strict();
const promptIds = ['product_description', 'customer_email', 'review_reply', 'seo_meta', 'inbox_draft_reply'] as const;
const promptSchema = z.object({ name: z.string().trim().max(200).nullable().optional(), content: z.string().trim().min(1).max(30000), version: z.string().max(200) }).strict();
const conflict = () => Object.assign(new Error('Resource changed or unavailable; reload before writing'), { statusCode: 409 });
const stamp = (old: Date) => new Date(Math.max(Date.now(), old.getTime() + 1));
async function invalidate(accountId: string) { try { await cacheDelete(`policies:${accountId}`); } catch { /* The write committed. Cache expiry is not a failed mutation. */ } }
const policiesRoutes: FastifyPluginAsync = async fastify => {
    fastify.addHook('preHandler', requireAuthFastify);
    fastify.addHook('preHandler', async (request, reply) => {
        if (!request.accountId || !request.user?.id) return reply.code(400).send({ error: 'Select an account' });
        const prompt = request.url.split('?')[0].includes('/ai-prompts');
        const permission = prompt ? 'manage_ai_prompts' : request.method === 'GET' ? 'view_policies' : 'manage_policies';
        if (!await PermissionService.hasPermission(request.user.id, request.accountId, permission)) return reply.code(403).send({ error: 'Policy or prompt permission required' });
    });
    fastify.get('/', async (request, reply) => {
        const parsed = z.object({ cursor: idSchema.optional(), limit: z.string().regex(/^[1-9]\d*$/).transform(Number).refine(value => value <= 100).optional() }).strict().safeParse(request.query);
        if (!parsed.success) return reply.code(400).send({ error: 'Invalid pagination' });
        const limit = parsed.data.limit || 50;
        const rows = await prisma.policy.findMany({ where: { accountId: request.accountId, ...(parsed.data.cursor ? { id: { gt: parsed.data.cursor } } : {}) }, orderBy: { id: 'asc' }, take: limit + 1 });
        return { items: rows.slice(0, limit), nextCursor: rows.length > limit ? rows[limit - 1].id : null };
    });
    fastify.get<{ Params: { id: string } }>('/:id', async (request, reply) => {
        const parsed = idSchema.safeParse(request.params.id); if (!parsed.success) return reply.code(400).send({ error: 'Invalid policy ID' });
        const item = await prisma.policy.findFirst({ where: { id: parsed.data, accountId: request.accountId } });
        return item || reply.code(404).send({ error: 'Policy not found' });
    });
    fastify.post('/', async (request, reply) => {
        const parsed = createSchema.safeParse(request.body); if (!parsed.success) return reply.code(400).send({ error: 'Invalid policy' });
        const accountId = request.accountId!;
        try {
            const item = await prisma.policy.create({ data: { ...parsed.data, accountId } }); await invalidate(accountId); return item;
        } catch (error) {
            if ((error as { code?: string }).code !== 'P2002') throw error;
            const existing = await prisma.policy.findFirst({ where: { id: parsed.data.id, accountId } });
            if (!existing || Object.entries(parsed.data).some(([key, value]) => existing[key as keyof typeof existing] !== value)) return reply.code(409).send({ error: 'Create identity already used; reload before retrying' });
            return existing;
        }
    });
    fastify.put<{ Params: { id: string } }>('/:id', async (request, reply) => {
        const parsed = updateSchema.safeParse(request.body), id = idSchema.safeParse(request.params.id);
        if (!parsed.success || !id.success) return reply.code(400).send({ error: 'Valid policy and version required' });
        const { version: expected, ...data } = parsed.data, accountId = request.accountId!;
        const item = await prisma.$transaction(async tx => {
            const changed = await tx.policy.updateMany({ where: { id: id.data, accountId, updatedAt: new Date(expected) }, data: { ...data, updatedAt: stamp(new Date(expected)) } });
            if (changed.count !== 1) throw conflict();
            return tx.policy.findFirstOrThrow({ where: { id: id.data, accountId } });
        });
        await invalidate(accountId); return item;
    });
    fastify.delete<{ Params: { id: string } }>('/:id', async (request, reply) => {
        const parsed = z.object({ version }).strict().safeParse(request.body), id = idSchema.safeParse(request.params.id);
        if (!parsed.success || !id.success) return reply.code(400).send({ error: 'Policy version required' });
        const changed = await prisma.policy.deleteMany({ where: { id: id.data, accountId: request.accountId, updatedAt: new Date(parsed.data.version) } });
        if (changed.count !== 1) throw conflict(); await invalidate(request.accountId!); return { success: true };
    });
    fastify.get('/ai-prompts', async request => {
        const [defaults, overrides] = await Promise.all([prisma.aIPrompt.findMany({ where: { promptId: { in: [...promptIds] } }, take: 6 }), prisma.accountAIPrompt.findMany({ where: { accountId: request.accountId, promptId: { in: [...promptIds] } }, take: 6 })]);
        return promptIds.flatMap(promptId => {
            const override = overrides.find(row => row.promptId === promptId), base = defaults.find(row => row.promptId === promptId), value = override || base;
            return value ? [{ id: promptId, name: value.name, content: value.content, updatedAt: value.updatedAt, isAccountOverride: !!override, version: `${override ? 'override' : 'default'}:${value.updatedAt.toISOString()}` }] : [];
        });
    });
    for (const method of ['PUT', 'DELETE'] as const) fastify.route<{ Params: { promptId: string } }>({ method, url: '/ai-prompts/:promptId', handler: async (request, reply) => {
        const promptId = z.enum(promptIds).safeParse(request.params.promptId);
        const parsed = method === 'PUT' ? promptSchema.safeParse(request.body) : z.object({ version: z.string().max(200) }).strict().safeParse(request.body);
        if (!promptId.success || !parsed.success) return reply.code(400).send({ error: 'Known prompt and valid version/content required' });
        const accountId = request.accountId!;
        return prisma.$transaction(async tx => {
            await tx.$queryRaw`SELECT 1 AS locked FROM pg_advisory_xact_lock(hashtextextended(${`prompt:${accountId}:${promptId.data}`}, 0))`;
            await tx.$queryRaw`SELECT 1 AS locked FROM "AIPrompt" WHERE "promptId" = ${promptId.data} FOR SHARE`;
            const current = await tx.accountAIPrompt.findUnique({ where: { accountId_promptId: { accountId, promptId: promptId.data } } });
            const base = await tx.aIPrompt.findUnique({ where: { promptId: promptId.data } });
            const effective = current || base;
            if (!base || !effective || parsed.data.version !== `${current ? 'override' : 'default'}:${effective.updatedAt.toISOString()}`) throw conflict();
            if (method === 'DELETE') {
                if (current) { const changed = await tx.accountAIPrompt.deleteMany({ where: { id: current.id, accountId, updatedAt: current.updatedAt } }); if (changed.count !== 1) throw conflict(); }
                return { success: true };
            }
            const input = promptSchema.parse(parsed.data), data = { content: input.content, name: input.name ?? base.name, updatedAt: stamp(effective.updatedAt) };
            const saved = current ? await tx.accountAIPrompt.updateMany({ where: { id: current.id, accountId, updatedAt: current.updatedAt }, data }) : await tx.accountAIPrompt.create({ data: { accountId, promptId: promptId.data, ...data } });
            if ('count' in saved && saved.count !== 1) throw conflict();
            return { success: true };
        });
    } });
};
export default policiesRoutes;
