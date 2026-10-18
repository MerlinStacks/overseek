import crypto from 'crypto';
import { prisma } from '../../utils/prisma';
import { segmentService } from '../SegmentService';
import { QueueFactory } from '../queue/QueueFactory';
import { MetaAdsService } from './MetaAdsService';
import { createGoogleAdsRestConfig } from './GoogleAdsClient';
import { audienceIdentifiers, audienceIdentifierKey, googleAudienceIdentifiers, metaAudienceRows, type AudienceIdentifier } from './audienceIdentifiers';
import { getAdvertisingSubscribers } from './AdvertisingSubscriberService';
import type { SegmentCriteria } from '../segments/criteria';
import { describeAudienceRejection } from './nativeAudienceDiagnostics';
import { Logger } from '../../utils/logger';

/** Contains sanitised diagnostics only, never a raw provider response or customer payload. */
class AudienceSyncRequestError extends Error {}

/** Only email hashes are sent; raw identifiers never enter queue payloads or logs. */
export function audienceEmailHashes(emails: string[], platform: string): string[] {
    return [...new Set(emails.map(email => {
        let normalized = email.trim().toLowerCase();
        if (platform === 'GOOGLE') {
            const [local, domain] = normalized.split('@');
            if (domain === 'gmail.com' || domain === 'googlemail.com') normalized = `${local.replace(/\./g, '')}@${domain}`;
        }
        return normalized;
    }).filter(email => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))
        .map(email => crypto.createHash('sha256').update(email).digest('hex')))];
}

export class AudienceSyncService {
    static async enqueue(accountId: string, syncId: string) {
        // A stable job ID deduplicates manual clicks and scheduled refreshes, including active jobs.
        await QueueFactory.createQueue('scheduler').add('sync-ad-audience', { accountId, syncId }, {
            jobId: `sync-ad-audience-${syncId}`, removeOnComplete: true, removeOnFail: true,
            attempts: 3, backoff: { type: 'exponential', delay: 60000 }
        });
    }

    static async dispatch() {
        let cursor: string | undefined;
        while (true) {
            const batch = await prisma.audienceSync.findMany({
                where: { autoSyncEnabled: true, isLookalike: false, consentConfirmedAt: { not: null } },
                select: { id: true, accountId: true }, orderBy: { id: 'asc' }, take: 100,
                ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {})
            });
            for (const sync of batch) await this.enqueue(sync.accountId, sync.id);
            if (batch.length < 100) break;
            cursor = batch[batch.length - 1].id;
        }
    }

    static async sync(accountId: string, syncId: string) {
        const sync = await prisma.audienceSync.findFirst({ where: { id: syncId, accountId }, include: { adAccount: true } });
        if (!sync || !sync.autoSyncEnabled || !sync.consentConfirmedAt || sync.isLookalike) return;
        if (sync.adAccount.accountId !== accountId || sync.adAccount.platform !== sync.platform) throw new Error('Invalid audience destination');
        await prisma.audienceSync.update({ where: { id: sync.id }, data: { status: 'SYNCING', lastAttemptAt: new Date(), lastError: null } });
        let phase = 'evaluating segment membership';
        try {
            const data = await segmentService.getExportableCustomers(accountId, sync.segmentId, true);
            let profiles = data.profiles || data.emails.map(email => ({ email }));
            if (sync.includeSubscribers) {
                const segment = await segmentService.getSegment(sync.segmentId, accountId);
                if (!segment) throw new Error('Segment not found');
                profiles = profiles.concat(await getAdvertisingSubscribers(accountId, segment.criteria as unknown as SegmentCriteria));
            }
            const desired = audienceIdentifiers(profiles, sync.platform, sync.enhancedMatching);
            // Older audiences only have an email snapshot. Retain it for removals
            // when migrating to richer identifiers; never strand old members.
            const previous = (sync.syncedIdentifiers as unknown as AudienceIdentifier[]) || [];
            const legacy = ((sync.syncedEmailHashes as string[]) || []).map(email => ({ email }));
            const applied = new Map<string, AudienceIdentifier>((previous.length ? previous : legacy).map(row => [audienceIdentifierKey(row), row] as const));
            let externalId = sync.externalId;
            phase = 'connecting to the advertising account';
            const google = sync.platform === 'GOOGLE' ? await createGoogleAdsRestConfig(sync.adAccountId) : null;
            const googleRequest = async (path: 'userLists:mutate' | ':uploadUserData', body: unknown, expectedOperations?: number): Promise<any> => {
                if (!google) throw new Error('Invalid Google configuration');
                // UserDataService is a customer-level action, not a /userData:mutate resource.
                // https://github.com/googleapis/googleapis/blob/master/google/ads/googleads/v24/services/user_data_service.proto
                const suffix = path.startsWith(':') ? path : `/${path}`;
                const response = await fetch(`https://googleads.googleapis.com/v24/customers/${google.customerId}${suffix}`, {
                    method: 'POST', signal: AbortSignal.timeout(30000),
                    headers: {
                        'Content-Type': 'application/json', Authorization: `Bearer ${google.accessToken}`,
                        'developer-token': google.developerToken,
                        ...(google.loginCustomerId ? { 'login-customer-id': google.loginCustomerId } : {})
                    },
                    body: JSON.stringify(body)
                });
                let result: any;
                try { result = await response.json(); } catch {
                    throw new AudienceSyncRequestError(`Google audience sync failed while ${phase} (HTTP ${response.status}); no readable JSON response was returned.`);
                }
                if (!response.ok || result?.error || result?.partialFailureError) {
                    const body = result?.partialFailureError ? { error: result.partialFailureError } : result;
                    throw new AudienceSyncRequestError(`${describeAudienceRejection('GOOGLE', response.status, body, [google.accessToken, google.developerToken, sync.adAccount.accessToken, sync.adAccount.refreshToken || ''], 'sync')} Stage: ${phase}.`);
                }
                if (expectedOperations !== undefined && result?.receivedOperationsCount !== undefined && Number(result.receivedOperationsCount) !== expectedOperations) {
                    throw new AudienceSyncRequestError('Google did not acknowledge all audience operations. Membership has not been marked as synced; retry the upload.');
                }
                return result;
            };
            if (!externalId) {
                phase = 'creating the customer list';
                if (sync.platform === 'META') {
                    externalId = (await MetaAdsService.createCustomAudience(sync.adAccountId, sync.audienceName, 'Automatically maintained by Overseek')).id;
                } else if (google) {
                    const result = await googleRequest('userLists:mutate', { operations: [{ create: {
                        name: sync.audienceName, description: 'Automatically maintained by Overseek', membershipLifeSpan: 540,
                        crmBasedUserList: { uploadKeyType: 'CONTACT_INFO', dataSourceType: 'FIRST_PARTY' }
                    } }] });
                    externalId = result.results?.[0]?.resourceName;
                } else throw new Error('Unsupported audience platform');
                if (!externalId) throw new Error('Platform did not return an audience ID');
                await prisma.audienceSync.update({ where: { id: sync.id }, data: { externalId } });
            }
            const wanted = new Set(desired.map(audienceIdentifierKey));
            const removals = [...applied].filter(([key]) => !wanted.has(key)).map(([, row]) => row);
            // Five-minute deltas must not re-upload the whole list every time.
            // Refresh acknowledged membership daily to prevent platform expiry.
            const fullRefresh = !sync.lastFullRefreshAt || Date.now() - sync.lastFullRefreshAt.getTime() >= 86400000;
            const additions = fullRefresh ? desired : desired.filter(row => !applied.has(audienceIdentifierKey(row)));
            for (const [action, rows] of [['remove', removals], ['create', additions]] as const) {
                // UserDataService permits 10 operations and 20 identifiers/request.
                const batchSize = sync.platform === 'META' ? 1000 : rows.some(row => Object.keys(row).some(key => key !== 'email')) ? 6 : 10;
                for (let offset = 0; offset < rows.length; offset += batchSize) {
                    // Pausing stops further batches, without losing the last acknowledged snapshot.
                    const active = await prisma.audienceSync.findFirst({ where: { id: sync.id, accountId, autoSyncEnabled: true } });
                    if (!active) return;
                    const batch = rows.slice(offset, offset + batchSize);
                    phase = action === 'remove' ? 'removing expired audience members' : 'uploading audience members';
                    if (sync.platform === 'META') {
                        const emails = batch.map(row => row.email || '');
                        const richer = batch.some(row => Object.keys(row).some(key => key !== 'email'));
                        const args = [sync.adAccountId, externalId, emails, ...(richer ? [metaAudienceRows(batch)] : [])] as [string, string, string[], string[][]?];
                        if (action === 'remove') await MetaAdsService.removeCustomAudienceMembers(...args);
                        else {
                            const result = await MetaAdsService.uploadCustomAudienceMembers(...args);
                            if (result.numInvalidEntries > 0) throw new Error('Meta rejected audience identifiers. Check your customer email data.');
                        }
                    } else {
                        await googleRequest(':uploadUserData', {
                            customerMatchUserListMetadata: {
                                userList: externalId, consent: { adUserData: 'GRANTED', adPersonalization: 'GRANTED' }
                            },
                            operations: batch.map(row => ({ [action]: { userIdentifiers: googleAudienceIdentifiers(row) } }))
                        }, batch.length);
                    }
                    for (const row of batch) action === 'remove' ? applied.delete(audienceIdentifierKey(row)) : applied.set(audienceIdentifierKey(row), row);
                    await prisma.audienceSync.update({ where: { id: sync.id }, data: {
                        syncedEmailHashes: [...new Set([...applied.values()].flatMap(row => row.email ? [row.email] : []))],
                        syncedIdentifiers: [...applied.values()] as object[],
                    } });
                }
            }
            await prisma.audienceSync.updateMany({ where: { id: sync.id, accountId, autoSyncEnabled: true }, data: {
                status: 'SYNCED', lastSyncAt: new Date(), lastError: null, memberCount: desired.length,
                ...(fullRefresh ? { lastFullRefreshAt: new Date() } : {})
            } });
        } catch (error) {
            const lastError = error instanceof AudienceSyncRequestError ? error.message
                : `Audience sync failed while ${phase}. ${phase === 'connecting to the advertising account' ? 'Check the advertising connection in Settings and reconnect if needed.' : 'Check the segment data and platform connection, then retry.'}`;
            Logger.warn('[AudienceSync] Sync failed', { accountId, syncId, platform: sync.platform, detail: lastError });
            await prisma.audienceSync.updateMany({ where: { id: sync.id, accountId, autoSyncEnabled: true }, data: {
                status: 'FAILED', lastError
            } });
            // Queue retries without retaining platform responses containing customer data.
            throw new Error('Audience sync failed');
        }
    }
}
