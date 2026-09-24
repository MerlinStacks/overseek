import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { persistWooProduct } from '../persistWooProduct';
import { openNativeDeliveryDatabase } from '../deliveryEstimates/__tests__/nativeDeliveryDatabase';

const { db, tx } = vi.hoisted(() => ({
    db: { wooProduct: { upsert: vi.fn() }, $transaction: vi.fn() },
    tx: {
        wooProduct: { upsert: vi.fn() },
        bOMItem: { updateMany: vi.fn(), deleteMany: vi.fn() },
        bOM: { deleteMany: vi.fn() },
        productVariation: { deleteMany: vi.fn() }
    }
}));
vi.mock('../../utils/prisma', () => ({ prisma: db }));

const args = {
    where: { accountId_wooId: { accountId: 'a', wooId: 10 } },
    create: { accountId: 'a', wooId: 10, name: 'Simple', rawData: { type: 'simple' } },
    update: { name: 'Simple', stockQuantity: 7, manageStock: true, rawData: { type: 'simple' } }
};

describe('atomic Woo simple-product persistence', () => {
    beforeEach(() => {
        vi.resetAllMocks();
        db.$transaction.mockImplementation(async work => work(tx));
        tx.wooProduct.upsert.mockResolvedValue({ id: 'p', ...args.update });
    });

    it('cleans on every explicit simple snapshot, including repeat repairs, without promoting variant data', async () => {
        for (let i = 0; i < 2; i++) {
            expect(await persistWooProduct('simple', args)).toEqual({ id: 'p', ...args.update });
        }
        expect(db.wooProduct.upsert).not.toHaveBeenCalled();
        expect(tx.wooProduct.upsert).toHaveBeenCalledWith(args);
        expect(tx.bOMItem.updateMany).toHaveBeenCalledWith({
            where: { childProductId: 'p', childVariationId: { not: null } },
            data: { isActive: false, deactivatedReason: 'VARIATION_DELETED_IN_WOO', childProductId: null, childVariationId: null }
        });
        expect(tx.bOMItem.updateMany).toHaveBeenNthCalledWith(2, {
            where: {
                bom: { productId: 'p', variationId: { not: 0 } },
                OR: [{ isActive: true }, { deactivatedReason: null }, { deactivatedReason: { not: 'VARIATION_DELETED_IN_WOO' } }]
            },
            data: { isActive: false, deactivatedReason: 'VARIATION_DELETED_IN_WOO' }
        });
        expect(tx.bOMItem.updateMany).toHaveBeenCalledTimes(4);
        expect(tx.bOM.deleteMany).not.toHaveBeenCalled();
        expect(tx.bOMItem.deleteMany).not.toHaveBeenCalled();
        expect(tx.productVariation.deleteMany).toHaveBeenCalledWith({ where: { productId: 'p' } });
        expect(tx.productVariation.deleteMany).toHaveBeenCalledTimes(2);
        expect(tx.bOMItem.updateMany.mock.invocationCallOrder[1]).toBeLessThan(tx.productVariation.deleteMany.mock.invocationCallOrder[0]);
    });

    it.each(['variable', 'variable-subscription', 'grouped', undefined, null, ''])('retains variations for type %j', async type => {
        await persistWooProduct(type, args);
        expect(db.wooProduct.upsert).toHaveBeenCalledWith(args);
        expect(db.$transaction).not.toHaveBeenCalled();
        expect(tx.productVariation.deleteMany).not.toHaveBeenCalled();
    });

    it.each(['parent', 'components', 'recipes', 'variations'])('propagates %s failures out of the transaction to trigger rollback', async stage => {
        const error = new Error('write failed');
        if (stage === 'parent') tx.wooProduct.upsert.mockRejectedValueOnce(error);
        if (stage === 'components') tx.bOMItem.updateMany.mockRejectedValueOnce(error);
        if (stage === 'recipes') {
            tx.bOMItem.updateMany.mockResolvedValueOnce({ count: 1 }).mockRejectedValueOnce(error);
        }
        if (stage === 'variations') tx.productVariation.deleteMany.mockRejectedValueOnce(error);
        await expect(persistWooProduct('simple', args)).rejects.toThrow('write failed');
        await expect(db.$transaction.mock.results[0].value).rejects.toThrow('write failed');
        expect(tx.bOMItem.updateMany).toHaveBeenCalledTimes(stage === 'parent' ? 0 : stage === 'components' ? 1 : 2);
        expect(tx.productVariation.deleteMany).toHaveBeenCalledTimes(stage === 'variations' ? 1 : 0);
        expect(tx.bOM.deleteMany).not.toHaveBeenCalled();
        expect(tx.bOMItem.deleteMany).not.toHaveBeenCalled();
    });
});

// Real Prisma predicates and trigger execution, only in an explicitly opted-in
// isolated native test schema. Never falls back to the application DATABASE_URL.
describe.skipIf(!process.env.DELIVERY_FRESHNESS_TEST_DATABASE_URL)('simple snapshot BOM no-op (native PostgreSQL)', () => {
    let fixture: Awaited<ReturnType<typeof openNativeDeliveryDatabase>>;
    beforeAll(async () => {
        fixture = await openNativeDeliveryDatabase();
        await fixture.db.exec(`ALTER TABLE "WooProduct" ADD COLUMN name text, ADD COLUMN "stockQuantity" int,
                ADD COLUMN "updatedAt" timestamp, ADD COLUMN "createdAt" timestamp,
                ADD COLUMN images jsonb, ADD COLUMN "isGoldPriceApplied" boolean, ADD COLUMN "miscCosts" jsonb,
                ADD COLUMN "seoScore" int, ADD COLUMN "seoData" jsonb, ADD COLUMN "merchantCenterScore" int,
                ADD COLUMN "merchantCenterIssues" jsonb, ADD UNIQUE ("accountId","wooId");
            INSERT INTO "WooProduct" (id,"accountId","wooId",name,"stockQuantity","manageStock","rawData","productionMinDays","productionMaxDays")
                VALUES ('p','a',10,'Simple',7,true,'{"type":"simple"}',0,0);
            INSERT INTO "BOM" VALUES ('obsolete','p',11);
            INSERT INTO "BOMItem" (id,"bomId","isActive",quantity,"deactivatedReason")
                VALUES ('retained','obsolete',false,1,'VARIATION_DELETED_IN_WOO');
            INSERT INTO "DeliveryInputSync" (id,"accountId",scope,"entityId",payload,"updatedAt")
                VALUES ('projection','a','inbound',10,'{"targets":[]}',now());
            TRUNCATE "DeliveryInboundDirtyTarget";`);
    }, 30_000);
    afterAll(async () => { await fixture?.close(); });
    beforeEach(() => {
        vi.resetAllMocks();
        db.$transaction.mockImplementation(work => fixture.client.$transaction(work));
    });
    const dirty = async () => (await fixture.db.query('SELECT "wooId",version FROM "DeliveryInboundDirtyTarget"')).rows;
    const revisions = async () => (await fixture.db.query('SELECT "desiredRevision","ackRevision",status FROM "DeliveryInputSync"')).rows;
    const snapshot = () => persistWooProduct('simple', { ...args, select: { id: true } });

    it('syncs the same payload twice with acknowledgement between, without requeue or revision changes', async () => {
        await snapshot();
        expect(await dirty()).toEqual([]);
        await fixture.db.exec(`UPDATE "DeliveryInputSync" SET "ackRevision"="desiredRevision",status='synced';
            DELETE FROM "DeliveryInboundDirtyTarget";`);
        const acknowledged = await revisions();
        await snapshot();
        expect(await dirty()).toEqual([]);
        expect(await revisions()).toEqual(acknowledged);
    });

    it.each([
        ['false', 'NULL'], ['false', "'PRODUCT_404'"], ['true', "'VARIATION_DELETED_IN_WOO'"]
    ])('repairs active=%s reason=%s once, including NULL reasons', async (active, reason) => {
        await fixture.db.exec(`UPDATE "BOMItem" SET "isActive"=${active},"deactivatedReason"=${reason} WHERE id='retained';
            TRUNCATE "DeliveryInboundDirtyTarget";`);
        await snapshot();
        expect(await dirty()).toEqual([{ wooId: 10, version: 1 }]);
        await fixture.db.exec('DELETE FROM "DeliveryInboundDirtyTarget"');
        await snapshot();
        expect(await dirty()).toEqual([]);
        expect((await fixture.db.query('SELECT "isActive","deactivatedReason" FROM "BOMItem"')).rows)
            .toEqual([{ isActive: false, deactivatedReason: 'VARIATION_DELETED_IN_WOO' }]);
    });
});
