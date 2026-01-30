/**
 * Reviews Route - Fastify Plugin
 */

import { FastifyPluginAsync } from 'fastify';
import { requireAuthFastify } from '../middleware/auth';
import { ReviewService } from '../services/ReviewService';
import { Logger } from '../utils/logger';

const reviewService = new ReviewService();

const reviewsRoutes: FastifyPluginAsync = async (fastify) => {
    // Apply auth to all routes
    fastify.addHook('preHandler', requireAuthFastify);

    // Get all reviews
    fastify.get('/', async (request, reply) => {
        try {
            const { page, limit, status, search } = request.query as {
                page?: string;
                limit?: string;
                status?: string;
                search?: string;
            };
            const accountId = request.accountId!;
            const result = await reviewService.getReviews(accountId, {
                page: Number(page),
                limit: Number(limit),
                status: status,
                search: search
            });
            return result;
        } catch (error) {
            Logger.error('Error fetching reviews', { error });
            return reply.code(500).send({ error: 'Failed to fetch reviews' });
        }
    });

    // Reply to a review
    fastify.post<{ Params: { id: string }; Body: { reply: string } }>('/:id/reply', async (request, reply) => {
        try {
            const { id } = request.params;
            const { reply: replyText } = request.body;
            const accountId = request.accountId!;
            const result = await reviewService.replyToReview(accountId, id, replyText);
            return result;
        } catch (error) {
            Logger.error('Error replying to review', { error });
            return reply.code(500).send({ error: 'Failed to reply to review' });
        }
    });

    // Rematch all reviews to orders
    fastify.post('/rematch-all', async (request, reply) => {
        try {
            const accountId = request.accountId!;
            Logger.info('Starting review-order rematch', { accountId });
            const result = await reviewService.rematchAllReviews(accountId);
            Logger.info('Review-order rematch complete', { accountId, ...result });
            return result;
        } catch (error) {
            Logger.error('Error during review rematch', { error });
            return reply.code(500).send({ error: 'Failed to rematch reviews' });
        }
    });
};

export default reviewsRoutes;
