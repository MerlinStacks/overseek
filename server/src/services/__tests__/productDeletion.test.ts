import { beforeEach, describe, expect, it, vi } from 'vitest';

const m = vi.hoisted(() => ({
    db: { $transaction: vi.fn(), wooProduct: { findUnique: vi.fn(), update: vi.fn(), upsert: vi.fn(), deleteMany: vi.fn() }, bOMItem: { updateMany: vi.fn() } },
    remove: vi.fn()
}));
vi.mock('../../utils/prisma', () => ({ prisma: m.db }));
vi.mock('../../utils/cache', () => ({ invalidateCache: vi.fn() }));
vi.mock('../search/IndexingService', () => ({ IndexingService: { deleteProduct: m.remove } }));
vi.mock('../wholesale/reconciliation', () => ({ reconcileWholesaleProductsBestEffort: vi.fn() }));
import { permanentlyDeleteWooProduct, trashWooProduct, isWooProductNotFound } from '../productDeletion';
import { persistWooProduct } from '../persistWooProduct';

describe('Woo product deletion lifecycle', () => {
    beforeEach(() => {
        vi.resetAllMocks();
        m.db.$transaction.mockImplementation(work => work(m.db));
        m.db.wooProduct.findUnique.mockResolvedValue({ id: 'uuid', wooId: 42, rawData: { type: 'variable', status: 'publish' } });
        m.db.wooProduct.deleteMany.mockResolvedValue({ count: 1 });
    });

    it('atomically deactivates and detaches incoming product AND variant references before deletion', async () => {
        expect(await permanentlyDeleteWooProduct('a', 42)).toBe(1);
        expect(m.db.$transaction).toHaveBeenCalledOnce();
        expect(m.db.bOMItem.updateMany).toHaveBeenCalledWith({ where: { childProductId: 'uuid' }, data: {
            isActive: false, deactivatedReason: 'PRODUCT_DELETED_IN_WOO', childProductId: null, childVariationId: null
        } });
        expect(m.db.bOMItem.updateMany.mock.invocationCallOrder[0]).toBeLessThan(m.db.wooProduct.deleteMany.mock.invocationCallOrder[0]);
        expect(m.db.wooProduct.deleteMany).toHaveBeenCalledWith({ where: { id: 'uuid', accountId: 'a', wooId: 42 } });
    });

    it('retries search by account and Woo ID after the DB row has gone', async () => {
        m.db.wooProduct.findUnique.mockResolvedValue(null);
        m.remove.mockRejectedValueOnce(new Error('offline'));
        await expect(permanentlyDeleteWooProduct('other-account', 42)).rejects.toThrow('offline');
        expect(await permanentlyDeleteWooProduct('other-account', 42)).toBe(0);
        expect(m.remove).toHaveBeenNthCalledWith(2, 'other-account', 42);
        expect(m.db.wooProduct.findUnique).toHaveBeenCalledWith({ where: { accountId_wooId: { accountId: 'other-account', wooId: 42 } }, select: { id: true } });
        expect(m.db.bOMItem.updateMany).not.toHaveBeenCalled();
    });

    it('propagates a detach failure without issuing parent deletion', async () => {
        m.db.bOMItem.updateMany.mockRejectedValueOnce(new Error('detach failed'));
        await expect(permanentlyDeleteWooProduct('a', 42)).rejects.toThrow('detach failed');
        expect(m.db.wooProduct.deleteMany).not.toHaveBeenCalled();
    });

    it('trash and restoration reuse the row and preserve costs, variations and relationships', async () => {
        const original = { id: 'uuid', wooId: 42, cogs: 17, supplierId: 'supplier', variations: [{ id: 'variant', cogs: 3 }], boms: [{ id: 'recipe' }], rawData: { type: 'variable', status: 'publish' } };
        let row: any = structuredClone(original);
        m.db.wooProduct.findUnique.mockImplementation(async () => row);
        m.db.wooProduct.update.mockImplementation(async ({ data }) => row = { ...row, ...data });
        m.db.wooProduct.upsert.mockImplementation(async ({ update }) => row = { ...row, ...update });
        await trashWooProduct('a', 42);
        expect(row).toMatchObject({ ...original, status: 'trash', rawData: { type: 'variable', status: 'trash' } });
        await persistWooProduct('variable', { where: { accountId_wooId: { accountId: 'a', wooId: 42 } }, create: { accountId: 'a', wooId: 42, name: 'Restored', rawData: original.rawData }, update: { status: 'publish', rawData: original.rawData } });
        expect(row).toMatchObject({ ...original, status: 'publish' });
        expect(m.db.bOMItem.updateMany).not.toHaveBeenCalled();
        expect(m.db.wooProduct.deleteMany).not.toHaveBeenCalled();
    });

    it('simple trash snapshots never retire variations in the persistence helper', async () => {
        await persistWooProduct('simple', { where: { accountId_wooId: { accountId: 'a', wooId: 42 } }, create: { accountId: 'a', wooId: 42, name: 'Trash', status: 'trash', rawData: {} }, update: { status: 'trash' } });
        expect(m.db.wooProduct.upsert).toHaveBeenCalledOnce();
        expect(m.db.$transaction).not.toHaveBeenCalled();
    });

    it.each([401, 403, 500])('does not classify status %s as authoritative deletion', status => {
        expect(isWooProductNotFound({ response: { status, data: { code: 'woocommerce_rest_product_invalid_id' } } })).toBe(false);
    });
});
