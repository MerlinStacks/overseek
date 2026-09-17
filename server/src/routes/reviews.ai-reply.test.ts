import Fastify from 'fastify';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { generateReply } = vi.hoisted(() => ({ generateReply: vi.fn() }));
vi.mock('../services/ReviewAIService', () => ({ ReviewAIService: { generateReply } }));
vi.mock('../services/ReviewService', () => ({ ReviewService: class {}, REVIEWER_NAME_DISPLAYS: [], REVIEW_MODERATION_MODES: [] }));
vi.mock('../utils/prisma', () => ({ prisma: {} }));
vi.mock('../utils/logger', () => ({ Logger: { error: vi.fn() } }));
vi.mock('../middleware/auth', () => ({ requireAuthFastify: async (request: any) => { request.accountId = 'account-1'; } }));

import reviewsRoutes from './reviews';

describe('POST /reviews/:id/ai-reply', () => {
    let app: ReturnType<typeof Fastify>;
    const replies = ['First reply', 'Second reply', 'Third reply'];

    beforeEach(async () => {
        vi.resetAllMocks();
        generateReply.mockResolvedValue({ replies });
        app = Fastify();
        await app.register(reviewsRoutes, { prefix: '/reviews' });
        await app.ready();
    });
    afterEach(async () => { await app.close(); });

    it.each([undefined, {}, { currentDraft: 'Draft', previousReplies: replies }, { currentDraft: '', previousReplies: [] }, { currentDraft: 'd'.repeat(12000), previousReplies: Array(3).fill('p'.repeat(4000)) }])('accepts omitted or valid body %#', async (body) => {
        const response = await app.inject({ method: 'POST', url: '/reviews/review-1/ai-reply', payload: body });
        expect(response.statusCode).toBe(200);
        expect(response.json()).toEqual({ replies });
        expect(generateReply).toHaveBeenCalledWith('account-1', 'review-1', body?.currentDraft, body?.previousReplies);
    });

    it.each([
        null, [], 'text', 12, true,
        { currentDraft: null }, { currentDraft: 12 }, { currentDraft: {} }, { currentDraft: [] }, { currentDraft: 'd'.repeat(12001) },
        { previousReplies: null }, { previousReplies: 'text' }, { previousReplies: {} },
        { previousReplies: ['a', 'b', 'c', 'd'] }, { previousReplies: ['p'.repeat(4001)] },
        { previousReplies: [null] }, { previousReplies: [1] }, { previousReplies: [{}] }
    ])('rejects invalid input before calling the service %#', async (body) => {
        const response = await app.inject({ method: 'POST', url: '/reviews/review-1/ai-reply', headers: { 'content-type': 'application/json' }, payload: JSON.stringify(body) });
        expect(response.statusCode).toBe(400);
        expect(response.json()).toHaveProperty('error');
        expect(generateReply).not.toHaveBeenCalled();
    });

    it('returns service errors without suggestions', async () => {
        generateReply.mockResolvedValue({ replies: [], error: 'Invalid model output' });
        const response = await app.inject({ method: 'POST', url: '/reviews/review-1/ai-reply' });
        expect(response.statusCode).toBe(400);
        expect(response.json()).toEqual({ error: 'Invalid model output' });
    });

    it('handles unexpected service failures', async () => {
        generateReply.mockRejectedValue(new Error('failure'));
        const response = await app.inject({ method: 'POST', url: '/reviews/review-1/ai-reply' });
        expect(response.statusCode).toBe(500);
        expect(response.json()).toEqual({ error: 'Failed to generate review reply' });
    });
});
