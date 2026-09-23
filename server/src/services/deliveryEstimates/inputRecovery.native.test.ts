import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Prisma } from '@prisma/client';
import { openNativeDeliveryDatabase } from './__tests__/nativeDeliveryDatabase';
const m = vi.hoisted(() => ({ client: null as any, caps: vi.fn(), post: vi.fn(), woo: vi.fn() }));
vi.mock('../../utils/prisma', () => ({ prisma: new Proxy({}, { get: (_, key) => {
    const value = m.client[key]; return typeof value === 'function' ? value.bind(m.client) : value;
} }) }));
vi.mock('../woo', () => ({ WooService: { forAccount: m.woo } }));
import { inputListQuery, listDeliveryInputs, retryDeliveryInput } from './inputRecovery';
import { dispatchDeliveryInput, recoverStrandedDeliveryInputs, requestDeliverySync } from './sync';
import { buildInboundBatch, drainInboundBuilds } from './inboundResync';
import { buildDeliveryResyncBatch } from './resync';
import { lockDeliveryAccount, recordIntent } from './intents';
import { remoteInputDiagnostic } from './inputDiagnostic';

describe.skipIf(!process.env.DELIVERY_FRESHNESS_TEST_DATABASE_URL)('delivery input diagnostics and targeted recovery (isolated native Prisma)', () => {
    let fixture: Awaited<ReturnType<typeof openNativeDeliveryDatabase>>;
    beforeEach(async () => {
        fixture = await openNativeDeliveryDatabase(); m.client = fixture.client; vi.clearAllMocks();
        m.woo.mockResolvedValue({ getDeliveryDiscovery: m.caps, postDeliveryInputs: m.post });
        m.caps.mockResolvedValue({ schemaVersion: 1, capabilities: { configurationSync: true, inboundInputs: true, variantSupplierLeads: true }, secret: 'SECRET' });
        m.post.mockImplementation(async e => ({ schemaVersion: 1, scope: e.scope, entityId: e.entityId, revision: e.revision, storedRevision: e.revision, applied: true, storefrontActivated: false }));
        await m.client.deliverySyncAccount.create({ data: { accountId: 'a' } });
    }, 30000);
    afterEach(async () => { await fixture?.close(); m.client = null; });
    const create = (id: string, data: any = {}) => m.client.deliveryInputSync.create({ data: { id, accountId: 'a', scope: 'product', entityId: Number(id.replace(/\D/g, '')) || 10, payload: { wooId: 10 }, ...data } });
    const get = (id: string) => m.client.deliveryInputSync.findUniqueOrThrow({ where: { id } });
    const control = () => m.client.deliverySyncAccount.findUniqueOrThrow({ where: { accountId: 'a' } });
    const list = (query: any = {}, account = 'a') => listDeliveryInputs(account, inputListQuery.parse(query));
    const reject = (code = 'overseek_delivery_input_invalid', reason = 'stock_owner_mismatch', status = 400) => m.post.mockRejectedValue({ response: { status, data: { code, message: 'SECRET https://credentials.invalid', data: { reason, proof: 'SECRET', costs: 'SECRET' } } } });
    const inbound = (expired = false) => ({ wooId: 10, generatedAt: new Date(Date.now() - (expired ? 172800000 : 1000)).toISOString(), expiresAt: new Date(Date.now() + (expired ? -86400000 : 86400000)).toISOString(), targets: [] });

    it('reads stable filtered pages locally, validates tenant/filter-bound cursors and redacts all payload/error internals', async () => {
        for (const [id, status, scope] of [['i1', 'blocked', 'product'], ['i2', 'failed', 'inbound'], ['i3', 'plugin_update_required', 'product'], ['i4', 'synced', 'product']] as const) {
            await create(id, { status, scope, lastError: 'SECRET generic error', payload: { ...inbound(true), name: 'SECRET', costs: 999, proof: 'SECRET', lease: 'SECRET' } });
        }
        await create('i5', { accountId: 'other', status: 'blocked' });
        const before = await m.client.deliveryInputSync.findMany(); const beforeControl = await control();
        const first = await list({ limit: 1 });
        expect(first.items.map(i => i.id)).toEqual(['i1']); expect(first.items[0].diagnostic).toBeNull();
        const second = await list({ limit: 1, cursor: first.nextCursor });
        expect(second.items.map(i => i.id)).toEqual(['i2']);
        expect(second.items[0].payloadSummary).toMatchObject({ isTombstone: true, targetCount: 0, expiredAtObservation: true });
        expect((await list({ cursor: second.nextCursor })).items.map(i => i.id)).toEqual(['i3']);
        expect((await list({ status: 'blocked', scope: 'product' })).items.map(i => i.id)).toEqual(['i1']);
        expect((await list()).items.map(i => i.id)).toEqual(['i1', 'i2', 'i3']);
        for (const [query, account] of [[{ cursor: first.nextCursor }, 'other'], [{ cursor: first.nextCursor, scope: 'inbound' }, 'a'], [{ cursor: first.nextCursor, status: 'failed' }, 'a'], [{ cursor: 'invalid' }, 'a']] as const) await expect(list(query, account)).rejects.toMatchObject({ statusCode: 400 });
        expect(JSON.stringify(first)).not.toMatch(/SECRET|"proof"|lease|costs|payload"|lastError/);
        expect(m.woo).not.toHaveBeenCalled();
        expect(await m.client.deliveryInputSync.findMany()).toEqual(before); expect(await control()).toEqual(beforeControl);
    });
    it('uses an enforced read-only repeatable snapshot while source writers remain unblocked', async () => {
        await create('i1', { status: 'blocked' });
        const original = m.client.$transaction.bind(m.client);
        const spy = vi.spyOn(m.client, '$transaction').mockImplementation((callback: any, options: any) => original(async (tx: any) => {
            return callback(new Proxy(tx, { get(target, key) {
                if (key === 'deliverySyncAccount') return { findUnique: async (args: any) => {
                    const value = await target.deliverySyncAccount.findUnique(args);
                    expect(await tx.$queryRawUnsafe(`SELECT current_setting('transaction_isolation') AS isolation, current_setting('transaction_read_only') AS readonly`)).toEqual([{ isolation: 'repeatable read', readonly: 'on' }]);
                    await fixture.db.exec(`BEGIN; SELECT id FROM "Account" WHERE id='a' FOR UPDATE NOWAIT;
                        UPDATE "DeliveryInputSync" SET status='synced' WHERE id='i1'; COMMIT`);
                    return value;
                } };
                const value = target[key]; return typeof value === 'function' ? value.bind(target) : value;
            } }));
        }, options));
        try { expect((await list()).items.map(i => i.id)).toEqual(['i1']); }
        finally { spy.mockRestore(); }
        expect((await list()).items).toEqual([]);
    });
    it('captures exact failed revision and precise reason; a new desired revision clears it', async () => {
        reject(); const job = await create('i1'); await dispatchDeliveryInput(job);
        expect((await get('i1')).lastDiagnostic).toMatchObject({ attemptedRevision: '1', reason: 'stock_owner_mismatch', phase: 'inputs', disposition: 'record_rejection' });
        expect((await list()).items[0].diagnostic?.code).toBe('overseek_delivery_input_invalid');
        expect((await control()).capabilityStatus).toBe('supported');
        await m.client.$transaction(async (tx: any) => { await lockDeliveryAccount(tx, 'a'); await recordIntent(tx, 'a', 'product', job.entityId, { wooId: job.entityId }); });
        expect(await get('i1')).toMatchObject({ desiredRevision: 2n, lastDiagnostic: null, status: 'pending' });
    });
    it.each(['revision', 'lease'])('does not capture a stale failure after concurrent %s change', async change => {
        const job = await create('i1');
        m.post.mockImplementationOnce(async () => {
            await m.client.deliveryInputSync.update({ where: { id: job.id }, data: change === 'revision' ? { desiredRevision: { increment: 1 } } : { leaseToken: 'new-owner' } });
            throw { response: { status: 403, data: { code: 'overseek_delivery_forbidden' } } };
        });
        await dispatchDeliveryInput(job);
        expect(await get('i1')).toMatchObject({ status: 'pending', lastDiagnostic: null });
        expect(await control()).toMatchObject({ capabilityStatus: 'supported', lastDiagnostic: null });
    });
    it('persists account suppression separately and reports it without inventing a sibling attempt', async () => {
        const job = await create('i1'); await create('i2');
        reject('overseek_delivery_account_mismatch', 'unknown', 403); await dispatchDeliveryInput(job);
        expect(await control()).toMatchObject({ capabilityStatus: 'blocked', lastDiagnostic: { attemptedRevision: null, code: 'overseek_delivery_account_mismatch', disposition: 'account_suppression' } });
        expect((await get('i2')).lastDiagnostic).toMatchObject({ revision: '1', diagnostic: { attemptedRevision: null, disposition: 'account_suppression' } });
        expect((await list()).items[1].diagnostic).toMatchObject({ attemptedRevision: null, disposition: 'account_suppression' });
    });
    it.each(['captured', 'legacy-fallback'])('retains B historical suppression through retry A and success (%s)', async mode => {
        const a = await create('i1', { scope: 'settings', entityId: 0 }); await create('i2');
        reject('overseek_delivery_account_mismatch', 'unknown', 403); await dispatchDeliveryInput(a);
        if (mode === 'legacy-fallback') await m.client.deliveryInputSync.update({ where: { id: 'i2' }, data: { lastDiagnostic: Prisma.DbNull } });
        const before = await get('i2');
        const beforeDiagnostic = (await list()).items.find(i => i.id === 'i2')!.diagnostic;
        expect(beforeDiagnostic).toMatchObject({ attemptedRevision: null, disposition: 'account_suppression', message: expect.stringContaining('Previously suppressed') });
        await retryDeliveryInput('a', 'i1');
        expect(await control()).toMatchObject({ capabilityStatus: 'unknown', lastDiagnostic: null });
        expect((await list()).items.find(i => i.id === 'i2')!.diagnostic).toEqual(beforeDiagnostic);
        m.post.mockImplementation(async e => ({ schemaVersion: 1, scope: e.scope, entityId: e.entityId, revision: e.revision, storedRevision: e.revision, applied: true, storefrontActivated: false }));
        await dispatchDeliveryInput(await get('i1'));
        expect((await get('i1')).status).toBe('synced');
        expect(await control()).toMatchObject({ capabilityStatus: 'supported', lastDiagnostic: null });
        expect((await list()).items.find(i => i.id === 'i2')!.diagnostic).toEqual(beforeDiagnostic);
        const after = await get('i2');
        expect({ ...after, lastDiagnostic: before.lastDiagnostic }).toEqual(before);
        if (mode === 'captured') expect(after).toEqual(before);
        expect(await m.client.deliveryInboundDirtyTarget.count()).toBe(0);
        // Even an out-of-band revision change must not revive the old provenance.
        await m.client.deliveryInputSync.update({ where: { id: 'i2' }, data: { desiredRevision: { increment: 1 } } });
        expect((await list()).items.find(i => i.id === 'i2')!.diagnostic).toBeNull();
    });
    it('keeps truly generic legacy rows unknown when another row is retried', async () => {
        await create('i1', { scope: 'settings', entityId: 0, status: 'blocked' });
        await create('i2', { status: 'blocked', lastError: 'Delivery authorization, schema or revision rejected.' });
        await m.client.deliverySyncAccount.update({ where: { accountId: 'a' }, data: { capabilityStatus: 'blocked' } });
        const before = await get('i2');
        await retryDeliveryInput('a', 'i1');
        expect(await get('i2')).toEqual(before);
        expect((await list()).items[0].diagnostic).toBeNull();
    });
    it('does not restore historical account fallback after a new desired payload under suppression', async () => {
        const a = await create('i1', { scope: 'settings', entityId: 0 }); await create('i2');
        reject('overseek_delivery_account_mismatch', 'unknown', 403); await dispatchDeliveryInput(a);
        await m.client.$transaction(async (tx: any) => { await lockDeliveryAccount(tx, 'a'); await recordIntent(tx, 'a', 'product', 2, { wooId: 2, productionMinDays: 1, productionMaxDays: 2, variations: [] }); });
        expect((await get('i2')).desiredRevision).toBe(2n);
        expect((await list()).items.find(i => i.id === 'i2')!.diagnostic).toBeNull();
        await retryDeliveryInput('a', 'i1');
        expect((await list()).items.find(i => i.id === 'i2')!.diagnostic).toBeNull();
    });
    it('treats a record validation 404 as a record rejection rather than suppressing the account', async () => {
        const job = await create('i1'); await create('i2'); reject('overseek_delivery_input_invalid', 'product_missing', 404);
        await dispatchDeliveryInput(job);
        expect(await get('i1')).toMatchObject({ status: 'blocked', lastDiagnostic: { reason: 'product_missing' } });
        expect((await get('i2')).status).toBe('pending'); expect((await control()).capabilityStatus).toBe('supported');
    });
    it('retries only the owned attention row, keeps revisions/history and clears capability cache', async () => {
        await fixture.db.exec(`INSERT INTO "WooProduct" (id,"accountId","wooId") VALUES ('p','a',1)`);
        await create('i1', { status: 'blocked', desiredRevision: 8n, ackRevision: 7n, attempts: 8, proofRebuilds: 3 });
        await create('i2', { status: 'synced', ackRevision: 1n }); await create('i3', { status: 'blocked' });
        const good = await get('i2'); const other = await get('i3');
        await m.client.deliverySyncAccount.update({ where: { accountId: 'a' }, data: { capabilityDetails: { variantSupplierLeads: false }, capabilityStatus: 'supported' } });
        await expect(retryDeliveryInput('other', 'i1')).rejects.toMatchObject({ statusCode: 404 });
        await expect(retryDeliveryInput('a', 'i2')).rejects.toMatchObject({ statusCode: 409 });
        expect(await retryDeliveryInput('a', 'i1')).toEqual({ accepted: true, disposition: 'queued', inputId: 'i1' });
        expect(await get('i1')).toMatchObject({ status: 'pending', desiredRevision: 8n, ackRevision: 7n, attempts: 0, proofRebuilds: 0 });
        expect(await get('i2')).toEqual(good); expect(await get('i3')).toEqual(other);
        expect(await control()).toMatchObject({ capabilityStatus: 'unknown', capabilityDetails: null });
        expect((await retryDeliveryInput('a', 'i1')).disposition).toBe('already_running');
        expect(m.woo).not.toHaveBeenCalled();
    });
    it('coalesces an active transport lease without clearing its diagnostics/cache', async () => {
        await create('i1', { status: 'blocked', leaseToken: 'active', leaseExpiresAt: new Date(Date.now() + 60000) });
        const before = await get('i1'); const account = await control();
        expect((await retryDeliveryInput('a', 'i1')).disposition).toBe('already_running');
        expect(await get('i1')).toEqual(before); expect(await control()).toEqual(account);
    });
    it.each(['targeted', 'whole', 'pending'])('rebuilds expired %s input from current sources with a new revision', async mode => {
        await create('i1', { scope: 'inbound', entityId: 10, status: mode === 'pending' ? 'pending' : 'blocked', payload: { ...inbound(true), targets: [{ wooId: 10, state: 'pending' }] } });
        const before = await get('i1');
        if (mode === 'targeted') expect((await retryDeliveryInput('a', 'i1')).disposition).toBe('rebuilding');
        else if (mode === 'whole') expect((await requestDeliverySync('a')).requestDisposition).toBe('retrying');
        else await recoverStrandedDeliveryInputs();
        expect(await m.client.deliveryInboundDirtyTarget.count()).toBe(1);
        expect((await get('i1')).payload).toEqual(before.payload);
        await dispatchDeliveryInput(await get('i1')); expect(m.woo).not.toHaveBeenCalled();
        await buildInboundBatch('a');
        const rebuilt = await get('i1');
        expect(rebuilt.desiredRevision).toBe(2n); expect((rebuilt.payload as any).targets).toEqual([]);
        expect((rebuilt.payload as any).expiresAt).not.toBe((before.payload as any).expiresAt);
        expect(await m.client.deliveryInboundDirtyTarget.count()).toBe(0);
    });
    it.each(['targeted', 'whole'])('rebuilds exact remote-expired revision with future local expiry via %s retry, then parks persistent clock skew', async mode => {
        const job = await create('i1', { scope: 'inbound', entityId: 10, payload: inbound() });
        reject('overseek_delivery_input_invalid', 'inbound_expired', 400);
        await dispatchDeliveryInput(job);
        expect(await get('i1')).toMatchObject({ status: 'blocked', desiredRevision: 1n, lastDiagnostic: { attemptedRevision: '1', reason: 'inbound_expired' } });
        expect((await list()).items[0].payloadSummary.expiredAtObservation).toBe(false);
        if (mode === 'targeted') expect((await retryDeliveryInput('a', 'i1')).disposition).toBe('rebuilding');
        else expect((await requestDeliverySync('a')).requestDisposition).toBe('retrying');
        expect(await m.client.deliveryInboundDirtyTarget.count()).toBe(1);
        await dispatchDeliveryInput(await get('i1'));
        expect(m.post).toHaveBeenCalledTimes(1); // the rejected old payload is never replayed
        await buildInboundBatch('a');
        const rebuilt = await get('i1');
        expect(rebuilt.desiredRevision).toBe(2n); expect(rebuilt.lastDiagnostic).toBeNull();
        expect(rebuilt.payload).not.toEqual(job.payload);
        await dispatchDeliveryInput(rebuilt); // WP clock remains ahead: new revision is rejected too
        expect(m.post).toHaveBeenCalledTimes(2);
        const blocked = await get('i1'); expect(blocked.status).toBe('blocked');
        for (let n = 0; n < 3; n++) { await recoverStrandedDeliveryInputs(); await drainInboundBuilds(); }
        expect(await get('i1')).toEqual(blocked);
        expect(await m.client.deliveryInboundDirtyTarget.count()).toBe(0);
        expect(m.post).toHaveBeenCalledTimes(2);
        // An operator may explicitly authorize another regeneration.
        expect((await retryDeliveryInput('a', 'i1')).disposition).toBe('rebuilding');
    });
    it('bounds full-retry remote-expiry recovery and fences unbuilt rows before HTTP', async () => {
        const diagnostic = remoteInputDiagnostic({ response: { status: 400, data: { code: 'overseek_delivery_input_invalid', data: { reason: 'inbound_expired' } } } }, 'inputs', 1n, false);
        for (let n = 1; n <= 23; n++) await create(`i${n}`, { scope: 'inbound', status: 'blocked', payload: inbound(), lastDiagnostic: diagnostic });
        await requestDeliverySync('a');
        expect(await m.client.deliveryInboundDirtyTarget.count()).toBe(10);
        const notBuilt = await m.client.deliveryInputSync.findFirstOrThrow({ where: { entityId: 9 } });
        await dispatchDeliveryInput(notBuilt);
        expect(m.woo).not.toHaveBeenCalled(); expect(m.post).not.toHaveBeenCalled();
        expect(await m.client.deliveryInboundDirtyTarget.count()).toBeLessThanOrEqual(11);
        await recoverStrandedDeliveryInputs();
        expect(await m.client.deliveryInboundDirtyTarget.count()).toBeLessThanOrEqual(21);
    });
    it('ignores a remote expiry rejection from a superseded revision on explicit retry', async () => {
        const diagnostic = remoteInputDiagnostic({ response: { status: 400, data: { code: 'overseek_delivery_input_invalid', data: { reason: 'inbound_expired' } } } }, 'inputs', 1n, false);
        await create('i1', { scope: 'inbound', entityId: 10, status: 'blocked', desiredRevision: 2n, payload: inbound(), lastDiagnostic: diagnostic });
        expect((await retryDeliveryInput('a', 'i1')).disposition).toBe('queued');
        expect(await m.client.deliveryInboundDirtyTarget.count()).toBe(0);
        expect((await get('i1')).desiredRevision).toBe(2n);
    });
    it('allows an explicitly selected expired rebuild while feature off', async () => {
        await fixture.db.exec(`INSERT INTO "AccountFeature" (id,"accountId","featureKey","isEnabled") VALUES ('off','a','DELIVERY_ESTIMATES',false)`);
        await create('i1', { scope: 'inbound', entityId: 10, status: 'blocked', payload: inbound(true) });
        expect((await retryDeliveryInput('a', 'i1')).disposition).toBe('rebuilding');
        await drainInboundBuilds();
        expect((await get('i1')).desiredRevision).toBe(2n);
        expect(m.woo).not.toHaveBeenCalled();
    });
    it('bounds same-generation expired pending recovery to ten targets per account per pass', async () => {
        for (let n = 1; n <= 23; n++) await create(`i${n}`, { scope: 'inbound', payload: inbound(true), inboundRenewAt: null });
        await recoverStrandedDeliveryInputs();
        expect(await m.client.deliveryInboundDirtyTarget.count()).toBe(10);
        await recoverStrandedDeliveryInputs();
        expect(await m.client.deliveryInboundDirtyTarget.count()).toBe(20);
        expect(m.woo).not.toHaveBeenCalled();
    });
    it.each(['targeted', 'resync'])('writes a new empty product tombstone for a missing local product via %s', async mode => {
        await create('i1', { status: mode === 'targeted' ? 'blocked' : 'synced', payload: { wooId: 1, productionMinDays: 4, productionMaxDays: 7, variations: [{ wooId: 11, productionMinDays: 3, productionMaxDays: 5 }] } });
        if (mode === 'targeted') await retryDeliveryInput('a', 'i1');
        else {
            await m.client.deliverySyncAccount.update({ where: { accountId: 'a' }, data: { resyncRequested: true, resyncGeneration: 1, resyncPhase: 'replay' } });
            await buildDeliveryResyncBatch('a');
        }
        expect(await get('i1')).toMatchObject({ desiredRevision: 2n, payload: { wooId: 1, productionMinDays: null, productionMaxDays: null, variations: [] } });
    });
    it('probes old cached capability shape once, parks only mixed-owner-lead inputs and retries after upgrade', async () => {
        await m.client.deliverySyncAccount.update({ where: { accountId: 'a' }, data: { capabilityStatus: 'supported', inboundCapabilityStatus: 'supported', capabilityExpiresAt: new Date(Date.now() + 3600000), capabilityDetails: Prisma.DbNull } });
        m.caps.mockResolvedValue({ schemaVersion: 1, capabilities: { configurationSync: true, inboundInputs: true } });
        const mixed = { ...inbound(), targets: [{ wooId: 11, stockOwnerWooId: 10, supplierLead: { min: 1, max: 2 } }, { wooId: 12, stockOwnerWooId: 10, supplierLead: { min: 3, max: 4 } }] };
        for (const id of ['i1', 'i2', 'i3']) await create(id, { scope: 'inbound', payload: id === 'i3' ? inbound() : mixed });
        for (const id of ['i1', 'i2', 'i3']) await dispatchDeliveryInput(await get(id));
        expect(m.caps).toHaveBeenCalledTimes(1); expect(m.post).toHaveBeenCalledTimes(1);
        expect(await get('i1')).toMatchObject({ status: 'plugin_update_required', lastDiagnostic: { source: 'local', reason: 'variant_supplier_leads_required', disposition: 'record_rejection' } });
        const good = await get('i3'); expect(good.status).toBe('synced');
        await retryDeliveryInput('a', 'i1');
        m.caps.mockResolvedValue({ schemaVersion: 1, capabilities: { configurationSync: true, inboundInputs: true, variantSupplierLeads: true } });
        await dispatchDeliveryInput(await get('i1'));
        expect((await get('i1')).status).toBe('synced'); expect((await get('i2')).status).toBe('plugin_update_required'); expect(await get('i3')).toEqual(good);
        expect(m.caps).toHaveBeenCalledTimes(2);
    });
});
