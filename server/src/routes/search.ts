/**
 * Search Route - Fastify Plugin
 */

import { FastifyPluginAsync } from 'fastify';
import { SearchQueryService } from '../services/search/SearchQueryService';
import { EmbeddingService } from '../services/EmbeddingService';
import { requireAuthFastify } from '../middleware/auth';
import { Logger } from '../utils/logger';

const searchRoutes: FastifyPluginAsync = async (fastify) => {
    fastify.addHook('preHandler', requireAuthFastify);

    fastify.get('/global', async (request, reply) => {
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
    fastify.get('/semantic', async (request, reply) => {
        try {
            const accountId = request.accountId;
            const { q, limit } = request.query as { q?: string; limit?: string };

            if (!accountId) return reply.code(400).send({ error: 'No account' });
            if (!q) return reply.code(400).send({ error: 'Query required' });

            const results = await EmbeddingService.semanticSearch(
                accountId,
                q,
                parseInt(limit || '10')
            );

            return results;
        } catch (error) {
            Logger.error('Semantic search failed', { error });
            return reply.code(500).send({ error: 'Semantic search failed' });
        }
    });

    // Find similar products
    fastify.get<{ Params: { productId: string } }>('/similar/:productId', async (request, reply) => {
        try {
            const accountId = request.accountId;
            const { productId } = request.params;
            const { limit } = request.query as { limit?: string };

            if (!accountId) return reply.code(400).send({ error: 'No account' });

            const results = await EmbeddingService.findSimilarProducts(
                productId,
                accountId,
                parseInt(limit || '5')
            );

            return results;
        } catch (error) {
            Logger.error('Similar products search failed', { error });
            return reply.code(500).send({ error: 'Similar products search failed' });
        }
    });

    // Batch generate embeddings (admin only)
    fastify.post<{ Body: { limit?: number } }>('/embeddings/generate', async (request, reply) => {
        try {
            const accountId = request.accountId;
            const { limit } = request.body;

            if (!accountId) return reply.code(400).send({ error: 'No account' });

            const updated = await EmbeddingService.batchUpdateEmbeddings(
                accountId,
                limit || 100
            );

            return { success: true, updated };
        } catch (error) {
            Logger.error('Embedding generation failed', { error });
            return reply.code(500).send({ error: 'Embedding generation failed' });
        }
    });
};

export default searchRoutes;
