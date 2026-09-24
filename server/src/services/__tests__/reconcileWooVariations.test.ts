import { beforeEach, describe, expect, it, vi } from 'vitest';
const m = vi.hoisted(() => ({ dirty: vi.fn() }));
vi.mock('../deliveryEstimates/intents', () => ({ dirtyInboundProducts: m.dirty }));
import { reconcileWooVariations } from '../reconcileWooVariations';

describe('durable delivery membership without deleting history', () => {
    let tx: any;
    beforeEach(() => {
        vi.resetAllMocks();
        tx = { wooProduct: { updateMany: vi.fn().mockResolvedValue({ count: 1 }) },
            productVariation: { updateMany: vi.fn().mockResolvedValue({ count: 0 }), findMany: vi.fn().mockResolvedValue([]) },
            bOMItem: { updateMany: vi.fn().mockResolvedValue({ count: 0 }) } };
    });
    it('only changes delivery membership; missing rows and all stock/override/reference metadata survive', async () => {
        tx.productVariation.updateMany.mockResolvedValueOnce({ count: 1 });
        tx.productVariation.findMany.mockResolvedValue([{ wooId: 12 }]);
        await reconcileWooVariations(tx, 'a', 'p', 10, [11]);
        expect(tx.productVariation.updateMany.mock.calls.map(([q]: any[]) => q.data)).toEqual([{ deliveryActive: false }, { deliveryActive: true }]);
        expect(tx.productVariation.updateMany.mock.calls[0][0].where).toEqual({ productId: 'p', product: { accountId: 'a' }, wooId: { notIn: [11] }, deliveryActive: true });
        expect(m.dirty).toHaveBeenCalledExactlyOnceWith(tx, 'a', [10]);
        for (const [q] of tx.bOMItem.updateMany.mock.calls) expect(q.data).toEqual({ isActive: false, deactivatedReason: 'VARIATION_DELETED_IN_WOO' });
    });
    it('restores membership without reactivating recipes or changing local stock', async () => {
        tx.productVariation.updateMany.mockResolvedValueOnce({ count: 0 }).mockResolvedValueOnce({ count: 1 });
        await reconcileWooVariations(tx, 'a', 'p', 10, [11, 12]);
        expect(m.dirty).toHaveBeenCalledOnce();
        expect(tx.bOMItem.updateMany).not.toHaveBeenCalled();
    });
    it('does not rebuild on repeated identical membership', async () => {
        await reconcileWooVariations(tx, 'a', 'p', 10, [11]);
        expect(m.dirty).not.toHaveBeenCalled();
    });
    it('fences stale snapshots and other accounts before any variation mutation', async () => {
        tx.wooProduct.updateMany.mockResolvedValue({ count: 0 });
        const observed = new Date();
        await reconcileWooVariations(tx, 'a', 'p', 10, [], observed);
        expect(tx.wooProduct.updateMany.mock.calls[0][0].where).toMatchObject({ id: 'p', accountId: 'a', AND: [{ OR: [{ deliveryMembershipObservedAt: null }, { deliveryMembershipObservedAt: { lte: observed } }] }] });
        expect(tx.productVariation.updateMany).not.toHaveBeenCalled();
    });
    it('propagates dirty-target failure to roll back the complete transaction', async () => {
        tx.productVariation.updateMany.mockResolvedValueOnce({ count: 1 });
        m.dirty.mockRejectedValue(new Error('outbox down'));
        await expect(reconcileWooVariations(tx, 'a', 'p', 10, [])).rejects.toThrow('outbox down');
    });
});
