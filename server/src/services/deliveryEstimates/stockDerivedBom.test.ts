import { readFile } from 'node:fs/promises';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildInbound } from './inbound';
import { buildCutoverBatch, cutoverBatchStillCurrent, cutoverProgress } from './cutoverBatch';
import { hasFreshnessTestDatabase, openFreshnessTestDatabase } from './__tests__/freshnessDatabase';

describe.skipIf(!hasFreshnessTestDatabase)('cost-only versus stock-derived BOM eligibility (PostgreSQL)', () => {
    let db: any;
    let tx: any;
    const due = new Date(Date.now() + 2 * 86_400_000).toISOString().slice(0, 10);
    beforeAll(async () => {
        db = await openFreshnessTestDatabase();
        await db.exec(`
            CREATE TABLE "Account" (id text PRIMARY KEY);
            CREATE TABLE "WooProduct" (id text PRIMARY KEY, "accountId" text, "wooId" int, "supplierId" text, "manageStock" boolean, "rawData" jsonb, "productionMinDays" int, "productionMaxDays" int);
            CREATE TABLE "ProductVariation" (id text PRIMARY KEY, "productId" text, "wooId" int, "manageStock" boolean, "rawData" jsonb, "productionMinDays" int, "productionMaxDays" int, "deliveryActive" boolean DEFAULT true);
            CREATE TABLE "BOM" (id text PRIMARY KEY, "productId" text);
            CREATE TABLE "BOMItem" (id text PRIMARY KEY, "bomId" text, "supplierItemId" text, "childProductId" text, "childVariationId" int, "internalProductId" text, "isActive" boolean DEFAULT true);
            CREATE TABLE "Supplier" (id text PRIMARY KEY, "accountId" text, "leadTimeMin" int, "leadTimeMax" int, "leadTimeDefault" int);
            CREATE TABLE "PurchaseOrder" (id text PRIMARY KEY, "accountId" text, status text, "expectedDate" timestamp);
            CREATE TABLE "PurchaseOrderItem" (id text PRIMARY KEY, "purchaseOrderId" text, "productId" text, "variationWooId" int, quantity int);
            CREATE TABLE "DeliveryInputSync" (id text, "accountId" text, scope text, "entityId" int, payload jsonb, status text);
            CREATE TABLE "DeliveryInboundDirtyTarget" ("accountId" text, "wooId" int, version int, "createdAt" timestamp, "updatedAt" timestamp, PRIMARY KEY ("accountId","wooId"));
            CREATE TABLE "DeliverySyncAccount" ("accountId" text, "capabilityStatus" text, "inboundCapabilityStatus" text, "inboundFailed" boolean);
            CREATE TABLE "AccountFeature" ("accountId" text, "featureKey" text, "isEnabled" boolean);
            CREATE TABLE "ReceiptOwner" ("accountId" text, "stockOwnerWooId" int, "certifiedEpoch" text, "lastSequence" bigint, "appliedSequence" bigint, parked boolean, "cascadePending" boolean);
            INSERT INTO "Account" VALUES ('a');
            INSERT INTO "WooProduct" VALUES ('p','a',10,'s',true,'{"type":"simple","manage_stock":true,"status":"publish"}',0,2),
                ('component','a',20,NULL,true,'{"type":"simple","manage_stock":true,"status":"publish"}',NULL,NULL);
            INSERT INTO "Supplier" VALUES ('s','a',2,4,NULL);
            INSERT INTO "BOM" VALUES ('cost','p');
            INSERT INTO "BOMItem" (id,"bomId","supplierItemId") VALUES ('material-cost','cost','supplier-material'), ('labour-cost','cost','supplier-labour');
        `);
        await db.exec(await readFile('prisma/migrations/20260922123000_delivery_freshness_targets/migration.sql', 'utf8'));
        await db.query(`INSERT INTO "PurchaseOrder" VALUES ('po','a','ORDERED',$1)`, [due]);
        await db.exec(`INSERT INTO "PurchaseOrderItem" VALUES ('line','po','p',NULL,7); TRUNCATE "DeliveryInboundDirtyTarget"`);

        // Execute cutover's actual SQL. The small source adapter executes the nested
        // Prisma reads requested by buildInbound against real tables, including its
        // requested BOM predicate (not a pre-filtered canned product fixture).
        tx = {
            $queryRaw: async (query: any) => (await db.query(query.text, query.values)).rows,
            wooProduct: { findFirst: async ({ where, select }: any) => {
                const product = (await db.query('SELECT * FROM "WooProduct" WHERE "accountId"=$1 AND "wooId"=$2', [where.accountId, where.wooId])).rows[0];
                if (!product) return null;
                const conditions = select.boms.where?.items?.some?.OR;
                const predicate = conditions?.map((clause: any) => {
                    const [field, comparison] = Object.entries(clause)[0];
                    expect(['childProductId', 'childVariationId', 'internalProductId']).toContain(field);
                    expect(comparison).toEqual({ not: null });
                    return `bi."${field}" IS NOT NULL`;
                }).join(' OR ');
                product.boms = (await db.query(`SELECT b.id FROM "BOM" b WHERE b."productId"=$1
                    ${predicate ? `AND EXISTS (SELECT 1 FROM "BOMItem" bi WHERE bi."bomId"=b.id AND (${predicate}))` : ''} LIMIT $2`, [product.id, select.boms.take])).rows;
                product.supplier = (await db.query('SELECT * FROM "Supplier" WHERE id=$1', [product.supplierId])).rows[0] ?? null;
                product.variations = (await db.query('SELECT * FROM "ProductVariation" WHERE "productId"=$1 AND "deliveryActive" ORDER BY "wooId" LIMIT $2', [product.id, select.variations.take])).rows;
                return product;
            } },
            purchaseOrderItem: { findMany: async ({ where, take }: any) => (await db.query(`SELECT i.*, p."accountId", p.status, p."expectedDate" FROM "PurchaseOrderItem" i
                JOIN "PurchaseOrder" p ON p.id=i."purchaseOrderId" WHERE i."productId"=$1 AND p."accountId"=$2 AND p.status=$3 LIMIT $4`,
            [where.productId, where.purchaseOrder.accountId, where.purchaseOrder.status, take])).rows.map((row: any) => ({ ...row,
                purchaseOrder: { accountId: row.accountId, status: row.status, expectedDate: new Date(row.expectedDate) },
            })) },
            receiptAccount: { findUnique: async () => ({ cutoverEpoch: 'epoch', cutoverState: 'guarded' }) },
            receiptOwner: { findMany: async ({ where }: any) => (await db.query('SELECT * FROM "ReceiptOwner" WHERE "accountId"=$1 AND "stockOwnerWooId"=ANY($2::int[])',
                [where.accountId, where.stockOwnerWooId.in])).rows.map((row: any) => ({ ...row, lastSequence: BigInt(row.lastSequence), appliedSequence: BigInt(row.appliedSequence) })) },
        };
    }, 30_000);
    afterAll(async () => { await db?.close(); });
    const page = () => buildCutoverBatch(tx, 'a', 1n, 'epoch', null, cutoverProgress(null));
    const inbound = () => buildInbound(tx, 'a', 10);

    it('includes cost-only native owners for certification and preserves direct supplier/PO dates', async () => {
        const command = await page();
        expect(command.owners).toContain(10);
        expect((await inbound()).receiptSafety).toBe('unverified'); // No inferred baseline.
        // Explicit persisted baseline acknowledgement fixture; no receipt arithmetic.
        await db.exec(`INSERT INTO "ReceiptOwner" VALUES ('a',10,'epoch',0,0,false,false)`);
        expect(await inbound()).toMatchObject({ receiptSafety: 'verified', targets: [{ wooId: 10, stockOwnerWooId: 10, state: 'pending', supplierLead: { min: 2, max: 4 }, batches: [{ dueDate: due, quantity: 7 }] }] });
    });

    it.each([
        ['inventory child', '"childProductId"', "'component'"],
        ['internal stock', '"internalProductId"', "'internal'"],
        ['orphan variation reference', '"childVariationId"', '999'],
        ['invalid zero variation reference', '"childVariationId"', '0'],
        ['ambiguous empty child reference', '"childProductId"', "''"],
    ])('excludes %s; adding/removing the dependency invalidates and fences cutover', async (_name, field, value) => {
        await db.exec('BEGIN');
        try {
            const before = await page();
            await db.exec(`TRUNCATE "DeliveryInboundDirtyTarget"; UPDATE "BOMItem" SET ${field}=${value}, "supplierItemId"=NULL WHERE id='material-cost'`);
            expect((await db.query('SELECT "accountId","wooId" FROM "DeliveryInboundDirtyTarget"')).rows).toEqual([{ accountId: 'a', wooId: 10 }]);
            expect((await page()).owners).not.toContain(10);
            expect(await cutoverBatchStillCurrent(tx, 'a', before.page!)).toBe(false);
            expect((await inbound()).targets).toEqual([{ wooId: 10, stockOwnerWooId: null, state: 'unsupported', supplierLead: null, batches: [] }]);
            await db.exec(`UPDATE "BOMItem" SET "isActive"=false WHERE id='material-cost'`);
            expect((await page()).owners).not.toContain(10); // Inactive inventory links remain conservative.
            await db.exec(`TRUNCATE "DeliveryInboundDirtyTarget"; UPDATE "BOMItem" SET ${field}=NULL, "supplierItemId"='supplier-material' WHERE id='material-cost'`);
            expect((await db.query('SELECT "wooId" FROM "DeliveryInboundDirtyTarget"')).rows).toEqual([{ wooId: 10 }]);
            expect((await page()).owners).toContain(10);
            expect((await inbound()).targets[0]).toMatchObject({ state: 'pending', batches: [{ dueDate: due, quantity: 7 }] });
        } finally { await db.exec('ROLLBACK'); }
    });
});
