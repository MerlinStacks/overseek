import { readFile } from 'node:fs/promises';
import { beforeAll, afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
vi.mock('../../utils/prisma', () => ({ prisma: {} }));
import { FRESHNESS_PREREQUISITE_SQL } from './freshnessPrerequisite';
import { hasFreshnessTestDatabase, openFreshnessTestDatabase } from './__tests__/freshnessDatabase';

// Run against an isolated embedded PostgreSQL, never the configured application DB:
// DELIVERY_FRESHNESS_PGLITE=/tmp/.../@electric-sql/pglite/dist/index.js vitest run ...
describe.skipIf(!hasFreshnessTestDatabase)('freshness migration transactional source hooks (PostgreSQL)', () => {
    let db: any;
    beforeAll(async () => {
        db = await openFreshnessTestDatabase();
        await db.exec(`
            CREATE TABLE "Account" (id text PRIMARY KEY);
            INSERT INTO "Account" VALUES ('a'), ('b');
            CREATE TABLE "WooProduct" (id text PRIMARY KEY, "accountId" text, "wooId" int, "supplierId" text,
                "manageStock" boolean DEFAULT false, "productionMinDays" int, "productionMaxDays" int, "rawData" jsonb, name text, price int, "stockQuantity" int);
            CREATE TABLE "ProductVariation" (id text PRIMARY KEY, "productId" text REFERENCES "WooProduct" ON DELETE CASCADE, "wooId" int,
                "manageStock" boolean, "productionMinDays" int, "productionMaxDays" int, "rawData" jsonb, price int, "stockQuantity" int);
            CREATE TABLE "DeliveryInputSync" (id text, "accountId" text, scope text, "entityId" int, payload jsonb, status text DEFAULT 'synced');
            CREATE TABLE "DeliverySyncAccount" ("accountId" text PRIMARY KEY, "capabilityStatus" text, "inboundCapabilityStatus" text, "inboundFailed" boolean DEFAULT false);
            CREATE TABLE "AccountFeature" ("accountId" text, "featureKey" text, "isEnabled" boolean);
            INSERT INTO "DeliverySyncAccount" VALUES ('a', 'supported', 'supported', false);
            CREATE TABLE "DeliveryInboundDirtyTarget" ("accountId" text, "wooId" int, version int, "createdAt" timestamp, "updatedAt" timestamp, PRIMARY KEY ("accountId", "wooId"));
            CREATE TABLE "BOM" (id text PRIMARY KEY, "productId" text REFERENCES "WooProduct" ON DELETE CASCADE, "variationId" int);
            CREATE TABLE "BOMItem" (id text PRIMARY KEY, "bomId" text REFERENCES "BOM" ON DELETE CASCADE, "isActive" boolean, quantity int);
            CREATE TABLE "Supplier" (id text PRIMARY KEY, "accountId" text, name text, "leadTimeMin" int, "leadTimeMax" int, "leadTimeDefault" int);
            CREATE TABLE "PurchaseOrder" (id text PRIMARY KEY, status text, "expectedDate" timestamp, notes text);
            CREATE TABLE "PurchaseOrderItem" (id text PRIMARY KEY, "purchaseOrderId" text REFERENCES "PurchaseOrder" ON DELETE CASCADE, "productId" text, "variationWooId" int, quantity int);
        `);
        // Schema-push-only baseline: even the indexed field cannot certify SQL hooks.
        await db.exec('ALTER TABLE "DeliveryInputSync" ADD COLUMN "inboundRenewAt" timestamp');
        expect((await db.query(FRESHNESS_PREREQUISITE_SQL)).rows.length).toBe(29);
        await db.exec('ALTER TABLE "DeliveryInputSync" DROP COLUMN "inboundRenewAt"');
        await db.exec(await readFile('prisma/migrations/20260922123000_delivery_freshness_targets/migration.sql', 'utf8'));
        expect((await db.query(FRESHNESS_PREREQUISITE_SQL)).rows.length).toBe(14); // Version attestation still absent.
        await db.exec(await readFile('prisma/migrations/20260922133000_delivery_freshness_prerequisite/migration.sql', 'utf8'));
        await db.exec(await readFile('prisma/migrations/20260923100000_variant_suppliers/migration.sql', 'utf8'));
        await db.exec(await readFile('prisma/migrations/20260923110000_variant_supplier_freshness/migration.sql', 'utf8'));
        expect((await db.query(FRESHNESS_PREREQUISITE_SQL)).rows).toEqual([
            { missing: 'function:delivery_bom_changed' }, { missing: 'function:delivery_bom_item_changed' }, { missing: 'function:delivery_variation_changed' }
        ]);
        await db.exec(await readFile('prisma/migrations/20260923120000_stock_write_offs/migration.sql', 'utf8'));
        await db.exec(await readFile('prisma/migrations/20260923130000_delivery_bom_noop_guards/migration.sql', 'utf8'));
        await db.exec(await readFile('prisma/migrations/20260924100000_delivery_catalogue_membership/migration.sql', 'utf8'));
        await db.exec(`ALTER TABLE "BOM" ADD COLUMN "updatedAt" timestamp;
            ALTER TABLE "BOMItem" ADD COLUMN "updatedAt" timestamp, ADD COLUMN "childProductId" text,
                ADD COLUMN "childVariationId" int, ADD COLUMN "internalProductId" text, ADD COLUMN "supplierItemId" text,
                ADD COLUMN "wasteFactor" numeric, ADD COLUMN "deactivatedReason" text;
            ALTER TABLE "Supplier" ADD COLUMN "contactName" text, ADD COLUMN email text;`);
        expect((await db.query(FRESHNESS_PREREQUISITE_SQL)).rows).toEqual([]);
    }, 30_000);
    afterAll(async () => { await db?.close(); });
    beforeEach(async () => {
        await db.exec(`TRUNCATE "WooProduct", "ProductVariation", "DeliveryInputSync", "DeliveryInboundDirtyTarget", "BOM", "BOMItem", "Supplier", "PurchaseOrder", "PurchaseOrderItem" CASCADE;
            INSERT INTO "WooProduct" (id, "accountId", "wooId", "productionMinDays", "supplierId", "rawData") VALUES
                ('p', 'a', 10, 0, 's', '{"type":"simple","manage_stock":false}'),
                ('other', 'a', 20, 1, 'other-s', '{}'), ('untouched', 'a', 30, NULL, 's', '{}'), ('foreign', 'b', 10, 1, 'foreign-s', '{}');
            INSERT INTO "Supplier" VALUES ('s', 'a', 'Supplier', 2, 4, NULL);
            TRUNCATE "DeliveryInboundDirtyTarget";`);
    });
    const targets = async () => (await db.query('SELECT "accountId", "wooId" FROM "DeliveryInboundDirtyTarget" ORDER BY "accountId", "wooId"')).rows;
    const onlyParent = async () => expect(await targets()).toEqual([{ accountId: 'a', wooId: 10 }]);

    it('rejects disabled/incorrect trigger bindings and missing function version markers', async () => {
        await db.exec('BEGIN; ALTER TABLE "WooProduct" DISABLE TRIGGER delivery_product_delete');
        expect((await db.query(FRESHNESS_PREREQUISITE_SQL)).rows).toContainEqual({ missing: 'trigger:WooProduct.delivery_product_delete' });
        await db.exec('ROLLBACK; BEGIN; DROP TRIGGER delivery_product_delete ON "WooProduct"; CREATE TRIGGER delivery_product_delete BEFORE DELETE ON "WooProduct" FOR EACH ROW EXECUTE FUNCTION delivery_variation_changed()');
        expect((await db.query(FRESHNESS_PREREQUISITE_SQL)).rows).toContainEqual({ missing: 'trigger:WooProduct.delivery_product_delete' });
        await db.exec('ROLLBACK; BEGIN; DROP TRIGGER delivery_product_delete ON "WooProduct"; CREATE TRIGGER delivery_product_delete BEFORE DELETE ON "WooProduct" FOR EACH ROW WHEN (false) EXECUTE FUNCTION delivery_product_changed()');
        expect((await db.query(FRESHNESS_PREREQUISITE_SQL)).rows).toContainEqual({ missing: 'trigger:WooProduct.delivery_product_delete' });
        await db.exec("ROLLBACK; BEGIN; COMMENT ON FUNCTION delivery_dirty_parent(text) IS 'old-version'");
        expect((await db.query(FRESHNESS_PREREQUISITE_SQL)).rows).toContainEqual({ missing: 'function:delivery_dirty_parent' });
        await db.exec('ROLLBACK');
    });

    it('ignores ordinary stock sales, price/name/raw price changes and identical ownership', async () => {
        await db.exec(`UPDATE "WooProduct" SET name='Renamed', price=99, "stockQuantity"=2, "rawData"="rawData" || '{"price":"99"}'::jsonb WHERE id='p';
            UPDATE "WooProduct" SET "manageStock"="manageStock" WHERE id='p';`);
        expect(await targets()).toEqual([]);
        await db.exec(`UPDATE "WooProduct" SET "manageStock"=true WHERE id='p'`); await onlyParent();
    });
    it('handles configured product creation and both sides of a product identity change', async () => {
        await db.exec(`INSERT INTO "WooProduct" (id,"accountId","wooId") VALUES ('new-default','a',40)`);
        expect(await targets()).toEqual([]);
        await db.exec(`UPDATE "WooProduct" SET "productionMinDays"=0, "productionMaxDays"=0 WHERE id='new-default'`);
        expect(await targets()).toEqual([{ accountId: 'a', wooId: 40 }]);
        await db.exec(`TRUNCATE "DeliveryInboundDirtyTarget"; UPDATE "WooProduct" SET "wooId"=41 WHERE id='new-default'`);
        expect(await targets()).toEqual([{ accountId: 'a', wooId: 40 }, { accountId: 'a', wooId: 41 }]);
    });
    it('covers BOM add, item re-enable/update/removal and final BOM removal atomically', async () => {
        for (const sql of [
            `INSERT INTO "BOM" VALUES ('bom', 'p', 0)`,
            `INSERT INTO "BOMItem" VALUES ('item', 'bom', false, 1)`,
            `UPDATE "BOMItem" SET "isActive"=true WHERE id='item'`,
            `UPDATE "BOMItem" SET quantity=2 WHERE id='item'`,
            `DELETE FROM "BOMItem" WHERE id='item'`,
            `DELETE FROM "BOM" WHERE id='bom'`,
        ]) { await db.exec(sql); await onlyParent(); await db.exec('TRUNCATE "DeliveryInboundDirtyTarget"'); }
        await db.exec(`BEGIN; INSERT INTO "BOM" VALUES ('rolled-back', 'p', 0); ROLLBACK;`);
        expect(await targets()).toEqual([]);
    });
    it('covers external variation addition, reparenting, ownership and deletion without price fanout', async () => {
        await db.exec(`INSERT INTO "ProductVariation" VALUES ('v', 'p', 11, false, NULL, NULL, '{"manage_stock":"parent"}', 1, 2)`); await onlyParent();
        await db.exec(`TRUNCATE "DeliveryInboundDirtyTarget"; UPDATE "ProductVariation" SET price=3,"stockQuantity"=1 WHERE id='v'`); expect(await targets()).toEqual([]);
        await db.exec(`UPDATE "ProductVariation" SET "rawData"='{"manage_stock":true}', "manageStock"=true WHERE id='v'`); await onlyParent();
        await db.exec(`TRUNCATE "DeliveryInboundDirtyTarget"; UPDATE "ProductVariation" SET "productId"='other' WHERE id='v'`);
        expect(await targets()).toEqual([{ accountId: 'a', wooId: 10 }, { accountId: 'a', wooId: 20 }]);
        await db.exec(`TRUNCATE "DeliveryInboundDirtyTarget"; DELETE FROM "ProductVariation" WHERE id='v'`);
        expect(await targets()).toEqual([{ accountId: 'a', wooId: 20 }]);
    });
    it('ignores identical and timestamp-only BOM writes, but dirties every changed source field exactly once', async () => {
        await db.exec(`INSERT INTO "BOM" (id,"productId","variationId") VALUES ('bom','p',0),('sibling','p',11),('other-bom','other',0);
            INSERT INTO "BOMItem" (id,"bomId","isActive",quantity) VALUES ('item','bom',true,1);
            TRUNCATE "DeliveryInboundDirtyTarget";
            UPDATE "BOM" SET "updatedAt"=now(), "variationId"="variationId";
            UPDATE "BOMItem" SET "updatedAt"=now(), quantity=quantity;`);
        expect(await targets()).toEqual([]);
        for (const assignment of [
            'quantity=2', '"wasteFactor"=0.1', '"isActive"=false',
            '"deactivatedReason"=\'VARIATION_DELETED_IN_WOO\'', '"deactivatedReason"=NULL',
            '"childProductId"=\'other\'', '"childVariationId"=21', '"childVariationId"=NULL',
            '"internalProductId"=\'internal\'', '"supplierItemId"=\'supplier-item\'', '"bomId"=\'sibling\''
        ]) {
            await db.exec(`UPDATE "BOMItem" SET ${assignment} WHERE id='item'`);
            await onlyParent();
            expect((await db.query('SELECT version FROM "DeliveryInboundDirtyTarget"')).rows).toEqual([{ version: 1 }]);
            await db.exec(`TRUNCATE "DeliveryInboundDirtyTarget"; UPDATE "BOMItem" SET ${assignment} WHERE id='item'`);
            expect(await targets()).toEqual([]);
        }
        await db.exec(`UPDATE "BOM" SET "variationId"=12 WHERE id='sibling'`);
        expect((await db.query('SELECT version FROM "DeliveryInboundDirtyTarget"')).rows).toEqual([{ version: 1 }]);
        for (const sql of [
            `UPDATE "BOMItem" SET "bomId"='other-bom' WHERE id='item'`,
            `UPDATE "BOM" SET "productId"='other' WHERE id='sibling'`
        ]) {
            await db.exec(`TRUNCATE "DeliveryInboundDirtyTarget"; ${sql}`);
            expect((await db.query('SELECT "wooId",version FROM "DeliveryInboundDirtyTarget" ORDER BY "wooId"')).rows)
                .toEqual([{ wooId: 10, version: 1 }, { wooId: 20, version: 1 }]);
        }
    });
    it('preserves enrolled null-range/deletion tombstones and never enrols an untouched catalogue', async () => {
        await db.exec(`INSERT INTO "DeliveryInputSync" (id,"accountId",scope,"entityId",payload) VALUES ('old','a','inbound',30,'{}');
            DELETE FROM "WooProduct" WHERE id='untouched'`);
        expect(await targets()).toEqual([{ accountId: 'a', wooId: 30 }]);
        await db.exec(`TRUNCATE "DeliveryInboundDirtyTarget"; INSERT INTO "DeliveryInputSync" (id,"accountId",scope,"entityId",payload) VALUES ('p-old','a','inbound',10,'{}');
            UPDATE "WooProduct" SET "productionMinDays"=NULL WHERE id='p'`); await onlyParent();
        await db.exec(`TRUNCATE "DeliveryInboundDirtyTarget"; DELETE FROM "WooProduct" WHERE id='p'`); await onlyParent();
    });
    it('targets supplier lead edits/deletion only to assigned eligible products', async () => {
        await db.exec(`UPDATE "Supplier" SET name='New name', "contactName"='Contact', email='new@example.test', "leadTimeMin"="leadTimeMin" WHERE id='s'`); expect(await targets()).toEqual([]);
        await db.exec(`UPDATE "Supplier" SET "leadTimeMin"=1 WHERE id='s'`); await onlyParent();
        await db.exec(`TRUNCATE "DeliveryInboundDirtyTarget"; DELETE FROM "Supplier" WHERE id='s'`); await onlyParent();
    });
    it('does not create fresh work during account teardown', async () => {
        await db.exec(`BEGIN; DELETE FROM "Account" WHERE id='a'; DELETE FROM "WooProduct" WHERE "accountId"='a';`);
        expect(await targets()).toEqual([]);
        await db.exec('ROLLBACK');
    });
    it('invalidates override assignment, replacement and clearing, but not identical assignments', async () => {
        await db.exec(`INSERT INTO "Supplier" VALUES ('override', 'a', 'Override', 7, 9, NULL);
            INSERT INTO "ProductVariation" (id,"productId","wooId") VALUES ('v','other',21);
            TRUNCATE "DeliveryInboundDirtyTarget";`);
        for (const supplier of ["'s'", "'override'", 'NULL']) {
            await db.exec(`UPDATE "ProductVariation" SET "supplierId"=${supplier} WHERE id='v'`);
            expect(await targets()).toEqual([{ accountId: 'a', wooId: 20 }]);
            await db.exec(`TRUNCATE "DeliveryInboundDirtyTarget"; UPDATE "ProductVariation" SET "supplierId"=${supplier} WHERE id='v'`);
            expect(await targets()).toEqual([]);
        }
        await db.exec(`BEGIN; UPDATE "ProductVariation" SET "supplierId"='s' WHERE id='v'; ROLLBACK;`);
        expect(await targets()).toEqual([]);
    });
    it('fans supplier changes out to direct and variant parents, retaining eligibility and tenant scope', async () => {
        await db.exec(`INSERT INTO "ProductVariation" (id,"productId","wooId","supplierId") VALUES
            ('v1','other',21,'s'), ('v2','other',22,'s'), ('v3','untouched',31,'s'), ('v4','foreign',11,'s');
            TRUNCATE "DeliveryInboundDirtyTarget";
            UPDATE "Supplier" SET name='Renamed' WHERE id='s';`);
        expect(await targets()).toEqual([]);
        for (const field of ['leadTimeMin', 'leadTimeMax', 'leadTimeDefault']) {
            await db.exec(`UPDATE "Supplier" SET "${field}"=8 WHERE id='s'`);
            expect(await targets()).toEqual([{ accountId: 'a', wooId: 10 }, { accountId: 'a', wooId: 20 }]);
            expect((await db.query('SELECT version FROM "DeliveryInboundDirtyTarget"')).rows).toEqual([{ version: 1 }, { version: 1 }]);
            await db.exec('TRUNCATE "DeliveryInboundDirtyTarget"');
        }
        // Remove the deliberately foreign reference before exercising FK SET NULL.
        await db.exec(`DELETE FROM "ProductVariation" WHERE id='v4'; TRUNCATE "DeliveryInboundDirtyTarget";`);
        await db.exec(`BEGIN; DELETE FROM "Supplier" WHERE id='s';`);
        expect(await targets()).toEqual([{ accountId: 'a', wooId: 10 }, { accountId: 'a', wooId: 20 }]);
        expect((await db.query('SELECT "supplierId" FROM "ProductVariation"')).rows.every((v: any) => v.supplierId === null)).toBe(true);
        await db.exec('ROLLBACK');
        expect(await targets()).toEqual([]);
        await db.exec(`DELETE FROM "Supplier" WHERE id='s'`);
        expect(await targets()).toEqual([{ accountId: 'a', wooId: 10 }, { accountId: 'a', wooId: 20 }]);
    });
    it('includes variant-configured and previously enrolled parents with supplier-only overrides', async () => {
        await db.exec(`INSERT INTO "Supplier" VALUES ('override','a','Override',3,5,NULL);
            INSERT INTO "WooProduct" (id,"accountId","wooId") VALUES ('enrolled','a',40);
            INSERT INTO "ProductVariation" (id,"productId","wooId","supplierId","productionMinDays") VALUES
                ('configured','untouched',31,'override',0), ('enrolled-v','enrolled',41,'override',NULL);
            INSERT INTO "DeliveryInputSync" (id,"accountId",scope,"entityId",payload) VALUES ('prior','a','inbound',40,'{}');
            TRUNCATE "DeliveryInboundDirtyTarget";
            UPDATE "Supplier" SET "leadTimeMax"=6 WHERE id='override';`);
        expect(await targets()).toEqual([{ accountId: 'a', wooId: 30 }, { accountId: 'a', wooId: 40 }]);
    });
    it('parks disabled/unsupported deadlines durably, then restores original dates without changing payloads', async () => {
        const payload = { generatedAt: '2026-09-21T12:00:00Z', expiresAt: '2026-09-22T12:00:00Z', targets: [{ wooId: 10 }] };
        await db.query(`INSERT INTO "DeliveryInputSync" (id,"accountId",scope,"entityId",payload,"inboundRenewAt") VALUES ('renew','a','inbound',10,$1,'2026-09-22T08:00:00Z')`, [JSON.stringify(payload)]);
        const row = async () => (await db.query(`SELECT payload,"inboundRenewAt" FROM "DeliveryInputSync" WHERE id='renew'`)).rows[0];
        await db.exec(`INSERT INTO "AccountFeature" VALUES ('a','DELIVERY_ESTIMATES',false)`);
        expect((await row()).inboundRenewAt).toBeNull();
        await db.exec(`UPDATE "AccountFeature" SET "isEnabled"=true`);
        expect(new Date((await row()).inboundRenewAt).toISOString()).toBe('2026-09-22T08:00:00.000Z');
        await db.exec(`UPDATE "DeliverySyncAccount" SET "inboundCapabilityStatus"='plugin_update_required' WHERE "accountId"='a'`);
        expect((await row()).inboundRenewAt).toBeNull();
        await db.exec(`UPDATE "DeliverySyncAccount" SET "inboundCapabilityStatus"='supported' WHERE "accountId"='a'`);
        expect(new Date((await row()).inboundRenewAt).toISOString()).toBe('2026-09-22T08:00:00.000Z');
        expect((await row()).payload).toEqual(payload);
        await db.exec(`DELETE FROM "AccountFeature"`);
    });
    it('covers backwards PO status/date edits and line old/new parents without notes fanout', async () => {
        await db.exec(`INSERT INTO "PurchaseOrder" VALUES ('po','RECEIVED','2026-09-25',NULL);
            INSERT INTO "PurchaseOrderItem" VALUES ('line','po','p',NULL,5)`); await onlyParent();
        await db.exec(`TRUNCATE "DeliveryInboundDirtyTarget"; UPDATE "PurchaseOrder" SET notes='notes' WHERE id='po'`); expect(await targets()).toEqual([]);
        await db.exec(`UPDATE "PurchaseOrder" SET status='ORDERED',"expectedDate"='2026-09-22' WHERE id='po'`); await onlyParent();
        await db.exec(`TRUNCATE "DeliveryInboundDirtyTarget"; UPDATE "PurchaseOrderItem" SET "productId"='other' WHERE id='line'`);
        expect(await targets()).toEqual([{ accountId: 'a', wooId: 10 }, { accountId: 'a', wooId: 20 }]);
    });
});
