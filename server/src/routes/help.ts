/**
 * Help Route - Fastify Plugin
 */

import { FastifyPluginAsync } from 'fastify';
import { prisma } from '../utils/prisma';
import { Logger } from '../utils/logger';
import { requireAuthFastify, requireSuperAdminFastify } from '../middleware/auth';

interface CollectionBody {
    title: string;
    slug: string;
    description?: string;
    icon?: string;
    order?: number;
}

interface ArticleBody {
    collectionId: string;
    title: string;
    slug: string;
    content: string;
    excerpt?: string;
    isPublished?: boolean;
    order?: number;
}

const helpRoutes: FastifyPluginAsync = async (fastify) => {
    // PUBLIC READ ROUTES

    // Get all collections with articles
    fastify.get('/collections', async (request, reply) => {
        try {
            const collections = await prisma.helpCollection.findMany({
                include: {
                    articles: {
                        select: { id: true, title: true, slug: true, excerpt: true, order: true },
                        where: { isPublished: true },
                        orderBy: { order: 'asc' }
                    }
                },
                orderBy: { order: 'asc' }
            });
            return collections;
        } catch (error) {
            Logger.error('Get Help Collections error', { error });
            return reply.code(500).send({ error: 'Internal server error' });
        }
    });

    // Search Articles
    fastify.get('/search', async (request, reply) => {
        try {
            const { q } = request.query as { q?: string };
            if (!q || typeof q !== 'string') return [];

            const articles = await prisma.helpArticle.findMany({
                where: {
                    isPublished: true,
                    OR: [
                        { title: { contains: q, mode: 'insensitive' } },
                        { content: { contains: q, mode: 'insensitive' } },
                        { excerpt: { contains: q, mode: 'insensitive' } }
                    ]
                },
                select: {
                    id: true,
                    title: true,
                    slug: true,
                    excerpt: true,
                    collection: { select: { title: true, slug: true } }
                },
                take: 10
            });

            return articles;
        } catch (error) {
            Logger.error('Search Help error', { error });
            return reply.code(500).send({ error: 'Internal server error' });
        }
    });

    // Get single article
    fastify.get<{ Params: { slug: string } }>('/articles/:slug', async (request, reply) => {
        try {
            const { slug } = request.params;
            const article = await prisma.helpArticle.findUnique({
                where: { slug },
                include: {
                    collection: {
                        select: { id: true, title: true, slug: true }
                    }
                }
            });

            if (!article) return reply.code(404).send({ error: 'Article not found' });
            if (!article.isPublished) {
                return reply.code(404).send({ error: 'Article not found' });
            }

            // Increment view count (fire and forget)
            prisma.helpArticle.update({
                where: { id: article.id },
                data: { viewCount: { increment: 1 } }
            }).catch(err => Logger.error('Failed to update view count', { error: err }));

            return article;
        } catch (error) {
            Logger.error('Get Article error', { error });
            return reply.code(500).send({ error: 'Internal server error' });
        }
    });

    // ADMIN WRITE ROUTES

    fastify.post<{ Body: CollectionBody }>('/collections', { preHandler: [requireAuthFastify, requireSuperAdminFastify] }, async (request, reply) => {
        try {
            const { title, slug, description, icon, order } = request.body;
            const collection = await prisma.helpCollection.create({
                data: { title, slug, description, icon, order: order || 0 }
            });
            return collection;
        } catch (e) {
            Logger.error('Create collection error', { error: e });
            return reply.code(500).send({ error: 'Failed to create collection' });
        }
    });

    fastify.put<{ Params: { id: string }; Body: CollectionBody }>('/collections/:id', { preHandler: [requireAuthFastify, requireSuperAdminFastify] }, async (request, reply) => {
        try {
            const { id } = request.params;
            const { title, slug, description, icon, order } = request.body;
            const collection = await prisma.helpCollection.update({
                where: { id },
                data: { title, slug, description, icon, order }
            });
            return collection;
        } catch (e) {
            return reply.code(500).send({ error: 'Failed to update collection' });
        }
    });

    fastify.delete<{ Params: { id: string } }>('/collections/:id', { preHandler: [requireAuthFastify, requireSuperAdminFastify] }, async (request, reply) => {
        try {
            const { id } = request.params;
            await prisma.helpCollection.delete({ where: { id } });
            return { success: true };
        } catch (e) {
            return reply.code(500).send({ error: 'Failed to delete collection' });
        }
    });

    fastify.post<{ Body: ArticleBody }>('/articles', { preHandler: [requireAuthFastify, requireSuperAdminFastify] }, async (request, reply) => {
        try {
            const { collectionId, title, slug, content, excerpt, isPublished, order } = request.body;
            const article = await prisma.helpArticle.create({
                data: { collectionId, title, slug, content, excerpt, isPublished: isPublished ?? true, order: order || 0 }
            });
            return article;
        } catch (e) {
            Logger.error('Create article error', { error: e });
            return reply.code(500).send({ error: 'Failed to create article' });
        }
    });

    fastify.put<{ Params: { id: string }; Body: ArticleBody }>('/articles/:id', { preHandler: [requireAuthFastify, requireSuperAdminFastify] }, async (request, reply) => {
        try {
            const { id } = request.params;
            const { collectionId, title, slug, content, excerpt, isPublished, order } = request.body;
            const article = await prisma.helpArticle.update({
                where: { id },
                data: { collectionId, title, slug, content, excerpt, isPublished, order }
            });
            return article;
        } catch (e) {
            return reply.code(500).send({ error: 'Failed to update article' });
        }
    });

    fastify.delete<{ Params: { id: string } }>('/articles/:id', { preHandler: [requireAuthFastify, requireSuperAdminFastify] }, async (request, reply) => {
        try {
            const { id } = request.params;
            await prisma.helpArticle.delete({ where: { id } });
            return { success: true };
        } catch (e) {
            return reply.code(500).send({ error: 'Failed to delete article' });
        }
    });
};

export default helpRoutes;
