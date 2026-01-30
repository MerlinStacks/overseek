import Fastify from 'fastify';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import type { ChatService } from '../services/ChatService';

vi.mock('../middleware/auth', () => ({
    requireAuthFastify: async (request: any) => {
        request.user = { id: 'user-1' };
    },
}));

vi.mock('../services/queue/QueueFactory', () => ({
    QueueFactory: {
        createQueue: vi.fn(),
        getQueue: vi.fn(),
    },
    QUEUES: {
        ORDERS: 'sync-orders',
        PRODUCTS: 'sync-products',
        REVIEWS: 'sync-reviews',
        CUSTOMERS: 'sync-customers',
        REPORTS: 'report-generation',
    },
}));

vi.mock('../utils/redis', () => ({
    redisClient: {
        incr: vi.fn(),
        expire: vi.fn(),
        duplicate: vi.fn(() => ({})),
    },
}));

import { createChatRoutes } from './chat';
import syncRoutes from './sync';
import notificationsRoutes from './notifications';

describe('account guard behavior', () => {
    let app: ReturnType<typeof Fastify>;
    let chatService: ChatService;

    beforeEach(async () => {
        app = Fastify();
        chatService = {
            listConversations: vi.fn(),
            createConversation: vi.fn(),
        } as unknown as ChatService;

        await app.register(createChatRoutes(chatService), { prefix: '/api/chat' });
        await app.register(syncRoutes, { prefix: '/api/sync' });
        await app.register(notificationsRoutes, { prefix: '/api/notifications' });
        await app.ready();
    });

    afterEach(async () => {
        await app.close();
        vi.clearAllMocks();
    });

    it('rejects chat conversations list without account', async () => {
        const res = await app.inject({
            method: 'GET',
            url: '/api/chat/conversations',
        });

        expect(res.statusCode).toBe(400);
    });

    it('rejects chat conversation create without account', async () => {
        const res = await app.inject({
            method: 'POST',
            url: '/api/chat/conversations',
            payload: { wooCustomerId: 'cust-1' },
        });

        expect(res.statusCode).toBe(400);
        expect((chatService.createConversation as any).mock.calls.length).toBe(0);
    });

    it('rejects notifications list without account', async () => {
        const res = await app.inject({
            method: 'GET',
            url: '/api/notifications',
        });

        expect(res.statusCode).toBe(400);
    });

    it('rejects sync manual without account', async () => {
        const res = await app.inject({
            method: 'POST',
            url: '/api/sync/manual',
            payload: { types: ['orders'] },
        });

        expect(res.statusCode).toBe(400);
    });

    it('rejects sync order search without account', async () => {
        const res = await app.inject({
            method: 'GET',
            url: '/api/sync/orders/search?q=test',
        });

        expect(res.statusCode).toBe(400);
    });
});
