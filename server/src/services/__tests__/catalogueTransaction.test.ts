import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
const m = vi.hoisted(() => ({ transaction: vi.fn(), lock: vi.fn() }));
vi.mock('../../utils/prisma', () => ({ prisma: { $transaction: m.transaction } }));
vi.mock('../deliveryEstimates/intents', () => ({ lockDeliveryAccount: m.lock }));
vi.mock('../../utils/logger', () => ({ Logger: { warn: vi.fn(), error: vi.fn() } }));
import { catalogueTransaction } from '../catalogueTransaction';
describe('bounded complete serializable retries', () => {
    beforeEach(() => { vi.resetAllMocks(); vi.useFakeTimers(); });
    afterEach(() => vi.useRealTimers());
    it('reacquires the account lock and rereads all sources after commit-time P2034', async () => {
        const work = vi.fn(async (tx: any) => tx.version);
        m.transaction.mockImplementationOnce(async work => { await work({ version: 1 }); throw { code: 'P2034' }; })
            .mockImplementationOnce(work => work({ version: 2 }));
        const result = catalogueTransaction('a', work);
        await vi.runAllTimersAsync();
        expect(await result).toBe(2);
        expect(work).toHaveBeenCalledTimes(2);
        expect(m.lock).toHaveBeenCalledTimes(2);
        expect(m.transaction.mock.calls.every(([, options]) => options.isolationLevel === 'Serializable')).toBe(true);
    });
    it.each(['P2034', 'P2003'])('caps retries and never retries non-conflict error %s', async code => {
        m.transaction.mockRejectedValue({ code });
        const result = catalogueTransaction('a', vi.fn()).catch(error => error);
        await vi.runAllTimersAsync();
        expect(await result).toEqual({ code });
        expect(m.transaction).toHaveBeenCalledTimes(code === 'P2034' ? 4 : 1);
    });
    it('retries the native pg-adapter raw-lock serialization error only by its exact SQLSTATE', async () => {
        m.transaction.mockRejectedValueOnce({ code: 'P2010', meta: { driverAdapterError: { cause: { originalCode: '40001' } } } })
            .mockResolvedValueOnce('fresh snapshot');
        const result = catalogueTransaction('a', vi.fn());
        await vi.runAllTimersAsync();
        expect(await result).toBe('fresh snapshot');
        expect(m.transaction).toHaveBeenCalledTimes(2);
    });
});
