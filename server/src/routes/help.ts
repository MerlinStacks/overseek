import { type FastifyPluginAsync, type FastifyReply } from 'fastify';
import { z } from 'zod';
import { prisma } from '../utils/prisma';
import { requireAuthFastify, requireSuperAdminFastify } from '../middleware/auth';

const idSchema = z.string().trim().min(1).max(128);
const slugSchema = z.string().trim().min(1).max(200).regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/);
const collectionSchema = z.object({ title: z.string().trim().min(1).max(200), slug: slugSchema, description: z.string().max(2000).optional(), icon: z.string().max(100).optional(), order: z.number().int().min(0).max(1000000).optional() }).strict();
const articleSchema = z.object({ collectionId: idSchema, title: z.string().trim().min(1).max(200), slug: slugSchema, content: z.string().trim().min(1).max(500000), excerpt: z.string().max(2000).optional(), isPublished: z.boolean().optional(), order: z.number().int().min(0).max(1000000).optional() }).strict();
function failure(reply: FastifyReply, error: unknown) {
    const code = (error as { code?: string })?.code;
    return code === 'P2025' ? reply.code(404).send({ error: 'Help resource not found' }) : code === 'P2002' ? reply.code(409).send({ error: 'This slug is already in use' }) : code === 'P2003' ? reply.code(400).send({ error: 'Invalid collection reference' }) : reply.code(500).send({ error: 'Help operation failed' });
}
const helpRoutes: FastifyPluginAsync = async fastify => {
    fastify.get('/collections', async (_request, reply) => {
        try { return await prisma.helpCollection.findMany({ include: { articles: { select: { id: true, title: true, slug: true, excerpt: true, order: true }, where: { isPublished: true }, orderBy: [{ order: 'asc' }, { id: 'asc' }] } }, orderBy: [{ order: 'asc' }, { id: 'asc' }] }); }
        catch (error) { return failure(reply, error); }
    });
    fastify.get('/search', async (request, reply) => {
        const parsed = z.object({ q: z.string().trim().max(200).optional() }).strict().safeParse(request.query);
        if (!parsed.success) return reply.code(400).send({ error: 'Search query must be at most 200 characters' });
        const q = parsed.data.q;
        if (!q) return [];
        try { return await prisma.helpArticle.findMany({ where: { isPublished: true, OR: [{ title: { contains: q, mode: 'insensitive' } }, { content: { contains: q, mode: 'insensitive' } }, { excerpt: { contains: q, mode: 'insensitive' } }] }, select: { id: true, title: true, slug: true, excerpt: true, collection: { select: { title: true, slug: true } } }, orderBy: [{ order: 'asc' }, { id: 'asc' }], take: 10 }); }
        catch (error) { return failure(reply, error); }
    });
    fastify.get<{ Params: { slug: string } }>('/articles/:slug', async (request, reply) => {
        const parsed = slugSchema.safeParse(request.params.slug);
        if (!parsed.success) return reply.code(400).send({ error: 'Invalid article slug' });
        try {
            const article = await prisma.helpArticle.findUnique({ where: { slug: parsed.data }, include: { collection: { select: { id: true, title: true, slug: true } } } });
            if (!article?.isPublished) return reply.code(404).send({ error: 'Article not found' });
            void prisma.helpArticle.update({ where: { id: article.id }, data: { viewCount: { increment: 1 } } }).catch(() => {});
            return article;
        } catch (error) { return failure(reply, error); }
    });
    const admin = { preHandler: [requireAuthFastify, requireSuperAdminFastify] };
    fastify.post('/collections', admin, async (request, reply) => {
        const parsed = collectionSchema.safeParse(request.body);
        if (!parsed.success) return reply.code(400).send({ error: 'Invalid collection fields' });
        try { return await prisma.helpCollection.create({ data: { ...parsed.data, order: parsed.data.order ?? 0 } }); }
        catch (error) { return failure(reply, error); }
    });
    fastify.put<{ Params: { id: string } }>('/collections/:id', admin, async (request, reply) => {
        const parsed = collectionSchema.safeParse(request.body);
        if (!parsed.success || !idSchema.safeParse(request.params.id).success) return reply.code(400).send({ error: 'Invalid collection fields' });
        try { return await prisma.helpCollection.update({ where: { id: request.params.id }, data: parsed.data }); }
        catch (error) { return failure(reply, error); }
    });
    fastify.delete<{ Params: { id: string } }>('/collections/:id', admin, async (request, reply) => {
        if (!idSchema.safeParse(request.params.id).success) return reply.code(400).send({ error: 'Invalid collection ID' });
        try { await prisma.helpCollection.delete({ where: { id: request.params.id } }); return { success: true }; }
        catch (error) { return failure(reply, error); }
    });
    fastify.post('/articles', { ...admin, bodyLimit: 600000 }, async (request, reply) => {
        const parsed = articleSchema.safeParse(request.body);
        if (!parsed.success) return reply.code(400).send({ error: 'Invalid article fields' });
        try { return await prisma.helpArticle.create({ data: { ...parsed.data, isPublished: parsed.data.isPublished ?? false, order: parsed.data.order ?? 0 } }); }
        catch (error) { return failure(reply, error); }
    });
    fastify.put<{ Params: { id: string } }>('/articles/:id', { ...admin, bodyLimit: 600000 }, async (request, reply) => {
        const parsed = articleSchema.safeParse(request.body);
        if (!parsed.success || !idSchema.safeParse(request.params.id).success) return reply.code(400).send({ error: 'Invalid article fields' });
        try { return await prisma.helpArticle.update({ where: { id: request.params.id }, data: parsed.data }); }
        catch (error) { return failure(reply, error); }
    });
    fastify.delete<{ Params: { id: string } }>('/articles/:id', admin, async (request, reply) => {
        if (!idSchema.safeParse(request.params.id).success) return reply.code(400).send({ error: 'Invalid article ID' });
        try { await prisma.helpArticle.delete({ where: { id: request.params.id } }); return { success: true }; }
        catch (error) { return failure(reply, error); }
    });
};
export default helpRoutes;
