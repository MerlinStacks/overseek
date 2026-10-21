import { beforeEach, describe, expect, it, vi } from 'vitest';
const m = vi.hoisted(() => ({ user: vi.fn(), subscriptions: vi.fn(), updateMany: vi.fn(), deleteMany: vi.fn(), upsert: vi.fn(), credential: vi.fn(), send: vi.fn(), transaction: vi.fn() }));
vi.mock('../utils/prisma', () => ({ prisma: { user: { findFirst: m.user }, pushSubscription: { findFirst: m.subscriptions, findMany: m.subscriptions, updateMany: m.updateMany, deleteMany: m.deleteMany, upsert: m.upsert }, platformCredentials: { findUnique: m.credential }, $transaction: m.transaction } }));
vi.mock('../utils/logger', () => ({ Logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } }));
vi.mock('web-push', () => ({ default: { setVapidDetails: vi.fn(), sendNotification: m.send } }));
import { PushNotificationService as service } from './PushNotificationService';
beforeEach(() => { vi.resetAllMocks(); service.clearCredentialsCache(); m.credential.mockResolvedValue({ credentials: { publicKey: 'public', privateKey: 'private' } }); m.user.mockResolvedValue({ id: 'u' }); m.send.mockResolvedValue({ statusCode: 201 }); m.updateMany.mockResolvedValue({ count: 1 }); });
describe('push subscription and delivery scope', () => {
    it('scopes device lookup by user, account and endpoint', async () => {
        m.subscriptions.mockResolvedValue(null); expect(await service.getSubscription('u', 'a', 'https://push.test/device')).toEqual({ isSubscribed: false }); expect(m.subscriptions).toHaveBeenCalledWith({ where: { userId: 'u', accountId: 'a', endpoint: 'https://push.test/device' } });
    });
    it('returns false when no preference row matches, while preserving explicit false updates', async () => {
        m.updateMany.mockResolvedValue({ count: 0 }); expect(await service.updatePreferences('u', 'endpoint', { notifyNewOrders: false }, 'a')).toBe(false);
        expect(m.updateMany).toHaveBeenCalledWith({ where: { userId: 'u', accountId: 'a', endpoint: 'endpoint' }, data: { notifyNewOrders: false } });
    });
    it('does not deliver account messages to a removed member', async () => {
        m.subscriptions.mockResolvedValue([{ id: 'sub', userId: 'u', endpoint: 'https://push.test/device', p256dh: 'p', auth: 'a' }]); m.user.mockResolvedValue(null);
        expect(await service.sendToAccount('a', { title: 'Order', body: 'Private' }, 'order')).toEqual({ sent: 0, failed: 1 }); expect(m.send).not.toHaveBeenCalled();
    });
    it('uses a network timeout and reports the measured provider outcome', async () => {
        m.subscriptions.mockResolvedValue([{ id: 'sub', userId: 'u', endpoint: 'https://push.test/device', p256dh: 'p', auth: 'a' }]);
        expect(await service.sendToAccount('a', { title: 'Order', body: 'Private' }, 'order')).toEqual({ sent: 1, failed: 0 }); expect(m.send.mock.calls[0][2]).toEqual({ timeout: 10000 });
    });
    it('checks account access before transferring device ownership', async () => {
        m.user.mockResolvedValue(null); expect(await service.subscribe('u', 'a', { endpoint: 'https://push.test/device', keys: { p256dh: 'p', auth: 'a' } })).toMatchObject({ success: false }); expect(m.transaction).not.toHaveBeenCalled();
    });
    it('does not repopulate deleted credentials from an old in-flight cache read', async () => {
        let resolve!: (value: unknown) => void; m.credential.mockReturnValueOnce(new Promise(r => { resolve = r; })).mockResolvedValue(null);
        const pending = service.getVapidPublicKey(); service.clearCredentialsCache(); resolve({ credentials: { publicKey: 'obsolete', privateKey: 'obsolete-private' } }); expect(await pending).toBeNull(); expect(m.credential).toHaveBeenCalledTimes(2);
    });
});
