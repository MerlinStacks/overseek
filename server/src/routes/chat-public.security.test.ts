import Fastify from 'fastify';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { prismaMock } = vi.hoisted(() => ({
    prismaMock: {
        conversation: {
            findFirst: vi.fn(),
            create: vi.fn(),
            update: vi.fn(),
        },
        wooCustomer: { findFirst: vi.fn() },
    },
}));

vi.mock('../utils/prisma', () => ({ prisma: prismaMock }));

import { createPublicChatRoutes } from './chat-public';

describe('public chat customer data', () => {
    let app: ReturnType<typeof Fastify>;

    beforeEach(async () => {
        app = Fastify();
        await app.register(createPublicChatRoutes({ addMessage: vi.fn() } as any));
        await app.ready();
    });

    afterEach(async () => {
        await app.close();
        vi.clearAllMocks();
    });

    it('does not disclose a linked Woo customer in conversation responses', async () => {
        prismaMock.conversation.findFirst.mockResolvedValue({
            id: 'conversation-1',
            accountId: 'account-1',
            visitorToken: 'visitor-1',
            wooCustomerId: 'customer-1',
            wooCustomer: {
                id: 'customer-1',
                firstName: 'Private',
                lastName: 'Customer',
                email: 'customer@example.com',
                totalSpent: 1234,
                ordersCount: 12,
            },
            messages: [{
                id: 'message-1',
                conversationId: 'conversation-1',
                content: 'Visible reply',
                contentType: 'TEXT',
                senderType: 'AGENT',
                senderId: 'user-1',
                isInternal: false,
                emailMessageId: '<private@example.com>',
                createdAt: new Date(0),
            }],
            guestEmail: 'customer@example.com',
        });

        const response = await app.inject({
            method: 'POST',
            url: '/conversation',
            payload: {
                accountId: 'account-1',
                visitorToken: 'visitor-1',
                email: 'customer@example.com',
            },
        });

        expect(response.statusCode).toBe(200);
        expect(response.json()).not.toHaveProperty('wooCustomerId');
        expect(response.json()).not.toHaveProperty('wooCustomer');
        expect(response.json()).not.toHaveProperty('visitorToken');
        expect(response.json()).not.toHaveProperty('guestEmail');
        expect(response.json().messages[0]).toEqual({
            id: 'message-1',
            content: 'Visible reply',
            contentType: 'TEXT',
            senderType: 'AGENT',
            createdAt: new Date(0).toISOString(),
        });
    });
});
