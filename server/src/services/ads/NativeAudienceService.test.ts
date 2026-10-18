import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NativeAudienceService } from './NativeAudienceService';

const mocks = vi.hoisted(() => ({
    destination: vi.fn(), find: vi.fn(), findMany: vi.fn(), upsert: vi.fn(), update: vi.fn(), updateMany: vi.fn(),
    source: vi.fn(), sourceLists: vi.fn(), metaRows: vi.fn(), google: vi.fn(), add: vi.fn()
}));
vi.mock('../../utils/prisma', () => ({ prisma: {
    adAccount: { findFirst: mocks.destination },
    nativeAdAudience: { findFirst: mocks.find, findMany: mocks.findMany, upsert: mocks.upsert, update: mocks.update, updateMany: mocks.updateMany },
    audienceSync: { findFirst: mocks.source, findMany: mocks.sourceLists }
} }));
vi.mock('../queue/QueueFactory', () => ({ QueueFactory: { createQueue: () => ({ add: mocks.add }) } }));
vi.mock('./MetaAdsService', () => ({ buildMetaUrl: (path: string) => `https://graph.facebook.com/v24.0/${path}`, fetchAllMetaRows: mocks.metaRows }));
vi.mock('./GoogleAdsClient', () => ({ createGoogleAdsRestConfig: mocks.google }));

describe('Platform-managed audience provisioning', () => {
    const definition = { pixelId: '123', event: 'AddToCart', retentionDays: 14, exclusionDays: 30, excludePurchasers: true };
    const audience = { id: 'native', accountId: 'tenant', adAccountId: 'ads', platform: 'META', kind: 'WEBSITE', name: 'Cart additions', status: 'PENDING', externalId: null, definition };
    let fetch: ReturnType<typeof vi.fn>;
    beforeEach(() => {
        vi.resetAllMocks();
        mocks.destination.mockResolvedValue({ id: 'ads', accountId: 'tenant', platform: 'META', externalId: '456', accessToken: 'secret' });
        mocks.find.mockResolvedValue(audience);
        mocks.findMany.mockResolvedValue([]);
        mocks.sourceLists.mockResolvedValue([]);
        mocks.source.mockResolvedValue({ externalId: 'seed' });
        mocks.metaRows.mockResolvedValue([{ id: '123', name: 'Store pixel' }]);
        mocks.updateMany.mockResolvedValue({ count: 1 });
        mocks.upsert.mockResolvedValue(audience);
        mocks.google.mockResolvedValue({ customerId: '789', loginCustomerId: '111', accessToken: 'google-secret', developerToken: 'dev' });
        fetch = vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => ({ id: 'remote' }) });
        vi.stubGlobal('fetch', fetch);
    });
    afterEach(() => vi.unstubAllGlobals());

    it('verifies destination ownership before returning sources or creating definitions', async () => {
        mocks.destination.mockResolvedValue(null);
        await expect(NativeAudienceService.sources('tenant', 'foreign')).rejects.toThrow('not found');
        expect(mocks.destination).toHaveBeenCalledWith({ where: { id: 'foreign', accountId: 'tenant', platform: { in: ['META', 'GOOGLE'] } } });
        expect(mocks.metaRows).not.toHaveBeenCalled();
    });
    it('validates Meta pixel access rather than accepting arbitrary pixel IDs', async () => {
        await expect(NativeAudienceService.create('tenant', 'ads', 'WEBSITE', 'Wrong pixel', { ...definition, pixelId: '999' })).rejects.toThrow('not accessible');
        expect(mocks.upsert).not.toHaveBeenCalled();
    });
    it('deduplicates creation by normalized definition, independently of user-entered names', async () => {
        await NativeAudienceService.create('tenant', 'ads', 'WEBSITE', 'First name', definition);
        await NativeAudienceService.create('tenant', 'ads', 'WEBSITE', 'Second name', definition);
        expect(mocks.upsert.mock.calls[0][0].where).toEqual(mocks.upsert.mock.calls[1][0].where);
        expect(mocks.add).toHaveBeenCalledWith('create-native-ad-audience', { accountId: 'tenant', id: 'native' }, expect.objectContaining({ jobId: 'native-ad-audience-native' }));
    });
    it('creates Meta website audiences with event inclusions/exclusions, not customer hashes', async () => {
        await NativeAudienceService.provision('tenant', 'native');
        const [url, request] = fetch.mock.calls[0];
        expect(url).toContain('act_456/customaudiences');
        const payload = JSON.parse(request.body);
        expect(payload).toMatchObject({ name: 'Cart additions [OS-native]', subtype: 'WEBSITE', pixel_id: '123', retention_days: 30 });
        expect(payload.rule.exclusions.rules[0].filter.filters[0].value).toBe('Purchase');
        expect(payload).not.toHaveProperty('payload');
        expect(mocks.update).toHaveBeenCalledWith({ where: { id: 'native' }, data: { externalId: 'remote', status: 'CREATED', lastError: null } });
    });
    it('requires a locally managed seed in the same tenant and Meta ad account', async () => {
        const lookalike = { sourceType: 'CUSTOMER_LIST' as const, sourceId: 'local-seed', country: 'AU', percent: 3 as const };
        mocks.source.mockResolvedValue(null);
        await expect(NativeAudienceService.sourceExternalId('tenant', 'ads', lookalike)).rejects.toThrow('successfully uploaded');
        expect(mocks.source).toHaveBeenCalledWith({ where: expect.objectContaining({ id: 'local-seed', accountId: 'tenant', adAccountId: 'ads', platform: 'META', isLookalike: false }) });
    });
    it('creates Meta lookalikes with the resolved seed, ratio and country', async () => {
        mocks.find.mockResolvedValue({ ...audience, kind: 'LOOKALIKE', definition: { sourceType: 'CUSTOMER_LIST', sourceId: 'local-seed', country: 'AU', percent: 3 } });
        await NativeAudienceService.provision('tenant', 'native');
        expect(JSON.parse(fetch.mock.calls[0][1].body)).toMatchObject({ subtype: 'LOOKALIKE', origin_audience_id: 'seed', lookalike_spec: { type: 'similarity', country: 'AU', ratio: 0.03 } });
    });
    it('does not claim Google supports this Meta lookalike workflow', async () => {
        mocks.destination.mockResolvedValue({ id: 'ads', platform: 'GOOGLE' });
        await expect(NativeAudienceService.create('tenant', 'ads', 'LOOKALIKE', 'Wrong platform', { sourceType: 'WEBSITE', sourceId: 'seed', country: 'AU', percent: 1 })).rejects.toThrow('Meta lookalikes only');
        expect(mocks.upsert).not.toHaveBeenCalled();
    });
    it('creates Google flexible website lists using the destination account and credentials', async () => {
        mocks.destination.mockResolvedValue({ id: 'ads', platform: 'GOOGLE' });
        mocks.find.mockResolvedValue({ ...audience, platform: 'GOOGLE', definition: { urlContains: '/checkout/', retentionDays: 14, exclusionDays: 30, excludePurchasers: false, tagConfirmed: true } });
        fetch.mockResolvedValue({ ok: true, status: 200, json: async () => ({ results: [{ resourceName: 'customers/789/userLists/123' }] }) });
        await NativeAudienceService.provision('tenant', 'native');
        expect(fetch.mock.calls[0][0]).toBe('https://googleads.googleapis.com/v24/customers/789/userLists:mutate');
        expect(fetch.mock.calls[0][1].headers['login-customer-id']).toBe('111');
        expect(JSON.parse(fetch.mock.calls[0][1].body).operations[0].create.ruleBasedUserList.flexibleRuleUserList.inclusiveOperands[0].rule.ruleItemGroups[0].ruleItems[0].name).toBe('url__');
    });
    it.each(['CREATING', 'CREATED', 'FAILED', 'NEEDS_REVIEW'])('does not recreate %s audiences on worker retries', async status => {
        mocks.find.mockResolvedValue({ ...audience, status });
        await NativeAudienceService.provision('tenant', 'native');
        expect(fetch).not.toHaveBeenCalled();
    });
    it('only one worker can claim a pending definition', async () => {
        mocks.updateMany.mockResolvedValueOnce({ count: 0 });
        await NativeAudienceService.provision('tenant', 'native');
        expect(fetch).not.toHaveBeenCalled();
    });
    it('treats network ambiguity as needing review, never a blind recreate', async () => {
        fetch.mockRejectedValue(new Error('timeout with secret response'));
        await NativeAudienceService.provision('tenant', 'native');
        expect(mocks.updateMany).toHaveBeenLastCalledWith(expect.objectContaining({ data: expect.objectContaining({ status: 'NEEDS_REVIEW' }) }));
        expect(JSON.stringify(mocks.updateMany.mock.calls)).not.toContain('secret response');
    });
    it('records definitive client rejections as retryable failures without retaining API responses', async () => {
        fetch.mockResolvedValue({ ok: false, status: 400, json: async () => ({ error: { message: 'private response' } }) });
        await NativeAudienceService.provision('tenant', 'native');
        expect(mocks.updateMany).toHaveBeenLastCalledWith(expect.objectContaining({ data: expect.objectContaining({ status: 'FAILED' }) }));
        expect(JSON.stringify(mocks.updateMany.mock.calls)).not.toContain('private response');
    });
    it('links an uncertain result only by its unique platform name, kind and destination', async () => {
        mocks.find.mockResolvedValue({ ...audience, status: 'NEEDS_REVIEW' });
        mocks.metaRows.mockResolvedValue([{ id: 'remote', name: 'Cart additions [OS-native]', subtype: 'WEBSITE' }, { id: 'foreign', name: 'Cart additions', subtype: 'WEBSITE' }]);
        await expect(NativeAudienceService.reconcile('tenant', 'native')).resolves.toMatchObject({ status: 'CREATED' });
        expect(mocks.updateMany).toHaveBeenLastCalledWith({ where: { id: 'native', accountId: 'tenant', status: 'NEEDS_REVIEW' }, data: { externalId: 'remote', status: 'CREATED', lastError: null } });
        expect(fetch).not.toHaveBeenCalled();
    });
    it('does not fabricate a match or create a replacement when reconciliation finds nothing', async () => {
        mocks.find.mockResolvedValue({ ...audience, status: 'NEEDS_REVIEW' });
        mocks.metaRows.mockResolvedValue([]);
        await expect(NativeAudienceService.reconcile('tenant', 'native')).rejects.toThrow('No unique matching');
        expect(mocks.updateMany).not.toHaveBeenCalled();
        expect(fetch).not.toHaveBeenCalled();
    });
});
