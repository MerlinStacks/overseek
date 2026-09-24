import { beforeEach, describe, expect, it, vi } from 'vitest';
const m = vi.hoisted(() => ({ upsert: vi.fn(), variation: vi.fn(), find: vi.fn(), transaction: vi.fn(), lock: vi.fn(), reconcile: vi.fn(), deactivate: vi.fn() }));
vi.mock('../../utils/prisma', () => ({ prisma: { wooProduct: { upsert: m.upsert }, $transaction: m.transaction } }));
vi.mock('../deliveryEstimates/intents', () => ({ lockDeliveryAccount: m.lock }));
vi.mock('../reconcileWooVariations', () => ({ reconcileWooVariations: m.reconcile, deactivateWooVariationRecipes: m.deactivate }));
import { persistWooProduct } from '../persistWooProduct';
const args = {
    where: { accountId_wooId: { accountId: 'a', wooId: 10 } },
    create: { accountId: 'a', wooId: 10, name: 'Simple', rawData: {} }, update: { rawData: {} },
};
describe('simple conversion persistence', () => {
    beforeEach(() => {
        vi.resetAllMocks();
        m.upsert.mockResolvedValue({ id: 'p', wooId: 10 });
        m.transaction.mockImplementation(work => work({ wooProduct: { upsert: m.upsert, findUnique: m.find }, productVariation: { upsert: m.variation } }));
    });
    it('locks account before atomically saving and reconciling an explicit simple snapshot', async () => {
        await persistWooProduct('simple', args);
        expect(m.lock).toHaveBeenCalledWith(expect.anything(), 'a');
        expect(m.lock.mock.invocationCallOrder[0]).toBeLessThan(m.upsert.mock.invocationCallOrder[0]);
        expect(m.reconcile).toHaveBeenCalledWith(expect.anything(), 'a', 'p', 10, [], expect.any(Date));
    });
    it.each(['variable', 'custom', undefined])('does not infer removed variations from %s', async type => {
        await persistWooProduct(type, args);
        expect(m.reconcile).not.toHaveBeenCalled();
    });
    it('retains simple trash variations', async () => {
        await persistWooProduct('simple', { ...args, update: { status: 'trash' } });
        expect(m.reconcile).not.toHaveBeenCalled();
    });
    it('propagates cleanup failure to roll back the parent transaction', async () => {
        m.reconcile.mockRejectedValue(new Error('cleanup failed'));
        await expect(persistWooProduct('simple', args)).rejects.toThrow('cleanup failed');
    });
    it('does not apply an older simple conversion over newer confirmed membership', async () => {
        const current = { id: 'p', wooId: 10, deliveryMembershipObservedAt: new Date('2026-09-24T13:00:00Z') };
        m.find.mockResolvedValue(current);
        expect(await persistWooProduct('simple', args, new Date('2026-09-24T12:00:00Z'))).toEqual({ accepted: false, reason: 'stale' });
        expect(m.upsert).not.toHaveBeenCalled();
        expect(m.reconcile).not.toHaveBeenCalled();
        expect(m.deactivate).not.toHaveBeenCalled();
    });
    it('commits parent source, variation source, membership and fence in one transaction', async () => {
        const observed = new Date();
        expect(await persistWooProduct('variable', args, observed, [{ id: 11, image: null, stock_quantity: 17 }]))
            .toMatchObject({ accepted: true, product: { id: 'p' }, variationsSynced: 1 });
        expect(m.transaction).toHaveBeenCalledOnce();
        expect(m.upsert).toHaveBeenCalledWith(expect.objectContaining({
            update: expect.objectContaining({ deliveryMembershipObservedAt: observed }),
            create: expect.objectContaining({ deliveryMembershipObservedAt: observed }),
        }));
        expect(m.upsert.mock.invocationCallOrder[0]).toBeLessThan(m.variation.mock.invocationCallOrder[0]);
        expect(m.variation.mock.invocationCallOrder[0]).toBeLessThan(m.reconcile.mock.invocationCallOrder[0]);
        expect(m.reconcile).toHaveBeenCalledWith(expect.anything(), 'a', 'p', 10, [11], observed);
    });
    it('rejects stale variable observations before any parent or variation write', async () => {
        const observed = new Date();
        m.find.mockResolvedValue({ deliveryMembershipObservedAt: new Date(observed.getTime() + 1) });
        expect(await persistWooProduct('variable', args, observed, [{ id: 11, stock_quantity: 999 }, { id: 99 }]))
            .toEqual({ accepted: false, reason: 'stale' });
        expect(m.upsert).not.toHaveBeenCalled();
        expect(m.variation).not.toHaveBeenCalled();
        expect(m.reconcile).not.toHaveBeenCalled();
    });
    it('rejects the whole quarantined parent outside the transaction', async () => {
        expect(await persistWooProduct('variable', args, new Date(), [{ id: 11 }, { id: 12, image: 'invalid' }]))
            .toMatchObject({ accepted: false, reason: 'quarantined_variations' });
        expect(m.transaction).not.toHaveBeenCalled();
        expect(m.upsert).not.toHaveBeenCalled();
        expect(m.variation).not.toHaveBeenCalled();
    });
});
