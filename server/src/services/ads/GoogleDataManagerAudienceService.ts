import { createHash } from 'crypto';
import { Prisma, type AudienceSync } from '@prisma/client';
import { prisma } from '../../utils/prisma';
import { createGoogleDataManagerConfig } from './GoogleAdsClient';
import { audienceIdentifierKey, type AudienceIdentifier } from './audienceIdentifiers';
import { describeAudienceRejection } from './nativeAudienceDiagnostics';

export class GoogleDataManagerError extends Error {}
interface BatchPlan {
    desiredKey: string;
    removals: AudienceIdentifier[];
    additions: AudienceIdentifier[];
    removeOffset: number;
    addOffset: number;
    requestId?: string;
    fullRefreshAt?: string;
}

export function dataManagerMember(row: AudienceIdentifier) {
    return { compositeData: { userData: { userIdentifiers: [
        ...(row.email ? [{ emailAddress: row.email }] : []),
        ...(row.phone ? [{ phoneNumber: row.phone }] : []),
        ...(row.firstName && row.lastName && row.country && row.postalCode ? [{ address: {
            givenName: row.firstName, familyName: row.lastName, regionCode: row.country, postalCode: row.postalCode
        } }] : [])
    ] } } };
}

export function dataManagerListId(externalId: string, customerId: string): string {
    const match = /^(?:customers\/(\d+)|accountTypes\/GOOGLE_ADS\/accounts\/(\d+))\/userLists\/(\d+)$/.exec(externalId);
    if (!match || (match[1] || match[2]) !== customerId) throw new GoogleDataManagerError('The audience ID does not belong to the connected Google Ads account.');
    return match[3];
}

/** Durable, one-at-a-time requests keep async additions/removals ordered across workers/restarts. */
export class GoogleDataManagerAudienceService {
    static async sync(sync: AudienceSync, desired: AudienceIdentifier[]) {
        let config;
        try { config = await createGoogleDataManagerConfig(sync.adAccountId); } catch {
            throw new GoogleDataManagerError('Reconnect Google Ads in Settings to grant the Data Manager permission. Enable the Data Manager API in the OAuth client’s Google Cloud project first.');
        }
        const { customerId, loginCustomerId, accessToken } = config;
        const parent = `accountTypes/GOOGLE_ADS/accounts/${customerId}`;
        const request = async (path: string, method = 'GET', body?: unknown, management = false): Promise<any> => {
            const response = await fetch(`https://datamanager.googleapis.com/v1/${path}`, {
                method, signal: AbortSignal.timeout(30000),
                headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json',
                    ...(management && loginCustomerId ? { 'login-account': `accountTypes/GOOGLE_ADS/accounts/${loginCustomerId}` } : {}) },
                ...(body === undefined ? {} : { body: JSON.stringify(body) })
            });
            let result: any;
            try { result = await response.json(); } catch { throw new GoogleDataManagerError(`Google Data Manager returned HTTP ${response.status} without readable diagnostics.`); }
            if (!response.ok || result?.error) {
                const detail = describeAudienceRejection('GOOGLE', response.status, result, [accessToken], 'sync');
                const setup = response.status === 401 || response.status === 403 ? ' Enable the Data Manager API in the OAuth project, then reconnect Google Ads in Settings to grant the datamanager scope. Also verify access to the destination account.' : '';
                throw new GoogleDataManagerError(`Data Manager: ${detail}${setup}`);
            }
            return result;
        };
        let externalId = sync.externalId;
        if (!externalId) {
            const integrationCode = `overseek:${sync.id}`;
            const filter = encodeURIComponent(`integration_code = ${JSON.stringify(integrationCode)}`);
            const existing = await request(`${parent}/userLists?filter=${filter}`, 'GET', undefined, true);
            if (existing.nextPageToken || (existing.userLists?.length || 0) > 1) throw new GoogleDataManagerError('Multiple Google lists match this sync. Resolve the duplicate lists before retrying.');
            const list = existing.userLists?.[0] || await request(`${parent}/userLists`, 'POST', {
                displayName: sync.audienceName, integrationCode, description: 'Automatically maintained by Overseek', membershipDuration: '46656000s',
                ingestedUserListInfo: { uploadKeyTypes: ['CONTACT_ID'], contactIdInfo: { dataSourceType: 'DATA_SOURCE_TYPE_FIRST_PARTY' } }
            }, true);
            if (typeof list.id !== 'string' || !/^\d+$/.test(list.id)) throw new GoogleDataManagerError('Google Data Manager did not return a valid audience ID.');
            externalId = `customers/${customerId}/userLists/${list.id}`;
            await prisma.audienceSync.update({ where: { id: sync.id }, data: { externalId } });
        }
        const listId = dataManagerListId(externalId, customerId);
        const destination = {
            operatingAccount: { accountType: 'GOOGLE_ADS', accountId: customerId },
            ...(loginCustomerId ? { loginAccount: { accountType: 'GOOGLE_ADS', accountId: loginCustomerId } } : {}),
            productDestinationId: listId
        };
        const previous = (sync.syncedIdentifiers as unknown as AudienceIdentifier[]) || [];
        const legacy = ((sync.syncedEmailHashes as string[]) || []).map(email => ({ email }));
        const applied = new Map<string, AudienceIdentifier>((previous.length ? previous : legacy).map(row => [audienceIdentifierKey(row), row] as const));
        const desiredKey = createHash('sha256').update(desired.map(audienceIdentifierKey).sort().join('\n')).digest('hex');
        let plan = sync.googleDataManagerState as unknown as BatchPlan | null;
        const newPlan = (): BatchPlan => {
            const wanted = new Set(desired.map(audienceIdentifierKey));
            const fullRefresh = !sync.lastFullRefreshAt || Date.now() - sync.lastFullRefreshAt.getTime() >= 86400000;
            return {
                desiredKey, removals: [...applied.values()].filter(row => !wanted.has(audienceIdentifierKey(row))),
                additions: fullRefresh ? desired : desired.filter(row => !applied.has(audienceIdentifierKey(row))),
                removeOffset: 0, addOffset: 0, ...(fullRefresh ? { fullRefreshAt: new Date().toISOString() } : {})
            };
        };
        const save = async () => prisma.audienceSync.update({ where: { id: sync.id }, data: {
            syncedIdentifiers: [...applied.values()] as object[],
            syncedEmailHashes: [...new Set([...applied.values()].flatMap(row => row.email ? [row.email] : []))],
            googleDataManagerState: plan ? plan as unknown as Prisma.InputJsonObject : Prisma.DbNull
        } });
        let submissions = 0;
        while (true) {
            const active = await prisma.audienceSync.findFirst({ where: { id: sync.id, accountId: sync.accountId, autoSyncEnabled: true } });
            if (!active) return;
            if (!plan || (!plan.requestId && plan.desiredKey !== desiredKey)) { plan = newPlan(); await save(); }
            const removing = plan.removeOffset < plan.removals.length;
            const rows = removing ? plan.removals.slice(plan.removeOffset, plan.removeOffset + 10000) : plan.additions.slice(plan.addOffset, plan.addOffset + 10000);
            if (plan.requestId) {
                const status = await request(`requestStatus:retrieve?requestId=${encodeURIComponent(plan.requestId)}`);
                const statuses = status.requestStatusPerDestination;
                if (!Array.isArray(statuses) || statuses.length === 0) {
                    await prisma.audienceSync.updateMany({ where: { id: sync.id, accountId: sync.accountId, autoSyncEnabled: true }, data: { status: 'PROCESSING', lastError: null } });
                    return;
                }
                // Exactly one destination was submitted. Do not acknowledge an unrelated response.
                const item = Array.isArray(statuses) && statuses.length === 1 ? statuses[0] : undefined;
                if (item?.destination?.productDestinationId !== listId || item?.destination?.operatingAccount?.accountId !== customerId) throw new GoogleDataManagerError('Google Data Manager returned diagnostics for an unexpected destination. Pending membership was not acknowledged.');
                if (item.requestStatus === 'FAILED' || item.requestStatus === 'PARTIAL_SUCCESS') {
                    // A partial addition may be live remotely. Track its superset for future removals,
                    // but retain the unadvanced plan so every row is retried, not falsely confirmed.
                    if (!removing && item.requestStatus === 'PARTIAL_SUCCESS') for (const row of rows) applied.set(audienceIdentifierKey(row), row);
                    const reasons = (item.errorInfo?.errorCounts || []).map((error: any) => error.reason).filter((value: unknown) => typeof value === 'string' && /^[A-Z_]{1,150}$/.test(value)).slice(0, 5);
                    plan.requestId = undefined; await save();
                    throw new GoogleDataManagerError(`Google Data Manager processing ${item.requestStatus}: ${reasons.join(', ') || 'check Google audience diagnostics'}. Retry after resolving the reported issue.`);
                }
                if (item.requestStatus !== 'SUCCESS') {
                    await prisma.audienceSync.updateMany({ where: { id: sync.id, accountId: sync.accountId, autoSyncEnabled: true }, data: { status: 'PROCESSING', lastError: null } });
                    return;
                }
                for (const row of rows) {
                    if (removing) applied.delete(audienceIdentifierKey(row));
                    else applied.set(audienceIdentifierKey(row), row);
                }
                if (removing) plan.removeOffset += rows.length; else plan.addOffset += rows.length;
                plan.requestId = undefined; await save();
                continue;
            }
            if (rows.length === 0) {
                const refreshedAt = plan.fullRefreshAt;
                plan = null; await save();
                await prisma.audienceSync.updateMany({ where: { id: sync.id, accountId: sync.accountId, autoSyncEnabled: true }, data: {
                    status: 'SYNCED', lastSyncAt: new Date(), lastError: null, memberCount: desired.length,
                    ...(refreshedAt ? { lastFullRefreshAt: new Date(refreshedAt) } : {})
                } });
                return;
            }
            if (submissions >= 4) {
                await prisma.audienceSync.updateMany({ where: { id: sync.id, accountId: sync.accountId, autoSyncEnabled: true }, data: { status: 'PROCESSING', lastError: null } });
                return;
            }
            const result = await request(`audienceMembers:${removing ? 'remove' : 'ingest'}`, 'POST', {
                destinations: [destination], audienceMembers: rows.map(dataManagerMember), encoding: 'HEX',
                ...(!removing ? { consent: { adUserData: 'CONSENT_GRANTED', adPersonalization: 'CONSENT_GRANTED' }, termsOfService: { customerMatchTermsOfServiceStatus: 'ACCEPTED' } } : {})
            });
            if (typeof result.requestId !== 'string' || !result.requestId) throw new GoogleDataManagerError('Google Data Manager did not return a request ID. Membership has not been acknowledged.');
            plan.requestId = result.requestId;
            await save();
            submissions++;
        }
    }
}
