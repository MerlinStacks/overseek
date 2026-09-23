import { beforeEach, describe, expect, it, vi } from 'vitest';
const m = vi.hoisted(() => ({ db: {} as any, control: {} as any, item: {} as any, cascade: vi.fn(), unsettled: 0 }));
vi.mock('../../utils/prisma', () => ({ prisma: m.db }));
vi.mock('../deliveryEstimates/intents', () => ({ lockDeliveryAccount: vi.fn() }));
vi.mock('../BOMConsumptionService', () => ({ BOMConsumptionService: { cascadeSyncAffectedProducts: m.cascade } }));
import { dispatchWriteOffCascade } from '../stockWriteOffCascade';

function matches(where: any) {
    if (where.cascadeLeaseToken && m.control.cascadeLeaseToken !== where.cascadeLeaseToken) return false;
    if (where.receivingFrozen === false && m.control.receivingFrozen) return false;
    if (where.cascadeLeaseExpiresAt?.gt && !(m.control.cascadeLeaseExpiresAt > where.cascadeLeaseExpiresAt.gt)) return false;
    if (where.OR && m.control.cascadeLeaseExpiresAt && m.control.cascadeLeaseExpiresAt > new Date()) return false;
    return true;
}
beforeEach(() => {
    vi.clearAllMocks(); m.unsettled = 0;
    m.control = { accountId: 'a', receivingFrozen: false, cascadeLeaseToken: null, cascadeLeaseExpiresAt: null };
    m.item = { id: 'line', internalProductId: 'internal', cascadeState: 'pending', cascadeAttempts: 0, cascadeNextAttemptAt: new Date(0), cascadeError: null };
    Object.assign(m.db, {
        $transaction: async (fn: any) => fn(m.db),
        receiptAccount: {
            findUnique: async () => ({ ...m.control }),
            findFirst: async ({ where }: any) => matches(where) ? { ...m.control } : null,
            updateMany: async ({ where, data }: any) => { if (!matches(where)) return { count: 0 }; Object.assign(m.control, data); return { count: 1 }; },
        },
        stockWriteOffItem: {
            findFirst: vi.fn(async () => m.item.cascadeState === 'pending' && m.item.cascadeNextAttemptAt <= new Date() ? { ...m.item } : null),
            update: vi.fn(async ({ data }: any) => { const attempts = m.item.cascadeAttempts; Object.assign(m.item, data); if (data.cascadeAttempts) m.item.cascadeAttempts = attempts + data.cascadeAttempts.increment; return m.item; }),
        },
        bOM: { findFirst: async () => ({ product: { wooId: 20, rawData: { type: 'simple' } } }) },
        receiptOperation: { count: async () => m.unsettled },
    });
    m.cascade.mockImplementation(async (_account, _component, _variation, _type, _visited, options) => options.beforeWrite('derived', 0));
});

describe('durable internal write-off cascade', () => {
    it('recalculates derived inventory once and marks completion without replaying deductions', async () => {
        await dispatchWriteOffCascade('a');
        expect(m.item).toMatchObject({ cascadeState: 'done', cascadeAttempts: 1, cascadeError: null });
        expect(m.cascade).toHaveBeenCalledWith('a', 'internal', undefined, 'internalProduct', expect.any(Set), expect.objectContaining({ strict: true }));
        await dispatchWriteOffCascade('a'); expect(m.cascade).toHaveBeenCalledTimes(1);
        expect(m.control.cascadeLeaseToken).toBeNull();
    });
    it('persists errors/backoff and recovers after failure and a crashed lease', async () => {
        m.cascade.mockRejectedValueOnce(new Error('Woo unavailable'));
        await dispatchWriteOffCascade('a');
        expect(m.item).toMatchObject({ cascadeState: 'pending', cascadeAttempts: 1, cascadeError: 'Woo unavailable' });
        expect(m.item.cascadeNextAttemptAt.getTime()).toBeGreaterThan(Date.now());
        await dispatchWriteOffCascade('a'); expect(m.cascade).toHaveBeenCalledTimes(1);
        m.item.cascadeNextAttemptAt = new Date(0); m.control.cascadeLeaseToken = 'crashed'; m.control.cascadeLeaseExpiresAt = new Date(0);
        await dispatchWriteOffCascade('a');
        expect(m.item).toMatchObject({ cascadeState: 'done', cascadeAttempts: 2, cascadeError: null });
    });
    it('defers while frozen or another receipt cascade holds the account lease', async () => {
        m.control.receivingFrozen = true; await dispatchWriteOffCascade('a');
        m.control.receivingFrozen = false; m.control.cascadeLeaseToken = 'other'; m.control.cascadeLeaseExpiresAt = new Date(Date.now() + 120_000);
        await dispatchWriteOffCascade('a'); expect(m.cascade).not.toHaveBeenCalled();
        expect(m.item.cascadeAttempts).toBe(0);
    });
    it('rejects stale completion and preserves the replacement worker lease', async () => {
        m.cascade.mockImplementationOnce(async () => { m.control.cascadeLeaseToken = 'replacement'; });
        await dispatchWriteOffCascade('a');
        expect(m.item.cascadeState).toBe('pending'); expect(m.control.cascadeLeaseToken).toBe('replacement');
    });
    it('does not overwrite a derived target with unsettled native stock work', async () => {
        m.unsettled = 1; await dispatchWriteOffCascade('a');
        expect(m.item.cascadeState).toBe('pending'); expect(m.item.cascadeError).toContain('outstanding native stock');
    });
    it('a freeze starting during calculation prevents writes and retains durable retry', async () => {
        m.cascade.mockImplementationOnce(async (_a, _c, _v, _t, _visited, options) => {
            m.control.receivingFrozen = true;
            await options.beforeWrite('derived', 0);
            throw new Error('must never reach a write');
        });
        await dispatchWriteOffCascade('a');
        expect(m.item.cascadeState).toBe('pending'); expect(m.item.cascadeError).toContain('frozen');
        expect(m.control.cascadeLeaseToken).toBeNull();
    });
    it('does not mark a cascade completed if receiving freezes before completion', async () => {
        m.cascade.mockImplementationOnce(async () => { m.control.receivingFrozen = true; });
        await dispatchWriteOffCascade('a');
        expect(m.item.cascadeState).toBe('pending');
    });
});
