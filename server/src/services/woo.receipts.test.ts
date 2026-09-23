import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ configs: [] as any[], post: vi.fn(), get: vi.fn() }));
vi.mock('@woocommerce/woocommerce-rest-api', () => ({ default: class {
    constructor(config: any) { mocks.configs.push(config); }
    post = mocks.post;
    get = mocks.get;
} }));
vi.mock('../utils/redis', () => ({ redisClient: {} }));
vi.mock('../utils/prisma', () => ({ prisma: {} }));
vi.mock('../utils/logger', () => ({ Logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } }));
vi.mock('../utils/runtimeMetrics', () => ({ registerRuntimeMetricsProvider: vi.fn() }));
import { WooService } from './woo';
const operation = { operationId: 'immutable_uuid', sequence: 1, productWooId: 10, variationWooId: null, stockOwnerWooId: 10, delta: 5 };
const makeWoo = (accountId?: string) => new WooService({ url: 'https://store.example.com', consumerKey: 'ck_test', consumerSecret: 'cs_test', accountId });
beforeEach(() => { vi.clearAllMocks(); mocks.configs.length = 0; mocks.post.mockResolvedValue({ data: { ack: true } }); });
afterEach(() => WooService.destroyAgents());
describe('guarded receipt Woo transport', () => {
    it.each([[10, 'products/10'], [11, 'products/10/variations/11']] as const)('fetches uncached physical owner %s through one bounded request', async (owner, path) => {
        mocks.get.mockResolvedValue({ data: { id: owner, stock_quantity: 2 } });
        await expect(makeWoo('a').getGuardedStockOwner(10, owner)).resolves.toEqual({ id: owner, stock_quantity: 2 });
        expect(mocks.get).toHaveBeenCalledExactlyOnceWith(path);
        expect(mocks.configs.at(-1)).toMatchObject({ version: 'wc/v3', axiosConfig: { timeout: 10000, maxRedirects: 0, maxContentLength: 1024 * 1024 } });
    });
    it('requires account identity and leaves failed stock observations to the durable worker', async () => {
        await expect(makeWoo().getGuardedStockOwner(10, 10)).rejects.toThrow('Account context required');
        mocks.get.mockRejectedValueOnce(new Error('observation unavailable'));
        await expect(makeWoo('a').getGuardedStockOwner(10, 10)).rejects.toThrow('observation unavailable');
        expect(mocks.get).toHaveBeenCalledTimes(1);
    });
    it.each(['prepare', 'apply'] as const)('sends exact %s envelope with linked account auth and 16 KiB limit', async phase => {
        const woo = makeWoo('tenant-a'); await expect(woo.postGuardedReceipt(phase, operation)).resolves.toEqual({ ack: true });
        expect(mocks.post).toHaveBeenCalledExactlyOnceWith(`delivery-estimates/receipts/${phase}`, { schemaVersion: 1, operation });
        expect(mocks.configs.at(-1)).toMatchObject({ consumerKey: 'ck_test', consumerSecret: 'cs_test', version: 'overseek/v1', axiosConfig: {
            headers: { 'X-Overseek-Account-Id': 'tenant-a' }, timeout: 10000, maxRedirects: 0, maxBodyLength: 16 * 1024,
        } });
    });
    it('does not retry internally when a response is lost', async () => {
        mocks.post.mockRejectedValue(new Error('lost response'));
        await expect(makeWoo('a').postGuardedReceipt('apply', operation)).rejects.toThrow('lost response'); expect(mocks.post).toHaveBeenCalledTimes(1);
    });
    it('requires account identity and rejects unsafe sequences/extra payload fields', async () => {
        await expect(makeWoo().postGuardedReceipt('prepare', operation)).rejects.toThrow('Account context required');
        const woo = makeWoo('a');
        for (const bad of [{ ...operation, sequence: Number.MAX_SAFE_INTEGER + 1 }, { ...operation, delta: 0 }, { ...operation, stockOwnerWooId: 11 }, { ...operation, supplier: 'private' }]) {
            await expect(woo.postGuardedReceipt('prepare', bad)).rejects.toThrow();
        }
        expect(mocks.post).not.toHaveBeenCalled();
    });
});
