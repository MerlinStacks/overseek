import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { PrismaClient, Prisma } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { openNativeDeliveryDatabase } from '../deliveryEstimates/__tests__/nativeDeliveryDatabase';
import { extendNativeReceiptBaseline } from '../deliveryEstimates/__tests__/nativeReceiptBaseline';
const m = vi.hoisted(() => ({ transaction: vi.fn() }));
vi.mock('../../utils/prisma', () => ({ prisma: { $transaction: m.transaction } }));
import { persistWooProduct } from '../persistWooProduct';
import { DeliveryEstimateService } from '../deliveryEstimates/service';
import { buildInbound } from '../deliveryEstimates/inbound';

const deferred = () => { let resolve!: () => void; const promise = new Promise<void>(r => { resolve = r; }); return { promise, resolve }; };
/** Wrap only the selected delegate operation; every DB read/write is real Prisma. */
function intercept(tx: any, modelName: string, operation: string, run: (original: (...args: any[]) => any, args: any[]) => any) {
    return new Proxy(tx, { get(target, key) {
        const model = target[key];
        if (key === modelName) return new Proxy(model, { get(delegate, method) {
            if (method === operation) return (...args: any[]) => run(delegate[method].bind(delegate), args);
            const value = delegate[method]; return typeof value === 'function' ? value.bind(delegate) : value;
        } });
        return typeof model === 'function' ? model.bind(target) : model;
    } });
}

describe.skipIf(!process.env.DELIVERY_FRESHNESS_TEST_DATABASE_URL)('complete catalogue observation fencing (native overlapping transactions)', () => {
    let f: Awaited<ReturnType<typeof openNativeDeliveryDatabase>>;
    let other: PrismaClient;
    const older = new Date('2026-09-24T12:00:01Z');
    const newer = new Date('2026-09-24T12:00:02Z');
    beforeAll(async () => {
        f = await openNativeDeliveryDatabase();
        await extendNativeReceiptBaseline(f.db);
        const schema = (await f.db.query('SELECT current_schema() AS schema')).rows[0].schema;
        if (!/^freshness_test_[a-f0-9]+$/.test(schema)) throw new Error('Not an isolated test schema');
        other = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.DELIVERY_FRESHNESS_TEST_DATABASE_URL,
            max: 1, options: `-c search_path=${schema} -c statement_timeout=10000` }, { schema }) });
        await other.$connect();
    }, 30_000);
    afterAll(async () => { await other?.$disconnect(); await f?.close(); });
    beforeEach(async () => {
        m.transaction.mockReset().mockImplementation((work, options) => f.client.$transaction(work, options));
        await f.db.exec(`TRUNCATE "WooProduct", "ProductVariation", "BOM", "BOMItem", "DeliveryInputSync", "DeliverySyncAccount", "DeliveryInboundDirtyTarget" CASCADE;
            INSERT INTO "WooProduct" (id,"accountId","wooId","manageStock","stockQuantity","rawData","productionMinDays","productionMaxDays")
                VALUES ('p','a',10,true,7,'{"id":10,"type":"simple","manage_stock":true,"variations":[]}',1,2);
            INSERT INTO "ProductVariation" (id,"productId","wooId","manageStock","stockQuantity",cogs,"rawData","deliveryActive") VALUES
                ('v11','p',11,true,17,5,'{"id":11,"manage_stock":true,"image":null,"source":"history"}',false),
                ('v12','p',12,true,31,9,'{"id":12,"manage_stock":true,"source":"history"}',false);
            INSERT INTO "BOM" (id,"productId","variationId") VALUES ('retained-recipe','p',12);
            INSERT INTO "BOMItem" (id,"bomId","isActive",quantity,"deactivatedReason") VALUES
                ('retained-item','retained-recipe',false,1,'VARIATION_DELETED_IN_WOO');
            TRUNCATE "DeliveryInboundDirtyTarget";`);
    });
    const args = (type: string, source: string, ids: number[], stock: number): Prisma.WooProductUpsertArgs => {
        const fields = { name: source, manageStock: true, stockQuantity: stock, rawData: { id: 10, type, source, manage_stock: true, stock_quantity: stock, variations: ids } };
        return { where: { accountId_wooId: { accountId: 'a', wooId: 10 } }, update: fields, create: { ...fields, accountId: 'a', wooId: 10 } };
    };
    const variations = (ids: number[], stock: number, source: string) => ids.map(id => ({ id, stock_quantity: stock, manage_stock: true,
        image: null, source, cost_of_goods_sold: { total_value: 999 } }));
    const snapshot = async () => ({
        parent: (await f.db.query(`SELECT to_jsonb(p) AS data FROM "WooProduct" p WHERE id='p'`)).rows,
        variants: (await f.db.query(`SELECT to_jsonb(v) AS data FROM "ProductVariation" v ORDER BY "wooId"`)).rows,
        recipes: (await f.db.query(`SELECT to_jsonb(i) AS data FROM "BOMItem" i ORDER BY id`)).rows,
        dirty: (await f.db.query(`SELECT * FROM "DeliveryInboundDirtyTarget" ORDER BY "wooId"`)).rows,
    });
    async function waitBlocked(pid: number) {
        for (let attempt = 0; attempt < 200; attempt++) {
            if (Number((await f.db.query('SELECT cardinality(pg_blocking_pids($1)) AS n', [pid])).rows[0].n) > 0) return;
            await new Promise(resolve => setTimeout(resolve, 5));
        }
        throw new Error('Second observation did not overlap the first transaction');
    }
    async function overlap(newType: 'simple' | 'variable', oldType: 'simple' | 'variable') {
        const pid = Number((await other.$queryRawUnsafe<any[]>('SELECT pg_backend_pid() AS pid'))[0].pid);
        const parentWritten = deferred(); const release = deferred();
        // B is paused at the exact former split-phase boundary: parent written,
        // variations and membership not yet written. A runs on a different client.
        m.transaction.mockImplementationOnce((work, options) => f.client.$transaction(async tx => work(intercept(tx, 'wooProduct', 'upsert', async (original, values) => {
            const product = await original(...values); parentWritten.resolve(); await release.promise; return product;
        })), options)).mockImplementation((work, options) => other.$transaction(work, options));
        const b = persistWooProduct(newType, args(newType, 'B-newer', newType === 'variable' ? [11, 13] : [], 100), newer,
            newType === 'variable' ? variations([11, 13], 25, 'B-newer') : undefined).catch(error => ({ unexpectedError: error }));
        await parentWritten.promise;
        const a = persistWooProduct(oldType, args(oldType, 'A-stale', oldType === 'variable' ? [11, 99] : [], 999), older,
            oldType === 'variable' ? variations([11, 99], 999, 'A-stale') : undefined).catch(error => ({ unexpectedError: error }));
        let results: any[];
        try {
            await waitBlocked(pid);
            // Other connections still see the old coherent source, never B's
            // new parent with old membership, nor any default-active new variant.
            expect((await snapshot()).parent[0].data.rawData.type).toBe('simple');
            expect((await f.db.query('SELECT COUNT(*)::int AS n FROM "ProductVariation" WHERE "deliveryActive"')).rows[0].n).toBe(0);
        } finally { release.resolve(); results = await Promise.all([b, a]); }
        const [newResult, oldResult] = results;
        expect(newResult).toMatchObject({ accepted: true });
        expect(oldResult).toEqual({ accepted: false, reason: 'stale' });
        // The account-lock wait is a real serializable conflict, retried from a
        // fresh snapshot. The retried stale observation still writes nothing.
        expect(m.transaction.mock.calls.length).toBeGreaterThanOrEqual(3);
        const saved = await snapshot();
        expect(saved.parent[0].data).toMatchObject({ name: 'B-newer', stockQuantity: 100, rawData: { type: newType, source: 'B-newer' } });
        expect(saved.variants.some((v: any) => v.data.wooId === 99)).toBe(false);
        const v11 = saved.variants.find((v: any) => v.data.wooId === 11)!.data;
        expect(v11.stockQuantity).toBe(newType === 'variable' ? 25 : 17);
        expect(v11.rawData.source).toBe(newType === 'variable' ? 'B-newer' : 'history');
        expect(v11.cogs).toBe(5);
        expect(saved.variants.find((v: any) => v.data.wooId === 12)!.data).toMatchObject({ stockQuantity: 31, cogs: 9, deliveryActive: false });
        const input = await DeliveryEstimateService.getProduct('a', 'p', f.client);
        expect(input.variations.map(v => v.wooId)).toEqual(newType === 'variable' ? [11, 13] : []);
        expect((await buildInbound(f.client, 'a', 10)).targets.some(t => t.state === 'integrity_error')).toBe(false);
        // A subsequent stale call cannot modify even bookkeeping or dirty versions.
        expect(await persistWooProduct(oldType, args(oldType, 'A-stale', oldType === 'variable' ? [11, 99] : [], 999), older,
            oldType === 'variable' ? variations([11, 99], 999, 'A-stale') : undefined)).toEqual({ accepted: false, reason: 'stale' });
        expect(await snapshot()).toEqual(saved);
    }
    it('newer variable B parent cannot be overwritten by older simple A before B membership commits', async () => { await overlap('variable', 'simple'); });
    it.each(['simple', 'variable'] as const)('rejected stale variable A neither creates active children nor overwrites newer %s B source', async type => { await overlap(type, 'variable'); });
    it('quarantines the entire source and does not consume the observation fence', async () => {
        const before = await snapshot();
        expect(await persistWooProduct('variable', args('variable', 'quarantine', [11, 13], 100), newer,
            [variations([11], 999, 'must-not-write')[0], { id: 13, image: 'invalid' }])).toMatchObject({ accepted: false, reason: 'quarantined_variations' });
        expect(m.transaction).not.toHaveBeenCalled();
        expect(await snapshot()).toEqual(before);
        expect(await persistWooProduct('variable', args('variable', 'complete', [11, 13], 100), newer,
            variations([11, 13], 25, 'complete'))).toMatchObject({ accepted: true });
    });
    it('rolls back parent, already-written children, fence and trigger effects when a later child write fails', async () => {
        const before = await snapshot(); let writes = 0;
        m.transaction.mockImplementationOnce((work, options) => f.client.$transaction(tx => work(intercept(tx, 'productVariation', 'upsert', async (original, values) => {
            if (++writes === 2) throw new Error('second child failed');
            return original(...values);
        })), options));
        await expect(persistWooProduct('variable', args('variable', 'failed', [11, 13], 100), newer,
            variations([11, 13], 25, 'failed'))).rejects.toThrow('second child failed');
        expect(writes).toBe(2);
        expect(await snapshot()).toEqual(before);
        expect(await persistWooProduct('variable', args('variable', 'retry', [11, 13], 100), newer,
            variations([11, 13], 25, 'retry'))).toMatchObject({ accepted: true });
    });
});
