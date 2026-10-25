import Fastify from 'fastify';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';

const m = vi.hoisted(() => ({
    conversation: { findFirst: vi.fn(), updateMany: vi.fn() },
    blockedContact: { findUnique: vi.fn(), upsert: vi.fn() },
    scopedOperation: { findUnique: vi.fn(), upsert: vi.fn(), create: vi.fn() },
    transaction: vi.fn(),
}));
vi.mock('../../middleware/auth', () => ({ requireAuthFastify: async (request: any) => {
    request.user = { id: 'agent', isSuperAdmin: true };
    request.accountId = 'account';
} }));
vi.mock('../../services/PermissionService', () => ({ PermissionService: { hasPermission: vi.fn().mockResolvedValue(true) } }));
vi.mock('../../utils/prisma', () => ({ prisma: { ...m, $transaction: m.transaction } }));
vi.mock('../../utils/cache', () => ({ invalidateCache: vi.fn() }));
import { blockedContactRoutes } from './blockedContacts';

let app: ReturnType<typeof Fastify>;
beforeEach(async () => {
    vi.clearAllMocks();
    m.conversation.findFirst.mockResolvedValue({ id: 'conversation', guestEmail: 'Customer@Example.com', updatedAt: new Date('2026-01-01T00:00:00.000Z') });
    m.conversation.updateMany.mockResolvedValue({ count: 1 });
    m.blockedContact.findUnique.mockResolvedValue(null);
    m.scopedOperation.findUnique.mockResolvedValue(null);
    m.transaction.mockImplementation(fn => fn({ ...m, $queryRaw: vi.fn() }));
    app = Fastify();
    await app.register(blockedContactRoutes, { prefix: '/api/chat' });
});
afterEach(async () => app.close());

it('accepts the desktop preflight and block payload and closes the scoped conversation', async () => {
    const read = await app.inject({ method: 'GET', url: '/api/chat/conversation/block-state' });
    expect(read.statusCode).toBe(200);
    const { accountId, ...observed } = read.json();
    expect(accountId).toBe('account');
    const result = await app.inject({ method: 'POST', url: '/api/chat/conversation/block', payload: {
        ...observed, operationId: '58205113-2154-4f77-a486-7ff9d5671d92', reason: 'Blocked from inbox',
    } });
    expect(result.statusCode).toBe(200);
    expect(result.json()).toMatchObject({ success: true, accountId: 'account', email: 'customer@example.com', blocked: true });
    expect(m.conversation.updateMany).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ id: 'conversation', accountId: 'account' }), data: { status: 'CLOSED' } }));
    expect(m.blockedContact.upsert).toHaveBeenCalledOnce();
});
