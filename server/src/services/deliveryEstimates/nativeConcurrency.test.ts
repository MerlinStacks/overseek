import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { openNativeDeliveryDatabase } from './__tests__/nativeDeliveryDatabase';

const m = vi.hoisted(() => ({ client: null as any, input: vi.fn(), control: vi.fn(), receipt: vi.fn() }));
vi.mock('../../utils/prisma', () => ({ prisma: new Proxy({}, { get: (_, key) => {
    const value = m.client[key];
    return typeof value === 'function' ? value.bind(m.client) : value;
} }) }));
vi.mock('../woo', () => ({ WooService: { forAccount: async () => ({
    postDeliveryInputs: m.input, deliveryControl: m.control, postGuardedReceipt: m.receipt,
}) } }));
vi.mock('../../utils/redis', () => ({ redisClient: {} }));
import { lockDeliveryAccount, recordIntent, recordSettingsIntent } from './intents';
import { queueDeliveryDisable } from './controlIntents';
import { dispatchDeliveryInput, reconcileDeliveryDispatch } from './sync';
import { dispatchGuardedReceipt } from './receiptWorker';
import { dispatchReceiptCascade } from './receiptCascade';
import { deliveryReadiness, drainDeliveryControls, requestCutover, requestActivation } from './launch';
import { FRESHNESS_PREREQUISITE_SQL } from './freshnessPrerequisite';
import { defaultSettings } from './validation';

describe.skipIf(!process.env.DELIVERY_FRESHNESS_TEST_DATABASE_URL)('native delivery worker concurrency and finalization (actual Prisma SQL)', () => {
    let fixture: Awaited<ReturnType<typeof openNativeDeliveryDatabase>>;
    let db: any;
    beforeEach(async () => {
        fixture = await openNativeDeliveryDatabase(); db = fixture.db; m.client = fixture.client;
        vi.clearAllMocks();
        m.control.mockImplementation(async (command?: any) => command
            ? { schemaVersion: 1, revision: command.revision, state: { active: command.action === 'activate', mode: 'guarded', epoch: 'epoch' } }
            : { schemaVersion: 1, protocolVersion: 1, blockers: [], wooVersion: '10.6.2', presentation: 'classic', environmentFingerprint: 'a'.repeat(64), state: { revision: 1, active: false, mode: 'guarded', epoch: 'epoch' } });
        m.input.mockImplementation(async (e: any) => ({ schemaVersion: 1, scope: e.scope, entityId: e.entityId, revision: e.revision, storedRevision: e.revision, applied: true, storefrontActivated: false }));
        await m.client.deliverySyncAccount.create({ data: { accountId: 'a', capabilityStatus: 'supported', inboundCapabilityStatus: 'supported', capabilityExpiresAt: new Date(Date.now() + 3600000) } });
    }, 30000);
    afterEach(async () => { await fixture?.close(); m.client = null; });

    const row = async (table: string) => (await db.query(`SELECT * FROM "${table}" WHERE "accountId"='a'`)).rows[0];
    async function input(scope: 'settings' | 'inbound' = 'settings') {
        await m.client.$transaction(async (tx: any) => { await lockDeliveryAccount(tx, 'a'); await recordIntent(tx, 'a', scope, scope === 'settings' ? 0 : 10, { enabled: true }); });
        return m.client.deliveryInputSync.findFirstOrThrow({ where: { accountId: 'a' } });
    }
    async function seedReceipt() {
        await m.client.receiptAccount.create({ data: { accountId: 'a', capability: 'supported', capabilityExpiresAt: new Date(Date.now() + 3600000) } });
        await m.client.receiptOwner.create({ data: { accountId: 'a', stockOwnerWooId: 10, lastSequence: 1n } });
        await m.client.receiptCycle.create({ data: { id: 'cycle', accountId: 'a', purchaseOrderId: 'po' } });
        await m.client.receiptOperation.create({ data: { operationId: 'op', accountId: 'a', cycleId: 'cycle', purchaseOrderId: 'po', productId: 'p', productWooId: 10, stockOwnerWooId: 10, sequence: 1n, delta: 2 } });
    }
    const receiptAck = (phase: string, op: any) => ({ schemaVersion: 1, operationId: op.operationId, sequence: op.sequence, stockOwnerWooId: op.stockOwnerWooId,
        guardActive: true, receiptSafety: 'unverified', state: phase === 'prepare' ? 'prepared' : 'applied', stockQuantity: phase === 'prepare' ? null : 12 });

    it('rejects missing cutover SQL before freeze but still finalizes explicit disable without the trigger', async () => {
        await db.exec(`ALTER TABLE "WooProduct" DISABLE TRIGGER delivery_product_write`);
        await expect(requestCutover('a', 'operator')).rejects.toThrow('freshness_sql_prerequisite_missing');
        expect(await row('ReceiptAccount')).toBeUndefined();
        expect((await db.query(`SELECT "receiptTransportMode" FROM "Account" WHERE id='a'`)).rows[0].receiptTransportMode).toBe('LEGACY');
        await m.client.receiptAccount.create({ data: { accountId: 'a', active: true, desiredActive: true } });
        await requestActivation('a', false);
        await drainDeliveryControls();
        expect(await row('ReceiptAccount')).toMatchObject({ active: false, desiredActive: false, controlAction: null, controlAckRevision: '1', controlError: null });
        expect(m.control).toHaveBeenCalledWith(expect.objectContaining({ action: 'disable' }), expect.any(Number));
        expect((await db.query(FRESHNESS_PREREQUISITE_SQL)).rows).toContainEqual({ missing: 'trigger:WooProduct.delivery_product_write' });
    });

    it('rechecks actual SQL after the guarded ACK and can resume immediately after SQL repair', async () => {
        await m.client.receiptAccount.create({ data: { accountId: 'a', cutoverState: 'baseline', cutoverEpoch: 'epoch', receivingFrozen: true,
            controlAction: 'cutover', controlRevision: 1n, controlPayload: { schemaVersion: 1, revision: 1, action: 'guarded', epoch: 'epoch', owners: [] } } });
        const healthyTransport = m.control.getMockImplementation()!;
        let damage = true;
        m.control.mockImplementation(async (command?: any) => {
            if (command?.action === 'guarded' && damage) { damage = false; await db.exec(`ALTER TABLE "WooProduct" DISABLE TRIGGER delivery_product_write`); }
            return healthyTransport(command);
        });
        await drainDeliveryControls();
        expect((await db.query(`SELECT "receiptTransportMode" FROM "Account" WHERE id='a'`)).rows[0].receiptTransportMode).toBe('LEGACY');
        expect(await row('ReceiptAccount')).toMatchObject({ cutoverState: 'baseline', receivingFrozen: true, controlAckRevision: '0' });
        expect((await row('ReceiptAccount')).controlError).toContain('freshness_sql_prerequisite_missing');
        await db.exec(`ALTER TABLE "WooProduct" ENABLE TRIGGER delivery_product_write; UPDATE "ReceiptAccount" SET "controlNextAttemptAt"=now() WHERE "accountId"='a'`);
        await drainDeliveryControls();
        expect((await db.query(`SELECT "receiptTransportMode" FROM "Account" WHERE id='a'`)).rows[0].receiptTransportMode).toBe('GUARDED');
        expect(await row('ReceiptAccount')).toMatchObject({ receivingFrozen: false, controlAckRevision: '1', controlError: null });
    });

    it('blocks the actual Account FOR UPDATE on a second connection until commit', async () => {
        const pid = Number((await m.client.$queryRawUnsafe('SELECT pg_backend_pid() AS pid'))[0].pid);
        await db.exec(`BEGIN; SELECT id FROM "Account" WHERE id='a' FOR UPDATE`);
        const pending = m.client.$transaction(async (tx: any) => { await lockDeliveryAccount(tx, 'a'); await tx.deliverySyncAccount.update({ where: { accountId: 'a' }, data: { inboundGeneration: { increment: 1 } } }); });
        try {
            await vi.waitFor(async () => {
                expect((await db.query('SELECT cardinality(pg_blocking_pids($1)) AS n', [pid])).rows[0].n).toBe(1);
            });
            expect((await row('DeliverySyncAccount')).inboundGeneration).toBe(0);
        } finally { await db.exec('COMMIT'); await pending; }
        expect((await row('DeliverySyncAccount')).inboundGeneration).toBe(1);
    });

    it('runs readiness against the complete migration chain and atomically rolls back/commits explicit feature disable', async () => {
        expect(fixture.migrations).toHaveLength(13);
        expect((await db.query(FRESHNESS_PREREQUISITE_SQL)).rows).toEqual([]);
        await db.exec(`UPDATE "Account" SET "receiptTransportMode"='GUARDED' WHERE id='a';
            INSERT INTO "WooProduct" (id,"accountId","wooId","productionMinDays","productionMaxDays","rawData") VALUES ('p','a',10,0,2,'{"type":"simple"}');`);
        await m.client.receiptAccount.create({ data: { accountId: 'a', cutoverState: 'guarded', cutoverEpoch: 'epoch', desiredActive: true, active: true } });
        const settings = { ...defaultSettings('UTC'), shippingMethods: [{ methodId: 'flat_rate', instanceId: 7, zoneId: 0, zoneName: 'Rest', title: 'Shipping', enabled: true, minTransitDays: 1, maxTransitDays: 2, fulfilmentType: 'delivery' }] };
        await m.client.deliveryEstimateSettings.create({ data: { accountId: 'a', settings } });
        await m.client.$transaction(async (tx: any) => {
            await lockDeliveryAccount(tx, 'a'); await recordSettingsIntent(tx, 'a');
            await recordIntent(tx, 'a', 'inbound', 10, { generatedAt: new Date().toISOString(), expiresAt: new Date(Date.now() + 86400000).toISOString(), receiptSafety: 'verified', receiptProof: { epoch: 'epoch' }, targets: [{ wooId: 10, state: 'pending' }] });
        });
        await db.exec(`UPDATE "DeliveryInputSync" SET status='synced',"ackRevision"="desiredRevision"; UPDATE "DeliverySyncAccount" SET "inboundRequested"=false`);
        expect(await deliveryReadiness('a')).toMatchObject({ ready: true, configuredCount: 1, eligibleConfiguredCount: 1, blockers: [] });
        const disable = (fail: boolean) => m.client.$transaction(async (tx: any) => {
            await lockDeliveryAccount(tx, 'a');
            await tx.$executeRaw`INSERT INTO "AccountFeature" (id,"accountId","featureKey","isEnabled") VALUES ('feature','a','DELIVERY_ESTIMATES',false)`;
            await queueDeliveryDisable(tx, 'a'); await recordSettingsIntent(tx, 'a');
            if (fail) throw new Error('rollback sentinel');
        });
        await expect(disable(true)).rejects.toThrow('rollback sentinel');
        expect((await row('ReceiptAccount')).desiredActive).toBe(true);
        expect((await db.query(`SELECT "inboundRenewAt" FROM "DeliveryInputSync" WHERE scope='inbound'`)).rows[0].inboundRenewAt).not.toBeNull();
        expect((await db.query('SELECT * FROM "AccountFeature"')).rowCount).toBe(0);
        await disable(false);
        expect((await row('ReceiptAccount'))).toMatchObject({ desiredActive: false, controlAction: 'disable' });
        expect((await db.query(`SELECT payload,status FROM "DeliveryInputSync" WHERE scope='settings'`)).rows[0]).toMatchObject({ payload: { enabled: false }, status: 'pending' });
        expect((await db.query(`SELECT "inboundRenewAt" FROM "DeliveryInputSync" WHERE scope='inbound'`)).rows[0].inboundRenewAt).toBeNull();
        expect((await deliveryReadiness('a')).blockers).toContain('feature_disabled');
        await drainDeliveryControls();
        expect(await row('ReceiptAccount')).toMatchObject({ active: false, controlAction: null, controlAckRevision: '1', controlLeaseToken: null });
    });

    it('records only the sent ACK when a new desired revision commits while the request is in flight', async () => {
        const job = await input();
        m.input.mockImplementationOnce(async (e: any) => {
            await db.exec(`UPDATE "DeliveryInputSync" SET "desiredRevision"="desiredRevision"+1,payload='{"enabled":false}',status='pending'`);
            return { schemaVersion: 1, scope: e.scope, entityId: e.entityId, revision: e.revision, storedRevision: e.revision, applied: true, storefrontActivated: false };
        });
        await dispatchDeliveryInput(job);
        expect(await row('DeliveryInputSync')).toMatchObject({ desiredRevision: '2', ackRevision: '1', status: 'pending', leaseToken: null });
        expect(await row('DeliverySyncAccount')).toMatchObject({ hasWork: true, leaseToken: null });
    });

    it('finalizes the current input revision and sleeps the drained account', async () => {
        await dispatchDeliveryInput(await input());
        expect(m.input).toHaveBeenCalledTimes(1);
        expect(await row('DeliveryInputSync')).toMatchObject({ desiredRevision: '1', ackRevision: '1', status: 'synced', leaseToken: null });
        expect(await row('DeliverySyncAccount')).toMatchObject({ hasWork: false, leaseToken: null });
    });

    it('rejects an input ACK and cleanup from a replaced lease owner', async () => {
        const job = await input();
        m.input.mockImplementationOnce(async (e: any) => {
            await db.exec(`BEGIN; UPDATE "DeliveryInputSync" SET "leaseToken"='replacement'; UPDATE "DeliverySyncAccount" SET "leaseToken"='replacement'; COMMIT`);
            return { schemaVersion: 1, scope: e.scope, entityId: e.entityId, revision: e.revision, storedRevision: e.revision, applied: true, storefrontActivated: false };
        });
        await dispatchDeliveryInput(job);
        expect(await row('DeliveryInputSync')).toMatchObject({ ackRevision: '0', status: 'pending', leaseToken: 'replacement' });
        expect(await row('DeliverySyncAccount')).toMatchObject({ leaseToken: 'replacement' });
    });

    it('rejects an inbound generation CAS made stale while its claim waits on a row lock', async () => {
        const job = await input('inbound');
        const pid = Number((await m.client.$queryRawUnsafe('SELECT pg_backend_pid() AS pid'))[0].pid);
        await db.exec(`BEGIN; UPDATE "DeliverySyncAccount" SET "inboundGeneration"="inboundGeneration"+1,"inboundVersion"="inboundVersion"+1,"inboundRequested"=true WHERE "accountId"='a'`);
        const pending = dispatchDeliveryInput(job);
        try { await vi.waitFor(async () => { expect((await db.query('SELECT cardinality(pg_blocking_pids($1)) AS n', [pid])).rows[0].n).toBe(1); }); }
        finally { await db.exec('COMMIT'); await pending; }
        expect(m.input).not.toHaveBeenCalled();
        expect(await row('DeliveryInputSync')).toMatchObject({ ackRevision: '0', leaseToken: null });
        expect(await row('DeliverySyncAccount')).toMatchObject({ inboundGeneration: 1, inboundVersion: 1, inboundRequested: true, leaseToken: null });
        await reconcileDeliveryDispatch('a');
        expect((await row('DeliverySyncAccount')).hasWork).toBe(false);
    });

    it.each(['revision', 'lease'])('fences control ACK finalization after competing %s replacement', async replacement => {
        await m.client.receiptAccount.create({ data: { accountId: 'a', controlAction: 'disable', controlRevision: 1n, active: true } });
        m.control.mockImplementationOnce(async (command: any) => {
            // A new intent clears the old envelope. Defer its dispatch so the fair
            // multi-command drain tests only this in-flight ACK's revision fence.
            await db.exec(replacement === 'revision'
                ? `UPDATE "ReceiptAccount" SET "controlRevision"=2,"controlAction"='activate',"desiredActive"=true,"controlPayload"=NULL,"controlNextAttemptAt"=now()+interval '1 hour'`
                : `UPDATE "ReceiptAccount" SET "controlLeaseToken"='replacement'`);
            return { schemaVersion: 1, revision: command.revision, state: { active: false } };
        });
        await drainDeliveryControls();
        expect(m.control).toHaveBeenCalledTimes(1);
        expect(await row('ReceiptAccount')).toMatchObject({ active: true, controlAckRevision: '0', controlLeaseToken: replacement === 'lease' ? 'replacement' : null });
        if (replacement === 'revision') expect(await row('ReceiptAccount')).toMatchObject({ controlRevision: '2', controlAction: 'activate', desiredActive: true, controlPayload: null });
    });

    it('finalizes guarded cutover, changes transport mode and queues a fresh inbound generation atomically', async () => {
        await m.client.receiptAccount.create({ data: { accountId: 'a', cutoverState: 'baseline', cutoverEpoch: 'epoch', receivingFrozen: true,
            controlAction: 'cutover', controlRevision: 1n, controlPayload: { schemaVersion: 1, revision: 1, action: 'guarded', epoch: 'epoch', owners: [10] } } });
        await drainDeliveryControls();
        expect((await row('ReceiptAccount')).controlError).toBeNull();
        expect(await row('ReceiptAccount')).toMatchObject({ cutoverState: 'guarded', receivingFrozen: false, controlAckRevision: '1', controlAction: null, controlLeaseToken: null });
        expect((await db.query(`SELECT "receiptTransportMode" FROM "Account" WHERE id='a'`)).rows[0].receiptTransportMode).toBe('GUARDED');
        expect(await row('ReceiptOwner')).toMatchObject({ stockOwnerWooId: 10, certifiedEpoch: 'epoch' });
        expect(await row('DeliverySyncAccount')).toMatchObject({ inboundGeneration: 1, inboundRequested: true, inboundFullRequested: true });
    });

    it('finalizes an actual guarded receipt and rejects immutable intent changes', async () => {
        await seedReceipt(); m.receipt.mockImplementation(async (phase: string, op: any) => receiptAck(phase, op));
        await dispatchGuardedReceipt('a');
        expect(m.receipt).toHaveBeenCalledTimes(2);
        expect(await row('ReceiptOperation')).toMatchObject({ state: 'applied', stockQuantity: 12 });
        expect(await row('ReceiptOwner')).toMatchObject({ appliedSequence: '1', leaseToken: null });
        expect(await row('ReceiptOperation')).toMatchObject({ cascadeState: 'pending' });
        await dispatchReceiptCascade('a');
        expect(await row('ReceiptOperation')).toMatchObject({ cascadeState: 'done' });
        expect(await row('ReceiptOwner')).toMatchObject({ cascadePending: false });
        await expect(db.exec(`UPDATE "ReceiptOperation" SET delta=3`)).rejects.toThrow('Receipt operation intent is immutable');
    });

    it.each(['account', 'owner'])('rejects receipt ACK and preserves the replaced %s lease', async replacement => {
        await seedReceipt();
        m.receipt.mockImplementationOnce(async (phase: string, op: any) => {
            await db.exec(`UPDATE "${replacement === 'account' ? 'ReceiptAccount' : 'ReceiptOwner'}" SET "leaseToken"='replacement'`);
            return receiptAck(phase, op);
        });
        await dispatchGuardedReceipt('a');
        expect(m.receipt).toHaveBeenCalledTimes(1);
        expect(await row('ReceiptOperation')).toMatchObject({ state: 'pending' });
        expect(await row('ReceiptOwner')).toMatchObject({ appliedSequence: '0' });
        expect((await row(replacement === 'account' ? 'ReceiptAccount' : 'ReceiptOwner')).leaseToken).toBe('replacement');
    });
});
