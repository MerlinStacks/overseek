import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { hasFreshnessTestDatabase, openFreshnessTestDatabase } from './__tests__/freshnessDatabase';
vi.mock('../../utils/prisma', () => ({ prisma: {} }));
import { checkInventoryCompatibility } from './inventoryCompatibility';
let db: any;
const client = { $queryRaw: async (parts: TemplateStringsArray, ...values: unknown[]) => {
    const sql = parts.reduce((s, p, i) => s + (i ? `$${i}` : '') + p, '');
    return (await db.query(sql, values)).rows;
} };
describe.skipIf(!hasFreshnessTestDatabase)('inventory cutover compatibility (isolated SQL)', () => {
    beforeEach(async () => {
        db = await openFreshnessTestDatabase();
        await db.exec(`CREATE TABLE "WooProduct" (id text, "accountId" text, "wooId" int, "manageStock" bool, "rawData" jsonb);
          CREATE TABLE "ProductVariation" (id text, "productId" text, "wooId" int, "manageStock" bool, "rawData" jsonb);
          CREATE TABLE "BOM" (id text, "productId" text, "variationId" int);
          CREATE TABLE "BOMItem" (id text, "bomId" text, "childProductId" text, "internalProductId" text, "childVariationId" int, "isActive" bool, quantity numeric DEFAULT 1, "wasteFactor" numeric DEFAULT 0);
          CREATE TABLE "PurchaseOrder" (id text, "accountId" text, status text);
          CREATE TABLE "PurchaseOrderItem" ("productId" text, "variationWooId" int, "purchaseOrderId" text);`);
    });
    afterEach(async () => { await db?.close(); });
    it('supports direct native components and excludes finished BOM products from direct receipt compatibility', async () => {
        await db.exec(`INSERT INTO "WooProduct" VALUES ('leaf','a',10,true,'{"id":10,"type":"simple","manage_stock":true,"stock_quantity":5}'),
          ('finished','a',20,true,'{"id":20,"type":"bundle","manage_stock":true}');
          INSERT INTO "BOM" VALUES ('bom','finished',0);
          INSERT INTO "BOMItem" (id,"bomId","childProductId","internalProductId","childVariationId","isActive") VALUES ('item','bom','leaf',NULL,NULL,true);`);
        expect(await checkInventoryCompatibility('a', client as any)).toEqual({ ready: true, blockedCount: 0, targets: [] });
        await db.exec(`UPDATE "WooProduct" SET "manageStock"=false,"rawData"=jsonb_set("rawData",'{manage_stock}','false') WHERE id='leaf'`);
        expect((await checkInventoryCompatibility('a', client as any)).targets).toEqual([{ productWooId: 10, variationWooId: null, reason: 'enable_native_stock_management' }]);
    });
    it('uses the real composite variation reference and permits both independent and parent-managed components', async () => {
        await db.exec(`INSERT INTO "WooProduct" VALUES ('p','a',10,false,'{"id":10,"type":"variable","manage_stock":false}'),
          ('finished','a',20,true,'{"id":20,"type":"simple","manage_stock":true}');
          INSERT INTO "ProductVariation" VALUES ('local-v','p',11,true,'{"id":11,"manage_stock":true}');
          INSERT INTO "BOM" VALUES ('bom','finished',0);
          INSERT INTO "BOMItem" (id,"bomId","childProductId","internalProductId","childVariationId","isActive") VALUES ('item','bom','p',NULL,11,true);`);
        expect((await checkInventoryCompatibility('a', client as any)).ready).toBe(true);
        await db.exec(`UPDATE "ProductVariation" SET "manageStock"=false,"rawData"='{"id":11,"manage_stock":"parent"}';
          UPDATE "WooProduct" SET "manageStock"=true,"rawData"=jsonb_set("rawData",'{manage_stock}','true') WHERE id='p'`);
        expect((await checkInventoryCompatibility('a', client as any)).ready).toBe(true);
    });
    it('reports unsupported custom types before mode changes rather than choosing a legacy fallback', async () => {
        await db.exec(`INSERT INTO "WooProduct" VALUES ('p','a',10,true,'{"type":"custom_inventory"}'),('foreign','b',20,true,'{"type":"custom_inventory"}')`);
        expect(await checkInventoryCompatibility('a', client as any)).toEqual({ ready: false, blockedCount: 1, targets: [{ productWooId: 10, variationWooId: null, reason: 'unsupported_native_stock_type' }] });
    });
    it('surfaces a known unsupported variable-parent cascade configuration before receipt processing', async () => {
        await db.exec(`INSERT INTO "WooProduct" VALUES ('leaf','a',10,true,'{"type":"simple","manage_stock":true,"stock_quantity":5}'),
          ('finished','a',20,true,'{"type":"variable","manage_stock":true}');
          INSERT INTO "BOM" VALUES ('bom','finished',0);
          INSERT INTO "BOMItem" (id,"bomId","childProductId","internalProductId","childVariationId","isActive") VALUES ('item','bom','leaf',NULL,NULL,true);`);
        expect((await checkInventoryCompatibility('a', client as any)).targets).toContainEqual({ productWooId: 20, variationWooId: null, reason: 'configure_variation_bom_instead_of_unsupported_parent_cascade' });
    });
});
