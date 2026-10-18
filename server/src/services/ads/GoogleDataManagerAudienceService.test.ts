import { Prisma, type AudienceSync } from '@prisma/client';
import { createHash } from 'crypto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { GoogleDataManagerAudienceService, dataManagerListId, dataManagerMember } from './GoogleDataManagerAudienceService';

const mocks = vi.hoisted(() => ({ config: vi.fn(), find: vi.fn(), update: vi.fn(), updateMany: vi.fn() }));
vi.mock('./GoogleAdsClient', () => ({ createGoogleDataManagerConfig: mocks.config }));
vi.mock('../../utils/prisma', () => ({ prisma: { audienceSync: { findFirst: mocks.find, update: mocks.update, updateMany: mocks.updateMany } } }));

describe('Google Data Manager customer audiences', () => {
    let record: AudienceSync;
    let fetch: ReturnType<typeof vi.fn>;
    let processingStatus: string;
    const row = { email: 'a'.repeat(64) };
    const destination = { operatingAccount: { accountType: 'GOOGLE_ADS', accountId: '123' }, productDestinationId: '456' };
    beforeEach(() => {
        vi.resetAllMocks();
        processingStatus = 'SUCCESS';
        record = { id: 'sync', accountId: 'tenant', adAccountId: 'ads', audienceName: 'Overseek - Repeat Customers',
            externalId: 'customers/123/userLists/456', platform: 'GOOGLE', autoSyncEnabled: true,
            syncedIdentifiers: [], syncedEmailHashes: [], googleDataManagerState: null, lastFullRefreshAt: null, lastSyncAt: null
        } as unknown as AudienceSync;
        mocks.config.mockResolvedValue({ customerId: '123', loginCustomerId: '789', accessToken: 'oauth-secret' });
        mocks.find.mockImplementation(async () => record.autoSyncEnabled ? record : null);
        mocks.update.mockImplementation(async ({ data }) => {
            const next = { ...data };
            if (next.googleDataManagerState === Prisma.DbNull) next.googleDataManagerState = null;
            Object.assign(record, structuredClone(next));
            return record;
        });
        mocks.updateMany.mockImplementation(async ({ data }) => { Object.assign(record, structuredClone(data)); return { count: 1 }; });
        fetch = vi.fn().mockImplementation(async (url: string, request: RequestInit) => {
            let body: unknown;
            if (url.includes('requestStatus:retrieve')) body = { requestStatusPerDestination: [{ destination, requestStatus: processingStatus }] };
            else if (url.includes('/userLists') && request.method === 'GET') body = { userLists: [] };
            else if (url.endsWith('/userLists')) body = { id: '456' };
            else body = { requestId: `request-${fetch.mock.calls.length}` };
            return { ok: true, status: 200, json: async () => body };
        });
        vi.stubGlobal('fetch', fetch);
    });
    afterEach(() => vi.unstubAllGlobals());
    const run = (rows = [row]) => GoogleDataManagerAudienceService.sync({ ...record }, rows);

    it('uses Data Manager ingest with consent, terms and manager destination, without any developer token', async () => {
        await run();
        const [url, request] = fetch.mock.calls[0];
        expect(url).toBe('https://datamanager.googleapis.com/v1/audienceMembers:ingest');
        expect(request.headers).not.toHaveProperty('developer-token');
        expect(request.headers).not.toHaveProperty('login-account');
        expect(JSON.parse(request.body)).toMatchObject({
            destinations: [{ ...destination, loginAccount: { accountType: 'GOOGLE_ADS', accountId: '789' } }],
            encoding: 'HEX', consent: { adUserData: 'CONSENT_GRANTED', adPersonalization: 'CONSENT_GRANTED' },
            termsOfService: { customerMatchTermsOfServiceStatus: 'ACCEPTED' }, audienceMembers: [dataManagerMember(row)]
        });
        expect(record.status).toBe('SYNCED');
        expect(record.syncedIdentifiers).toEqual([row]);
        expect(record.googleDataManagerState).toBeNull();
        expect(fetch.mock.calls.every(([url]) => !url.includes('googleads.googleapis.com'))).toBe(true);
    });
    it('creates new contact lists through Data Manager and retains the canonical Google list ID', async () => {
        record.externalId = null;
        await run();
        const [url, request] = fetch.mock.calls.find(([url, options]) => url.endsWith('/userLists') && options.method === 'POST')!;
        expect(url).toBe('https://datamanager.googleapis.com/v1/accountTypes/GOOGLE_ADS/accounts/123/userLists');
        expect(request.headers['login-account']).toBe('accountTypes/GOOGLE_ADS/accounts/789');
        expect(JSON.parse(request.body)).toMatchObject({ displayName: 'Overseek - Repeat Customers', integrationCode: 'overseek:sync', membershipDuration: '46656000s', ingestedUserListInfo: { uploadKeyTypes: ['CONTACT_ID'], contactIdInfo: { dataSourceType: 'DATA_SOURCE_TYPE_FIRST_PARTY' } } });
        expect(record.externalId).toBe('customers/123/userLists/456');
    });
    it('reuses an existing list with its integration code after an interrupted creation', async () => {
        record.externalId = null;
        fetch.mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ userLists: [{ id: '456' }] }) });
        await run();
        expect(fetch.mock.calls.some(([url, options]) => url.endsWith('/userLists') && options.method === 'POST')).toBe(false);
    });
    it('resumes pending diagnostics after restart rather than re-uploading or claiming immediate success', async () => {
        processingStatus = 'PROCESSING';
        await run();
        expect(record.status).toBe('PROCESSING');
        expect(record.syncedIdentifiers).toEqual([]);
        expect(record.lastSyncAt).toBeNull();
        expect(record.googleDataManagerState).toMatchObject({ requestId: 'request-1', addOffset: 0 });
        processingStatus = 'SUCCESS';
        await run();
        expect(fetch.mock.calls.filter(([url]) => url.endsWith('audienceMembers:ingest'))).toHaveLength(1);
        expect(record.status).toBe('SYNCED');
        expect(record.memberCount).toBe(1);
    });
    it('removes old identifiers including when the desired audience is empty', async () => {
        record.syncedIdentifiers = [row];
        await run([]);
        expect(fetch.mock.calls[0][0]).toBe('https://datamanager.googleapis.com/v1/audienceMembers:remove');
        const body = JSON.parse(fetch.mock.calls[0][1].body);
        expect(body).not.toHaveProperty('consent');
        expect(body).not.toHaveProperty('termsOfService');
        expect(record.syncedIdentifiers).toEqual([]);
        expect(record.memberCount).toBe(0);
    });
    it('caps ingestion at 10000 members per request and tracks batch offsets', async () => {
        const rows = Array.from({ length: 10001 }, (_, i) => ({ email: createHash('sha256').update(String(i)).digest('hex') }));
        await run(rows);
        const batches = fetch.mock.calls.filter(([url]) => url.endsWith('audienceMembers:ingest')).map(([, request]) => JSON.parse(request.body).audienceMembers.length);
        expect(batches).toEqual([10000, 1]);
        expect(record.memberCount).toBe(10001);
    });
    it('does not acknowledge failed processing, and retains the batch for retry', async () => {
        processingStatus = 'FAILED';
        await expect(run()).rejects.toThrow('processing FAILED');
        expect(record.syncedIdentifiers).toEqual([]);
        expect(record.googleDataManagerState).toMatchObject({ addOffset: 0 });
        processingStatus = 'SUCCESS';
        await run();
        expect(record.status).toBe('SYNCED');
    });
    it('tracks possible partial additions for later removal but does not claim successful sync', async () => {
        processingStatus = 'PARTIAL_SUCCESS';
        await expect(run()).rejects.toThrow('PARTIAL_SUCCESS');
        expect(record.syncedIdentifiers).toEqual([row]);
        expect(record.lastSyncAt).toBeNull();
        expect(record.googleDataManagerState).toMatchObject({ addOffset: 0 });
        processingStatus = 'SUCCESS';
        await run([]);
        expect(fetch.mock.calls.some(([url]) => url.endsWith('audienceMembers:remove'))).toBe(true);
        expect(record.memberCount).toBe(0);
    });
    it('finishes a pending request before applying newer segment changes', async () => {
        processingStatus = 'PROCESSING';
        await run();
        processingStatus = 'SUCCESS';
        const replacement = { email: 'b'.repeat(64) };
        await run([replacement]);
        expect(record.syncedIdentifiers).toEqual([replacement]);
        expect(fetch.mock.calls.some(([url]) => url.endsWith('audienceMembers:remove'))).toBe(true);
    });
    it('stops new submissions when a sync is paused', async () => {
        record.autoSyncEnabled = false;
        await run();
        expect(fetch).not.toHaveBeenCalled();
    });
    it('rejects an audience ID from a different customer account', async () => {
        record.externalId = 'customers/999/userLists/456';
        await expect(run()).rejects.toThrow('does not belong');
        expect(fetch).not.toHaveBeenCalled();
    });
    it('gives actionable API-enable/reconnect instructions and sanitises credentials', async () => {
        fetch.mockResolvedValue({ ok: false, status: 403, json: async () => ({ error: { code: 403, message: 'Bearer oauth-secret has insufficient scopes', details: [{ reason: 'ACCESS_TOKEN_SCOPE_INSUFFICIENT' }] } }) });
        await expect(run()).rejects.toThrow('Enable the Data Manager API');
        try { await run(); } catch (error) { expect(String(error)).not.toContain('oauth-secret'); }
        expect(record.lastSyncAt).toBeNull();
    });
    it('does not acknowledge a status response for a different destination', async () => {
        fetch.mockImplementation(async (url: string) => ({ ok: true, status: 200, json: async () => url.includes('requestStatus') ? { requestStatusPerDestination: [{ destination: { ...destination, productDestinationId: '999' }, requestStatus: 'SUCCESS' }] } : { requestId: 'pending' } }));
        await expect(run()).rejects.toThrow('unexpected destination');
        expect(record.syncedIdentifiers).toEqual([]);
    });
    it('maps enhanced hashed identifiers to Data Manager field names', () => {
        const body = dataManagerMember({ ...row, phone: 'b'.repeat(64), firstName: 'c'.repeat(64), lastName: 'd'.repeat(64), country: 'AU', postalCode: '2000' });
        expect(body.compositeData.userData.userIdentifiers).toEqual([{ emailAddress: row.email }, { phoneNumber: 'b'.repeat(64) }, { address: { givenName: 'c'.repeat(64), familyName: 'd'.repeat(64), regionCode: 'AU', postalCode: '2000' } }]);
        expect(dataManagerListId('accountTypes/GOOGLE_ADS/accounts/123/userLists/456', '123')).toBe('456');
    });
});
