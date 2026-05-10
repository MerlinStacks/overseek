import { FastifyPluginAsync } from 'fastify';
import { requireAuthFastify } from '../middleware/auth';
import { prisma } from '../utils/prisma';
import { getRouteAccountIdOrReply } from './routeHelpers';

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
};

export default contentRoutes;
