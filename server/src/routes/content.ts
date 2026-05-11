import { FastifyPluginAsync } from 'fastify';
import { requireAuthFastify } from '../middleware/auth';
import { prisma } from '../utils/prisma';
import { getRouteAccountIdOrReply } from './routeHelpers';
import { z } from 'zod';
import { WooService } from '../services/woo';
import { calculateContentSeoScore } from '@overseek/core';

const contentIdParamSchema = z.object({
    id: z.string().uuid(),
});

const updateContentBodySchema = z.object({
    title: z.string().min(1).optional(),
    content: z.string().optional(),
    excerpt: z.string().optional(),
    status: z.string().optional(),
    focusKeyword: z.string().optional(),
});

type ContentListQuery = { q?: string; page?: string; limit?: string; status?: string };

const contentSelect = {
    id: true,
    wooId: true,
    title: true,
    slug: true,
    status: true,
    permalink: true,
    dateCreated: true,
    dateModified: true,
    updatedAt: true,
    content: true,
    excerpt: true,
    seoScore: true,
    seoData: true,
};


function parseListQuery(query: ContentListQuery) {
    const page = Math.max(1, Number.parseInt(query.page || '1', 10));
    const limit = Math.min(100, Math.max(1, Number.parseInt(query.limit || '25', 10)));
    const q = query.q?.trim();

    return { page, limit, q };
}

function buildWhere(accountId: string, query: ContentListQuery, q?: string) {
    return {
        accountId,
        ...(query.status ? { status: query.status } : {}),
        ...(q
            ? {
                  OR: [
                      { title: { contains: q, mode: 'insensitive' } },
                      { slug: { contains: q, mode: 'insensitive' } },
                      { permalink: { contains: q, mode: 'insensitive' } },
                  ],
              }
            : {}),
    };
}

async function fetchContentList(
    model: {
        findMany: (args: unknown) => Promise<unknown[]>;
        count: (args: unknown) => Promise<number>;
    },
    accountId: string,
    query: ContentListQuery,
) {
    const { page, limit, q } = parseListQuery(query);
    const where = buildWhere(accountId, query, q);

    const [items, total] = await Promise.all([
        model.findMany({
            where,
            orderBy: { dateModified: 'desc' },
            skip: (page - 1) * limit,
            take: limit,
            select: contentSelect,
        }),
        model.count({ where }),
    ]);

    return {
        items,
        pagination: { page, limit, total, totalPages: Math.max(1, Math.ceil(total / limit)) },
    };
}

const contentRoutes: FastifyPluginAsync = async (fastify) => {
    fastify.addHook('preHandler', requireAuthFastify);

    fastify.get('/pages', async (request, reply) => {
        const accountId = getRouteAccountIdOrReply(request, reply);
        if (!accountId) return;

        return fetchContentList(prisma.wooPage, accountId, request.query as ContentListQuery);
    });

    fastify.get('/posts', async (request, reply) => {
        const accountId = getRouteAccountIdOrReply(request, reply);
        if (!accountId) return;

        return fetchContentList(prisma.wooBlogPost, accountId, request.query as ContentListQuery);
    });

    fastify.get('/pages/:id', async (request, reply) => {
        const accountId = getRouteAccountIdOrReply(request, reply);
        if (!accountId) return;

        const { id } = contentIdParamSchema.parse(request.params);
        const item = await prisma.wooPage.findFirst({ where: { id, accountId }, select: contentSelect });
        if (!item) return reply.code(404).send({ error: 'Page not found' });
        return item;
    });

    fastify.get('/posts/:id', async (request, reply) => {
        const accountId = getRouteAccountIdOrReply(request, reply);
        if (!accountId) return;

        const { id } = contentIdParamSchema.parse(request.params);
        const item = await prisma.wooBlogPost.findFirst({ where: { id, accountId }, select: contentSelect });
        if (!item) return reply.code(404).send({ error: 'Post not found' });
        return item;
    });

    fastify.patch('/pages/:id', async (request, reply) => {
        const accountId = getRouteAccountIdOrReply(request, reply);
        if (!accountId) return;

        const { id } = contentIdParamSchema.parse(request.params);
        const payload = updateContentBodySchema.parse(request.body);

        const current = await prisma.wooPage.findFirst({ where: { id, accountId } });
        if (!current) return reply.code(404).send({ error: 'Page not found' });

        const woo = await WooService.forAccount(accountId);
        await woo.updatePage(current.wooId, {
            title: payload.title,
            content: payload.content,
            excerpt: payload.excerpt,
            status: payload.status,
        }, request.user?.id);

        const focusKeyword = payload.focusKeyword ?? ((current.seoData as any)?.focusKeyword ?? '');
        const seoResult = calculateContentSeoScore({
            title: payload.title ?? current.title,
            content: payload.content ?? current.content,
            excerpt: payload.excerpt ?? current.excerpt,
            slug: current.slug,
            permalink: current.permalink,
            focusKeyword,
        });

        const updated = await prisma.wooPage.update({
            where: { id },
            data: {
                ...(payload.title !== undefined ? { title: payload.title } : {}),
                ...(payload.content !== undefined ? { content: payload.content } : {}),
                ...(payload.excerpt !== undefined ? { excerpt: payload.excerpt } : {}),
                ...(payload.status !== undefined ? { status: payload.status } : {}),
                dateModified: new Date(),
                seoScore: seoResult.score,
                seoData: { focusKeyword, analysis: seoResult.tests } as any,
            },
            select: contentSelect,
        });

        return updated;
    });

    fastify.patch('/posts/:id', async (request, reply) => {
        const accountId = getRouteAccountIdOrReply(request, reply);
        if (!accountId) return;

        const { id } = contentIdParamSchema.parse(request.params);
        const payload = updateContentBodySchema.parse(request.body);

        const current = await prisma.wooBlogPost.findFirst({ where: { id, accountId } });
        if (!current) return reply.code(404).send({ error: 'Post not found' });

        const woo = await WooService.forAccount(accountId);
        await woo.updatePost(current.wooId, {
            title: payload.title,
            content: payload.content,
            excerpt: payload.excerpt,
            status: payload.status,
        }, request.user?.id);

        const focusKeyword = payload.focusKeyword ?? ((current.seoData as any)?.focusKeyword ?? '');
        const seoResult = calculateContentSeoScore({
            title: payload.title ?? current.title,
            content: payload.content ?? current.content,
            excerpt: payload.excerpt ?? current.excerpt,
            slug: current.slug,
            permalink: current.permalink,
            focusKeyword,
        });

        const updated = await prisma.wooBlogPost.update({
            where: { id },
            data: {
                ...(payload.title !== undefined ? { title: payload.title } : {}),
                ...(payload.content !== undefined ? { content: payload.content } : {}),
                ...(payload.excerpt !== undefined ? { excerpt: payload.excerpt } : {}),
                ...(payload.status !== undefined ? { status: payload.status } : {}),
                dateModified: new Date(),
                seoScore: seoResult.score,
                seoData: { focusKeyword, analysis: seoResult.tests } as any,
            },
            select: contentSelect,
        });

        return updated;
    });
};

export default contentRoutes;
