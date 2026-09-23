import { beforeEach, describe, expect, it, vi } from 'vitest';
import { DeliveryInputSync } from '@prisma/client';
const mocks = vi.hoisted(() => ({ recover: vi.fn(), schedule: vi.fn(), dirtyQueue: vi.fn(), raw: vi.fn(), dirty: vi.fn(), update: vi.fn(), find: vi.fn(), scan: vi.fn(), caps: vi.fn(), post: vi.fn(), woo: vi.fn(), account: vi.fn(), accountUpdate: vi.fn(), accountFirst: vi.fn(), accountScan: vi.fn(), build: vi.fn(), launchWrite: vi.fn() }));
vi.mock('../../utils/prisma', () => {
    const db = { $queryRaw: (sql: TemplateStringsArray, ...args: unknown[]) => {
        if (sql.join('').includes('SELECT GREATEST')) return mocks.schedule(sql, ...args);
        if (sql.join('').includes('SELECT i.*')) return mocks.raw(sql, ...args);
        return Promise.resolve([]);
    }, deliveryInboundDirtyTarget: { findFirst: mocks.dirty }, receiptAccount: { update: mocks.launchWrite, updateMany: mocks.launchWrite, upsert: mocks.launchWrite }, deliveryInputSync: { updateMany: mocks.update, findFirst: mocks.find, findMany: mocks.scan },
        deliverySyncAccount: { findUnique: mocks.account, updateMany: mocks.accountUpdate, findFirst: mocks.accountFirst, findMany: mocks.accountScan } };
    return { prisma: { ...db, $transaction: (callback: (tx: unknown) => unknown) => callback(db) } };
});
vi.mock('./resync', () => ({ drainDeliveryResyncs: mocks.build, enqueueDeliveryResync: vi.fn() }));
vi.mock('./inboundResync', () => ({ drainInboundBuilds: vi.fn() }));
vi.mock('./intents', async importOriginal => ({ ...await importOriginal<typeof import('./intents')>(), dirtyInboundProducts: mocks.dirtyQueue, recoverStrandedInbound: mocks.recover }));
vi.mock('../woo', () => ({ WooService: { forAccount: mocks.woo } }));
import { dispatchDeliveryInput, drainDeliveryInputs, reconcileDeliveryDispatch, validDeliveryAck } from './sync';

const job = { id: 'j', accountId: 'a', scope: 'settings', entityId: 0, inboundGeneration: 1, desiredRevision: 2n, ackRevision: 0n, attempts: 0, payload: { enabled: false }, status: 'pending' } as unknown as DeliveryInputSync;
const ack = { schemaVersion: 1, scope: 'settings', entityId: 0, revision: 2, storedRevision: 2, applied: true, storefrontActivated: false };
function installAccountState(overrides: Record<string, unknown> = {}) {
    const row: any = { accountId: 'a', capabilityStatus: 'unknown', capabilityExpiresAt: null, resyncRequested: false, resyncGeneration: 0, inboundVersion: 0, leaseToken: null, leaseExpiresAt: null, ...overrides };
    const matches = (where: any) => {
        for (const name of ['leaseToken', 'leaseExpiresAt', 'resyncGeneration', 'resyncRequested', 'capabilityStatus', 'capabilityExpiresAt', 'inboundVersion', 'inboundGeneration', 'inboundRequested']) {
            if (name === 'leaseExpiresAt' && where[name]?.gt) { if (!(row[name] > where[name].gt)) return false; continue; }
            if (name in where && String(where[name]) !== String(row[name])) return false;
        }
        if (where.OR && row.leaseExpiresAt && row.leaseExpiresAt > where.OR[1].leaseExpiresAt.lte) return false;
        return true;
    };
    mocks.account.mockImplementation(async () => structuredClone(row));
    mocks.accountUpdate.mockImplementation(async ({ where, data }) => {
        if (!matches(where)) return { count: 0 };
        Object.assign(row, data); return { count: 1 };
    });
    mocks.accountFirst.mockImplementation(async ({ where }) => matches(where) ? { accountId: 'a' } : null);
    return row;
}
describe('durable delivery worker', () => {
    beforeEach(() => {
        vi.resetAllMocks();
        mocks.raw.mockResolvedValue([]);
        mocks.schedule.mockResolvedValue([]);
        mocks.recover.mockResolvedValue(0);
        mocks.dirty.mockResolvedValue(null);
        mocks.update.mockResolvedValue({ count: 1 });
        mocks.find.mockResolvedValue({ id: 'j' });
        mocks.woo.mockResolvedValue({ getDeliveryDiscovery: mocks.caps, postDeliveryInputs: mocks.post });
        mocks.caps.mockResolvedValue({ schemaVersion: 1, capabilities: { configurationSync: true, inboundInputs: true, inboundReceiptSafety: false } });
        mocks.post.mockResolvedValue(ack);
        mocks.account.mockResolvedValue({ accountId: 'a', capabilityStatus: 'unknown', capabilityExpiresAt: null, resyncRequested: false, resyncGeneration: 0 });
        mocks.accountUpdate.mockResolvedValue({ count: 1 });
        mocks.accountFirst.mockResolvedValue({ accountId: 'a' });
        mocks.accountScan.mockResolvedValue([]);
    });
    it('dispatches disabled settings and acknowledges only the sent revision with the lease token', async () => {
        await dispatchDeliveryInput(job);
        expect(mocks.post).toHaveBeenCalledWith({ schemaVersion: 1, scope: 'settings', entityId: 0, revision: 2, payload: { enabled: false } });
        const synced = mocks.update.mock.calls.find(([query]) => query.data.status === 'synced')![0];
        expect(synced.where).toEqual({ id: 'j', desiredRevision: 2n, leaseToken: expect.any(String), account: { deliverySyncAccount: { is: { leaseToken: synced.where.leaseToken } } } });
        expect(mocks.update.mock.calls[0][0].where.OR).toEqual([{ leaseExpiresAt: null }, { leaseExpiresAt: { lte: expect.any(Date) } }]);
    });
    it('accepts the legacy non-activating write ACK without treating it as live control status', async () => {
        await dispatchDeliveryInput({ ...job, payload: { enabled: true } });
        expect(mocks.post).toHaveBeenCalled();
        expect(mocks.update).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ status: 'synced' }) }));
        expect(mocks.launchWrite).not.toHaveBeenCalled();
    });
    it('parks inbound only for config-capable older plugins with one account probe', async () => {
        const row = installAccountState({ inboundCapabilityStatus: 'unknown', inboundRequested: false, inboundGeneration: 1, inboundVersion: 1 });
        mocks.caps.mockResolvedValue({ schemaVersion: 1, capabilities: { configurationSync: true } });
        const inbound = { ...job, scope: 'inbound', entityId: 10 };
        await dispatchDeliveryInput(inbound);
        await Promise.all(Array.from({ length: 1000 }, (_, n) => dispatchDeliveryInput({ ...inbound, id: `inbound${n}` })));
        expect(row).toMatchObject({ capabilityStatus: 'supported', inboundCapabilityStatus: 'plugin_update_required' });
        expect(mocks.caps).toHaveBeenCalledTimes(1);
        expect(mocks.post).not.toHaveBeenCalled();
        expect(mocks.update).toHaveBeenCalledWith({ where: { accountId: 'a', scope: 'inbound', status: { not: 'synced' } }, data: { status: 'plugin_update_required', lastError: 'Update the plugin for inbound inputs.' } });
        await dispatchDeliveryInput(job);
        expect(mocks.post).toHaveBeenCalledTimes(1);
    });
    it('retries the exact stale inbound payload without renewing build freshness or receipt safety', async () => {
        installAccountState({ inboundCapabilityStatus: 'supported', inboundRequested: false, inboundGeneration: 1, inboundVersion: 1 });
        const payload = { wooId: 10, generatedAt: '2026-01-01T00:00:00.000Z', expiresAt: '2026-01-02T00:00:00.000Z', receiptSafety: 'unverified', targets: [] };
        const inbound = { ...job, scope: 'inbound', entityId: 10, payload };
        mocks.post.mockRejectedValueOnce(new Error('offline')).mockResolvedValue({ ...ack, scope: 'inbound', entityId: 10 });
        await dispatchDeliveryInput(inbound);
        await dispatchDeliveryInput({ ...inbound, attempts: 1 });
        expect(mocks.post.mock.calls.map(([envelope]) => envelope.payload)).toEqual([payload, payload]);
    });
    it('does not dispatch an outdated generation while rebuilding', async () => {
        installAccountState({ inboundRequested: true, inboundGeneration: 2 });
        await dispatchDeliveryInput({ ...job, scope: 'inbound' });
        expect(mocks.post).not.toHaveBeenCalled();
        await dispatchDeliveryInput(job);
        expect(mocks.post).toHaveBeenCalledTimes(1);
    });
    it('fences a source mutation during discovery before sending a superseded inbound snapshot', async () => {
        const row = installAccountState({ inboundCapabilityStatus: 'unknown', inboundRequested: false, inboundGeneration: 1, inboundVersion: 1 });
        mocks.caps.mockImplementation(async () => {
            row.inboundGeneration++; row.inboundRequested = true;
            return { schemaVersion: 1, capabilities: { configurationSync: true, inboundInputs: true } };
        });
        await dispatchDeliveryInput({ ...job, scope: 'inbound', entityId: 10 });
        expect(mocks.post).not.toHaveBeenCalled();
    });
    it('drains current inbound rows despite uninterrupted unrelated target updates', async () => {
        const row = installAccountState({ inboundCapabilityStatus: 'supported', inboundRequested: true, inboundGeneration: 1, inboundVersion: 1 });
        mocks.caps.mockImplementation(async () => {
            row.inboundVersion++;
            return { schemaVersion: 1, capabilities: { configurationSync: true, inboundInputs: true } };
        });
        mocks.post.mockImplementation(async envelope => {
            row.inboundVersion++;
            return { ...ack, scope: envelope.scope, entityId: envelope.entityId };
        });
        for (let entityId = 10; entityId < 20; entityId++) await dispatchDeliveryInput({ ...job, scope: 'inbound', entityId });
        expect(mocks.post).toHaveBeenCalledTimes(10);
        expect(mocks.update.mock.calls.filter(([q]) => q.data.status === 'synced')).toHaveLength(10);
        expect(row.inboundRequested).toBe(true);
    });
    it('never sends a dirty product even with matching revision and generation', async () => {
        installAccountState({ inboundCapabilityStatus: 'supported', inboundRequested: true, inboundGeneration: 1 });
        mocks.dirty.mockResolvedValue({ wooId: 10 });
        await dispatchDeliveryInput({ ...job, scope: 'inbound', entityId: 10 });
        expect(mocks.post).not.toHaveBeenCalled();
    });
    it.each([0, 3])('retains bounded Woo stale-proof rejection at %s prior rebuilds', async proofRebuilds => {
        installAccountState({ inboundCapabilityStatus: 'supported', inboundRequested: true, inboundGeneration: 1 });
        mocks.post.mockRejectedValue({ response: { status: 409, data: { code: 'overseek_delivery_stale_proof' } } });
        await dispatchDeliveryInput({ ...job, scope: 'inbound', entityId: 10, proofRebuilds });
        expect(mocks.update.mock.calls.some(([q]) => q.data.ackRevision !== undefined || q.data.status === 'synced')).toBe(false);
        expect(mocks.dirtyQueue).toHaveBeenCalledTimes(proofRebuilds < 3 ? 1 : 0);
        expect(mocks.update).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ status: proofRebuilds < 3 ? 'pending' : 'blocked' }) }));
    });
    it('records ACK history but does not mark a newly dirtied source current', async () => {
        installAccountState({ inboundCapabilityStatus: 'supported', inboundRequested: false, inboundGeneration: 1 });
        mocks.post.mockImplementation(async () => {
            mocks.dirty.mockResolvedValue({ wooId: 10 });
            return { ...ack, scope: 'inbound', entityId: 10 };
        });
        await dispatchDeliveryInput({ ...job, scope: 'inbound', entityId: 10 });
        expect(mocks.update.mock.calls.some(([q]) => q.data.ackRevision === 2n)).toBe(true);
        expect(mocks.update.mock.calls.some(([q]) => q.data.status === 'synced')).toBe(false);
    });
    it('does not mark an old-generation ACK synced after full source invalidation', async () => {
        const row = installAccountState({ inboundCapabilityStatus: 'supported', inboundGeneration: 1 });
        mocks.post.mockImplementation(async () => {
            row.inboundGeneration++;
            return { ...ack, scope: 'inbound', entityId: 10 };
        });
        await dispatchDeliveryInput({ ...job, scope: 'inbound', entityId: 10 });
        expect(mocks.update.mock.calls.some(([q]) => q.data.ackRevision === 2n)).toBe(true);
        expect(mocks.update.mock.calls.some(([q]) => q.data.status === 'synced')).toBe(false);
    });
    it('does not send after losing a concurrent claim', async () => {
        mocks.update.mockResolvedValueOnce({ count: 0 });
        await dispatchDeliveryInput(job);
        expect(mocks.woo).not.toHaveBeenCalled();
    });
    it('an in-flight save stays pending while only the sent revision is acknowledged', async () => {
        const row = { desiredRevision: 2n, ackRevision: 0n, status: 'pending', leaseToken: null as string | null };
        mocks.update.mockImplementation(async ({ where, data }) => {
            if (where.leaseToken && where.leaseToken !== row.leaseToken) return { count: 0 };
            if (where.desiredRevision && where.desiredRevision !== row.desiredRevision) return { count: 0 };
            Object.assign(row, data);
            return { count: 1 };
        });
        mocks.post.mockImplementation(async () => {
            row.desiredRevision = 3n; // transaction commits a new disable while revision 2 is on the wire
            return ack;
        });
        await dispatchDeliveryInput(job);
        expect(row).toMatchObject({ desiredRevision: 3n, ackRevision: 2n, status: 'pending', leaseToken: null });
    });
    it('a replaced lease token prevents both acknowledgement and release by the old worker', async () => {
        const row = { desiredRevision: 2n, ackRevision: 0n, status: 'pending', leaseToken: null as string | null };
        mocks.update.mockImplementation(async ({ where, data }) => {
            if (where.leaseToken && where.leaseToken !== row.leaseToken) return { count: 0 };
            Object.assign(row, data);
            return { count: 1 };
        });
        mocks.post.mockImplementation(async () => { row.leaseToken = 'replacement'; return ack; });
        await dispatchDeliveryInput(job);
        expect(row).toMatchObject({ ackRevision: 0n, status: 'pending', leaseToken: 'replacement' });
    });
    it('skips superseded enabled settings during discovery', async () => {
        mocks.find.mockResolvedValue(null);
        await dispatchDeliveryInput({ ...job, payload: { enabled: true } });
        expect(mocks.post).not.toHaveBeenCalled();
    });
    it('parks old plugins without posting or repeatedly scanning parked state', async () => {
        mocks.caps.mockResolvedValue({ schemaVersion: 1, capabilities: { configurationSync: false } });
        await dispatchDeliveryInput(job);
        expect(mocks.post).not.toHaveBeenCalled();
        expect(mocks.update).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ status: 'plugin_update_required' }) }));
        await drainDeliveryInputs();
        expect(mocks.accountScan.mock.calls[0][0].where.capabilityStatus).toEqual({ in: ['unknown', 'supported'] });
        expect(mocks.scan).not.toHaveBeenCalled();
    });
    it('rejects mismatched acknowledgements without advancing ackRevision', async () => {
        mocks.post.mockResolvedValue({ ...ack, storedRevision: 3 });
        await dispatchDeliveryInput(job);
        expect(mocks.update.mock.calls.some(([query]) => query.data.ackRevision !== undefined)).toBe(false);
        expect(mocks.update).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ status: 'blocked' }) }));
        expect(validDeliveryAck({ ...ack, applied: false }, job)).toBe(true);
        for (const field of ['schemaVersion', 'scope', 'entityId', 'revision', 'storedRevision', 'applied', 'storefrontActivated']) {
            expect(validDeliveryAck({ ...ack, [field]: null }, job)).toBe(false);
        }
    });
    it('bounds transient retries and sanitizes upstream failures', async () => {
        mocks.post.mockRejectedValue(new Error('secret credential and remote payload'));
        await dispatchDeliveryInput({ ...job, attempts: 7 });
        expect(mocks.update).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ status: 'failed', attempts: 8, lastError: 'Delivery transport unavailable.' }) }));
    });
    it('parks missing credentials as blocked without making requests', async () => {
        const row = installAccountState();
        mocks.woo.mockRejectedValue(new Error('Account missing WooCommerce credentials'));
        await dispatchDeliveryInput(job);
        await dispatchDeliveryInput({ ...job, id: 'another-product' });
        expect(mocks.caps).not.toHaveBeenCalled();
        expect(mocks.woo).toHaveBeenCalledTimes(1);
        expect(row.capabilityStatus).toBe('blocked');
        expect(mocks.update).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ status: 'blocked', lastError: 'Delivery authorization unavailable.' }) }));
    });
    it('probes an unsupported account once for 10,000 products and durably parks the account', async () => {
        const row = installAccountState();
        mocks.caps.mockResolvedValue({ schemaVersion: 1, capabilities: { configurationSync: false } });
        await dispatchDeliveryInput(job);
        await Promise.all(Array.from({ length: 10_000 }, (_, index) => dispatchDeliveryInput({ ...job, id: `p${index}`, scope: 'product', entityId: index + 1 })));
        expect(mocks.caps).toHaveBeenCalledTimes(1);
        expect(mocks.post).not.toHaveBeenCalled();
        expect(row.capabilityStatus).toBe('plugin_update_required');
        expect(mocks.update).toHaveBeenCalledWith({ where: { accountId: 'a', status: { not: 'synced' } }, data: { status: 'plugin_update_required', lastError: 'Update the Overseek WooCommerce plugin.' } });
    });
    it('serializes simultaneous account probes and reuses the durable positive cache', async () => {
        const row = installAccountState();
        await Promise.all(Array.from({ length: 50 }, () => dispatchDeliveryInput(job)));
        expect(mocks.caps).toHaveBeenCalledTimes(1);
        expect(mocks.post).toHaveBeenCalledTimes(1);
        expect(row.capabilityStatus).toBe('supported');
        await dispatchDeliveryInput(job);
        expect(mocks.caps).toHaveBeenCalledTimes(1);
        expect(mocks.post).toHaveBeenCalledTimes(2);
    });
    it('retains a live 120-second account lease, then allows crash recovery after expiry', async () => {
        const row = installAccountState({ leaseToken: 'crashed-worker', leaseExpiresAt: new Date(Date.now() + 120_000) });
        await dispatchDeliveryInput(job);
        expect(mocks.woo).not.toHaveBeenCalled();
        row.leaseExpiresAt = new Date(Date.now() - 1);
        await dispatchDeliveryInput(job);
        expect(mocks.post).toHaveBeenCalledTimes(1);
        const claim = mocks.accountUpdate.mock.calls.find(([query]) => query.data.leaseToken && query.data.lastServedAt)![0];
        expect(claim.data.leaseExpiresAt.getTime() - claim.data.lastServedAt.getTime()).toBe(120_000);
    });
    it('blocks account dispatch during a build and ignores a stale probe after explicit retry', async () => {
        const row = installAccountState({ resyncRequested: true });
        await dispatchDeliveryInput(job);
        expect(mocks.woo).not.toHaveBeenCalled();
        row.resyncRequested = false;
        mocks.caps.mockImplementation(async () => {
            row.resyncGeneration++;
            row.resyncRequested = true;
            return { schemaVersion: 1, capabilities: { configurationSync: false } };
        });
        await dispatchDeliveryInput(job);
        expect(row.capabilityStatus).toBe('unknown');
        expect(mocks.post).not.toHaveBeenCalled();
    });
    it('losing an account lease cannot release or poison the replacement owner', async () => {
        const row = installAccountState();
        mocks.caps.mockImplementation(async () => {
            row.leaseToken = 'replacement';
            return { schemaVersion: 1, capabilities: { configurationSync: false } };
        });
        await dispatchDeliveryInput(job);
        expect(row).toMatchObject({ leaseToken: 'replacement', capabilityStatus: 'unknown' });
        expect(mocks.post).not.toHaveBeenCalled();
    });
    it('refreshes an expired supported cache once and fairly schedules bounded distinct accounts', async () => {
        installAccountState({ capabilityStatus: 'supported', capabilityExpiresAt: new Date(0) });
        await dispatchDeliveryInput(job);
        expect(mocks.caps).toHaveBeenCalledTimes(1);
        await drainDeliveryInputs(1000);
        expect(mocks.accountScan).toHaveBeenCalledWith(expect.objectContaining({ take: 5, orderBy: [{ lastServedAt: 'asc' }, { accountId: 'asc' }] }));
        expect(mocks.build).toHaveBeenCalledTimes(1);
    });
    it('uses a total dispatch budget across rounds rather than limiting a large account to one job', async () => {
        installAccountState();
        mocks.accountScan.mockResolvedValue([{ accountId: 'a' }]);
        mocks.raw.mockResolvedValue([job]);
        mocks.find.mockImplementation(async ({ where, select }) => select?.nextAttemptAt ? { nextAttemptAt: new Date() } : where.leaseToken ? { id: 'j' } : job);
        await drainDeliveryInputs(10_000);
        expect(mocks.post).toHaveBeenCalledTimes(25);
        expect(mocks.caps).toHaveBeenCalledTimes(1);
        expect(mocks.accountScan).toHaveBeenCalledTimes(25);
        expect(mocks.accountScan.mock.calls.every(([query]) => query.take <= 5)).toBe(true);
    });
    it('five empty supplier-build accounts are put to sleep so real work is served in the same drain', async () => {
        const rows = new Map(Array.from({ length: 6 }, (_, n) => {
            const accountId = n < 5 ? `empty${n}` : 'a';
            return [accountId, { accountId, hasWork: true, nextAttemptAt: new Date(0), lastServedAt: new Date(n),
                capabilityStatus: 'unknown', capabilityExpiresAt: null, resyncRequested: false, resyncGeneration: 0,
                inboundRequested: false, inboundVersion: 0, inboundCapabilityStatus: 'unknown', leaseToken: null, leaseExpiresAt: null } as any];
        }));
        let pending = true;
        mocks.raw.mockImplementation(async (_sql, accountId) => accountId === 'a' && pending ? [job] : []);
        mocks.accountScan.mockImplementation(async ({ take }) => [...rows.values()].filter(row => row.hasWork && row.nextAttemptAt <= new Date()).sort((a, b) => a.lastServedAt - b.lastServedAt).slice(0, take).map(row => ({ accountId: row.accountId })));
        mocks.account.mockImplementation(async ({ where }) => structuredClone(rows.get(where.accountId)));
        mocks.accountUpdate.mockImplementation(async ({ where, data }) => {
            const row = rows.get(where.accountId)!;
            if (Object.entries(where).some(([key, value]) => key !== 'OR' && String(row[key]) !== String(value))) return { count: 0 };
            Object.assign(row, data); return { count: 1 };
        });
        mocks.find.mockImplementation(async ({ where, select }) => {
            if (where.leaseToken) return { id: 'j' };
            return where.accountId === 'a' && pending ? (select?.nextAttemptAt ? { nextAttemptAt: new Date() } : job) : null;
        });
        mocks.update.mockImplementation(async ({ data }) => { if (data.status === 'synced') pending = false; return { count: 1 }; });
        await drainDeliveryInputs(10);
        expect(mocks.post).toHaveBeenCalledTimes(1);
        for (const [id, row] of rows) if (id !== 'a') {
            expect(row.hasWork).toBe(false); expect(row.lastServedAt.getTime()).toBeGreaterThan(5);
        }
        expect(mocks.accountScan).toHaveBeenCalledTimes(3);
    });
    it('rechecks pending work after a stale no-candidate scan, retaining a newly saved wake', async () => {
        const row = installAccountState({ hasWork: true, inboundVersion: 1 });
        const next = new Date();
        mocks.schedule.mockResolvedValue([{ nextAttemptAt: next }]);
        await reconcileDeliveryDispatch('a');
        expect(row).toMatchObject({ hasWork: true, nextAttemptAt: next, lastServedAt: expect.any(Date) });
    });
    it('rotates a continuously dirty no-candidate account while another account sends', async () => {
        mocks.accountScan.mockResolvedValueOnce([{ accountId: 'hot' }, { accountId: 'a' }]).mockResolvedValue([]);
        mocks.account.mockImplementation(async ({ where }) => ({ accountId: where.accountId, capabilityStatus: 'supported', capabilityExpiresAt: new Date(Date.now() + 60_000), inboundCapabilityStatus: 'supported', inboundRequested: true, inboundVersion: 1, resyncRequested: false, resyncGeneration: 0 }));
        mocks.raw.mockImplementation(async (_sql, accountId) => accountId === 'a' ? [job] : []);
        mocks.find.mockImplementation(async ({ select }) => select?.nextAttemptAt ? { nextAttemptAt: new Date() } : { id: 'j' });
        mocks.schedule.mockResolvedValue([{ nextAttemptAt: new Date() }]);
        await drainDeliveryInputs(2);
        expect(mocks.post).toHaveBeenCalledTimes(1);
        expect(mocks.accountUpdate).toHaveBeenCalledWith(expect.objectContaining({
            where: expect.objectContaining({ accountId: 'hot' }),
            data: expect.objectContaining({ hasWork: true, lastServedAt: expect.any(Date) }),
        }));
    });
    it('CAS does not overwrite a lease claimed during no-candidate reconciliation', async () => {
        const row = installAccountState({ hasWork: true, inboundVersion: 1 });
        mocks.schedule.mockImplementation(async () => { row.leaseToken = 'new-owner'; row.leaseExpiresAt = new Date(Date.now() + 120_000); return []; });
        await reconcileDeliveryDispatch('a');
        expect(row).toMatchObject({ hasWork: true, leaseToken: 'new-owner' });
        expect(row.lastServedAt).toBeUndefined();
        expect(mocks.accountUpdate.mock.calls[0][0].where).toMatchObject({ leaseToken: null, leaseExpiresAt: null, inboundVersion: 1 });
    });
    it('leaves a live owner alone and retains future/row-lease recovery wakeups', async () => {
        const row = installAccountState({ hasWork: true, inboundVersion: 1, leaseToken: 'owner', leaseExpiresAt: new Date(Date.now() + 120_000) });
        await reconcileDeliveryDispatch('a');
        expect(mocks.accountUpdate).not.toHaveBeenCalled();
        row.leaseToken = null; row.leaseExpiresAt = null;
        const future = new Date(Date.now() + 60_000);
        mocks.schedule.mockResolvedValueOnce([{ nextAttemptAt: future }]);
        await reconcileDeliveryDispatch('a');
        expect(row).toMatchObject({ hasWork: true, nextAttemptAt: future });
        const expiry = new Date(Date.now() + 120_000);
        mocks.schedule.mockResolvedValueOnce([{ nextAttemptAt: expiry }]);
        await reconcileDeliveryDispatch('a');
        expect(row).toMatchObject({ hasWork: true, nextAttemptAt: expiry });
    });
});
