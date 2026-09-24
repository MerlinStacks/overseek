import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { openNativeDeliveryDatabase } from '../deliveryEstimates/__tests__/nativeDeliveryDatabase';
import { extendNativeReceiptBaseline } from '../deliveryEstimates/__tests__/nativeReceiptBaseline';
const db = vi.hoisted(() => ({ $transaction: vi.fn() }));
vi.mock('../../utils/prisma', () => ({ prisma: db }));
import { persistWooProduct } from '../persistWooProduct';

// Retain native coverage of the no-op recipe guard. This suite requires an
// explicitly opted-in isolated schema and is not run against the application DB.
describe.skipIf(!process.env.DELIVERY_FRESHNESS_TEST_DATABASE_URL)('simple snapshot BOM no-op (native PostgreSQL)', () => {
    let fixture: Awaited<ReturnType<typeof openNativeDeliveryDatabase>>;
    beforeAll(async () => {
        fixture = await openNativeDeliveryDatabase();
        await extendNativeReceiptBaseline(fixture.db);
        await fixture.db.exec(`INSERT INTO "WooProduct" (id,"accountId","wooId",name,"stockQuantity","manageStock","rawData","productionMinDays","productionMaxDays")
                VALUES ('p','a',10,'Simple',7,true,'{"type":"simple"}',0,0);
            INSERT INTO "BOM" VALUES ('obsolete','p',11);
            INSERT INTO "BOMItem" (id,"bomId","isActive",quantity,"deactivatedReason")
                VALUES ('retained','obsolete',false,1,'VARIATION_DELETED_IN_WOO');
            INSERT INTO "DeliveryInputSync" (id,"accountId",scope,"entityId",payload,"updatedAt")
                VALUES ('projection','a','inbound',10,'{"targets":[]}',now());
            TRUNCATE "DeliveryInboundDirtyTarget";`);
    }, 30_000);
    afterAll(async () => { await fixture?.close(); });
    beforeEach(() => { db.$transaction.mockImplementation((work, options) => fixture.client.$transaction(work, options)); });
    const dirty = async () => (await fixture.db.query('SELECT "wooId",version FROM "DeliveryInboundDirtyTarget"')).rows;
    const revisions = async () => (await fixture.db.query('SELECT "desiredRevision","ackRevision",status FROM "DeliveryInputSync"')).rows;
    const snapshot = () => persistWooProduct('simple', {
        where: { accountId_wooId: { accountId: 'a', wooId: 10 } },
        create: { accountId: 'a', wooId: 10, name: 'Simple', rawData: { type: 'simple' } },
        update: { name: 'Simple', stockQuantity: 7, manageStock: true, rawData: { type: 'simple' } }, select: { id: true },
    });
    it('syncs the same payload twice without requeue or revision changes', async () => {
        await snapshot();
        expect(await dirty()).toEqual([]);
        await fixture.db.exec(`UPDATE "DeliveryInputSync" SET "ackRevision"="desiredRevision",status='synced'; DELETE FROM "DeliveryInboundDirtyTarget";`);
        const acknowledged = await revisions();
        await snapshot();
        expect(await dirty()).toEqual([]);
        expect(await revisions()).toEqual(acknowledged);
    });
    it.each([['false', 'NULL'], ['false', "'PRODUCT_404'"], ['true', "'VARIATION_DELETED_IN_WOO'"]])('repairs active=%s reason=%s once', async (active, reason) => {
        await fixture.db.exec(`UPDATE "BOMItem" SET "isActive"=${active},"deactivatedReason"=${reason} WHERE id='retained'; TRUNCATE "DeliveryInboundDirtyTarget";`);
        await snapshot();
        expect(await dirty()).toEqual([{ wooId: 10, version: 1 }]);
        await fixture.db.exec('DELETE FROM "DeliveryInboundDirtyTarget"');
        await snapshot();
        expect(await dirty()).toEqual([]);
        expect((await fixture.db.query('SELECT "isActive","deactivatedReason" FROM "BOMItem"')).rows)
            .toEqual([{ isActive: false, deactivatedReason: 'VARIATION_DELETED_IN_WOO' }]);
    });
});
