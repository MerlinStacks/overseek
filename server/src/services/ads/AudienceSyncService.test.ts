import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AudienceSyncService, audienceEmailHashes } from './AudienceSyncService';

const mocks = vi.hoisted(() => ({ find: vi.fn(), update: vi.fn(), updateMany: vi.fn(), exports: vi.fn(), create: vi.fn(), upload: vi.fn(), remove: vi.fn(), google: vi.fn(), add: vi.fn() }));
vi.mock('../../utils/prisma', () => ({ prisma: { audienceSync: { findFirst: mocks.find, update: mocks.update, updateMany: mocks.updateMany } } }));
vi.mock('../SegmentService', () => ({ segmentService: { getExportableCustomers: mocks.exports } }));
vi.mock('../queue/QueueFactory', () => ({ QueueFactory: { createQueue: () => ({ add: mocks.add }) } }));
vi.mock('./MetaAdsService', () => ({ MetaAdsService: { createCustomAudience: mocks.create, uploadCustomAudienceMembers: mocks.upload, removeCustomAudienceMembers: mocks.remove } }));
vi.mock('./GoogleAdsClient', () => ({ createGoogleAdsRestConfig: mocks.google }));

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
        expect(mocks.update).toHaveBeenCalledWith(expect.objectContaining({ data: { syncedEmailHashes: desired } }));
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
        const uploads = fetch.mock.calls.slice(1).map(call => JSON.parse(call[1].body));
        expect(uploads.map(body => body.operations.length)).toEqual([10, 10, 3]);
        expect(uploads[0].customerMatchUserListMetadata).toEqual({ userList: 'customers/123/userLists/456', consent: { adUserData: 'GRANTED', adPersonalization: 'GRANTED' } });
        expect(uploads[0].operations[0].create.userIdentifiers[0].hashedEmail).toMatch(/^[a-f0-9]{64}$/);
    });

    it('normalizes Google Gmail dots, trims, lowercases and deduplicates', () => {
        expect(audienceEmailHashes([' Person.Name@gmail.com ', 'personname@gmail.com'], 'GOOGLE')).toHaveLength(1);
        expect(audienceEmailHashes(['invalid', ''], 'META')).toEqual([]);
    });
});
