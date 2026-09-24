import { beforeEach, describe, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ find: vi.fn(), update: vi.fn(), variationUpdate: vi.fn(), settingsFind: vi.fn(), upsert: vi.fn(), intent: vi.fn(), lock: vi.fn(), transaction: vi.fn(), inputFind: vi.fn(), control: vi.fn(), eligible: vi.fn(), inboundRows: vi.fn(), dirtyTarget: vi.fn() }));
vi.mock('../../utils/prisma', () => {
    const db = { wooProduct: { findFirst: mocks.find, updateMany: mocks.update, findMany: mocks.eligible }, productVariation: { updateMany: mocks.variationUpdate },
        deliveryEstimateSettings: { findUnique: mocks.settingsFind, upsert: mocks.upsert },
        $queryRaw: mocks.lock, deliveryInputSync: { upsert: mocks.intent, findUnique: mocks.inputFind, findMany: mocks.inboundRows },
        deliveryInboundDirtyTarget: { upsert: mocks.dirtyTarget },
        deliverySyncAccount: { upsert: mocks.control },
        receiptAccount: { updateMany: vi.fn().mockResolvedValue({ count: 0 }) },
        account: { findUniqueOrThrow: async () => ({ timezone: 'UTC' }) }, accountFeature: { findUnique: async () => null } };
    return { prisma: { ...db, $transaction: (callback: (tx: unknown) => unknown) => mocks.transaction(callback, db) } };
});
import { DeliveryEstimateService, resolveProductionRange } from './service';
import { defaultSettings } from './validation';

describe('local delivery persistence and tenant isolation', () => {
    beforeEach(() => {
        vi.resetAllMocks();
        mocks.transaction.mockImplementation((callback, db) => callback(db));
        mocks.control.mockResolvedValue({ capabilityStatus: 'unknown', resyncGeneration: 0, lastError: null });
        mocks.inputFind.mockResolvedValue({ id: 'settings' });
        mocks.eligible.mockResolvedValue([]); mocks.inboundRows.mockResolvedValue([]);
    });
    const range = { productionMinDays: 2, productionMaxDays: 4 };
    it('keeps unknown products unresolved and distinguishes inheritance from zero overrides', () => {
        const unset = { productionMinDays: null, productionMaxDays: null };
        expect(resolveProductionRange(unset).source).toBe('unset');
        expect(resolveProductionRange(unset, range)).toMatchObject({ source: 'parent', effectiveProductionMinDays: 2 });
        expect(resolveProductionRange({ productionMinDays: 0, productionMaxDays: 0 }, range)).toMatchObject({ source: 'override', effectiveProductionMaxDays: 0 });
    });
    it('cannot read or mutate a product outside the account', async () => {
        mocks.find.mockResolvedValue(null);
        await expect(DeliveryEstimateService.saveProduct('a', 'foreign', range)).rejects.toThrow('Product not found');
        expect(mocks.find).toHaveBeenCalledWith(expect.objectContaining({ where: { id: 'foreign', accountId: 'a' } }));
        expect(mocks.update).not.toHaveBeenCalled();
    });
    it('rejects foreign or wrong-parent variation IDs before any writes', async () => {
        mocks.find.mockResolvedValue({ id: 'p', wooId: 1, ...range, variations: [{ id: 'v', wooId: 2, ...range }] });
        await expect(DeliveryEstimateService.saveProduct('a', 'p', { ...range, variations: [{ id: 'foreign', ...range }] })).rejects.toThrow('Variation not found');
        expect(mocks.update).not.toHaveBeenCalled();
        expect(mocks.variationUpdate).not.toHaveBeenCalled();
    });
    it('fails the save transaction when durable intent persistence fails', async () => {
        mocks.intent.mockRejectedValue(new Error('database write failed'));
        await expect(DeliveryEstimateService.saveSettings('a', defaultSettings())).rejects.toThrow('database write failed');
        expect(mocks.lock).toHaveBeenCalled();
    });
    it('commits local settings and intent together and rolls both back on an intent failure', async () => {
        let committed: { settings?: unknown; intent?: unknown } = {};
        let rejectIntent = false;
        mocks.transaction.mockImplementation(async (callback, db) => {
            const staged = { ...committed };
            const tx = { ...db,
                deliveryEstimateSettings: {
                    upsert: async ({ create }: { create: { settings: unknown } }) => { staged.settings = create.settings; },
                    findUnique: async () => staged.settings ? { settings: staged.settings } : null,
                },
                deliveryInputSync: { upsert: async ({ create }: { create: unknown }) => {
                    if (rejectIntent) throw new Error('outbox unavailable');
                    staged.intent = create;
                } },
            };
            const result = await callback(tx);
            committed = staged;
            return result;
        });
        const settings = defaultSettings();
        await DeliveryEstimateService.saveSettings('a', settings);
        expect(committed).toMatchObject({ settings, intent: { accountId: 'a', scope: 'settings', payload: { enabled: true, settings } } });
        const previous = committed;
        rejectIntent = true;
        await expect(DeliveryEstimateService.saveSettings('a', { ...settings, cutoffTime: '16:00' })).rejects.toThrow('outbox unavailable');
        expect(committed).toBe(previous);
        expect(mocks.upsert).not.toHaveBeenCalled(); // all writes used the transaction client
    });
    it('snapshots Woo identities and explicit null clearing without effective inherited values', async () => {
        const clear = { productionMinDays: null, productionMaxDays: null };
        mocks.find.mockResolvedValue({ id: 'internal', wooId: 42, ...clear, variations: [{ id: 'internal-v', wooId: 43, ...clear }] });
        mocks.update.mockResolvedValue({ count: 1 });
        mocks.inboundRows.mockResolvedValue([{ entityId: 42 }]);
        await DeliveryEstimateService.saveProduct('a', 'internal', clear);
        expect(mocks.intent).toHaveBeenCalledWith(expect.objectContaining({ create: expect.objectContaining({
            accountId: 'a', entityId: 42, payload: { wooId: 42, ...clear, variations: [{ wooId: 43, ...clear }] },
        }) }));
        expect(mocks.dirtyTarget).toHaveBeenCalledWith(expect.objectContaining({ create: { accountId: 'a', wooId: 42 } }));
    });
    it('product-first save seeds settings exactly when absent, within the save transaction', async () => {
        mocks.inputFind.mockResolvedValue(null);
        mocks.find.mockResolvedValue({ id: 'p', wooId: 42, ...range, variations: [] });
        mocks.update.mockResolvedValue({ count: 1 });
        mocks.eligible.mockResolvedValue([{ wooId: 42 }]);
        await DeliveryEstimateService.saveProduct('a', 'p', range);
        expect(mocks.intent.mock.calls.map(([query]) => query.create.scope)).toEqual(['settings', 'product']);
        expect(mocks.dirtyTarget.mock.calls.map(([query]) => query.create.wooId)).toEqual([42]);
        expect(mocks.control.mock.calls.every(([query]) => query.update.inboundFullRequested === undefined)).toBe(true);
        expect(mocks.intent.mock.calls[0][0].create.payload).toEqual({ enabled: true, settings: defaultSettings() });
        mocks.inputFind.mockResolvedValue({ id: 'settings' });
        mocks.intent.mockClear();
        await DeliveryEstimateService.saveProduct('a', 'p', range);
        expect(mocks.intent.mock.calls.map(([query]) => query.create.scope)).toEqual(['product']);
    });
    it('saves new desired data without waking an unsupported account', async () => {
        mocks.control.mockResolvedValue({ capabilityStatus: 'plugin_update_required', resyncGeneration: 2, lastError: 'Update plugin.' });
        await DeliveryEstimateService.saveSettings('a', defaultSettings());
        expect(mocks.intent.mock.calls[0][0].update).toMatchObject({ status: 'plugin_update_required', desiredRevision: { increment: 1 }, resyncGeneration: 2 });
        expect(mocks.control.mock.calls[0][0].update).not.toHaveProperty('capabilityStatus');
    });
    it('scopes both writes and preserves untouched variation inputs', async () => {
        mocks.find.mockResolvedValue({ id: 'p', wooId: 1, ...range, variations: [{ id: 'v', wooId: 2, ...range }] });
        mocks.update.mockResolvedValue({ count: 1 });
        mocks.variationUpdate.mockResolvedValue({ count: 1 });
        await DeliveryEstimateService.saveProduct('a', 'p', { ...range, variations: [{ id: 'v', ...range }] });
        expect(mocks.update).toHaveBeenCalledWith({ where: { id: 'p', accountId: 'a' }, data: range });
        expect(mocks.variationUpdate).toHaveBeenCalledWith({ where: { id: 'v', productId: 'p', product: { accountId: 'a' } }, data: range });
        mocks.variationUpdate.mockClear();
        await DeliveryEstimateService.saveProduct('a', 'p', range);
        expect(mocks.variationUpdate).not.toHaveBeenCalled();
    });
    it('stores and reads settings by account only', async () => {
        const settings = defaultSettings();
        await DeliveryEstimateService.saveSettings('a', settings);
        expect(mocks.upsert).toHaveBeenCalledWith({ where: { accountId: 'a' }, create: { accountId: 'a', settings }, update: { settings } });
        mocks.settingsFind.mockResolvedValue({ settings });
        expect(await DeliveryEstimateService.getSettings('a')).toEqual(settings);
        expect(mocks.settingsFind).toHaveBeenCalledWith({ where: { accountId: 'a' } });
    });
});
