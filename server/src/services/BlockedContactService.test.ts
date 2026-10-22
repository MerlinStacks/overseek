import { beforeEach, expect, it, vi } from 'vitest';
const m = vi.hoisted(() => ({ find: vi.fn(), upsert: vi.fn(), remove: vi.fn(), list: vi.fn(), receipt: { findUnique: vi.fn(), create: vi.fn(), upsert: vi.fn() }, conversation: { findFirst: vi.fn(), updateMany: vi.fn() }, invalidate: vi.fn(), transaction: vi.fn() }));
vi.mock('../utils/prisma', () => ({ prisma: { blockedContact: { findUnique: m.find, findMany: m.list }, $transaction: m.transaction } }));
vi.mock('../utils/cache', () => ({ invalidateCache: m.invalidate }));
vi.mock('../utils/logger', () => ({ Logger: { warn: vi.fn() } }));
import { BlockedContactService, canonicalBlockedEmail } from './BlockedContactService';
const operationId = '58205113-2154-4f77-a486-7ff9d5671d92';
beforeEach(() => { vi.resetAllMocks(); m.transaction.mockImplementation(fn => fn({ $queryRaw: vi.fn(), blockedContact: { findUnique: m.find, upsert: m.upsert, deleteMany: m.remove }, scopedOperation: m.receipt, conversation: m.conversation })); m.find.mockResolvedValue(null); m.receipt.findUnique.mockResolvedValue(null); });
it('uses authoritative normalized exact identities and propagates unavailable decisions', async () => {
    expect(canonicalBlockedEmail(' User@Example.com ')).toBe('user@example.com');
    expect(() => canonicalBlockedEmail('social-id')).toThrow();
    m.find.mockResolvedValueOnce({ id: 'blocked' }); expect(await BlockedContactService.isBlocked('a', 'USER@example.com')).toBe(true);
    m.find.mockRejectedValueOnce(new Error('DB unavailable')); await expect(BlockedContactService.isBlocked('a', 'user@example.com')).rejects.toThrow('DB unavailable');
});
it('commits acknowledgement independent of later cache failure and replays one actor/payload', async () => {
    m.invalidate.mockRejectedValue(new Error('cache down'));
    const command = { operationId, version: null };
    const result = await BlockedContactService.blockContact('a', 'user@example.com', 'u', 'reason', command);
    expect(result).toMatchObject({ success: true, blocked: true });
    m.receipt.findUnique.mockResolvedValue(m.receipt.create.mock.calls[0][0].data);
    expect(await BlockedContactService.blockContact('a', 'user@example.com', 'u', 'reason', command)).toEqual(result);
    expect(m.upsert).toHaveBeenCalledOnce();
    await expect(BlockedContactService.blockContact('a', 'user@example.com', 'other', 'reason', command)).rejects.toThrow('changed');
});
it('requires block/conversation versions and never conflates social IDs with emails', async () => {
    m.find.mockResolvedValue({ blockedAt: new Date('2026-01-01T00:00:00Z') });
    await expect(BlockedContactService.unblockContact('a', 'user@example.com', 'u', { operationId, version: null })).rejects.toThrow('changed');
    expect(m.remove).not.toHaveBeenCalled();
    m.find.mockResolvedValue(null); m.conversation.findFirst.mockResolvedValue({ updatedAt: new Date('2026-01-01T00:00:00Z'), externalConversationId: 'social' });
    await expect(BlockedContactService.blockContact('a', 'user@example.com', 'u', '', { operationId, version: null, conversationVersion: '2026-01-01T00:00:00.000Z' }, 'conversation')).rejects.toThrow();
    expect(m.conversation.updateMany).not.toHaveBeenCalled();
});
it('retains absent-state tombstones so an old null-version command cannot recreate a removed block', async () => {
    m.receipt.findUnique.mockResolvedValueOnce(null).mockResolvedValueOnce({ result: { version: '2026-01-01T00:00:00.000Z' } });
    await expect(BlockedContactService.blockContact('a', 'user@example.com', 'u', '', { operationId, version: null })).rejects.toThrow('changed');
    expect(m.upsert).not.toHaveBeenCalled();
});
