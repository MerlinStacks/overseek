import { readFile } from 'node:fs/promises';
import { describe, expect, it, vi } from 'vitest';
vi.mock('../../utils/prisma', () => ({ prisma: {} }));
import { FRESHNESS_PREREQUISITE_SQL } from './freshnessPrerequisite';
import { hasFreshnessTestDatabase, openFreshnessTestDatabase } from './__tests__/freshnessDatabase';

describe.skipIf(!hasFreshnessTestDatabase)('isolated complete new delivery migration chain', () => {
    it('applies all delivery migrations in order over a pre-delivery source baseline', async () => {
        const db = await openFreshnessTestDatabase();
        try {
            // Minimal pre-delivery source tables, not a replacement for historical
            // whole-application migration coverage. Every new delivery table is real DDL.
            await db.exec(`
                CREATE TABLE "Account" (id text PRIMARY KEY);
                CREATE TABLE "WooOrder" (id text PRIMARY KEY);
                CREATE TABLE "WooProduct" (id text PRIMARY KEY, "accountId" text, "wooId" int, "supplierId" text, "manageStock" boolean, "rawData" jsonb);
                CREATE TABLE "ProductVariation" (id text PRIMARY KEY, "productId" text, "wooId" int, "manageStock" boolean, "rawData" jsonb);
                CREATE TABLE "AccountFeature" ("accountId" text, "featureKey" text, "isEnabled" boolean);
                CREATE TABLE "BOM" (id text PRIMARY KEY, "productId" text);
                CREATE TABLE "BOMItem" (id text PRIMARY KEY, "bomId" text, "isActive" boolean, quantity int);
                CREATE TABLE "Supplier" (id text PRIMARY KEY, "accountId" text, "leadTimeMin" int, "leadTimeMax" int, "leadTimeDefault" int);
                CREATE TABLE "PurchaseOrder" (id text PRIMARY KEY, status text, "expectedDate" timestamp);
                CREATE TABLE "PurchaseOrderItem" (id text PRIMARY KEY, "purchaseOrderId" text, "productId" text, "variationWooId" int, quantity int);
                CREATE TABLE "BOMDeductionLedger" (id text PRIMARY KEY);
                INSERT INTO "Account" VALUES ('a');
            `);
            const migrations = [
                '20260921000000_delivery_estimates', '20260921010000_delivery_input_sync',
                '20260921020000_delivery_sync_account', '20260921030000_delivery_inbound',
                '20260921040000_delivery_inbound_targets', '20260922000000_order_delivery_estimate_snapshot',
                '20260922010000_guarded_receipts', '20260922020000_delivery_launch',
                '20260922123000_delivery_freshness_targets', '20260922133000_delivery_freshness_prerequisite',
                '20260922134000_delivery_inbound_scope_constraints',
                '20260922160000_delivery_launch_recovery',
                '20260922170000_receipt_cascade',
                '20260923100000_variant_suppliers', '20260923110000_variant_supplier_freshness',
                '20260923120000_stock_write_offs', '20260923130000_delivery_bom_noop_guards',
            ];
            for (const migration of migrations) await db.exec(await readFile(`prisma/migrations/${migration}/migration.sql`, 'utf8'));
            expect((await db.query(FRESHNESS_PREREQUISITE_SQL)).rows).toEqual([]);
            await db.exec(`INSERT INTO "WooProduct" (id,"accountId","wooId","productionMinDays","productionMaxDays") VALUES ('p','a',10,0,0)`);
            expect((await db.query('SELECT "accountId", "wooId" FROM "DeliveryInboundDirtyTarget"')).rows).toEqual([{ accountId: 'a', wooId: 10 }]);
            await db.exec(`INSERT INTO "DeliverySyncAccount" ("accountId","updatedAt","capabilityStatus","inboundCapabilityStatus") VALUES ('a',now(),'supported','supported')`);
            await db.exec(`INSERT INTO "DeliveryInputSync" (id,"accountId",scope,"entityId",payload,"updatedAt","inboundRenewAt")
                VALUES ('i','a','inbound',10,'{"generatedAt":"2026-09-22T00:00:00Z","expiresAt":"2026-09-23T00:00:00Z","targets":[{"wooId":10}]}',now(),'2026-09-22T20:00:00Z');
                INSERT INTO "AccountFeature" VALUES ('a','DELIVERY_ESTIMATES',false)`);
            expect((await db.query('SELECT "inboundRenewAt" FROM "DeliveryInputSync"')).rows[0].inboundRenewAt).toBeNull();
            for (const change of ["scope='unknown'", '"entityId"=0', '"ackRevision"=2', '"desiredRevision"=0']) {
                await expect(db.exec(`UPDATE "DeliveryInputSync" SET ${change} WHERE id='i'`)).rejects.toThrow(/check constraint/);
            }
            expect((await db.query(`SELECT "receiptTransportMode" FROM "Account" WHERE id='a'`)).rows[0].receiptTransportMode).toBe('LEGACY');
            await db.exec(`INSERT INTO "ReceiptOwner" ("accountId","stockOwnerWooId","lastSequence") VALUES ('a',10,1),('a',11,1);
                INSERT INTO "ReceiptCycle" (id,"accountId","purchaseOrderId","skippedLines") VALUES ('cycle','a','po','[{"reason":"unlinked_or_supplier_only"}]');
                INSERT INTO "ReceiptOperation" ("operationId","accountId","cycleId","purchaseOrderId","productId","productWooId","variationWooId","stockOwnerWooId",sequence,delta,"cascadeState")
                  VALUES ('parent-owned','a','cycle','po','p',10,11,10,1,3,'waiting_receipt');
                UPDATE "ReceiptOperation" SET state='applied',"cascadeState"='pending';
                UPDATE "ReceiptOwner" SET "appliedSequence"=1,"cascadePending"=true WHERE "stockOwnerWooId"=10;`);
            expect((await db.query(`SELECT "variationId","stockOwnerWooId","cascadeState" FROM "ReceiptOperation"`)).rows[0]).toMatchObject({ variationId: null, stockOwnerWooId: 10, cascadeState: 'pending' });
            await expect(db.exec(`UPDATE "ReceiptOperation" SET delta=9`)).rejects.toThrow('Receipt operation intent is immutable');
            await expect(db.exec(`UPDATE "ReceiptCycle" SET "skippedLines"='[]'`)).rejects.toThrow('Receipt cycle provenance is immutable');
            await db.exec(`UPDATE "ReceiptCycle" SET active=false`);
            await expect(db.exec(`INSERT INTO "ReceiptOperation" ("operationId","accountId","cycleId","purchaseOrderId","productId","productWooId","stockOwnerWooId",sequence,delta)
                VALUES ('wrong-owner','a','cycle','po','p',10,11,1,3)`)).rejects.toThrow(/check constraint/);
        } finally { await db.close(); }
    }, 30_000);
});
