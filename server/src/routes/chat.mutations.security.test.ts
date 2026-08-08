import Fastify from 'fastify';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ChatService } from '../services/ChatService';

const mocks = vi.hoisted(() => ({
    accountUserFindUnique: vi.fn(),
    createConversation: vi.fn(),
    markAsRead: vi.fn()
}));

vi.mock('../middleware/auth', () => ({
    requireAuthFastify: async (request: any) => {
        request.user = { id: 'viewer-1' };
        request.accountId = 'account-1';
    }
}));

vi.mock('../utils/prisma', () => ({
    prisma: {
        accountUser: { findUnique: mocks.accountUserFindUnique }
    }
}));

vi.mock('../utils/accountFeatures', () => ({
    isAccountFeatureEnabled: vi.fn().mockResolvedValue(true)
}));

vi.mock('../utils/redis', () => ({
    redisClient: {},
    invalidateCache: vi.fn()
}));

import { createChatRoutes } from './chat';

describe('VIEWER conversation mutation enforcement', () => {
    let app: ReturnType<typeof Fastify>;

    beforeEach(async () => {
        vi.clearAllMocks();
        mocks.accountUserFindUnique.mockResolvedValue({ role: 'VIEWER' });
        app = Fastify();
        await app.register(createChatRoutes({
            createConversation: mocks.createConversation,
            markAsRead: mocks.markAsRead
        } as unknown as ChatService));
        await app.ready();
    });

    afterEach(async () => {
        await app.close();
    });

    it('blocks conversation creation before service execution', async () => {
        const response = await app.inject({ method: 'POST', url: '/conversations', payload: {} });

        expect(response.statusCode).toBe(403);
        expect(mocks.createConversation).not.toHaveBeenCalled();
    });

    it('blocks mark-as-read before service execution', async () => {
        const response = await app.inject({ method: 'POST', url: '/conversation-1/read' });

        expect(response.statusCode).toBe(403);
        expect(mocks.markAsRead).not.toHaveBeenCalled();
    });
});
