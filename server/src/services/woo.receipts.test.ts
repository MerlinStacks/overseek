import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ configs: [] as any[], post: vi.fn() }));
vi.mock('@woocommerce/woocommerce-rest-api', () => ({ default: class {
    constructor(config: any) { mocks.configs.push(config); }
    post = mocks.post;
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
