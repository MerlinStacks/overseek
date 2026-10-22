import { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { requireAuthFastify } from '../middleware/auth';
import { prisma } from '../utils/prisma';
import { getRouteAccountIdOrReply } from './routeHelpers';
import { PermissionService } from '../services/PermissionService';
import { findContentById } from './contentHelpers';
import { writeContent, presentContent } from '../services/ContentWriteAdmission';
const contentSelect = { id: true, wooId: true, title: true, slug: true, status: true, permalink: true, dateCreated: true, dateModified: true, updatedAt: true, content: true, excerpt: true, seoScore: true, seoData: true, rawData: true };
const contentRoutes: FastifyPluginAsync = async fastify => {
    fastify.addHook('preHandler', requireAuthFastify);
    fastify.addHook('preHandler', async (request, reply) => {
        const accountId = getRouteAccountIdOrReply(request, reply); if (!accountId) return;
        const permission = request.method === 'GET' ? 'view_products' : 'manage_content';
        if (!request.user?.id || !await PermissionService.hasPermission(request.user.id, accountId, permission)) return reply.code(403).send({ error: 'Content permission required' });
    });
    for (const kind of ['pages', 'posts'] as const) {
        const model = kind === 'pages' ? prisma.wooPage : prisma.wooBlogPost as unknown as typeof prisma.wooPage;
        fastify.get(`/${kind}`, async (request, reply) => {
            const parsed = z.object({ q: z.string().trim().max(200).optional(), page: z.coerce.number().int().min(1).max(100000).default(1), limit: z.coerce.number().int().min(1).max(100).default(25), status: z.enum(['draft', 'publish', 'private', 'pending']).optional() }).strict().safeParse(request.query);
            if (!parsed.success) return reply.code(400).send({ error: 'Invalid content page' });
            const { page, limit, q, status } = parsed.data, where = { accountId: request.accountId!, ...(status ? { status } : {}), ...(q ? { OR: [{ title: { contains: q, mode: 'insensitive' as const } }, { slug: { contains: q, mode: 'insensitive' as const } }] } : {}) };
            const [items, total] = await Promise.all([model.findMany({ where, orderBy: [{ dateModified: 'desc' }, { id: 'asc' }], skip: (page - 1) * limit, take: limit, select: contentSelect }), model.count({ where })]);
            return { items: items.map(presentContent), pagination: { page, limit, total, totalPages: Math.ceil(total / limit) }, basis: 'local synced content; heuristic scores are not ranking evidence' };
        });
        fastify.get(`/${kind}/:id`, async (request, reply) => { const { id } = z.object({ id: z.string().min(1).max(200) }).parse(request.params); const item = await findContentById(id, request.accountId!, where => model.findFirst({ where, select: contentSelect })); return item ? presentContent(item) : reply.code(404).send({ error: 'Content not found' }); });
        const write = async (request: any, reply: any, id: string | null) => {
            try { const result = await writeContent(request.accountId!, request.user.id, kind, id, request.body); return reply.code(id ? 200 : 201).send(result); }
            catch (error) { return reply.code((error as Error).name === 'ZodError' ? 400 : 409).send({ error: 'Content write unacknowledged/conflicted. Reconcile the original operation before retrying.' }); }
        };
        fastify.post(`/${kind}`, (request, reply) => write(request, reply, null));
        fastify.patch(`/${kind}/:id`, async (request, reply) => { const parsed = z.object({ id: z.string().uuid() }).safeParse(request.params); if (!parsed.success) return reply.code(400).send({ error: 'Immutable local content UUID required for writes' }); return write(request, reply, parsed.data.id); });
    }
};
export default contentRoutes;
