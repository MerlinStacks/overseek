import { FastifyPluginAsync } from 'fastify';
import { requireAuthFastify } from '../middleware/auth';
import { prisma } from '../utils/prisma';
import { getRouteAccountIdOrReply } from './routeHelpers';
import { z } from 'zod';
import { WooService } from '../services/woo';
import { calculateContentSeoScore } from '@overseek/core';
import { buildContentLookupWhere } from './contentHelpers';

const contentIdParamSchema = z.object({
    id: z.string().min(1),
});

const updateContentBodySchema = z.object({
    title: z.string().min(1).optional(),
    content: z.string().optional(),
    excerpt: z.string().optional(),
    status: z.string().optional(),
    focusKeyword: z.string().optional(),
});

const createContentBodySchema = z.object({
    title: z.string().min(1),
    content: z.string().optional().default(''),
    excerpt: z.string().optional().default(''),
    status: z.enum(['draft', 'publish', 'private', 'pending']).optional().default('draft'),
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

    const [rawItems, total] = await Promise.all([
        model.findMany({
            where,
            orderBy: { dateModified: 'desc' },
            skip: (page - 1) * limit,
            take: limit,
            select: contentSelect,
        }),
        model.count({ where }),
    ]);

    const items = rawItems.map((item: any) => {
        const focusKeyword = (item?.seoData as any)?.focusKeyword ?? '';
        const seoResult = calculateContentSeoScore({
            title: item?.title ?? '',
            content: item?.content ?? '',
            excerpt: item?.excerpt ?? '',
            slug: item?.slug ?? null,
            permalink: item?.permalink ?? null,
            focusKeyword,
        });

        return {
            ...item,
            seoScore: seoResult.score,
            seoData: {
                ...(item?.seoData ?? {}),
                focusKeyword,
                analysis: seoResult.tests,
            },
        };
    });

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

    fastify.post('/pages', async (request, reply) => {
        const accountId = getRouteAccountIdOrReply(request, reply);
        if (!accountId) return;

        const payload = createContentBodySchema.parse(request.body);
        const woo = await WooService.forAccount(accountId);
        const created = await woo.createPage({
            title: payload.title,
            content: payload.content,
            excerpt: payload.excerpt,
            status: payload.status,
        }, request.user?.id);

        const focusKeyword = payload.focusKeyword || '';
        const seoResult = calculateContentSeoScore({
            title: created?.title?.rendered ?? payload.title,
            content: created?.content?.rendered ?? payload.content,
            excerpt: created?.excerpt?.rendered ?? payload.excerpt,
            slug: created?.slug ?? null,
            permalink: created?.link ?? null,
            focusKeyword,
        });

        const item = await prisma.wooPage.upsert({
            where: { accountId_wooId: { accountId, wooId: created.id } },
            update: {
                title: created?.title?.rendered ?? payload.title,
                slug: created?.slug ?? null,
                status: created?.status ?? payload.status,
                permalink: created?.link ?? null,
                content: created?.content?.rendered ?? payload.content,
                excerpt: created?.excerpt?.rendered ?? payload.excerpt,
                dateModified: new Date(created?.modified_gmt || created?.modified || Date.now()),
                seoScore: seoResult.score,
                seoData: { focusKeyword, analysis: seoResult.tests } as any,
                rawData: created as any,
            },
            create: {
                wooId: created.id,
                title: created?.title?.rendered ?? payload.title,
                slug: created?.slug ?? null,
                status: created?.status ?? payload.status,
                permalink: created?.link ?? null,
                content: created?.content?.rendered ?? payload.content,
                excerpt: created?.excerpt?.rendered ?? payload.excerpt,
                dateCreated: new Date(created?.date_gmt || created?.date || Date.now()),
                dateModified: new Date(created?.modified_gmt || created?.modified || Date.now()),
                seoScore: seoResult.score,
                seoData: { focusKeyword, analysis: seoResult.tests } as any,
                rawData: created as any,
                account: { connect: { id: accountId } },
            },
            select: contentSelect,
        });

        return reply.code(201).send(item);
    });

    fastify.post('/posts', async (request, reply) => {
        const accountId = getRouteAccountIdOrReply(request, reply);
        if (!accountId) return;

        const payload = createContentBodySchema.parse(request.body);
        const woo = await WooService.forAccount(accountId);
        const created = await woo.createPost({
            title: payload.title,
            content: payload.content,
            excerpt: payload.excerpt,
            status: payload.status,
        }, request.user?.id);

        const focusKeyword = payload.focusKeyword || '';
        const seoResult = calculateContentSeoScore({
            title: created?.title?.rendered ?? payload.title,
            content: created?.content?.rendered ?? payload.content,
            excerpt: created?.excerpt?.rendered ?? payload.excerpt,
            slug: created?.slug ?? null,
            permalink: created?.link ?? null,
            focusKeyword,
        });

        const item = await prisma.wooBlogPost.upsert({
            where: { accountId_wooId: { accountId, wooId: created.id } },
            update: {
                title: created?.title?.rendered ?? payload.title,
                slug: created?.slug ?? null,
                status: created?.status ?? payload.status,
                permalink: created?.link ?? null,
                content: created?.content?.rendered ?? payload.content,
                excerpt: created?.excerpt?.rendered ?? payload.excerpt,
                dateModified: new Date(created?.modified_gmt || created?.modified || Date.now()),
                seoScore: seoResult.score,
                seoData: { focusKeyword, analysis: seoResult.tests } as any,
                rawData: created as any,
            },
            create: {
                wooId: created.id,
                title: created?.title?.rendered ?? payload.title,
                slug: created?.slug ?? null,
                status: created?.status ?? payload.status,
                permalink: created?.link ?? null,
                content: created?.content?.rendered ?? payload.content,
                excerpt: created?.excerpt?.rendered ?? payload.excerpt,
                dateCreated: new Date(created?.date_gmt || created?.date || Date.now()),
                dateModified: new Date(created?.modified_gmt || created?.modified || Date.now()),
                seoScore: seoResult.score,
                seoData: { focusKeyword, analysis: seoResult.tests } as any,
                rawData: created as any,
                account: { connect: { id: accountId } },
            },
            select: contentSelect,
        });

        return reply.code(201).send(item);
    });

    fastify.get('/pages/:id', async (request, reply) => {
        const accountId = getRouteAccountIdOrReply(request, reply);
        if (!accountId) return;

        const { id } = contentIdParamSchema.parse(request.params);
        const item = await prisma.wooPage.findFirst({ where: buildContentLookupWhere(id, accountId), select: contentSelect });
        if (!item) return reply.code(404).send({ error: 'Page not found' });
        return item;
    });

    fastify.get('/posts/:id', async (request, reply) => {
        const accountId = getRouteAccountIdOrReply(request, reply);
        if (!accountId) return;

        const { id } = contentIdParamSchema.parse(request.params);
        const item = await prisma.wooBlogPost.findFirst({ where: buildContentLookupWhere(id, accountId), select: contentSelect });
        if (!item) return reply.code(404).send({ error: 'Post not found' });
        return item;
    });

    fastify.patch('/pages/:id', async (request, reply) => {
        const accountId = getRouteAccountIdOrReply(request, reply);
        if (!accountId) return;

        const { id } = contentIdParamSchema.parse(request.params);
        const payload = updateContentBodySchema.parse(request.body);

        const current = await prisma.wooPage.findFirst({ where: buildContentLookupWhere(id, accountId) });
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
            where: { id: current.id },
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

        const current = await prisma.wooBlogPost.findFirst({ where: buildContentLookupWhere(id, accountId) });
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
            where: { id: current.id },
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
