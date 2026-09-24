import { readFile } from 'node:fs/promises';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { openNativeDeliveryDatabase } from './__tests__/nativeDeliveryDatabase';
import { extendNativeReceiptBaseline } from './__tests__/nativeReceiptBaseline';

const m = vi.hoisted(() => ({ client: null as any, receipt: vi.fn(), get: vi.fn(), write: vi.fn(),
    redis: { get: vi.fn(), setnx: vi.fn(), expire: vi.fn(), setex: vi.fn(), del: vi.fn() } }));
vi.mock('../../utils/prisma', () => ({ prisma: new Proxy({}, { get: (_, key) => {
    const value = m.client[key]; return typeof value === 'function' ? value.bind(m.client) : value;
} }) }));
vi.mock('../../utils/redis', () => ({ redisClient: m.redis }));
vi.mock('../../utils/logger', () => ({ Logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));
vi.mock('../woo', () => ({ WooService: { forAccount: async () => ({
    postGuardedReceipt: m.receipt, getProduct: m.get, updateProduct: m.write,
}) } }));
import { recordGuardedReceipt } from './receipts';
import { dispatchGuardedReceipt } from './receiptWorker';
import { dispatchReceiptCascade, retryReceiptCascade } from './receiptCascade';
import { BOMConsumptionService } from '../BOMConsumptionService';
import { materializeLegacyBomReviews } from './bomStockTransport';
import { lockDeliveryAccount, recordIntent } from './intents';
import { renewInboundInputs, wakeInboundTargets } from './inboundRenewal';
import { FRESHNESS_PREREQUISITE_SQL } from './freshnessPrerequisite';

describe.skipIf(!process.env.DELIVERY_FRESHNESS_TEST_DATABASE_URL)('native 13-migration receipt/cascade services', () => {
    let fixture: Awaited<ReturnType<typeof openNativeDeliveryDatabase>>;
    let db: any;
    let remote: Map<number, number>;
    beforeEach(async () => {
        fixture = await openNativeDeliveryDatabase(); db = fixture.db; m.client = fixture.client;
        await extendNativeReceiptBaseline(db);
        vi.resetAllMocks(); remote = new Map([[10, 10], [20, 0]]);
        m.redis.get.mockResolvedValue(null); m.redis.setnx.mockResolvedValue(1);
        const applied = new Set<string>();
        m.receipt.mockImplementation(async (phase: string, op: any) => {
            if (phase === 'apply' && !applied.has(op.operationId)) {
                remote.set(op.stockOwnerWooId, remote.get(op.stockOwnerWooId)! + op.delta); applied.add(op.operationId);
            }
            return { schemaVersion: 1, operationId: op.operationId, sequence: op.sequence, stockOwnerWooId: op.stockOwnerWooId,
                state: phase === 'prepare' ? 'prepared' : 'applied', stockQuantity: phase === 'prepare' ? null : remote.get(op.stockOwnerWooId),
                guardActive: true, receiptSafety: 'unverified' };
        });
        m.get.mockImplementation(async (id: number) => ({ id, type: 'simple', stock_quantity: remote.get(id), manage_stock: true }));
        m.write.mockImplementation(async (id: number, data: any) => { remote.set(id, data.stock_quantity); return { id, ...data }; });
        await db.exec(`UPDATE "Account" SET "receiptTransportMode"='GUARDED' WHERE id='a';
            INSERT INTO "WooProduct" (id,"accountId","wooId","manageStock","rawData") VALUES
                ('component','a',10,true,'{"id":10,"type":"simple","manage_stock":true,"stock_quantity":10}'),
                ('finished','a',20,true,'{"id":20,"type":"simple","manage_stock":true}');
            INSERT INTO "PurchaseOrder" (id,"accountId",status) VALUES ('po','a','ORDERED');`);
        await m.client.receiptAccount.create({ data: { accountId: 'a', capability: 'supported', capabilityExpiresAt: new Date(Date.now() + 3600000), cutoverState: 'guarded', cutoverEpoch: 'epoch' } });
    }, 30000);
    afterEach(async () => { await fixture?.close(); m.client = null; });

    const ops = () => m.client.receiptOperation.findMany({ orderBy: { sequence: 'asc' } });
    const stock = async () => (await db.query(`SELECT "stockQuantity" FROM "WooProduct" WHERE id='component'`)).rows[0].stockQuantity;
    const owner = () => m.client.receiptOwner.findUniqueOrThrow({ where: { accountId_stockOwnerWooId: { accountId: 'a', stockOwnerWooId: 10 } } });
    const transact = (fn: (tx: any) => Promise<any>) => m.client.$transaction(async (tx: any) => { await lockDeliveryAccount(tx, 'a'); return fn(tx); });
    const po = (items: any[], status = 'ORDERED') => ({ id: 'po', status, items });
    const line = { id: 'line', productId: 'component', variationWooId: null, quantity: 3 };
    const order = { id: 123, status: 'processing', line_items: [{ product_id: 20, variation_id: 0, quantity: 1, name: 'Finished BOM' }] };
    async function bom() {
        await db.exec(`INSERT INTO "BOM" (id,"productId","variationId") VALUES ('bom','finished',0);
            INSERT INTO "BOMItem" (id,"bomId","isActive",quantity,"childProductId") VALUES ('item','bom',true,2,'component')`);
    }

    it('records a real parent-owned variation receipt under the repaired CHECK and rolls back stock/ledger atomically', async () => {
        await db.exec(`UPDATE "WooProduct" SET "rawData"='{"id":10,"type":"variable","manage_stock":true,"variations":[11]}' WHERE id='component';
            INSERT INTO "ProductVariation" (id,"productId","wooId","manageStock","rawData") VALUES ('v','component',11,false,'{"id":11,"parent_id":10,"manage_stock":"parent"}')`);
        const receive = (abort: boolean) => transact(async tx => {
            const result = await recordGuardedReceipt(tx, 'a', po([{ ...line, variationWooId: 11 }]), false);
            if (abort) throw new Error('intent rollback'); return result;
        });
        await expect(receive(true)).rejects.toThrow('intent rollback');
        expect(await stock()).toBe(10); expect(await ops()).toEqual([]);
        expect(await m.client.receiptCycle.count()).toBe(0);
        expect(await receive(false)).toMatchObject({ updated: 1, guarded: true });
        const [op] = await ops();
        expect(op).toMatchObject({ productWooId: 10, variationWooId: 11, stockOwnerWooId: 10, variationId: null, state: 'pending', cascadeState: 'waiting_receipt', delta: 3 });
        expect(await stock()).toBe(13);
        expect((await db.query(`SELECT "stockQuantity" FROM "ProductVariation" WHERE id='v'`)).rows[0].stockQuantity).toBe(10);
        await expect(db.exec(`UPDATE "ReceiptOperation" SET "sourceId"='forged'`)).rejects.toThrow('Receipt operation source is immutable');
        await expect(db.exec(`UPDATE "ReceiptOperation" SET delta=4`)).rejects.toThrow('Receipt operation intent is immutable');
        await m.client.receiptOwner.create({ data: { accountId: 'a', stockOwnerWooId: 11, lastSequence: 1n } });
        await expect(m.client.receiptOperation.create({ data: { operationId: 'invalid-parent', accountId: 'a', cycleId: op.cycleId, purchaseOrderId: 'po', productId: 'component', productWooId: 10, stockOwnerWooId: 11, sequence: 1n, delta: 1 } })).rejects.toThrow(/check constraint/i);
        expect(m.receipt).not.toHaveBeenCalled();
    });

    it('keeps skipped/empty cycles immutable and reverses from provenance instead of edited PO lines', async () => {
        await bom();
        const skipped = [{ ...line, id: 'unlinked', productId: null }, { ...line, id: 'assembly', productId: 'finished' }];
        expect(await transact(tx => recordGuardedReceipt(tx, 'a', po(skipped), false))).toMatchObject({ updated: 0, skipped: false });
        const cycle = await m.client.receiptCycle.findFirstOrThrow();
        expect(cycle.skippedLines).toEqual(expect.arrayContaining([
            expect.objectContaining({ reason: 'unlinked_or_supplier_only', lineId: 'unlinked' }),
            expect.objectContaining({ reason: 'finished_bom', lineId: 'assembly' }),
        ]));
        await expect(db.exec(`UPDATE "ReceiptCycle" SET "skippedLines"='[]'`)).rejects.toThrow('Receipt cycle provenance is immutable');
        expect(await transact(tx => recordGuardedReceipt(tx, 'a', po([line], 'RECEIVED'), true))).toMatchObject({ updated: 0, skipped: false });
        expect(await ops()).toEqual([]); expect(await stock()).toBe(10);
        expect(await m.client.receiptCycle.findFirstOrThrow()).toMatchObject({ active: false, skippedLines: cycle.skippedLines });
        expect((await db.query(`SELECT status FROM "PurchaseOrder" WHERE id='po'`)).rows[0].status).toBe('ORDERED');
        expect(m.receipt).not.toHaveBeenCalled();
    });

    it('persists pending -> applied -> cascade failed -> retried -> done using real BOM queries, without delta replay', async () => {
        await bom(); await transact(tx => recordGuardedReceipt(tx, 'a', po([line]), false));
        const [created] = await ops();
        expect(created).toMatchObject({ state: 'pending', cascadeState: 'waiting_receipt' });
        await expect(retryReceiptCascade('a', created.operationId, 'actor')).rejects.toThrow('stock must be settled');
        await dispatchGuardedReceipt('a');
        expect((await ops())[0]).toMatchObject({ state: 'applied', cascadeState: 'pending', attempts: 1 });
        expect(await owner()).toMatchObject({ appliedSequence: 1n, cascadePending: true });
        m.write.mockRejectedValue(new Error('derived stock transport unavailable'));
        for (let attempt = 1; attempt <= 8; attempt++) {
            await dispatchReceiptCascade('a');
            expect((await ops())[0]).toMatchObject({ state: 'applied', cascadeAttempts: attempt, cascadeState: attempt === 8 ? 'failed' : 'pending' });
            if (attempt < 8) await db.exec(`UPDATE "ReceiptOperation" SET "cascadeNextAttemptAt"=now()`);
        }
        expect(await owner()).toMatchObject({ cascadePending: true });
        await dispatchGuardedReceipt('a'); expect(m.receipt).toHaveBeenCalledTimes(2);
        expect(await retryReceiptCascade('a', created.operationId, 'actor')).toMatchObject({ cascadeState: 'pending' });
        expect(await m.client.auditLog.count({ where: { source: 'MANUAL' } })).toBe(1);
        m.write.mockImplementation(async (id: number, data: any) => { remote.set(id, data.stock_quantity); return { id, ...data }; });
        await dispatchReceiptCascade('a');
        expect((await ops())[0]).toMatchObject({ state: 'applied', cascadeState: 'done', cascadeAttempts: 1, cascadeError: null, delta: 3, sequence: 1n });
        expect((await ops())[0].cascadeCompletedAt).toBeInstanceOf(Date);
        expect(await owner()).toMatchObject({ appliedSequence: 1n, cascadePending: false });
        expect(await stock()).toBe(13); expect(remote.get(10)).toBe(13); expect(remote.get(20)).toBe(6);
        expect(m.write.mock.calls.every(([id]) => id === 20)).toBe(true);
        await dispatchReceiptCascade('a'); await dispatchGuardedReceipt('a');
        expect(m.receipt).toHaveBeenCalledTimes(2); expect(await ops()).toHaveLength(1);
    }, 30000);

    it.each([true, false])('sequences real guarded BOM order consume/cancel, cancellation before ACK=%s', async beforeAck => {
        await bom();
        const consumed = await BOMConsumptionService.consumeOrderComponents('a', order);
        expect(consumed.errors).toEqual([]); expect(consumed.consumed).toHaveLength(1);
        expect(await stock()).toBe(8); expect(m.write).not.toHaveBeenCalled(); expect(m.receipt).not.toHaveBeenCalled();
        expect(await BOMConsumptionService.consumeOrderComponents('a', order)).toMatchObject({ skipped: true });
        expect(await ops()).toHaveLength(1);
        if (!beforeAck) {
            await dispatchGuardedReceipt('a'); await dispatchReceiptCascade('a');
            expect(await m.client.bOMDeductionLedger.findFirstOrThrow()).toMatchObject({ status: 'COMPLETED' });
        }
        expect(await BOMConsumptionService.reverseOrderConsumption('a', { ...order, status: 'cancelled' })).toMatchObject({ reversed: 1, errors: [] });
        expect(await BOMConsumptionService.reverseOrderConsumption('a', { ...order, status: 'cancelled' })).toMatchObject({ reversed: 0 });
        expect((await ops()).map((op: any) => [op.sequence, op.delta, op.sourceType])).toEqual([[1n, -2, 'bom_consumption'], [2n, 2, 'bom_reversal']]);
        expect(await stock()).toBe(10);
        if (beforeAck) { await dispatchGuardedReceipt('a'); await dispatchReceiptCascade('a'); }
        await dispatchGuardedReceipt('a'); await dispatchReceiptCascade('a');
        expect(await owner()).toMatchObject({ lastSequence: 2n, appliedSequence: 2n, cascadePending: false });
        expect((await ops()).every((op: any) => op.state === 'applied' && op.cascadeState === 'done')).toBe(true);
        expect(await m.client.bOMDeductionLedger.findFirstOrThrow()).toMatchObject({ status: 'REVERSED' });
        expect(m.receipt.mock.calls.filter(([phase]) => phase === 'apply').map(([, op]) => [op.sequence, op.delta])).toEqual([[1, -2], [2, 2]]);
        expect(remote.get(10)).toBe(10); expect(remote.get(20)).toBe(5);
        expect(m.write.mock.calls.every(([id]) => id === 20)).toBe(true);
    });

    it('materializes unknown legacy BOM work for review without retroactive native deltas or stock writes', async () => {
        await m.client.bOMDeductionLedger.create({ data: { id: 'old', accountId: 'a', orderId: 123, componentType: 'WooProduct', componentId: 'component', componentName: 'old', wooId: 10, quantityDeducted: 2, previousStock: 12, newStock: 10, status: 'EXECUTED' } });
        const original = await m.client.bOMDeductionLedger.findFirstOrThrow();
        expect(await transact(tx => materializeLegacyBomReviews(tx, 'a'))).toBe(1);
        await transact(tx => materializeLegacyBomReviews(tx, 'a'));
        expect(await m.client.receiptLegacyWork.count()).toBe(1);
        expect(await m.client.receiptLegacyWork.findFirstOrThrow()).toMatchObject({ state: 'pending', sourceType: 'bom_consumption', sourceId: 'old' });
        await expect(BOMConsumptionService.reverseOrderConsumption('a', order)).rejects.toThrow('Legacy BOM consumption needs operator review');
        expect(await m.client.bOMDeductionLedger.findFirstOrThrow()).toEqual(original);
        expect(await ops()).toEqual([]); expect(await stock()).toBe(10);
        expect(m.write).not.toHaveBeenCalled(); expect(m.receipt).not.toHaveBeenCalled();
        await expect(transact(tx => recordGuardedReceipt(tx, 'a', po([line], 'RECEIVED'), true))).rejects.toThrow('no guarded receipt ledger exists');
        expect(await m.client.receiptCycle.count()).toBe(0);
    });

    it('preserves historical receipt provenance through migration 13 and only schedules unfinished receipt cascades', async () => {
        const historical = await openNativeDeliveryDatabase(async (database, migration) => {
            if (migration !== '20260922170000_receipt_cascade') return;
            await database.exec(`INSERT INTO "PurchaseOrder" (id,"accountId",status) VALUES ('old-po','a','RECEIVED');
                INSERT INTO "ReceiptAccount" ("accountId") VALUES ('a');
                INSERT INTO "ReceiptLegacyWork" (id,"accountId","purchaseOrderId") VALUES ('unknown','a','old-po');
                INSERT INTO "ReceiptOwner" ("accountId","stockOwnerWooId","lastSequence","appliedSequence") VALUES ('a',10,3,2);
                INSERT INTO "ReceiptCycle" (id,"accountId","purchaseOrderId") VALUES ('history','a','tracked-po');
                INSERT INTO "ReceiptOperation" ("operationId","accountId","cycleId","purchaseOrderId","productId","productWooId","stockOwnerWooId",sequence,delta,state)
                VALUES ('applied','a','history','tracked-po','p',10,10,1,2,'applied'),
                    ('reconciled','a','history','tracked-po','p',10,10,2,3,'reconciled'),
                    ('pending','a','history','tracked-po','p',10,10,3,4,'pending');`);
        });
        try {
            expect(historical.migrations).toHaveLength(18);
            expect((await historical.db.query(`SELECT "operationId",delta,state,"cascadeState","sourceType","sourceId" FROM "ReceiptOperation" ORDER BY sequence`)).rows).toEqual([
                { operationId: 'applied', delta: 2, state: 'applied', cascadeState: 'done', sourceType: 'purchase_order', sourceId: null },
                { operationId: 'reconciled', delta: 3, state: 'reconciled', cascadeState: 'done', sourceType: 'purchase_order', sourceId: null },
                { operationId: 'pending', delta: 4, state: 'pending', cascadeState: 'waiting_receipt', sourceType: 'purchase_order', sourceId: null },
            ]);
            expect((await historical.db.query(`SELECT "receiptTransportMode" FROM "Account" WHERE id='a'`)).rows[0].receiptTransportMode).toBe('LEGACY');
            expect((await historical.db.query(`SELECT "cutoverState","cutoverEpoch" FROM "ReceiptAccount"`)).rows[0]).toEqual({ cutoverState: 'legacy', cutoverEpoch: null });
            expect((await historical.db.query(`SELECT state,targets,"sourceId" FROM "ReceiptLegacyWork"`)).rows[0]).toEqual({ state: 'pending', targets: null, sourceId: null });
            expect((await historical.db.query(`SELECT "skippedLines" FROM "ReceiptCycle"`)).rows[0].skippedLines).toBeNull();
            expect((await historical.db.query(`SELECT * FROM "ReceiptCycle" WHERE "purchaseOrderId"='old-po'`)).rowCount).toBe(0);
            expect((await historical.db.query(FRESHNESS_PREREQUISITE_SQL)).rows).toEqual([]);
        } finally { await historical.close(); }
    });

    it('verifies final function bodies, indexed renewal and actual renewal/wake services after all 18 migrations', async () => {
        expect(fixture.migrations).toHaveLength(18);
        expect((await db.query(FRESHNESS_PREREQUISITE_SQL)).rows).toEqual([]);
        const bodies = new Map<string, string>();
        for (const name of fixture.migrations) {
            const sql = await readFile(`prisma/migrations/${name}/migration.sql`, 'utf8');
            for (const match of sql.matchAll(/CREATE(?: OR REPLACE)? FUNCTION (\w+)\([^]*?AS \$\$([^]*?)\$\$/g)) bodies.set(match[1], match[2].trim());
        }
        expect(bodies.size).toBeGreaterThanOrEqual(17);
        const installed = (await db.query(`SELECT proname,prosrc FROM pg_proc WHERE pronamespace=current_schema()::regnamespace`)).rows;
        for (const [name, body] of bodies) expect(installed.find((fn: any) => fn.proname === name)?.prosrc.trim(), name).toBe(body);
        await m.client.deliverySyncAccount.create({ data: { accountId: 'a', capabilityStatus: 'supported', inboundCapabilityStatus: 'supported' } });
        await db.exec(`UPDATE "WooProduct" SET "productionMinDays"=0,"productionMaxDays"=1 WHERE id='component'; TRUNCATE "DeliveryInboundDirtyTarget"`);
        const payload = { generatedAt: new Date(Date.now() - 86400000).toISOString(), expiresAt: new Date(Date.now() + 3600000).toISOString(), targets: [{ wooId: 10 }] };
        await transact(tx => recordIntent(tx, 'a', 'inbound', 10, payload));
        await db.exec(`UPDATE "DeliveryInputSync" SET status='synced',"ackRevision"="desiredRevision"`);
        await renewInboundInputs(); await renewInboundInputs();
        expect(await m.client.deliveryInboundDirtyTarget.findMany()).toMatchObject([{ accountId: 'a', wooId: 10, version: 1 }]);
        expect(await m.client.deliveryInputSync.findFirstOrThrow()).toMatchObject({ payload, desiredRevision: 1n, inboundRenewAt: null });
        await db.exec(`UPDATE "DeliverySyncAccount" SET "inboundRequested"=false`);
        await wakeInboundTargets();
        expect(await m.client.deliverySyncAccount.findUniqueOrThrow({ where: { accountId: 'a' } })).toMatchObject({ inboundRequested: true });
        await db.exec('SET enable_seqscan=off');
        try {
            const plan = await db.query(`EXPLAIN (FORMAT JSON) SELECT id FROM "DeliveryInputSync" WHERE scope='inbound' AND status='synced' AND "inboundRenewAt"<=now() ORDER BY "inboundRenewAt",id LIMIT 40`);
            expect(JSON.stringify(plan.rows)).toContain('DeliveryInputSync_inbound_renew_idx');
        } finally { await db.exec('RESET enable_seqscan'); }
    });
});
