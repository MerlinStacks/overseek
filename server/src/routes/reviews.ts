/**
 * Reviews Route - Fastify Plugin
 */

import { FastifyPluginAsync } from 'fastify';
import { requireAuthFastify } from '../middleware/auth';
import { ReviewService } from '../services/ReviewService';
import { ReviewAIService } from '../services/ReviewAIService';
import { Logger } from '../utils/logger';

const reviewService = new ReviewService();

function positiveInt(value: string | undefined, fallback: number, max?: number): number {
    const parsed = Number(value);
    const normalized = Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
    return max ? Math.min(normalized, max) : normalized;
}

function reviewErrorStatus(error: unknown): number | null {
    const code = error instanceof Error ? (error as Error & { code?: string }).code : undefined;
    if (code === 'REVIEW_NOT_FOUND') return 404;
    if (code?.startsWith('REVIEW_')) return 400;

    return null;
}

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
                page: positiveInt(page, 1),
                limit: positiveInt(limit, 20, 100),
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
            const { reply: replyText } = request.body || { reply: '' };
            const accountId = request.accountId!;
            const result = await reviewService.replyToReview(accountId, id, replyText);
            return result;
        } catch (error) {
            Logger.error('Error replying to review', { error });
            const status = reviewErrorStatus(error);
            if (status) return reply.code(status).send({ error: error instanceof Error ? error.message : 'Failed to reply to review' });
            return reply.code(500).send({ error: 'Failed to reply to review' });
        }
    });

    // Generate an AI-assisted reply draft for a review.
    fastify.post<{ Params: { id: string }; Body: { currentDraft?: string } }>('/:id/ai-reply', async (request, reply) => {
        try {
            const accountId = request.accountId!;
            const result = await ReviewAIService.generateReply(accountId, request.params.id, request.body?.currentDraft);
            if (result.error) return reply.code(400).send({ error: result.error });
            return { reply: result.reply };
        } catch (error) {
            Logger.error('Error generating review AI reply', { error });
            return reply.code(500).send({ error: 'Failed to generate review reply' });
        }
    });

    // Update review content/rating/status in WooCommerce.
    fastify.patch<{ Params: { id: string }; Body: { status?: string; content?: string; rating?: number } }>('/:id', async (request, reply) => {
        try {
            const accountId = request.accountId!;
            return await reviewService.updateReview(accountId, request.params.id, request.body || {});
        } catch (error) {
            Logger.error('Error updating review', { error });
            const status = reviewErrorStatus(error);
            if (status) return reply.code(status).send({ error: error instanceof Error ? error.message : 'Failed to update review' });
            return reply.code(500).send({ error: 'Failed to update review' });
        }
    });

    // Moderate review status in WooCommerce.
    fastify.post<{ Params: { id: string }; Body: { status: string } }>('/:id/moderate', async (request, reply) => {
        try {
            const accountId = request.accountId!;
            return await reviewService.moderateReview(accountId, request.params.id, request.body?.status || '');
        } catch (error) {
            Logger.error('Error moderating review', { error });
            const status = reviewErrorStatus(error);
            if (status) return reply.code(status).send({ error: error instanceof Error ? error.message : 'Failed to moderate review' });
            return reply.code(500).send({ error: 'Failed to moderate review' });
        }
    });

    fastify.post<{ Body: { ids?: string[]; status: string } }>('/bulk-moderate', async (request, reply) => {
        try {
            const accountId = request.accountId!;
            return await reviewService.bulkModerateReviews(accountId, request.body?.ids || [], request.body?.status || '');
        } catch (error) {
            Logger.error('Error bulk moderating reviews', { error });
            const status = reviewErrorStatus(error);
            if (status) return reply.code(status).send({ error: error instanceof Error ? error.message : 'Failed to moderate reviews' });
            return reply.code(500).send({ error: 'Failed to moderate reviews' });
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
