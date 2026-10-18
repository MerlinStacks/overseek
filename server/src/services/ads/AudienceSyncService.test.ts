import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AudienceSyncService, audienceEmailHashes } from './AudienceSyncService';
import { audienceIdentifiers } from './audienceIdentifiers';

const mocks = vi.hoisted(() => ({ find: vi.fn(), update: vi.fn(), updateMany: vi.fn(), exports: vi.fn(), segment: vi.fn(), subscribers: vi.fn(), create: vi.fn(), upload: vi.fn(), remove: vi.fn(), google: vi.fn(), add: vi.fn(), warn: vi.fn() }));
vi.mock('../../utils/prisma', () => ({ prisma: { audienceSync: { findFirst: mocks.find, update: mocks.update, updateMany: mocks.updateMany } } }));
vi.mock('../SegmentService', () => ({ segmentService: { getExportableCustomers: mocks.exports, getSegment: mocks.segment } }));
vi.mock('./AdvertisingSubscriberService', () => ({ getAdvertisingSubscribers: mocks.subscribers }));
vi.mock('../queue/QueueFactory', () => ({ QueueFactory: { createQueue: () => ({ add: mocks.add }) } }));
vi.mock('./MetaAdsService', () => ({ MetaAdsService: { createCustomAudience: mocks.create, uploadCustomAudienceMembers: mocks.upload, removeCustomAudienceMembers: mocks.remove } }));
vi.mock('./GoogleAdsClient', () => ({ createGoogleAdsRestConfig: mocks.google }));
vi.mock('../../utils/logger', () => ({ Logger: { warn: mocks.warn } }));

describe('Automatic advertising audience sync', () => {
    const sync = {
        id: 'sync', accountId: 'tenant', segmentId: 'segment', adAccountId: 'ads', platform: 'META', externalId: 'audience',
        audienceName: 'Customers', autoSyncEnabled: true, consentConfirmedAt: new Date(), isLookalike: false,
        syncedEmailHashes: ['expired-hash'], adAccount: { accountId: 'tenant', platform: 'META' }
    };
    beforeEach(() => {
        vi.resetAllMocks();
        mocks.find.mockResolvedValue(sync);
        mocks.exports.mockResolvedValue({ emails: [' Person@Example.com '] });
        mocks.upload.mockResolvedValue({ numInvalidEntries: 0 });
        mocks.update.mockResolvedValue({});
        mocks.updateMany.mockResolvedValue({ count: 1 });
    });
    afterEach(() => vi.unstubAllGlobals());

    it('deduplicates manual and scheduled jobs without including customer identifiers', async () => {
        await AudienceSyncService.enqueue('tenant', 'sync');
        expect(mocks.add).toHaveBeenCalledWith('sync-ad-audience', { accountId: 'tenant', syncId: 'sync' }, expect.objectContaining({ jobId: 'sync-ad-audience-sync' }));
    });

    it('removes expired members, uploads hashes, and records acknowledged membership', async () => {
        await AudienceSyncService.sync('tenant', 'sync');
        expect(mocks.find).toHaveBeenCalledWith(expect.objectContaining({ where: { id: 'sync', accountId: 'tenant' } }));
        expect(mocks.remove).toHaveBeenCalledWith('ads', 'audience', ['expired-hash']);
        const desired = audienceEmailHashes(['person@example.com'], 'META');
        expect(mocks.upload).toHaveBeenCalledWith('ads', 'audience', desired);
        expect(mocks.update).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ syncedEmailHashes: desired, syncedIdentifiers: desired.map(email => ({ email })) }) }));
        expect(mocks.updateMany).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ status: 'SYNCED', memberCount: 1 }) }));
    });

    it('clears stale members even if the rolling segment is now empty', async () => {
        mocks.exports.mockResolvedValue({ emails: [] });
        await AudienceSyncService.sync('tenant', 'sync');
        expect(mocks.remove).toHaveBeenCalledWith('ads', 'audience', ['expired-hash']);
        expect(mocks.upload).not.toHaveBeenCalled();
        expect(mocks.updateMany).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ memberCount: 0 }) }));
    });

    it.each([{ autoSyncEnabled: false }, { consentConfirmedAt: null }])('does not send paused or unconsented audiences', async override => {
        mocks.find.mockResolvedValue({ ...sync, ...override });
        await AudienceSyncService.sync('tenant', 'sync');
        expect(mocks.exports).not.toHaveBeenCalled();
    });

    it('does not advance acknowledged membership on platform failure and preserves retryability', async () => {
        mocks.remove.mockRejectedValue(new Error('private API response'));
        await expect(AudienceSyncService.sync('tenant', 'sync')).rejects.toThrow('Audience sync failed');
        expect(mocks.update).not.toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ syncedEmailHashes: expect.anything() }) }));
        expect(mocks.updateMany).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ status: 'FAILED' }) }));
    });

    it('creates Google lists and limits user-data mutations to ten operations with explicit consent', async () => {
        mocks.find.mockResolvedValue({ ...sync, platform: 'GOOGLE', externalId: null, syncedEmailHashes: [], adAccount: { accountId: 'tenant', platform: 'GOOGLE' } });
        mocks.exports.mockResolvedValue({ emails: Array.from({ length: 23 }, (_, i) => `customer${i}@example.com`) });
        mocks.google.mockResolvedValue({ customerId: '123', accessToken: 'secret', developerToken: 'dev' });
        const fetch = vi.fn().mockResolvedValue({ ok: true, json: async () => ({}) });
        fetch.mockResolvedValueOnce({ ok: true, json: async () => ({ results: [{ resourceName: 'customers/123/userLists/456' }] }) });
        vi.stubGlobal('fetch', fetch);
        await AudienceSyncService.sync('tenant', 'sync');
        expect(fetch).toHaveBeenCalledTimes(4);
        expect(fetch.mock.calls[0][0]).toBe('https://googleads.googleapis.com/v24/customers/123/userLists:mutate');
        for (const [url] of fetch.mock.calls.slice(1)) expect(url).toBe('https://googleads.googleapis.com/v24/customers/123:uploadUserData');
        const uploads = fetch.mock.calls.slice(1).map(call => JSON.parse(call[1].body));
        expect(uploads.map(body => body.operations.length)).toEqual([10, 10, 3]);
        expect(uploads[0].customerMatchUserListMetadata).toEqual({ userList: 'customers/123/userLists/456', consent: { adUserData: 'GRANTED', adPersonalization: 'GRANTED' } });
        expect(uploads[0].operations[0].create.userIdentifiers[0].hashedEmail).toMatch(/^[a-f0-9]{64}$/);
    });

    it('normalizes Google Gmail dots, trims, lowercases and deduplicates', () => {
        expect(audienceEmailHashes([' Person.Name@gmail.com ', 'personname@gmail.com'], 'GOOGLE')).toHaveLength(1);
        expect(audienceEmailHashes(['invalid', ''], 'META')).toEqual([]);
    });

    it('removes every prior matching identifier when enhanced members leave the segment', async () => {
        const previous = audienceIdentifiers([{ email: 'old@example.com', rawData: { phone: '+61412345678' } }], 'META', true);
        mocks.find.mockResolvedValue({ ...sync, syncedIdentifiers: previous, enhancedMatching: true });
        mocks.exports.mockResolvedValue({ emails: [], profiles: [] });
        await AudienceSyncService.sync('tenant', 'sync');
        expect(mocks.remove).toHaveBeenCalledWith('ads', 'audience', [previous[0].email], expect.arrayContaining([expect.arrayContaining([previous[0].phone])]));
        expect(mocks.update).toHaveBeenCalledWith(expect.objectContaining({ data: { syncedIdentifiers: [], syncedEmailHashes: [] } }));
    });

    it('bounds enhanced Google uploads by both operation and identifier limits', async () => {
        mocks.find.mockResolvedValue({ ...sync, platform: 'GOOGLE', syncedEmailHashes: [], enhancedMatching: true, adAccount: { accountId: 'tenant', platform: 'GOOGLE' } });
        mocks.exports.mockResolvedValue({ emails: [], profiles: Array.from({ length: 13 }, (_, i) => ({
            email: `customer${i}@example.com`, firstName: 'Jane', lastName: 'Doe', rawData: { billing: { phone: '+61412345678', country: 'AU', postcode: '2000' } },
        })) });
        mocks.google.mockResolvedValue({ customerId: '123', accessToken: 'secret', developerToken: 'dev' });
        const fetch = vi.fn().mockResolvedValue({ ok: true, json: async () => ({}) });
        vi.stubGlobal('fetch', fetch);
        await AudienceSyncService.sync('tenant', 'sync');
        const uploads = fetch.mock.calls.map(call => JSON.parse(call[1].body));
        expect(uploads.map(body => body.operations.length)).toEqual([6, 6, 1]);
        expect(uploads.every(body => body.operations.flatMap((op: any) => op.create.userIdentifiers).length <= 20)).toBe(true);
        expect(fetch.mock.calls.every(call => call[0] === 'https://googleads.googleapis.com/v24/customers/123:uploadUserData')).toBe(true);
    });

    it('uses the documented customer-level action for removals too, without recreating an existing list', async () => {
        mocks.find.mockResolvedValue({ ...sync, platform: 'GOOGLE', externalId: 'customers/123/userLists/456', adAccount: { accountId: 'tenant', platform: 'GOOGLE' } });
        mocks.exports.mockResolvedValue({ emails: [] });
        mocks.google.mockResolvedValue({ customerId: '123', accessToken: 'secret', developerToken: 'dev', loginCustomerId: '789' });
        const fetch = vi.fn().mockImplementation(async (url, request) => {
            if (url !== 'https://googleads.googleapis.com/v24/customers/123:uploadUserData') return { ok: false, status: 404, json: async () => ({ error: { message: 'Unknown endpoint' } }) };
            expect(JSON.parse(request.body).operations[0].remove).toBeDefined();
            return { ok: true, status: 200, json: async () => ({ receivedOperationsCount: 1 }) };
        });
        vi.stubGlobal('fetch', fetch);
        await AudienceSyncService.sync('tenant', 'sync');
        expect(fetch).toHaveBeenCalledOnce();
        expect(fetch.mock.calls[0][1].headers['login-customer-id']).toBe('789');
        expect(mocks.updateMany).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ status: 'SYNCED', memberCount: 0 }) }));
    });

    it('retains sanitised Google rejection details and symbolic codes without advancing the snapshot', async () => {
        mocks.find.mockResolvedValue({ ...sync, platform: 'GOOGLE', syncedEmailHashes: [], externalId: 'customers/123/userLists/456', adAccount: { accountId: 'tenant', platform: 'GOOGLE' } });
        mocks.google.mockResolvedValue({ customerId: '123', accessToken: 'oauth-secret', developerToken: 'dev-secret' });
        vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 403, json: async () => ({ error: {
            code: 403, message: 'Permission denied; Bearer oauth-secret', details: [{ errors: [{
                message: 'Customer Match is not enabled for this account', errorCode: { authorizationError: 'CUSTOMER_NOT_ENABLED' },
                trigger: { stringValue: 'private-payload' }
            }] }]
        } }) }));
        await expect(AudienceSyncService.sync('tenant', 'sync')).rejects.toThrow('Audience sync failed');
        const detail = mocks.updateMany.mock.calls.at(-1)![0].data.lastError;
        expect(detail).toContain('Google rejected audience sync (HTTP 403; code 403)');
        expect(detail).toContain('authorizationError: CUSTOMER_NOT_ENABLED');
        expect(detail).toContain('uploading audience members');
        expect(detail).not.toContain('oauth-secret');
        expect(detail).not.toContain('private-payload');
        expect(JSON.stringify(mocks.warn.mock.calls)).not.toContain('oauth-secret');
        expect(mocks.update).not.toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ syncedIdentifiers: expect.anything() }) }));
    });

    it('reports Google list-creation rejections separately from membership upload failures', async () => {
        mocks.find.mockResolvedValue({ ...sync, platform: 'GOOGLE', externalId: null, syncedEmailHashes: [], adAccount: { accountId: 'tenant', platform: 'GOOGLE' } });
        mocks.google.mockResolvedValue({ customerId: '123', accessToken: 'secret', developerToken: 'dev' });
        vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 400, json: async () => ({ error: { code: 400, message: 'Invalid user list argument' } }) }));
        await expect(AudienceSyncService.sync('tenant', 'sync')).rejects.toThrow('Audience sync failed');
        expect(mocks.updateMany.mock.calls.at(-1)![0].data.lastError).toContain('Stage: creating the customer list');
    });

    it('does not mark membership as acknowledged if Google reports fewer operations received', async () => {
        mocks.find.mockResolvedValue({ ...sync, platform: 'GOOGLE', syncedEmailHashes: [], adAccount: { accountId: 'tenant', platform: 'GOOGLE' } });
        mocks.google.mockResolvedValue({ customerId: '123', accessToken: 'secret', developerToken: 'dev' });
        vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => ({ receivedOperationsCount: 0 }) }));
        await expect(AudienceSyncService.sync('tenant', 'sync')).rejects.toThrow('Audience sync failed');
        expect(mocks.updateMany.mock.calls.at(-1)![0].data.lastError).toContain('did not acknowledge all audience operations');
        expect(mocks.update).not.toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ syncedIdentifiers: expect.anything() }) }));
    });

    it('keeps HTTP status for non-JSON errors and never retains the response body', async () => {
        mocks.find.mockResolvedValue({ ...sync, platform: 'GOOGLE', syncedEmailHashes: [], adAccount: { accountId: 'tenant', platform: 'GOOGLE' } });
        mocks.google.mockResolvedValue({ customerId: '123', accessToken: 'secret', developerToken: 'dev' });
        vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 404, json: async () => { throw new Error('HTML with private-payload'); } }));
        await expect(AudienceSyncService.sync('tenant', 'sync')).rejects.toThrow('Audience sync failed');
        expect(mocks.updateMany.mock.calls.at(-1)![0].data.lastError).toContain('HTTP 404');
        expect(JSON.stringify(mocks.updateMany.mock.calls)).not.toContain('private-payload');
    });

    it('sends only deltas between daily refreshes and handles JSONB key ordering', async () => {
        const profile = { email: 'person@example.com', rawData: { phone: '+61412345678' } };
        const row = audienceIdentifiers([profile], 'META', true)[0];
        mocks.find.mockResolvedValue({ ...sync, enhancedMatching: true, lastFullRefreshAt: new Date(), syncedIdentifiers: [{ phone: row.phone, email: row.email }] });
        mocks.exports.mockResolvedValue({ emails: [profile.email], profiles: [profile] });
        await AudienceSyncService.sync('tenant', 'sync');
        expect(mocks.upload).not.toHaveBeenCalled();
        expect(mocks.remove).not.toHaveBeenCalled();
    });

    it('includes eligible subscribers only with explicit opt-in and scopes criteria to the tenant', async () => {
        await AudienceSyncService.sync('tenant', 'sync');
        expect(mocks.subscribers).not.toHaveBeenCalled();
        mocks.find.mockResolvedValue({ ...sync, includeSubscribers: true });
        const criteria = { type: 'AND', rules: [{ field: 'emailClickedWithinDays', operator: 'within', value: 30 }] };
        mocks.segment.mockResolvedValue({ criteria });
        mocks.subscribers.mockResolvedValue([{ email: 'subscriber@example.com' }]);
        await AudienceSyncService.sync('tenant', 'sync');
        expect(mocks.segment).toHaveBeenCalledWith('segment', 'tenant');
        expect(mocks.subscribers).toHaveBeenCalledWith('tenant', criteria);
        expect(mocks.upload).toHaveBeenLastCalledWith('ads', 'audience', audienceEmailHashes(['person@example.com', 'subscriber@example.com'], 'META'));
    });
});
