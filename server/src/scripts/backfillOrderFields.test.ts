import { beforeEach, describe, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ findMany: vi.fn(), updateMany: vi.fn() }));
vi.mock('../utils/prisma', () => ({ prisma: { wooOrder: mocks } }));
vi.mock('../utils/logger', () => ({ Logger: { info: vi.fn(), warn: vi.fn() } }));
import { backfillOrderDenormalizedFields } from './backfillOrderFields';
const order = (extra: Record<string, unknown> = {}) => ({ id: 'a', billingEmail: null, billingCountry: null, wooCustomerId: null, rawData: { billing: { email: ' User@Example.com ', country: ' au ' }, customer_id: '42' }, ...extra });
beforeEach(() => { vi.resetAllMocks(); mocks.findMany.mockResolvedValue([]); mocks.updateMany.mockResolvedValue({ count: 1 }); });
describe('order denormalization backfill', () => {
    it('normalizes missing fields with conditional writes and cursor pagination', async () => {
        mocks.findMany.mockResolvedValueOnce([order()]);
        expect(await backfillOrderDenormalizedFields()).toEqual({ updated: 1, errors: 0 });
        expect(mocks.updateMany).toHaveBeenCalledWith({ where: { id: 'a', billingEmail: null, billingCountry: null, wooCustomerId: null }, data: { billingEmail: 'user@example.com', billingCountry: 'AU', wooCustomerId: 42 } });
        expect(mocks.findMany.mock.calls[1][0].where.id).toEqual({ gt: 'a' });
    });
    it('does not overwrite populated fields or manufacture customer IDs for guests', async () => {
        mocks.findMany.mockResolvedValueOnce([order({ billingEmail: 'kept@example.com', billingCountry: 'NZ', rawData: { customer_id: 0 } })]);
        expect(await backfillOrderDenormalizedFields()).toEqual({ updated: 0, errors: 0 }); expect(mocks.updateMany).not.toHaveBeenCalled();
    });
    it('fills missing billing data even when a customer ID is already populated', async () => {
        mocks.findMany.mockResolvedValueOnce([order({ wooCustomerId: 99 })]);
        await backfillOrderDenormalizedFields();
        expect(mocks.updateMany.mock.calls[0][0].data).toEqual({ billingEmail: 'user@example.com', billingCountry: 'AU' });
        expect(mocks.findMany.mock.calls[0][0].where.OR).toContainEqual({ billingEmail: null });
    });
    it.each([null, [], { billing: { email: 42, country: {} }, customer_id: -1 }, { billing: { email: 'bad', country: 'AUS' }, customer_id: 1.5 }, { customer_id: 2147483648 }])('skips malformed raw fields without destructive null writes: %j', async rawData => {
        mocks.findMany.mockResolvedValueOnce([order({ rawData })]);
        expect(await backfillOrderDenormalizedFields()).toEqual({ updated: 0, errors: 0 }); expect(mocks.updateMany).not.toHaveBeenCalled();
    });
    it('does not count or retry a conditional write lost to concurrent synchronization', async () => {
        mocks.findMany.mockResolvedValueOnce([order()]); mocks.updateMany.mockResolvedValue({ count: 0 });
        expect(await backfillOrderDenormalizedFields()).toEqual({ updated: 0, errors: 0 });
    });
    it('continues after an individual write failure', async () => {
        mocks.findMany.mockResolvedValueOnce([order(), order({ id: 'b' })]); mocks.updateMany.mockRejectedValueOnce(new Error('Unavailable'));
        expect(await backfillOrderDenormalizedFields()).toEqual({ updated: 1, errors: 1 });
    });
});
