import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { hasFreshnessTestDatabase, openFreshnessTestDatabase } from './__tests__/freshnessDatabase';
import { buildCutoverBatch, cutoverBatchStillCurrent, cutoverProgress, controlBytes, CONTROL_MAX_BYTES } from './cutoverBatch';

let db: any; let queries: string[];
const tx = { $queryRaw: async (query: { text: string; values: unknown[] }) => {
    queries.push(query.text); return (await db.query(query.text, query.values)).rows;
} };
describe.skipIf(!hasFreshnessTestDatabase)('bounded cutover metadata pages (isolated PostgreSQL)', () => {
    beforeEach(async () => {
        db = await openFreshnessTestDatabase(); queries = [];
        await db.exec(`CREATE TABLE "WooProduct" (id text PRIMARY KEY,"accountId" text,"wooId" int,"manageStock" boolean,"rawData" jsonb);
          CREATE INDEX product_page ON "WooProduct" ("accountId",id);
          CREATE TABLE "ProductVariation" (id text PRIMARY KEY,"productId" text,"wooId" int,"manageStock" boolean,"rawData" jsonb);
          CREATE INDEX variation_page ON "ProductVariation" ("productId","wooId");
          CREATE TABLE "BOM" (id text,"productId" text); CREATE INDEX bom_product ON "BOM" ("productId");
          CREATE TABLE "BOMItem" (id text,"bomId" text,"childProductId" text,"childVariationId" int,"internalProductId" text);
          CREATE INDEX bom_items ON "BOMItem" ("bomId");`);
    });
    afterEach(async () => { await db?.close(); });
    const page = (cursor: string | null = null, progress = cutoverProgress(null, null), revision = 1n) => buildCutoverBatch(tx as any, 'a', revision, 'epoch', cursor, progress);
    async function simple(count: number) {
        await db.query(`INSERT INTO "WooProduct" SELECT 'p'||lpad(i::text,5,'0'),'a',i,true,jsonb_build_object('type','simple','manage_stock',true) FROM generate_series(1,$1) i`, [count]);
    }
    it.each([500, 1000])('certifies %s simple products in <=40 complete bounded commands without reading PO data', async count => {
        await simple(count);
        let cursor: string | null = null; let progress = cutoverProgress(null, null); let commands = 0;
        const owners: number[] = [];
        for (; commands < 40;) {
            const command = await page(cursor, progress, BigInt(++commands));
            expect(controlBytes(command)).toBeLessThanOrEqual(CONTROL_MAX_BYTES);
            if (command.action === 'guarded') break;
            expect(command.page!.productCount).toBeLessThanOrEqual(50);
            expect(await cutoverBatchStillCurrent(tx as any, 'a', command.page!)).toBe(true);
            owners.push(...command.owners); cursor = command.cursor!;
            progress = { ...progress, baselineEstablished: true, productsProcessed: progress.productsProcessed + command.page!.productCount };
        }
        expect(commands).toBe(count / 50 + 1);
        expect(progress.productsProcessed).toBe(count);
        expect(new Set(owners).size).toBe(count);
        expect(queries.every(sql => !/PurchaseOrder|Supplier|stock_quantity/.test(sql))).toBe(true);
    });
    it('handles a complete 1000-variation product and never advances past an owner-cap overflow', async () => {
        await simple(3);
        await db.exec(`UPDATE "WooProduct" SET "rawData"='{"type":"variable","manage_stock":false}',"manageStock"=false WHERE id='p00002';
          INSERT INTO "ProductVariation" SELECT 'v'||i,'p00002',100+i,true,'{"manage_stock":true}' FROM generate_series(1,1000) i;`);
        const first = await page();
        expect(first.owners).toHaveLength(1001);
        expect(first.page!.productIds).toEqual(['p00001', 'p00002']); expect(first.cursor).toBe('p00002');
        expect(await cutoverBatchStillCurrent(tx as any, 'a', first.page!)).toBe(true);
        const next = await page(first.cursor!);
        expect(next.page!.productIds).toEqual(['p00003']); expect(next.owners).toEqual([3]);
    });
    it('deduplicates inherited owners without requiring a pending parent target', async () => {
        await simple(1);
        await db.exec(`UPDATE "WooProduct" SET "rawData"='{"type":"variable","manage_stock":true}';
          INSERT INTO "ProductVariation" SELECT 'v'||i,'p00001',100+i,false,'{"manage_stock":"parent"}' FROM generate_series(1,1000) i;`);
        const result = await page(); expect(result.owners).toEqual([1]); expect(result.page!.productCount).toBe(1);
    });
    it('limits materialized variation rows by deferring an entire second product', async () => {
        await simple(2);
        await db.exec(`UPDATE "WooProduct" SET "rawData"='{"type":"variable","manage_stock":false}',"manageStock"=false;
          INSERT INTO "ProductVariation" SELECT 'a'||i,'p00001',100+i,true,'{"manage_stock":true}' FROM generate_series(1,700) i;
          INSERT INTO "ProductVariation" SELECT 'b'||i,'p00002',1000+i,true,'{"manage_stock":true}' FROM generate_series(1,700) i;`);
        const first = await page(); const second = await page(first.cursor!);
        expect(first.page!.productIds).toEqual(['p00001']); expect(first.owners).toHaveLength(700);
        expect(second.page!.productIds).toEqual(['p00002']); expect(second.owners).toHaveLength(700);
        expect(new Set([...first.owners, ...second.owners]).size).toBe(1400);
    });
    it('never truncates an oversized variation product or loses it behind the preceding cursor', async () => {
        await simple(2);
        await db.exec(`UPDATE "WooProduct" SET "rawData"='{"type":"variable","manage_stock":true}' WHERE id='p00002';
          INSERT INTO "ProductVariation" SELECT 'v'||i,'p00002',100+i,true,'{"manage_stock":true}' FROM generate_series(1,1001) i;`);
        const first = await page(); expect(first.cursor).toBe('p00001'); expect(first.owners).toEqual([1]);
        await expect(page(first.cursor!)).rejects.toThrow('1000-variation protocol limit');
    });
    it('enforces UTF-8 envelope bytes on whole products as well as owner count', async () => {
        for (let i = 1; i <= 50; i++) await db.query(`INSERT INTO "WooProduct" VALUES ($1,'a',$2,true,'{"type":"simple","manage_stock":true}')`, [`p${String(i).padStart(3, '0')}${'庫'.repeat(600)}`, i]);
        const first = await page();
        expect(first.page!.productCount).toBeGreaterThan(1); expect(first.page!.productCount).toBeLessThan(50);
        expect(controlBytes(first)).toBeLessThanOrEqual(64 * 1024);
        expect(first.cursor).toBe(first.page!.productIds.at(-1));
        const next = await page(first.cursor!);
        expect([...first.owners, ...next.owners]).toEqual(Array.from({ length: 50 }, (_, i) => i + 1));
    });
    it('establishes the empty baseline explicitly and processes exclusions/tombstones without invented owners', async () => {
        const empty = await page(); expect(empty.action).toBe('baseline'); expect(empty.owners).toEqual([]);
        expect(await cutoverBatchStillCurrent(tx as any, 'a', empty.page!)).toBe(true);
        expect((await page(null, { ...cutoverProgress(null), baselineEstablished: true })).action).toBe('guarded');
        await simple(3);
        expect(await cutoverBatchStillCurrent(tx as any, 'a', empty.page!)).toBe(false);
        await db.exec(`INSERT INTO "BOM" VALUES ('bom','p00001'); INSERT INTO "BOMItem" VALUES ('stock-dependency','bom','p00003',NULL,NULL);
          UPDATE "WooProduct" SET "rawData"=jsonb_set("rawData",'{status}','"trash"') WHERE id='p00002';`);
        const excluded = await page(); expect(excluded.page!.productCount).toBe(3); expect(excluded.owners).toEqual([3]);
        expect(excluded.cursor).toBe('p00003');
    });
    it('fences source changes, inserted prefix rows and deletion while ignoring ordinary stock/price changes', async () => {
        await simple(2); const original = await page();
        await db.exec(`UPDATE "WooProduct" SET "rawData"="rawData" || '{"price":"20","stock_quantity":2}'`);
        expect(await cutoverBatchStillCurrent(tx as any, 'a', original.page!)).toBe(true);
        await db.exec(`INSERT INTO "WooProduct" VALUES ('p00001a','a',99,true,'{"type":"simple","manage_stock":true}')`);
        expect(await cutoverBatchStillCurrent(tx as any, 'a', original.page!)).toBe(false);
        await db.exec(`DELETE FROM "WooProduct" WHERE id='p00001a'; UPDATE "WooProduct" SET "manageStock"=false WHERE id='p00002'`);
        expect(await cutoverBatchStillCurrent(tx as any, 'a', original.page!)).toBe(false);
        await db.exec(`DELETE FROM "WooProduct" WHERE id='p00002'`);
        expect(await cutoverBatchStillCurrent(tx as any, 'a', original.page!)).toBe(false);
    });
});
