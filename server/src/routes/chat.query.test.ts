import Fastify from 'fastify';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ChatService } from '../services/ChatService';

const mocks = vi.hoisted(() => ({
    conversationFindMany: vi.fn(),
    labelFindFirst: vi.fn(),
    listConversations: vi.fn(),
    getConversation: vi.fn()
}));

vi.mock('../middleware/auth', () => ({
    requireAuthFastify: async (request: any) => {
        request.user = { id: 'user-1' };
        request.accountId = 'account-1';
    }
}));

vi.mock('../utils/prisma', () => ({
    prisma: {
        conversation: { findMany: mocks.conversationFindMany },
        conversationLabel: { findFirst: mocks.labelFindFirst }
    }
}));

vi.mock('../services/BlockedContactService', () => ({
    BlockedContactService: {
        listBlockedEmails: vi.fn().mockResolvedValue([]),
        isBlocked: vi.fn().mockResolvedValue(false)
    }
}));

vi.mock('../utils/accountFeatures', () => ({
    isAccountFeatureEnabled: vi.fn().mockResolvedValue(true)
}));

import { createChatRoutes } from './chat';

describe('inbox query routes', () => {
    let app: ReturnType<typeof Fastify>;

    beforeEach(async () => {
        vi.clearAllMocks();
        mocks.labelFindFirst.mockResolvedValue({ id: 'label-1' });
        mocks.conversationFindMany.mockResolvedValue([]);
        mocks.listConversations.mockResolvedValue([]);
        mocks.getConversation.mockResolvedValue({
            id: 'conversation-1',
            messages: [],
            hasMoreMessages: false,
            nextMessageCursor: null
        });

        app = Fastify();
        await app.register(createChatRoutes({
            listConversations: mocks.listConversations,
            getConversation: mocks.getConversation
        } as unknown as ChatService));
        await app.ready();
    });

    afterEach(async () => {
        await app.close();
    });

    it('honors search assignment and label filters and returns labels', async () => {
        const result = {
            id: 'conversation-1',
            updatedAt: new Date('2026-01-01T00:00:00.000Z'),
            labels: [{ label: { id: 'label-1', name: 'VIP', color: '#fff' } }]
        };
        mocks.conversationFindMany.mockResolvedValueOnce([result]).mockResolvedValueOnce([]);

        const response = await app.inject({
            method: 'GET',
            url: '/conversations/search?q=customer&assignedTo=user-2&labelId=label-1&limit=10'
        });

        expect(response.statusCode).toBe(200);
        expect(mocks.labelFindFirst).toHaveBeenCalledWith({
            where: { id: 'label-1', accountId: 'account-1' },
            select: { id: true }
        });
        expect(mocks.conversationFindMany).toHaveBeenCalledWith(expect.objectContaining({
            where: expect.objectContaining({
                accountId: 'account-1',
                assignedTo: 'user-2',
                labels: { some: { labelId: 'label-1' } },
                mergedIntoId: null
            }),
            include: expect.objectContaining({ labels: expect.any(Object) }),
            take: 10
        }));
        expect(response.json().results[0].labels).toEqual([
            { id: 'label-1', name: 'VIP', color: '#fff' }
        ]);
    });

    it('rejects a label owned by another account', async () => {
        mocks.labelFindFirst.mockResolvedValueOnce(null);

        const response = await app.inject({
            method: 'GET',
            url: '/conversations/search?q=customer&labelId=foreign-label'
        });

        expect(response.statusCode).toBe(400);
        expect(mocks.conversationFindMany).not.toHaveBeenCalled();
    });

    it.each([
        '/conversations?limit=nope',
        '/conversations?limit=0',
        '/conversations/search?q=customer&limit=2.5',
        '/conversation-1?limit=-1'
    ])('rejects invalid numeric limits for %s', async (url) => {
        const response = await app.inject({ method: 'GET', url });
        expect(response.statusCode).toBe(400);
    });

    it('forwards an older-message cursor and preserves pagination metadata', async () => {
        mocks.getConversation.mockResolvedValueOnce({
            id: 'conversation-1',
            messages: [{ id: 'message-1' }],
            hasMoreMessages: true,
            nextMessageCursor: 'next-opaque-cursor'
        });

        const response = await app.inject({
            method: 'GET',
            url: '/conversation-1?limit=25&before=opaque-cursor'
        });

        expect(response.statusCode).toBe(200);
        expect(mocks.getConversation).toHaveBeenCalledWith('account-1', 'conversation-1', {
            messageLimit: 25,
            before: 'opaque-cursor'
        });
        expect(response.json()).toMatchObject({
            hasMoreMessages: true,
            nextMessageCursor: 'next-opaque-cursor'
        });
    });
});
