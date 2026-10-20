import Fastify from 'fastify';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import type { ChatService } from '../services/ChatService';

const mocks = vi.hoisted(() => ({
    accountId: undefined as string | undefined,
    notifications: vi.fn(), unreadCount: vi.fn(), runSync: vi.fn(), searchOrders: vi.fn(),
}));
vi.mock('../utils/prisma', () => ({ prisma: { notification: { findMany: mocks.notifications, count: mocks.unreadCount } } }));
vi.mock('../services/sync', () => ({ SyncService: class { runSync = mocks.runSync; } }));
vi.mock('../services/search/SearchQueryService', () => ({ SearchQueryService: { searchOrders: mocks.searchOrders } }));
vi.mock('../utils/accountFeatures', () => ({ isAccountFeatureEnabled: vi.fn(async () => true) }));

vi.mock('../middleware/auth', () => ({
    requireAuthFastify: async (request: any) => {
        request.user = { id: 'user-1' };
        request.accountId = mocks.accountId;
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
        vi.clearAllMocks();
        mocks.accountId = undefined;
        mocks.notifications.mockResolvedValue([]);
        mocks.unreadCount.mockResolvedValue(0);
        mocks.runSync.mockResolvedValue(undefined);
        mocks.searchOrders.mockResolvedValue({ orders: [], total: 0 });
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
        expect(res.json()).toEqual({ error: 'Account ID required' });
        expect(chatService.listConversations).not.toHaveBeenCalled();
    });

    it('rejects chat conversation create without account', async () => {
        const res = await app.inject({
            method: 'POST',
            url: '/api/chat/conversations',
            payload: { wooCustomerId: 'cust-1' },
        });

        expect(res.statusCode).toBe(400);
        expect(res.json()).toEqual({ error: 'Account ID required' });
        expect((chatService.createConversation as any).mock.calls.length).toBe(0);
    });

    it('rejects notifications list without account', async () => {
        const res = await app.inject({
            method: 'GET',
            url: '/api/notifications',
        });

        expect(res.statusCode).toBe(400);
        expect(res.json()).toEqual({ error: 'Account ID and user required' });
        expect(mocks.notifications).not.toHaveBeenCalled();
        expect(mocks.unreadCount).not.toHaveBeenCalled();
    });

    it('rejects sync manual without account', async () => {
        const res = await app.inject({
            method: 'POST',
            url: '/api/sync/manual',
            payload: { types: ['orders'] },
        });

        expect(res.statusCode).toBe(400);
        expect(res.json()).toEqual({ error: 'accountId is required' });
        expect(mocks.runSync).not.toHaveBeenCalled();
    });

    it('rejects sync order search without account', async () => {
        const res = await app.inject({
            method: 'GET',
            url: '/api/sync/orders/search?q=test',
        });

        expect(res.statusCode).toBe(400);
        expect(mocks.searchOrders).not.toHaveBeenCalled();
        expect(res.json()).toEqual({ error: 'accountId is required' });
    });

    it('forwards the authenticated account to chat listing instead of query input', async () => {
        mocks.accountId = 'tenant-1';
        vi.mocked(chatService.listConversations).mockResolvedValue([]);
        const response = await app.inject({ method: 'GET', url: '/api/chat/conversations?accountId=other-tenant' });
        expect(response.statusCode).toBe(200);
        expect(chatService.listConversations).toHaveBeenCalledWith('tenant-1', undefined, undefined, 51, undefined,
            { wooCustomerId: undefined, guestEmail: undefined, sort: 'updated' });
    });

    it('scopes notification queries to the authenticated account and user', async () => {
        mocks.accountId = 'tenant-1';
        const response = await app.inject({ method: 'GET', url: '/api/notifications?accountId=other-tenant' });
        expect(response.statusCode).toBe(200);
        expect(mocks.notifications).toHaveBeenCalledWith(expect.objectContaining({
            where: { accountId: 'tenant-1' }, include: { reads: { where: { userId: 'user-1' }, select: { id: true } } },
        }));
        expect(mocks.unreadCount).toHaveBeenCalledWith(expect.objectContaining({
            where: expect.objectContaining({ accountId: 'tenant-1', reads: { none: { userId: 'user-1' } } }),
        }));
    });

    it('rejects a conflicting sync account without starting any work', async () => {
        mocks.accountId = 'tenant-1';
        const response = await app.inject({ method: 'POST', url: '/api/sync/manual', payload: { accountId: 'other-tenant', types: ['orders'] } });
        expect(response.statusCode).toBe(400);
        expect(response.json()).toEqual({ error: 'accountId mismatch' });
        expect(mocks.runSync).not.toHaveBeenCalled();
    });

    it('starts sync for the selected account', async () => {
        mocks.accountId = 'tenant-1';
        const response = await app.inject({ method: 'POST', url: '/api/sync/manual', payload: { types: ['orders'] } });
        expect(response.statusCode).toBe(200);
        expect(mocks.runSync).toHaveBeenCalledWith('tenant-1', { types: ['orders'], incremental: true, triggerSource: 'MANUAL' });
    });

    it('scopes order searches to the selected account instead of query input', async () => {
        mocks.accountId = 'tenant-1';
        const response = await app.inject({ method: 'GET', url: '/api/sync/orders/search?q=mug&accountId=other-tenant' });
        expect(response.statusCode).toBe(200);
        expect(mocks.searchOrders).toHaveBeenCalledWith('tenant-1', 'mug', 1, 50, undefined, undefined);
    });
});
