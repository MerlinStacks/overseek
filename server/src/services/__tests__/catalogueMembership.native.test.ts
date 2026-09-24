import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { openNativeDeliveryDatabase } from '../deliveryEstimates/__tests__/nativeDeliveryDatabase';
import { extendNativeReceiptBaseline } from '../deliveryEstimates/__tests__/nativeReceiptBaseline';
const m = vi.hoisted(() => ({ transaction: vi.fn() }));
vi.mock('../../utils/prisma', () => ({ prisma: { $transaction: m.transaction } }));
import { catalogueTransaction } from '../catalogueTransaction';
import { reconcileWooVariations } from '../reconcileWooVariations';
import { persistWooProduct } from '../persistWooProduct';
import { DeliveryEstimateService } from '../deliveryEstimates/service';
import { buildInbound } from '../deliveryEstimates/inbound';
import { buildInboundBatch } from '../deliveryEstimates/inboundResync';
import { FRESHNESS_PREREQUISITE_SQL } from '../deliveryEstimates/freshnessPrerequisite';
import { buildCutoverBatch, cutoverBatchStillCurrent, cutoverProgress } from '../deliveryEstimates/cutoverBatch';

describe.skipIf(!process.env.DELIVERY_FRESHNESS_TEST_DATABASE_URL)('authoritative delivery membership (native PostgreSQL)', () => {
    let f: Awaited<ReturnType<typeof openNativeDeliveryDatabase>>;
    const at = new Date('2026-09-24T12:00:00Z');
    beforeAll(async () => { f = await openNativeDeliveryDatabase(); await extendNativeReceiptBaseline(f.db); }, 30_000);
    afterAll(async () => { await f?.close(); });
    beforeEach(async () => {
        m.transaction.mockReset().mockImplementation((work, options) => f.client.$transaction(work, options));
        await f.db.exec(`TRUNCATE "WooProduct", "ProductVariation", "BOM", "BOMItem", "PurchaseOrder", "PurchaseOrderItem",
            "DeliveryInboundDirtyTarget", "DeliveryInputSync", "DeliverySyncAccount" CASCADE;
            INSERT INTO "WooProduct" (id,"accountId","wooId","manageStock","rawData","productionMinDays","productionMaxDays") VALUES
                ('p','a',10,true,'{"id":10,"type":"variable","manage_stock":true,"variations":[11,12]}',1,2),
                ('dependent','a',20,true,'{"id":20,"type":"simple","manage_stock":true}',NULL,NULL),
                ('q','other',10,true,'{"id":10,"type":"variable","manage_stock":true}',1,2);
            INSERT INTO "ProductVariation" (id,"productId","wooId","manageStock","rawData",cogs,"stockQuantity","productionMinDays","productionMaxDays") VALUES
                ('v11','p',11,true,'{"id":11,"manage_stock":true,"backorders":"notify","image":null}',5,17,2,3),
                ('v12','p',12,true,'{"id":12,"manage_stock":true,"backorders":"yes","image":null}',9,31,4,5),
                ('other12','q',12,true,'{"id":12,"manage_stock":true}',9,31,4,5);
            INSERT INTO "BOM" (id,"productId","variationId") VALUES ('recipe','p',12),('uses-removed','dependent',0);
            INSERT INTO "BOMItem" (id,"bomId","isActive",quantity,"childProductId","childVariationId") VALUES
                ('reference','uses-removed',true,1,'p',12), ('recipe-item','recipe',true,1,NULL,NULL);
            INSERT INTO "PurchaseOrder" (id,"accountId",status,"expectedDate") VALUES ('po','a','ORDERED',CURRENT_DATE + 2);
            INSERT INTO "PurchaseOrderItem" (id,"purchaseOrderId","productId","variationWooId",quantity) VALUES
                ('valid-line','po','p',11,3), ('retained-line','po','p',12,999);
            TRUNCATE "DeliveryInboundDirtyTarget";`);
    });
    const history = async () => (await f.db.query(`SELECT id, to_jsonb(v)-'deliveryActive'-'updatedAt' AS data FROM "ProductVariation" v ORDER BY id`)).rows;
    const reconcile = (ids: number[], observed = at) => catalogueTransaction('a', tx => reconcileWooVariations(tx, 'a', 'p', 10, ids, observed));
    const projections = async () => ({ product: await DeliveryEstimateService.getProduct('a', 'p', f.client), inbound: await buildInbound(f.client, 'a', 10) });
    it('retains removed stock/COGS/PO/BOM references while rebuilding valid product+inbound only for surviving members', async () => {
        const before = await history();
        const cutover = await buildCutoverBatch(f.client, 'a', 1n, 'epoch', null, cutoverProgress({}));
        await reconcile([11]);
        expect(await cutoverBatchStillCurrent(f.client, 'a', cutover.page!)).toBe(false);
        expect(await history()).toEqual(before);
        const { product, inbound } = await projections();
        expect(product.variations.map(v => v.wooId)).toEqual([11]);
        expect(inbound.targets.map(t => t.wooId)).toEqual([10, 11]);
        expect(inbound.targets.find(t => t.wooId === 11)).toMatchObject({ state: 'pending', batches: [{ quantity: 3 }] });
        expect((await f.db.query(`SELECT "childProductId","childVariationId","isActive" FROM "BOMItem" WHERE id='reference'`)).rows)
            .toEqual([{ childProductId: 'p', childVariationId: 12, isActive: false }]);
        expect((await f.db.query('SELECT COUNT(*)::int AS n FROM "PurchaseOrderItem"')).rows[0].n).toBe(2);
        expect((await f.db.query(`SELECT "deliveryActive" FROM "ProductVariation" WHERE id='other12'`)).rows[0].deliveryActive).toBe(true);
        await buildInboundBatch('a');
        const inputs = (await f.db.query(`SELECT scope,payload FROM "DeliveryInputSync" WHERE "accountId"='a' AND "entityId"=10 ORDER BY scope`)).rows;
        expect(inputs.find((i: any) => i.scope === 'product').payload.variations.map((v: any) => v.wooId)).toEqual([11]);
        expect(inputs.find((i: any) => i.scope === 'inbound').payload.targets.map((v: any) => v.wooId)).toEqual([10, 11]);
    });
    it('simple conversion retains historical variants but produces valid simple product/inbound and cutover mappings', async () => {
        const before = await history();
        await persistWooProduct('simple', { where: { accountId_wooId: { accountId: 'a', wooId: 10 } },
            create: { accountId: 'a', wooId: 10, name: 'Simple', rawData: {} },
            update: { rawData: { id: 10, type: 'simple', manage_stock: true }, name: 'Simple' },
        }, at);
        expect(await history()).toEqual(before);
        const { product, inbound } = await projections();
        expect(product.variations).toEqual([]);
        expect(inbound.targets).toEqual([{ wooId: 10, stockOwnerWooId: 10, state: 'pending', supplierLead: null, batches: [] }]);
        const mapping = await buildCutoverBatch(f.client, 'a', 1n, 'epoch', null, cutoverProgress({}));
        expect(mapping.owners).toEqual([10]);
        await buildInboundBatch('a');
        expect((await f.db.query(`SELECT payload->'variations' AS variations FROM "DeliveryInputSync" WHERE "accountId"='a' AND scope='product'`)).rows[0].variations).toEqual([]);
    });
    it('restores only membership and fences older observations, without reviving recipes', async () => {
        await reconcile([]);
        const before = await history();
        await reconcile([11], new Date(at.getTime() + 1000));
        await reconcile([], at);
        expect((await projections()).product.variations.map(v => v.wooId)).toEqual([11]);
        expect(await history()).toEqual(before);
        expect((await f.db.query(`SELECT "isActive" FROM "BOMItem" WHERE id='reference'`)).rows[0].isActive).toBe(false);
    });
    it('rebuilds a product-only outbox when the final configured variation is retired', async () => {
        await f.db.exec(`UPDATE "WooProduct" SET "productionMinDays"=NULL,"productionMaxDays"=NULL WHERE id='p';
            UPDATE "ProductVariation" SET "productionMinDays"=NULL,"productionMaxDays"=NULL WHERE id='v11'`);
        await f.client.deliveryInputSync.create({ data: { accountId: 'a', scope: 'product', entityId: 10,
            payload: { wooId: 10, productionMinDays: null, productionMaxDays: null,
                variations: [{ wooId: 12, productionMinDays: 4, productionMaxDays: 5 }] } } });
        await reconcile([]);
        await buildInboundBatch('a');
        const cleared = await f.client.deliveryInputSync.findUniqueOrThrow({ where: { accountId_scope_entityId: { accountId: 'a', scope: 'product', entityId: 10 } } });
        expect(cleared.payload).toEqual({ wooId: 10, productionMinDays: null, productionMaxDays: null, variations: [] });
        expect(cleared.desiredRevision).toBe(2n);
    });
    it('does not silently discard an unknown PO variation based on a partial/raw parent list', async () => {
        await reconcile([11]);
        await f.db.exec(`INSERT INTO "PurchaseOrderItem" (id,"purchaseOrderId","productId","variationWooId",quantity) VALUES ('unknown','po','p',99,1)`);
        expect((await projections()).inbound.targets[0].state).toBe('integrity_error');
    });
    it('attests the additive migration and preserves no-op, supplier, membership and rollback invalidation semantics', async () => {
        expect((await f.db.query(FRESHNESS_PREREQUISITE_SQL)).rows).toEqual([]);
        await f.db.exec(`BEGIN; COMMENT ON FUNCTION delivery_variation_changed() IS 'overseek-delivery-freshness-v1'`);
        expect((await f.db.query(FRESHNESS_PREREQUISITE_SQL)).rows).toContainEqual({ missing: 'function:delivery_variation_changed' });
        await f.db.exec('ROLLBACK');
        await f.db.exec(`UPDATE "ProductVariation" SET price=3,"stockQuantity"=99 WHERE id='v11'`);
        expect((await f.db.query('SELECT * FROM "DeliveryInboundDirtyTarget"')).rows).toEqual([]);
        await f.db.exec(`UPDATE "ProductVariation" SET "deliveryActive"=false WHERE id='v12'`);
        expect((await f.db.query('SELECT "accountId","wooId" FROM "DeliveryInboundDirtyTarget"')).rows).toEqual([{ accountId: 'a', wooId: 10 }]);
        await f.db.exec(`TRUNCATE "DeliveryInboundDirtyTarget"; UPDATE "ProductVariation" SET "deliveryActive"=false WHERE id='v12'`);
        expect((await f.db.query('SELECT * FROM "DeliveryInboundDirtyTarget"')).rows).toEqual([]);
        await f.db.exec(`BEGIN; UPDATE "ProductVariation" SET "deliveryActive"=true WHERE id='v12'; ROLLBACK;`);
        expect((await f.db.query('SELECT * FROM "DeliveryInboundDirtyTarget"')).rows).toEqual([]);
        await f.db.exec(`INSERT INTO "Supplier" (id,"accountId") VALUES ('s','a') ON CONFLICT DO NOTHING; UPDATE "ProductVariation" SET "supplierId"='s' WHERE id='v11'`);
        expect((await f.db.query('SELECT "wooId" FROM "DeliveryInboundDirtyTarget"')).rows).toEqual([{ wooId: 10 }]);
    });
    it('retries a real serializable account-lock snapshot conflict from the beginning', async () => {
        await f.db.exec(`BEGIN; UPDATE "Account" SET name='held' WHERE id='a'`);
        const work = reconcile([11]).then(() => null, error => error);
        try {
            let blocked = false;
            for (let i = 0; i < 100; i++) {
                await f.db.query('SELECT pg_stat_clear_snapshot()');
                const rows = (await f.db.query(`SELECT 1 FROM pg_stat_activity WHERE datname=current_database() AND wait_event_type='Lock' AND query LIKE '%Account%'`)).rows;
                if (rows.length) { blocked = true; break; }
                await new Promise(resolve => setTimeout(resolve, 10));
            }
            expect(blocked).toBe(true);
        } finally { await f.db.exec('COMMIT'); }
        expect(await work).toBeNull();
        expect(m.transaction.mock.calls.length).toBeGreaterThanOrEqual(2);
        expect((await projections()).product.variations.map(v => v.wooId)).toEqual([11]);
        expect((await f.db.query(`SELECT COUNT(*)::int AS n FROM "ProductVariation" WHERE "productId"='p'`)).rows[0].n).toBe(2);
    });
});
