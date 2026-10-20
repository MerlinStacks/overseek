/**
 * Search Route - Fastify Plugin
 */

import { FastifyPluginAsync } from 'fastify';
import { SearchQueryService } from '../services/search/SearchQueryService';
import { EmbeddingService } from '../services/EmbeddingService';
import { requireAuthFastify } from '../middleware/auth';
import { Logger } from '../utils/logger';
import { prisma } from '../utils/prisma';

const querySchema = (defaultLimit?: number, requiredQuery = false) => ({
    type: 'object',
    properties: {
        q: { type: 'string', maxLength: 500, ...(requiredQuery ? { minLength: 1 } : {}) },
        ...(defaultLimit ? { limit: { type: 'integer', minimum: 1, maximum: 100, default: defaultLimit } } : {})
    },
    ...(requiredQuery ? { required: ['q'] } : {}),
    additionalProperties: false
});

const searchRoutes: FastifyPluginAsync = async (fastify) => {
    fastify.addHook('preHandler', requireAuthFastify);

    fastify.get('/global', { schema: { querystring: querySchema() } }, async (request, reply) => {
        try {
            const accountId = request.accountId;
            const { q } = request.query as { q?: string };

            if (!accountId) return reply.code(400).send({ error: 'No account' });

            const results = await SearchQueryService.globalSearch(accountId, q || '');
            return results;
        } catch (error) {
            Logger.error('Search failed', { error });
            return reply.code(500).send({ error: 'Search failed' });
        }
    });

    // Semantic search using pgvector embeddings
    fastify.get('/semantic', { schema: { querystring: querySchema(10, true) } }, async (request, reply) => {
        try {
            const accountId = request.accountId;
            const { q, limit } = request.query as { q?: string; limit: number };

            if (!accountId) return reply.code(400).send({ error: 'No account' });
            if (!q?.trim()) return reply.code(400).send({ error: 'Query required' });

            const results = await EmbeddingService.semanticSearch(
                accountId,
                q.trim(),
                limit
            );

            return results;
        } catch (error) {
            Logger.error('Semantic search failed', { error });
            return reply.code(500).send({ error: 'Semantic search failed' });
        }
    });

    // Find similar products
    fastify.get<{ Params: { productId: string } }>('/similar/:productId', { schema: { querystring: querySchema(5) } }, async (request, reply) => {
        try {
            const accountId = request.accountId;
            const { productId } = request.params;
            const { limit } = request.query as { limit: number };

            if (!accountId) return reply.code(400).send({ error: 'No account' });

            const results = await EmbeddingService.findSimilarProducts(
                productId,
                accountId,
                limit
            );

            return results;
        } catch (error) {
            Logger.error('Similar products search failed', { error });
            return reply.code(500).send({ error: 'Similar products search failed' });
        }
    });

    // Batch generate embeddings (admin only)
    fastify.post<{ Body: { limit?: number } }>('/embeddings/generate', {
        schema: { body: { type: 'object', properties: { limit: { type: 'integer', minimum: 1, maximum: 500 } }, additionalProperties: false } }
    }, async (request, reply) => {
        try {
            const accountId = request.accountId;
            const { limit } = request.body ?? {};

            if (!accountId) return reply.code(400).send({ error: 'No account' });

            if (!request.user?.isSuperAdmin) {
                if (!request.user) return reply.code(401).send({ error: 'Authentication required' });
                const membership = await prisma.accountUser.findUnique({
                    where: { userId_accountId: { userId: request.user.id, accountId } }, select: { role: true }
                });
                if (!membership || !['OWNER', 'ADMIN'].includes(membership.role)) return reply.code(403).send({ error: 'Account admin required' });
            }

            const updated = await EmbeddingService.batchUpdateEmbeddings(
                accountId,
                limit ?? 100
            );

            return { success: true, updated };
        } catch (error) {
            Logger.error('Embedding generation failed', { error });
            return reply.code(500).send({ error: 'Embedding generation failed' });
        }
    });
};

export default searchRoutes;
