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
import { dispatchDeliveryInput, reconcileDeliveryDispatch, recoverStrandedDeliveryInputs, deliverySyncStatus, requestDeliverySync, selectDeliveryInput } from './sync';
import { buildInboundBatch } from './inboundResync';
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
        await m.client.deliverySyncAccount.create({ data: { accountId: 'a', capabilityStatus: 'supported', inboundCapabilityStatus: 'supported', capabilityDetails: { variantSupplierLeads: true }, capabilityExpiresAt: new Date(Date.now() + 3600000) } });
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
        expect(fixture.migrations).toHaveLength(19);
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

    it.each(['control', 'aggregate'])('status uses one read-only snapshot when a writer creates and requeues inputs after the %s read', async checkpoint => {
        await input();
        await db.exec(`UPDATE "DeliveryInputSync" SET status='synced',"ackRevision"=1,"lastAcknowledgedAt"='2026-09-22T00:00:00Z'`);
        await m.client.receiptAccount.create({ data: { accountId: 'a' } });
        const databaseState = async () => (await db.query(`SELECT jsonb_build_object(
            'control', (SELECT to_jsonb(c) FROM "DeliverySyncAccount" c WHERE "accountId"='a'),
            'inputs', (SELECT jsonb_agg(to_jsonb(i) ORDER BY id) FROM "DeliveryInputSync" i WHERE "accountId"='a'),
            'targets', (SELECT jsonb_agg(to_jsonb(d) ORDER BY "wooId") FROM "DeliveryInboundDirtyTarget" d WHERE "accountId"='a'),
            'launch', (SELECT to_jsonb(r) FROM "ReceiptAccount" r WHERE "accountId"='a')) AS state`)).rows[0].state;
        let afterWrite: unknown;
        let interleaved = false;
        const originalTransaction = m.client.$transaction.bind(m.client);
        const transaction = vi.spyOn(m.client, '$transaction').mockImplementation((callback: any, options: any) => originalTransaction(async (tx: any) => {
            const afterRead = async () => {
                if (interleaved) return;
                interleaved = true;
                expect(await tx.$queryRawUnsafe(`SELECT current_setting('transaction_isolation') AS isolation, current_setting('transaction_read_only') AS readonly`))
                    .toEqual([{ isolation: 'repeatable read', readonly: 'on' }]);
                // Independent native connection commits while GET holds its snapshot.
                // NOWAIT proves the reader did not acquire the Account writer lock.
                await db.exec(`BEGIN; SET LOCAL lock_timeout='250ms'; SELECT id FROM "Account" WHERE id='a' FOR UPDATE NOWAIT;
                    UPDATE "DeliveryInputSync" SET status='pending',"desiredRevision"=2,"lastError"='Transport retry pending',"updatedAt"=now();
                    INSERT INTO "DeliveryInputSync" (id,"accountId",scope,"entityId",payload,status,"ackRevision","updatedAt","lastAcknowledgedAt")
                        VALUES ('new-input','a','inbound',10,'{}','synced',1,now(),'2026-09-23T00:00:00Z');
                    INSERT INTO "DeliveryInboundDirtyTarget" ("accountId","wooId","updatedAt") VALUES ('a',10,now());
                    UPDATE "DeliverySyncAccount" SET "inboundRequested"=true,"inboundVersion"="inboundVersion"+1;
                    UPDATE "ReceiptAccount" SET active=true,"cutoverState"='guarded'; COMMIT`);
                afterWrite = await databaseState();
            };
            return callback(new Proxy(tx, { get(target, key) {
                if (key === 'deliverySyncAccount' && checkpoint === 'control') return new Proxy(target.deliverySyncAccount, { get(delegate, method) {
                    if (method === 'findUnique') return async (...args: any[]) => { const result = await delegate.findUnique(...args); await afterRead(); return result; };
                    const value = delegate[method]; return typeof value === 'function' ? value.bind(delegate) : value;
                } });
                if (key === '$queryRaw' && checkpoint === 'aggregate') return async (sql: TemplateStringsArray, ...args: any[]) => {
                    const result = await target.$queryRaw(sql, ...args);
                    if (sql.join('').includes('COUNT(*)')) await afterRead();
                    return result;
                };
                const value = target[key]; return typeof value === 'function' ? value.bind(target) : value;
            } }));
        }, options));
        let before;
        try { before = (await deliverySyncStatus('a')).status; }
        finally { transaction.mockRestore(); }
        expect(interleaved).toBe(true);
        expect(before).toMatchObject({ configurationSync: 'synced', pendingCount: 0, syncedCount: 1, storefrontActivated: false, receiptSafety: 'unverified',
            lastAcknowledgedAt: '2026-09-22T00:00:00.000Z', lastError: null,
            progress: { totalInputs: 1, acknowledgedInputs: 1, pendingInputs: 0, dirtyProducts: 0, rebuildingInbound: false } });
        expect(await databaseState()).toEqual(afterWrite);
        const after = (await deliverySyncStatus('a')).status;
        expect(after).toMatchObject({ configurationSync: 'pending', pendingCount: 2, syncedCount: 1, storefrontActivated: true, receiptSafety: 'guarded',
            lastAcknowledgedAt: '2026-09-23T00:00:00.000Z', lastError: 'Transport retry pending',
            progress: { totalInputs: 2, acknowledgedInputs: 2, pendingInputs: 1, dirtyProducts: 1, rebuildingInbound: true } });
        for (const status of [before!, after]) {
            const progress = status.progress;
            expect(progress.acknowledgedInputs).toBeLessThanOrEqual(progress.totalInputs);
            expect(progress.scopes.reduce((n, scope) => n + scope.total, 0)).toBe(progress.totalInputs);
            expect(progress.scopes.reduce((n, scope) => n + scope.acknowledged, 0)).toBe(progress.acknowledgedInputs);
            expect(progress.scopes.reduce((n, scope) => n + scope.synced, 0)).toBe(status.syncedCount);
            expect(progress.scopes.every(scope => scope.acknowledged <= scope.total)).toBe(true);
            expect(status.pendingCount).toBe(progress.totalInputs - status.syncedCount + Number(progress.rebuildingProducts) + Number(progress.rebuildingInbound));
        }
        expect(await databaseState()).toEqual(afterWrite);
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
        expect(await row('DeliverySyncAccount')).toMatchObject({ inboundRequested: true, inboundFullRequested: false, inboundGeneration: 1 });
        expect((await db.query('SELECT "wooId",version FROM "DeliveryInboundDirtyTarget"')).rows).toEqual([{ wooId: 10, version: 1 }]);
        expect((await deliverySyncStatus('a')).status.progress).toMatchObject({ totalInputs: 1, pendingInputs: 1, acknowledgedInputs: 0, dirtyProducts: 1, rebuildingInbound: true });
        expect((await requestDeliverySync('a')).requestDisposition).toBe('already_running');
        expect(await row('DeliveryInputSync')).toMatchObject({ desiredRevision: '1', ackRevision: '0', inboundGeneration: 0 });
        // Recovery builds current sources, including a real deleted-product tombstone.
        await buildInboundBatch('a');
        const rebuilt = await m.client.deliveryInputSync.findUniqueOrThrow({ where: { id: job.id } });
        expect(rebuilt).toMatchObject({ desiredRevision: 2n, inboundGeneration: 1, payload: { wooId: 10, targets: [] } });
        await dispatchDeliveryInput(job);
        expect(m.input).not.toHaveBeenCalled();
        await dispatchDeliveryInput(rebuilt);
        expect(m.input).toHaveBeenCalledTimes(1);
        expect(await m.client.deliveryInputSync.findUniqueOrThrow({ where: { id: job.id } })).toMatchObject({ desiredRevision: 2n, ackRevision: 2n, status: 'synced' });
    });

    it('recovers sleeping stranded generations in bounded target pages without changing historical ACKs or restarting a full pass', async () => {
        await m.client.deliveryInputSync.createMany({ data: Array.from({ length: 23 }, (_, index) => ({
            id: `stranded-${String(index).padStart(2, '0')}`, accountId: 'a', scope: 'inbound', entityId: index + 1,
            desiredRevision: 9n, ackRevision: 8n, payload: { wooId: index + 1, generatedAt: '2020-01-01T00:00:00Z', targets: [] },
        })) });
        await db.exec(`UPDATE "DeliverySyncAccount" SET "hasWork"=false,"inboundRequested"=false,"inboundFullRequested"=false,"inboundGeneration"=7`);
        expect(await selectDeliveryInput('a')).toBeUndefined();
        for (const expected of [10, 10, 3]) {
            await recoverStrandedDeliveryInputs();
            expect((await db.query('SELECT * FROM "DeliveryInboundDirtyTarget"')).rowCount).toBe(expected);
            expect(await row('DeliverySyncAccount')).toMatchObject({ inboundRequested: true, inboundFullRequested: false, inboundGeneration: 7, resyncGeneration: 0 });
            expect((await deliverySyncStatus('a')).status.progress.acknowledgedInputs).toBe(23);
            await buildInboundBatch('a');
        }
        const recovered = await m.client.deliveryInputSync.findMany({ where: { accountId: 'a', scope: 'inbound' } });
        expect(recovered).toHaveLength(23);
        expect(recovered.every((input: any) => input.desiredRevision === 10n && input.ackRevision === 8n && input.inboundGeneration === 7 && input.payload.generatedAt !== '2020-01-01T00:00:00Z')).toBe(true);
        expect(await row('DeliverySyncAccount')).toMatchObject({ inboundRequested: false, inboundFullRequested: false, inboundGeneration: 7 });
        expect((await db.query('SELECT * FROM "DeliveryInboundDirtyTarget"')).rowCount).toBe(0);
    });

    it('manual retry repairs a sleeping stranded row, while a real full pass retains responsibility for its old generations', async () => {
        const job = await input('inbound');
        await db.exec(`UPDATE "DeliverySyncAccount" SET "hasWork"=false,"inboundRequested"=false,"inboundFullRequested"=false,"inboundGeneration"=2`);
        expect((await requestDeliverySync('a')).requestDisposition).toBe('retrying');
        expect(await row('DeliveryInputSync')).toMatchObject({ desiredRevision: '1', ackRevision: '0', inboundGeneration: 0 });
        await db.exec(`DELETE FROM "DeliveryInboundDirtyTarget"; UPDATE "DeliverySyncAccount" SET "inboundFullRequested"=true,"inboundRequested"=true`);
        await reconcileDeliveryDispatch('a');
        await recoverStrandedDeliveryInputs();
        expect((await db.query('SELECT * FROM "DeliveryInboundDirtyTarget"')).rowCount).toBe(0);
        expect((await row('DeliverySyncAccount')).hasWork).toBe(false);
        await dispatchDeliveryInput(job);
        expect(m.input).not.toHaveBeenCalled();
    });

    it('preserves a failed builder and its cursor until explicit retry queues stranded source recovery', async () => {
        await input('inbound');
        await db.exec(`UPDATE "DeliverySyncAccount" SET "inboundGeneration"=3,"inboundRequested"=true,
            "inboundFailed"=true,"inboundAttempts"=8,"inboundCursor"='saved-cursor',"inboundNextAttemptAt"=now()+interval '1 hour'`);
        await recoverStrandedDeliveryInputs();
        await reconcileDeliveryDispatch('a');
        expect((await db.query('SELECT * FROM "DeliveryInboundDirtyTarget"')).rowCount).toBe(0);
        expect(await row('DeliverySyncAccount')).toMatchObject({ hasWork: false, inboundFailed: true, inboundAttempts: 8, inboundCursor: 'saved-cursor' });
        expect((await requestDeliverySync('a')).requestDisposition).toBe('retrying');
        expect(await row('DeliverySyncAccount')).toMatchObject({ inboundFailed: false, inboundAttempts: 0, inboundCursor: 'saved-cursor', inboundGeneration: 3, inboundFullRequested: false });
        expect((await db.query('SELECT "wooId" FROM "DeliveryInboundDirtyTarget"')).rows).toEqual([{ wooId: 10 }]);
        expect(await row('DeliveryInputSync')).toMatchObject({ desiredRevision: '1', ackRevision: '0', inboundGeneration: 0 });
    });

    it('requires dirty-target absence even with matching generation and no full pass, including a SQL source edit during HTTP', async () => {
        await db.exec(`INSERT INTO "WooProduct" (id,"accountId","wooId","productionMinDays","productionMaxDays","rawData") VALUES ('p','a',10,0,2,'{"type":"simple"}')`);
        const job = await input('inbound');
        expect(await row('DeliverySyncAccount')).toMatchObject({ inboundGeneration: 0, inboundFullRequested: false });
        await dispatchDeliveryInput(job);
        expect(m.input).not.toHaveBeenCalled();
        await reconcileDeliveryDispatch('a');
        expect((await row('DeliverySyncAccount')).hasWork).toBe(false);
        await db.exec(`DELETE FROM "DeliveryInboundDirtyTarget"`);
        m.input.mockImplementationOnce(async (e: any) => {
            await db.exec(`UPDATE "WooProduct" SET "productionMaxDays"=3 WHERE id='p'`);
            return { schemaVersion: 1, scope: e.scope, entityId: e.entityId, revision: e.revision, storedRevision: e.revision, applied: true, storefrontActivated: false };
        });
        await dispatchDeliveryInput(job);
        expect(m.input).toHaveBeenCalledTimes(1);
        expect(await row('DeliveryInputSync')).toMatchObject({ ackRevision: '1', status: 'pending' });
        expect((await db.query('SELECT "wooId" FROM "DeliveryInboundDirtyTarget"')).rows).toEqual([{ wooId: 10 }]);
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
