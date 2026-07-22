/** Replays the exact stored platform payload on the original delivery row. */
import { prisma } from '../../utils/prisma';
import { Logger } from '../../utils/logger';
import { decryptCapiConfig } from '../../utils/capiConfig';
import { ConversionForwarder } from './ConversionForwarder';

const BATCH_SIZE = 100;
const MAX_AGE_HOURS = 24;
const MAX_ATTEMPTS = 5;
const STALE_PENDING_MINUTES = 15;

interface RetryDelivery {
    id: string;
    accountId: string;
    platform: string;
    payload: unknown;
    attempts: number;
    status: string;
    lastAttemptAt: Date | null;
}

interface RawRequest {
    url: string;
    headers: Record<string, string>;
    body: unknown;
    acceptsResponse?: (response: Response, body: string) => boolean;
}

export async function retryFailedConversions(): Promise<{
    totalAttempted: number;
    totalRecovered: number;
    platformBreakdown: Record<string, { attempted: number; recovered: number }>;
}> {
    const cutoff = new Date(Date.now() - MAX_AGE_HOURS * 60 * 60 * 1000);
    const stalePendingCutoff = new Date(Date.now() - STALE_PENDING_MINUTES * 60 * 1000);
    const deliveries = await prisma.conversionDelivery.findMany({
        where: {
            createdAt: { gte: cutoff },
            OR: [
                { status: 'FAILED', attempts: { lt: MAX_ATTEMPTS } },
                {
                    status: 'PENDING',
                    OR: [
                        { lastAttemptAt: { lte: stalePendingCutoff } },
                        { lastAttemptAt: null, createdAt: { lte: stalePendingCutoff } },
                    ],
                },
            ],
        },
        orderBy: { createdAt: 'asc' },
        take: BATCH_SIZE,
        select: {
            id: true,
            accountId: true,
            platform: true,
            payload: true,
            attempts: true,
            status: true,
            lastAttemptAt: true,
        },
    }) as RetryDelivery[];

    const result = {
        totalAttempted: 0,
        totalRecovered: 0,
        platformBreakdown: {} as Record<string, { attempted: number; recovered: number }>,
    };

    for (const delivery of deliveries) {
        const platformResult = result.platformBreakdown[delivery.platform] ||= { attempted: 0, recovered: 0 };

        if (delivery.platform === 'GOOGLE') {
            if (!ConversionForwarder.hasStoredDeliveryRetry(delivery.platform)) {
                if (delivery.status === 'PENDING') {
                    await failStrandedPending(delivery.id, 'Interrupted retry recovered; direct Google retry is unavailable');
                }
                Logger.warn('[ConversionRetry] Platform requires a registered direct retry transport', {
                    deliveryId: delivery.id,
                    platform: delivery.platform,
                });
                continue;
            }
            if (delivery.status === 'PENDING' && delivery.attempts >= MAX_ATTEMPTS) {
                await failStrandedPending(delivery.id, 'Scheduled retry attempt limit reached');
                continue;
            }
            const claimed = await claimDelivery(delivery);
            if (!claimed) continue;
            result.totalAttempted++;
            platformResult.attempted++;
            try {
                const retryResult = await ConversionForwarder.retryStoredDelivery(delivery);
                if (!retryResult) throw new Error('Direct retry transport was unregistered');
                await finishAttempt(
                    delivery.id,
                    retryResult.status,
                    retryResult.httpStatus,
                    retryResult.response,
                    retryResult.lastError,
                );
                if (retryResult.status === 'SENT') {
                    result.totalRecovered++;
                    platformResult.recovered++;
                }
            } catch (error: any) {
                await finishAttempt(delivery.id, 'FAILED', null, null, error?.message || String(error));
            }
            continue;
        }

        if (delivery.status === 'PENDING' && delivery.attempts >= MAX_ATTEMPTS) {
            await failStrandedPending(delivery.id, 'Scheduled retry attempt limit reached');
            continue;
        }

        const config = await getPlatformConfig(delivery.accountId, delivery.platform);
        if (!config) {
            Logger.warn('[ConversionRetry] Enabled platform config is unavailable', {
                deliveryId: delivery.id,
                platform: delivery.platform,
            });
            if (delivery.status === 'PENDING') {
                await failStrandedPending(delivery.id, 'Enabled platform config is unavailable');
            }
            continue;
        }

        const claimed = await claimDelivery(delivery);
        if (!claimed) continue;

        result.totalAttempted++;
        platformResult.attempted++;

        const recovered = await replayClaimedDelivery(delivery, config);
        if (recovered) {
            result.totalRecovered++;
            platformResult.recovered++;
        }
    }

    return result;
}

async function claimDelivery(delivery: RetryDelivery): Promise<boolean> {
    const claimed = await prisma.conversionDelivery.updateMany({
        where: {
            id: delivery.id,
            status: delivery.status,
            attempts: delivery.attempts,
        },
        data: {
            status: 'PENDING',
            attempts: { increment: 1 },
            lastAttemptAt: new Date(),
        },
    });
    return claimed.count === 1;
}

async function replayClaimedDelivery(delivery: RetryDelivery, config: Record<string, any>): Promise<boolean> {
    try {
        const request = buildRawRequest(delivery.platform, config, delivery.payload);
        const response = await fetch(request.url, {
            method: 'POST',
            headers: request.headers,
            body: JSON.stringify(request.body),
            signal: AbortSignal.timeout(30_000),
        });
        const responseBody = await response.text();
        const accepted = request.acceptsResponse
            ? request.acceptsResponse(response, responseBody)
            : response.ok;

        await finishAttempt(
            delivery.id,
            accepted ? 'SENT' : 'FAILED',
            response.status,
            responseBody,
            accepted ? null : responseBody || `HTTP ${response.status}`,
        );
        return accepted;
    } catch (error: any) {
        await finishAttempt(delivery.id, 'FAILED', null, null, error?.message || String(error));
        return false;
    }
}

async function finishAttempt(
    id: string,
    status: 'SENT' | 'FAILED',
    httpStatus: number | null,
    response: string | null,
    lastError: string | null,
): Promise<void> {
    await prisma.conversionDelivery.update({
        where: { id },
        data: {
            status,
            httpStatus,
            response: response?.substring(0, 2000) || null,
            lastError: lastError?.substring(0, 2000) || null,
            sentAt: status === 'SENT' ? new Date() : undefined,
        },
    });
}

async function failStrandedPending(id: string, lastError: string): Promise<void> {
    await prisma.conversionDelivery.updateMany({
        where: { id, status: 'PENDING' },
        data: { status: 'FAILED', lastError },
    });
}

async function getPlatformConfig(accountId: string, platform: string): Promise<Record<string, any> | null> {
    const platformToFeatureKey: Record<string, string> = {
        META: 'META_CAPI',
        TIKTOK: 'TIKTOK_EVENTS_API',
        PINTEREST: 'PINTEREST_CAPI',
        GA4: 'GA4_MEASUREMENT',
        SNAPCHAT: 'SNAPCHAT_CAPI',
        MICROSOFT: 'MICROSOFT_CAPI',
        TWITTER: 'TWITTER_CAPI',
    };
    const featureKey = platformToFeatureKey[platform];
    if (!featureKey) return null;

    const feature = await prisma.accountFeature.findUnique({
        where: { accountId_featureKey: { accountId, featureKey } },
        select: { config: true, isEnabled: true },
    });
    return feature?.isEnabled && feature.config && typeof feature.config === 'object'
        ? decryptCapiConfig(feature.config)
        : null;
}

/**
 * Shared direct retry contract. Platform payload bytes are reconstructed only by
 * JSON serialising the stored Json value; no generic tracking event is rebuilt.
 */
export function buildRawRequest(platform: string, config: Record<string, any>, payload: unknown): RawRequest {
    const jsonHeaders = { 'Content-Type': 'application/json' };
    switch (platform) {
        case 'META':
            requireConfig(config, ['pixelId', 'accessToken']);
            return {
                url: `https://graph.facebook.com/v25.0/${config.pixelId}/events`,
                headers: { ...jsonHeaders, Authorization: `Bearer ${config.accessToken}` },
                body: payload,
            };
        case 'TIKTOK':
            requireConfig(config, ['accessToken']);
            return {
                url: 'https://business-api.tiktok.com/open_api/v1.3/event/track/',
                headers: { ...jsonHeaders, 'Access-Token': config.accessToken },
                body: payload,
                acceptsResponse: (response, body) => {
                    if (!response.ok) return false;
                    try { return JSON.parse(body).code === 0; } catch { return false; }
                },
            };
        case 'PINTEREST':
            requireConfig(config, ['adAccountId', 'accessToken']);
            return {
                url: `https://api.pinterest.com/v5/ad_accounts/${config.adAccountId}/events`,
                headers: { ...jsonHeaders, Authorization: `Bearer ${config.accessToken}` },
                body: payload,
            };
        case 'GA4': {
            requireConfig(config, ['measurementId', 'apiSecret']);
            const endpoint = config.useDebugEndpoint
                ? 'https://www.google-analytics.com/debug/mp/collect'
                : 'https://www.google-analytics.com/mp/collect';
            const query = new URLSearchParams({ measurement_id: config.measurementId, api_secret: config.apiSecret });
            return { url: `${endpoint}?${query}`, headers: jsonHeaders, body: payload };
        }
        case 'SNAPCHAT':
            requireConfig(config, ['pixelId', 'accessToken']);
            return {
                url: `https://tr.snapchat.com/v3/${encodeURIComponent(config.pixelId)}/events?access_token=${encodeURIComponent(config.accessToken)}`,
                headers: jsonHeaders,
                body: payload,
                acceptsResponse: (response, body) => {
                    if (!response.ok) return false;
                    try { return JSON.parse(body).status === 'VALID'; } catch { return false; }
                },
            };
        case 'MICROSOFT':
            requireConfig(config, ['accessToken']);
            return {
                url: 'https://bat.bing.com/api/v2/conversion/event',
                headers: { ...jsonHeaders, Authorization: `SharedAccessSignature ${config.accessToken}` },
                body: { events: [payload] },
            };
        case 'TWITTER':
            requireConfig(config, ['pixelId', 'accessToken']);
            return {
                url: `https://ads-api.x.com/12/measurement/conversions/${config.pixelId}`,
                headers: { ...jsonHeaders, Authorization: `Bearer ${config.accessToken}` },
                body: payload,
                acceptsResponse: (response, body) => {
                    if (!response.ok) return false;
                    try { return Number(JSON.parse(body)?.data?.conversions_processed || 0) > 0; } catch { return false; }
                },
            };
        default:
            throw new Error(`Unsupported conversion retry platform: ${platform}`);
    }
}

function requireConfig(config: Record<string, any>, keys: string[]): void {
    const missing = keys.filter((key) => !config[key]);
    if (missing.length > 0) throw new Error(`Missing retry config: ${missing.join(', ')}`);
}
