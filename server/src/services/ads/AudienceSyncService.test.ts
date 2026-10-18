import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AudienceSyncService, audienceEmailHashes } from './AudienceSyncService';
import { audienceIdentifiers } from './audienceIdentifiers';

const mocks = vi.hoisted(() => ({ find: vi.fn(), update: vi.fn(), updateMany: vi.fn(), exports: vi.fn(), segment: vi.fn(), subscribers: vi.fn(), create: vi.fn(), upload: vi.fn(), remove: vi.fn(), google: vi.fn(), add: vi.fn(), warn: vi.fn(), dataManager: vi.fn() }));
vi.mock('../../utils/prisma', () => ({ prisma: { audienceSync: { findFirst: mocks.find, update: mocks.update, updateMany: mocks.updateMany } } }));
vi.mock('../SegmentService', () => ({ segmentService: { getExportableCustomers: mocks.exports, getSegment: mocks.segment } }));
vi.mock('./AdvertisingSubscriberService', () => ({ getAdvertisingSubscribers: mocks.subscribers }));
vi.mock('../queue/QueueFactory', () => ({ QueueFactory: { createQueue: () => ({ add: mocks.add }) } }));
vi.mock('./MetaAdsService', () => ({ MetaAdsService: { createCustomAudience: mocks.create, uploadCustomAudienceMembers: mocks.upload, removeCustomAudienceMembers: mocks.remove } }));
vi.mock('./GoogleAdsClient', () => ({ createGoogleAdsRestConfig: mocks.google }));
vi.mock('./GoogleDataManagerAudienceService', () => ({ GoogleDataManagerAudienceService: { sync: mocks.dataManager }, GoogleDataManagerError: class extends Error {} }));
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

    it('routes Google customer lists exclusively through Data Manager, preserving enhanced/subscriber evaluation', async () => {
        mocks.find.mockResolvedValue({ ...sync, platform: 'GOOGLE', externalId: null, syncedEmailHashes: [], adAccount: { accountId: 'tenant', platform: 'GOOGLE' } });
        mocks.exports.mockResolvedValue({ emails: Array.from({ length: 23 }, (_, i) => `customer${i}@example.com`) });
        const fetch = vi.fn();
        vi.stubGlobal('fetch', fetch);
        await AudienceSyncService.sync('tenant', 'sync');
        expect(fetch).not.toHaveBeenCalled();
        expect(mocks.google).not.toHaveBeenCalled();
        expect(mocks.dataManager.mock.calls[0][1]).toHaveLength(23);
        expect(mocks.dataManager.mock.calls[0][1][0].email).toMatch(/^[a-f0-9]{64}$/);
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

    it('passes enhanced Google profiles to Data Manager without raw contact details', async () => {
        mocks.find.mockResolvedValue({ ...sync, platform: 'GOOGLE', syncedEmailHashes: [], enhancedMatching: true, adAccount: { accountId: 'tenant', platform: 'GOOGLE' } });
        mocks.exports.mockResolvedValue({ emails: [], profiles: Array.from({ length: 13 }, (_, i) => ({
            email: `customer${i}@example.com`, firstName: 'Jane', lastName: 'Doe', rawData: { billing: { phone: '+61412345678', country: 'AU', postcode: '2000' } },
        })) });
        const fetch = vi.fn().mockResolvedValue({ ok: true, json: async () => ({}) });
        vi.stubGlobal('fetch', fetch);
        await AudienceSyncService.sync('tenant', 'sync');
        expect(fetch).not.toHaveBeenCalled();
        expect(mocks.dataManager.mock.calls[0][1]).toHaveLength(13);
        expect(mocks.dataManager.mock.calls[0][1][0]).toMatchObject({ email: expect.stringMatching(/^[a-f0-9]{64}$/), phone: expect.stringMatching(/^[a-f0-9]{64}$/), firstName: expect.stringMatching(/^[a-f0-9]{64}$/), country: 'AU', postalCode: '2000' });
    });

    it('passes existing Google list IDs and empty membership to Data Manager for removals', async () => {
        mocks.find.mockResolvedValue({ ...sync, platform: 'GOOGLE', externalId: 'customers/123/userLists/456', adAccount: { accountId: 'tenant', platform: 'GOOGLE' } });
        mocks.exports.mockResolvedValue({ emails: [] });
        const fetch = vi.fn();
        vi.stubGlobal('fetch', fetch);
        await AudienceSyncService.sync('tenant', 'sync');
        expect(fetch).not.toHaveBeenCalled();
        expect(mocks.dataManager).toHaveBeenCalledWith(expect.objectContaining({ externalId: 'customers/123/userLists/456' }), []);
    });

    it('passes through sanitised Data Manager errors without advancing the snapshot', async () => {
        mocks.find.mockResolvedValue({ ...sync, platform: 'GOOGLE', syncedEmailHashes: [], externalId: 'customers/123/userLists/456', adAccount: { accountId: 'tenant', platform: 'GOOGLE' } });
        mocks.dataManager.mockRejectedValue(new (await import('./GoogleDataManagerAudienceService')).GoogleDataManagerError('Data Manager: Google rejected audience sync (HTTP 403; code 403). authorizationError: CUSTOMER_NOT_ENABLED. Stage: uploading audience members.'));
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
        mocks.dataManager.mockRejectedValue(new (await import('./GoogleDataManagerAudienceService')).GoogleDataManagerError('Data Manager: Stage: creating the customer list'));
        await expect(AudienceSyncService.sync('tenant', 'sync')).rejects.toThrow('Audience sync failed');
        expect(mocks.updateMany.mock.calls.at(-1)![0].data.lastError).toContain('Stage: creating the customer list');
    });

    it('does not mark membership as acknowledged if Data Manager cannot confirm the batch', async () => {
        mocks.find.mockResolvedValue({ ...sync, platform: 'GOOGLE', syncedEmailHashes: [], adAccount: { accountId: 'tenant', platform: 'GOOGLE' } });
        mocks.dataManager.mockRejectedValue(new (await import('./GoogleDataManagerAudienceService')).GoogleDataManagerError('Data Manager did not acknowledge all audience operations'));
        await expect(AudienceSyncService.sync('tenant', 'sync')).rejects.toThrow('Audience sync failed');
        expect(mocks.updateMany.mock.calls.at(-1)![0].data.lastError).toContain('did not acknowledge all audience operations');
        expect(mocks.update).not.toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ syncedIdentifiers: expect.anything() }) }));
    });

    it('keeps HTTP status for non-JSON errors and never retains the response body', async () => {
        mocks.find.mockResolvedValue({ ...sync, platform: 'GOOGLE', syncedEmailHashes: [], adAccount: { accountId: 'tenant', platform: 'GOOGLE' } });
        mocks.dataManager.mockRejectedValue(new (await import('./GoogleDataManagerAudienceService')).GoogleDataManagerError('Google Data Manager returned HTTP 404 without readable diagnostics.'));
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
