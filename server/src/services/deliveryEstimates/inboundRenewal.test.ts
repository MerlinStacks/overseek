import { beforeEach, describe, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ find: vi.fn(), claim: vi.fn(), configured: vi.fn(), dirty: vi.fn(), lock: vi.fn() }));
vi.mock('../../utils/prisma', () => {
    const tx = { deliveryInputSync: { findMany: mocks.find, updateMany: mocks.claim }, wooProduct: { findFirst: mocks.configured } };
    return { prisma: { ...tx, $transaction: (fn: any) => fn(tx) } };
});
vi.mock('./intents', async original => ({ ...await original<typeof import('./intents')>(), lockDeliveryAccount: mocks.lock, dirtyInboundProducts: mocks.dirty }));
import { renewInboundInputs } from './inboundRenewal';

describe('indexed inbound renewal', () => {
    const now = new Date('2026-09-22T12:00:00Z');
    let rows: any[];
    beforeEach(() => {
        vi.resetAllMocks();
        rows = Array.from({ length: 100 }, (_, n) => ({ id: `${n}`, accountId: 'a', entityId: n + 1, desiredRevision: 4n, status: 'synced', inboundRenewAt: new Date(now.getTime() - 86_400_000), enabled: true, supported: true }));
        mocks.find.mockImplementation(async ({ where, take }) => {
            expect(where).toMatchObject({ scope: 'inbound', status: 'synced', inboundRenewAt: { lte: now }, account: {
                features: { none: { featureKey: 'DELIVERY_ESTIMATES', isEnabled: false } },
                deliverySyncAccount: { is: { capabilityStatus: 'supported', inboundCapabilityStatus: 'supported', inboundFailed: false } },
            } });
            return rows.filter(row => row.status === 'synced' && row.inboundRenewAt && row.inboundRenewAt <= now && row.enabled && row.supported).slice(0, take);
        });
        mocks.claim.mockImplementation(async ({ where, data }) => {
            const row = rows.find(r => r.id === where.id);
            if (!row || row.desiredRevision !== where.desiredRevision || !row.inboundRenewAt || !row.enabled || !row.supported) return { count: 0 };
            Object.assign(row, data); return { count: 1 };
        });
        mocks.configured.mockResolvedValue({ id: 'configured' });
    });
    it('caps an already-expired backlog at forty, atomically claims once and only queues async targets', async () => {
        await renewInboundInputs(now, 10000);
        expect(mocks.dirty).toHaveBeenCalledTimes(40);
        expect(mocks.find.mock.calls[0][0]).toMatchObject({ take: 40, orderBy: [{ inboundRenewAt: 'asc' }, { id: 'asc' }] });
        await renewInboundInputs(now, 10000);
        expect(mocks.dirty).toHaveBeenCalledTimes(80);
        expect(new Set(mocks.dirty.mock.calls.map(call => call[2][0])).size).toBe(80);
        expect(rows.every(row => row.desiredRevision === 4n)).toBe(true);
    });
    it('parks unsupported/disabled accounts and never renews pending transport retries', async () => {
        rows = [
            { ...rows[0], supported: false }, { ...rows[1], enabled: false },
            { ...rows[2], status: 'pending' }, { ...rows[3], inboundRenewAt: new Date(now.getTime() + 1) },
        ];
        await renewInboundInputs(now); await renewInboundInputs(now);
        expect(mocks.claim).not.toHaveBeenCalled(); expect(mocks.dirty).not.toHaveBeenCalled();
    });
    it('parks cleared/deleted configuration, and fences a concurrent revision/disable', async () => {
        rows = rows.slice(0, 2);
        mocks.configured.mockResolvedValue(null);
        mocks.lock.mockImplementationOnce(async () => { rows[0].enabled = false; });
        await renewInboundInputs(now);
        expect(mocks.dirty).not.toHaveBeenCalled();
        expect(rows[0].inboundRenewAt).not.toBeNull();
        expect(rows[1].inboundRenewAt).toBeNull();
    });
});
