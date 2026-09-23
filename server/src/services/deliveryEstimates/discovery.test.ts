import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ account: vi.fn(), get: vi.fn(), post: vi.fn(), options: vi.fn() }));
vi.mock('../../utils/prisma', () => ({ prisma: { account: { findUnique: mocks.account } } }));
vi.mock('@woocommerce/woocommerce-rest-api', () => ({ default: class {
    constructor(options: unknown) { mocks.options(options); }
    get = mocks.get;
    post = mocks.post;
} }));
import { discoverShippingMethods } from './discovery';
import { WooService } from '../woo';

const capabilities = { shippingMethods: true, calculationEngine: true, configurationSync: false, storefront: false };
const caps = { schemaVersion: 1, pluginVersion: '1.0.0', capabilities };
const method = { methodId: 'flat_rate', instanceId: 1, zoneId: 0, zoneName: 'Everywhere', title: 'Flat rate',
    enabled: true, provider: 'woocommerce', rateIdentityScope: 'method_instance', requiresRateVerification: false };
const discovery = { schemaVersion: 1, timezone: 'UTC', methods: [method], warnings: [] };

describe('delivery discovery transport and response validation', () => {
    beforeEach(() => {
        vi.resetAllMocks();
        mocks.account.mockImplementation(async ({ where }: { where: { id: string } }) => ({
            id: where.id, wooUrl: `https://${where.id}.example.com`, wooConsumerKey: `key-${where.id}`, wooConsumerSecret: `secret-${where.id}`,
        }));
        mocks.get.mockResolvedValueOnce({ data: caps }).mockResolvedValueOnce({ data: discovery });
    });
    it('posts exact sync envelopes with account auth and a transport deadline below the lease', async () => {
        const input = { schemaVersion: 1 as const, scope: 'product', entityId: 12, revision: 4, payload: { wooId: 12, productionMinDays: null, productionMaxDays: null, variations: [] } };
        mocks.post.mockResolvedValue({ data: { applied: false } });
        const woo = await WooService.forAccount('a');
        expect(await woo.postDeliveryInputs(input)).toEqual({ applied: false });
        expect(mocks.post).toHaveBeenCalledExactlyOnceWith('delivery-estimates/inputs', input);
        expect(mocks.options).toHaveBeenLastCalledWith(expect.objectContaining({
            consumerKey: 'key-a', consumerSecret: 'secret-a', version: 'overseek/v1',
            axiosConfig: expect.objectContaining({ headers: { 'X-Overseek-Account-Id': 'a' }, timeout: 10000, signal: expect.any(AbortSignal), maxRedirects: 0 }),
        }));
    });
    it('uses tenant credentials and context for sequential authenticated bounded GETs', async () => {
        const result = await discoverShippingMethods('tenant-a');
        expect(mocks.account).toHaveBeenCalledExactlyOnceWith({ where: { id: 'tenant-a' } });
        expect(mocks.get.mock.calls).toEqual([['delivery-estimates/capabilities'], ['delivery-estimates/shipping-methods']]);
        const requests = mocks.options.mock.calls.map(([options]) => options).filter(options => options.version === 'overseek/v1');
        expect(requests).toHaveLength(2);
        for (const options of requests) expect(options).toMatchObject({
            url: 'https://tenant-a.example.com', consumerKey: 'key-tenant-a', consumerSecret: 'secret-tenant-a', queryStringAuth: false,
            axiosConfig: { headers: { 'X-Overseek-Account-Id': 'tenant-a' }, timeout: 10000, maxRedirects: 0,
                maxContentLength: 1048576, signal: expect.any(AbortSignal) },
        });
        expect(result).toMatchObject({ status: 'available', timezone: 'UTC', methods: [method], capabilities });
        expect(result.warnings[0]).toContain('does not mean configuration sync is ready');
        mocks.get.mockResolvedValueOnce({ data: caps }).mockResolvedValueOnce({ data: discovery });
        await discoverShippingMethods('tenant-b');
        expect(mocks.options).toHaveBeenLastCalledWith(expect.objectContaining({ consumerKey: 'key-tenant-b', consumerSecret: 'secret-tenant-b',
            axiosConfig: expect.objectContaining({ headers: { 'X-Overseek-Account-Id': 'tenant-b' } }) }));
    });
    it.each(['capabilities', 'shipping-methods'])('maps old plugin 404 at %s without retry', async resource => {
        mocks.get.mockReset();
        if (resource === 'shipping-methods') mocks.get.mockResolvedValueOnce({ data: caps });
        mocks.get.mockRejectedValueOnce({ response: { status: 404, data: 'secret' } });
        expect(await discoverShippingMethods('a')).toMatchObject({ status: 'plugin_update_required', methods: [] });
        expect(mocks.get).toHaveBeenCalledTimes(resource === 'capabilities' ? 1 : 2);
    });
    it.each([
        [{ ...caps, schemaVersion: 2 }], [{ ...caps, capabilities: { ...capabilities, shippingMethods: 'true' } }],
        [{ ...caps, pluginVersion: 'x'.repeat(65) }], [null],
    ])('rejects invalid capabilities without requesting methods: %j', async data => {
        mocks.get.mockReset().mockResolvedValue({ data });
        await expect(discoverShippingMethods('a')).rejects.toMatchObject({ statusCode: 502, code: 'DELIVERY_DISCOVERY_INVALID_RESPONSE' });
        expect(mocks.get).toHaveBeenCalledTimes(1);
    });
    it('recognizes an explicit unsupported capability', async () => {
        mocks.get.mockReset().mockResolvedValue({ data: { ...caps, capabilities: { ...capabilities, shippingMethods: false } } });
        expect(await discoverShippingMethods('a')).toMatchObject({ status: 'plugin_update_required', methods: [] });
        expect(mocks.get).toHaveBeenCalledTimes(1);
    });
    it.each([
        { rateIdentityScope: undefined }, { rateIdentityScope: 'rate' }, { instanceId: 1.5 }, { instanceId: '1' },
        { zoneId: -1 }, { instanceId: Number.MAX_SAFE_INTEGER + 1 }, { enabled: 'yes' }, { requiresRateVerification: 1 },
        { provider: 'vendor' }, { title: 'x'.repeat(256) }, { methodId: 'bad:id' },
    ])('rejects malformed method fields: %j', async patch => {
        mocks.get.mockReset().mockResolvedValueOnce({ data: caps }).mockResolvedValueOnce({ data: { ...discovery, methods: [{ ...method, ...patch }] } });
        await expect(discoverShippingMethods('a')).rejects.toMatchObject({ statusCode: 502, code: 'DELIVERY_DISCOVERY_INVALID_RESPONSE' });
    });
    it.each([
        { methods: Array(1001).fill(method) }, { warnings: ['x'.repeat(513)] }, { timezone: '' }, { schemaVersion: 2 },
    ])('rejects excessive or invalid discovery payloads: %j', async patch => {
        mocks.get.mockReset().mockResolvedValueOnce({ data: caps }).mockResolvedValueOnce({ data: { ...discovery, ...patch } });
        await expect(discoverShippingMethods('a')).rejects.toMatchObject({ statusCode: 502, code: 'DELIVERY_DISCOVERY_INVALID_RESPONSE' });
    });
    it('allowlists output and generates warnings without forwarding costs or secrets', async () => {
        mocks.get.mockReset().mockResolvedValueOnce({ data: { ...caps, secret: 'hidden', capabilities: { ...capabilities, secret: 'hidden' } } })
            .mockResolvedValueOnce({ data: { ...discovery, secret: 'hidden', warnings: ['hidden'], methods: [
                { ...method, provider: 'weight_based', requiresRateVerification: true, cost: 'hidden', settings: { secret: 'hidden' } },
            ] } });
        const result = await discoverShippingMethods('a');
        expect(JSON.stringify(result)).not.toContain('hidden');
        expect(result.methods[0]).not.toHaveProperty('cost');
        expect(result.warnings).toHaveLength(2);
    });
    it.each([
        [{ response: { status: 401 } }, 502, 'AUTH_FAILED'], [{ response: { status: 403 } }, 502, 'AUTH_FAILED'],
        [{ code: 'ECONNABORTED' }, 503, 'UNAVAILABLE'], [{ code: 'ERR_CANCELED' }, 503, 'UNAVAILABLE'],
        [{ response: { status: 503 } }, 503, 'UNAVAILABLE'], [{ response: { status: 429 } }, 503, 'UNAVAILABLE'],
        [{ response: { status: 400 } }, 502, 'UPSTREAM_ERROR'],
    ])('sanitizes upstream errors without retries: %j', async (error, statusCode, suffix) => {
        for (const stage of [0, 1]) {
            mocks.get.mockReset();
            if (stage) mocks.get.mockResolvedValueOnce({ data: caps });
            mocks.get.mockRejectedValueOnce({ ...error, message: 'secret', config: { consumer_secret: 'secret' } });
            await expect(discoverShippingMethods('a')).rejects.toMatchObject({ statusCode, code: `DELIVERY_DISCOVERY_${suffix}` });
            expect(mocks.get).toHaveBeenCalledTimes(stage + 1);
        }
    });
    it('sanitizes missing account credentials before transport', async () => {
        mocks.account.mockResolvedValue({ id: 'a' });
        await expect(discoverShippingMethods('a')).rejects.toMatchObject({ statusCode: 503, code: 'DELIVERY_DISCOVERY_UNAVAILABLE' });
        expect(mocks.get).not.toHaveBeenCalled();
    });
    it('requires HTTPS rather than putting discovery credentials in a URL', async () => {
        mocks.account.mockResolvedValue({ id: 'a', wooUrl: 'http://a.example.com', wooConsumerKey: 'key', wooConsumerSecret: 'secret' });
        await expect(discoverShippingMethods('a')).rejects.toMatchObject({ code: 'DELIVERY_DISCOVERY_UPSTREAM_ERROR' });
        expect(mocks.get).not.toHaveBeenCalled();
    });
    it('retains actual observed option IDs and rejects overbound or malformed observations', async () => {
        const option = { rateId: 'wbs:opaque/standard?x=1', title: 'Standard', capturedAt: '2026-09-22T10:00:00Z' };
        mocks.get.mockReset().mockResolvedValueOnce({ data: caps }).mockResolvedValueOnce({ data: { ...discovery, methods: [{ ...method, methodId: 'wbs', instanceId: 0, observedRates: [option] }] } });
        expect((await discoverShippingMethods('a')).methods[0].observedRates).toEqual([option]);
        for (const observedRates of [Array(101).fill(option), [{ ...option, rateId: 'valid\n' }], [{ ...option, capturedAt: 'yesterday' }]]) {
            mocks.get.mockReset().mockResolvedValueOnce({ data: caps }).mockResolvedValueOnce({ data: { ...discovery, methods: [{ ...method, observedRates }] } });
            await expect(discoverShippingMethods('a')).rejects.toMatchObject({ code: 'DELIVERY_DISCOVERY_INVALID_RESPONSE' });
        }
    });
});
