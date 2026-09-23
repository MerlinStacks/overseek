import { beforeEach, describe, expect, it, vi } from 'vitest';
import { persistWooProduct } from '../persistWooProduct';

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
            where: { bom: { productId: 'p', variationId: { not: 0 } } },
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
