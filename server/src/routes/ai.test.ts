import Fastify, { type FastifyInstance, type FastifyReply, type FastifyRequest } from 'fastify';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
    generateResponse: vi.fn(), getModels: vi.fn(), findUnique: vi.fn(),
    authenticated: true, accountId: 'tenant-1' as string | undefined,
}));
vi.mock('../services/ai', () => ({ AIService: { generateResponse: mocks.generateResponse, getModels: mocks.getModels } }));
vi.mock('../utils/prisma', () => ({ prisma: { account: { findUnique: mocks.findUnique } } }));
vi.mock('../utils/logger', () => ({ Logger: { error: vi.fn() } }));
vi.mock('../middleware/auth', () => ({
    requireAuthFastify: async (request: FastifyRequest, reply: FastifyReply) => {
        if (!mocks.authenticated) return reply.code(401).send({ error: 'Unauthorized' });
        request.accountId = mocks.accountId;
    },
}));

import aiRoutes from './ai';

describe('AI routes', () => {
    let app: FastifyInstance;
    beforeEach(async () => {
        vi.resetAllMocks();
        mocks.authenticated = true;
        mocks.accountId = 'tenant-1';
        mocks.generateResponse.mockResolvedValue({ message: 'Response', tools: [] });
        mocks.getModels.mockResolvedValue([{ id: 'model-1' }]);
        mocks.findUnique.mockResolvedValue({ openRouterApiKey: 'tenant-api-key' });
        app = Fastify();
        await app.register(aiRoutes, { prefix: '/api/ai' });
    });
    afterEach(async () => { await app.close(); });

    it.each([
        null, [], 'invalid', 1, true, {}, { message: null }, { message: 42 }, { message: true },
        { message: {} }, { message: [] }, { message: '' }, { message: '  \n\t' },
    ])('rejects malformed or blank chat input before calling the AI service: %j', async payload => {
        const response = await app.inject({
            method: 'POST', url: '/api/ai/chat', headers: { 'content-type': 'application/json' },
            payload: JSON.stringify(payload),
        });
        expect(response.statusCode).toBe(400);
        expect(response.json()).toEqual({ error: 'Message required' });
        expect(mocks.generateResponse).not.toHaveBeenCalled();
    });

    it('returns 400 rather than 500 when the request body is missing', async () => {
        const response = await app.inject({ method: 'POST', url: '/api/ai/chat' });
        expect(response.statusCode).toBe(400);
        expect(response.json()).toEqual({ error: 'Message required' });
        expect(mocks.generateResponse).not.toHaveBeenCalled();
    });

    it('preserves valid message whitespace, context and service results', async () => {
        const message = '  Explain this order\nplease  ';
        const context = { path: '/orders/123', additional: 'preserve' };
        const response = await app.inject({ method: 'POST', url: '/api/ai/chat', payload: { message, context } });
        expect(response.statusCode).toBe(200);
        expect(mocks.generateResponse).toHaveBeenCalledExactlyOnceWith(message, 'tenant-1', context);
        expect(response.json()).toEqual({ message: 'Response', tools: [] });
    });

    it('accepts valid messages without context', async () => {
        const response = await app.inject({ method: 'POST', url: '/api/ai/chat', payload: { message: 'Hello' } });
        expect(response.statusCode).toBe(200);
        expect(mocks.generateResponse).toHaveBeenCalledWith('Hello', 'tenant-1', undefined);
    });

    it('preserves the missing-account guard', async () => {
        mocks.accountId = undefined;
        const response = await app.inject({ method: 'POST', url: '/api/ai/chat', payload: { message: 'Hello' } });
        expect(response.statusCode).toBe(400);
        expect(response.json()).toEqual({ error: 'Account ID required' });
        expect(mocks.generateResponse).not.toHaveBeenCalled();
    });

    it.each(['GET' as const, 'POST' as const])('runs authentication before %s handling', async method => {
        mocks.authenticated = false;
        const response = await app.inject({ method, url: method === 'GET' ? '/api/ai/models' : '/api/ai/chat' });
        expect(response.statusCode).toBe(401);
        expect(mocks.generateResponse).not.toHaveBeenCalled();
        expect(mocks.getModels).not.toHaveBeenCalled();
        expect(mocks.findUnique).not.toHaveBeenCalled();
    });

    it('preserves generic chat failure responses without leaking provider errors', async () => {
        mocks.generateResponse.mockRejectedValue(new Error('Private provider detail'));
        const response = await app.inject({ method: 'POST', url: '/api/ai/chat', payload: { message: 'Hello' } });
        expect(response.statusCode).toBe(500);
        expect(response.json()).toEqual({ error: 'Failed to generate response' });
    });

    it('lists models using only the selected tenant API key', async () => {
        const response = await app.inject({ method: 'GET', url: '/api/ai/models' });
        expect(response.statusCode).toBe(200);
        expect(response.json()).toEqual([{ id: 'model-1' }]);
        expect(mocks.findUnique).toHaveBeenCalledExactlyOnceWith({ where: { id: 'tenant-1' }, select: { openRouterApiKey: true } });
        expect(mocks.getModels).toHaveBeenCalledExactlyOnceWith('tenant-api-key');
    });

    it.each([null, { openRouterApiKey: null }, { openRouterApiKey: '' }])('preserves model-list fallback when tenant credentials are absent: %j', async account => {
        mocks.findUnique.mockResolvedValue(account);
        const response = await app.inject({ method: 'GET', url: '/api/ai/models' });
        expect(response.statusCode).toBe(200);
        expect(mocks.getModels).toHaveBeenCalledExactlyOnceWith('');
    });

    it('preserves model listing without a selected account and avoids an unscoped lookup', async () => {
        mocks.accountId = undefined;
        const response = await app.inject({ method: 'GET', url: '/api/ai/models' });
        expect(response.statusCode).toBe(200);
        expect(mocks.findUnique).not.toHaveBeenCalled();
        expect(mocks.getModels).toHaveBeenCalledExactlyOnceWith('');
    });

    it.each(['database', 'provider'])('preserves generic model-list errors for %s failures', async source => {
        if (source === 'database') mocks.findUnique.mockRejectedValue(new Error('Private database detail'));
        else mocks.getModels.mockRejectedValue(new Error('Private provider detail'));
        const response = await app.inject({ method: 'GET', url: '/api/ai/models' });
        expect(response.statusCode).toBe(500);
        expect(response.json()).toEqual({ error: 'Failed to fetch models' });
    });
});
