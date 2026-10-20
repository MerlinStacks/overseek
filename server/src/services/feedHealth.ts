import { prisma } from '../utils/prisma';
import { cacheAside, cacheGet, cacheSet } from '../utils/cache';
import { FeedMappingService, type FeedChannel, type FeedScanHealth, type VariationMode } from './feedMapping';

export interface FeedExportEvent {
    at: string;
    status: 'generated' | 'failed';
    message: string;
}

const scanJobs = new Map<string, Promise<FeedScanHealth>>();
const keyFor = (accountId: string, channel: FeedChannel, mode: VariationMode) => `${accountId}:${channel}:${mode}`;
const telemetryOptions = { namespace: 'feed-export-status', ttl: 30 * 86400 };

/** Records generation only, not delivery, a platform fetch or platform acceptance. */
export async function recordFeedExport(accountId: string, channel: FeedChannel, mode: VariationMode, succeeded: boolean): Promise<void> {
    const event: FeedExportEvent = {
        at: new Date().toISOString(), status: succeeded ? 'generated' : 'failed',
        message: succeeded ? 'Feed generated locally. Platform acceptance is not verified.' : 'Feed generation failed. Check API logs for details.',
    };
    const key = keyFor(accountId, channel, mode);
    await Promise.all([
        cacheSet(`${key}:attempt`, event, telemetryOptions),
        cacheSet(`${key}:${succeeded ? 'success' : 'failure'}`, event, telemetryOptions),
    ]);
}

export async function getFeedHealth(accountId: string, channel: FeedChannel, mode: VariationMode) {
    const key = keyFor(accountId, channel, mode);
    const [scan, sync, lastAttempt, lastSuccess, lastFailure] = await Promise.all([
        cacheAside(key, async () => {
            const running = scanJobs.get(key);
            if (running) return running;
            const job = FeedMappingService.getFeedRows(accountId, channel, 1, 0, '', mode, undefined, true)
                .then((result) => result.health!);
            // Only active scans are retained; the cross-process result cache lasts 60 seconds.
            scanJobs.set(key, job);
            try { return await job; } finally { scanJobs.delete(key); }
        }, { namespace: 'feed-health-v1', ttl: 60 }),
        prisma.syncState.findUnique({
            where: { accountId_entityType: { accountId, entityType: 'products' } }, select: { lastSyncedAt: true },
        }),
        cacheGet<FeedExportEvent>(`${key}:attempt`, telemetryOptions),
        cacheGet<FeedExportEvent>(`${key}:success`, telemetryOptions),
        cacheGet<FeedExportEvent>(`${key}:failure`, telemetryOptions),
    ]);
    return { ...scan, channel, variationMode: mode, lastProductSyncAt: sync?.lastSyncedAt || null,
        lastAttempt, lastSuccess, lastFailure, platformAcceptance: 'not_verified' as const, cacheSeconds: 60 };
}
