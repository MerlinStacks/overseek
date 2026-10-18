import crypto from 'crypto';
import { prisma } from '../../utils/prisma';
import { segmentService } from '../SegmentService';
import { QueueFactory } from '../queue/QueueFactory';
import { MetaAdsService } from './MetaAdsService';
import { audienceIdentifiers, audienceIdentifierKey, metaAudienceRows, type AudienceIdentifier } from './audienceIdentifiers';
import { getAdvertisingSubscribers } from './AdvertisingSubscriberService';
import type { SegmentCriteria } from '../segments/criteria';
import { GoogleDataManagerAudienceService, GoogleDataManagerError } from './GoogleDataManagerAudienceService';
import { Logger } from '../../utils/logger';

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
            if (sync.platform === 'GOOGLE') {
                phase = 'syncing the Google Data Manager audience';
                await GoogleDataManagerAudienceService.sync(sync, desired);
                return;
            }
            // Older audiences only have an email snapshot. Retain it for removals
            // when migrating to richer identifiers; never strand old members.
            const previous = (sync.syncedIdentifiers as unknown as AudienceIdentifier[]) || [];
            const legacy = ((sync.syncedEmailHashes as string[]) || []).map(email => ({ email }));
            const applied = new Map<string, AudienceIdentifier>((previous.length ? previous : legacy).map(row => [audienceIdentifierKey(row), row] as const));
            let externalId = sync.externalId;
            phase = 'connecting to the advertising account';
            if (!externalId) {
                phase = 'creating the customer list';
                if (sync.platform === 'META') {
                    externalId = (await MetaAdsService.createCustomAudience(sync.adAccountId, sync.audienceName, 'Automatically maintained by Overseek')).id;
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
                const batchSize = 1000;
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
            const lastError = error instanceof GoogleDataManagerError ? error.message
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
