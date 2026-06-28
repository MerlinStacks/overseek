/**
 * Tracking Middleware
 * 
 * Security utilities for tracking endpoints: account validation, rate limiting.
 */

import { prisma } from '../utils/prisma';
import { Logger } from '../utils/logger';
import { onShutdown } from '../utils/shutdown';
import { registerRuntimeMetricsProvider } from '../utils/runtimeMetrics';
import crypto from 'crypto';

// Account validation cache
const accountCache = new Map<string, { timestamp: number; webhookSecret: string | null }>();
const CACHE_TTL = 60000;

function timingSafeStringEquals(a: string, b: string): boolean {
    const aBuffer = Buffer.from(a);
    const bBuffer = Buffer.from(b);
    return aBuffer.length === bBuffer.length && crypto.timingSafeEqual(aBuffer, bBuffer);
}

function extractBearerToken(authHeader: unknown): string {
    if (typeof authHeader !== 'string') return '';
    const match = authHeader.trim().match(/^Bearer\s+(.+)$/i);
    return match ? match[1].trim() : '';
}

async function getAccountAuthContext(accountId: string): Promise<{ exists: boolean; webhookSecret: string | null }> {
    const cached = accountCache.get(accountId);
    if (cached && Date.now() - cached.timestamp < CACHE_TTL) {
        return { exists: true, webhookSecret: cached.webhookSecret };
    }

    const account = await prisma.account.findUnique({
        where: { id: accountId },
        select: { id: true, webhookSecret: true }
    });

    if (!account) {
        return { exists: false, webhookSecret: null };
    }

    accountCache.set(accountId, { timestamp: Date.now(), webhookSecret: account.webhookSecret || null });
    return { exists: true, webhookSecret: account.webhookSecret || null };
}

/**
 * Validates that an account exists (with 1-minute caching).
 */
export async function isValidAccount(accountId: string): Promise<boolean> {
    return (await getAccountAuthContext(accountId)).exists;
}

/**
 * Validates signed server-side tracking requests from the WooCommerce plugin.
 */
export async function hasValidTrackingAuth(accountId: string, authHeader: unknown): Promise<boolean> {
    const account = await getAccountAuthContext(accountId);
    if (!account.exists || !account.webhookSecret) return false;

    const token = extractBearerToken(authHeader);
    return token.length > 0 && timingSafeStringEquals(account.webhookSecret, token);
}

/** Why fixed-window: O(1) per check vs O(n) array filter; no GC pressure under load */
interface RateWindow {
    count: number;
    windowStart: number;
}

const accountRateLimits = new Map<string, RateWindow>();
const MAX_EVENTS_PER_MINUTE = 100;

/**
 * Checks if account is rate limited (100 events/min) using a fixed-window counter.
 */
export function isRateLimited(accountId: string): boolean {
    const now = Date.now();
    const window = accountRateLimits.get(accountId);

    if (!window || now - window.windowStart >= 60000) {
        accountRateLimits.set(accountId, { count: 1, windowStart: now });
        return false;
    }

    // Why: >= would block the Nth event itself, making the effective limit N-1
    return ++window.count > MAX_EVENTS_PER_MINUTE;
}

// Cleanup stale entries every 5 minutes
export async function cleanupRateLimits() {
    const now = Date.now();
    const batchSize = 1000;
    let count = 0;

    for (const [accountId, window] of accountRateLimits.entries()) {
        if (++count % batchSize === 0) {
            await new Promise(resolve => setImmediate(resolve));
        }

        if (now - window.windowStart >= 60000) {
            accountRateLimits.delete(accountId);
        }
    }

    // Also clean expired account validation cache entries
    for (const [accountId, cached] of accountCache.entries()) {
        if (++count % batchSize === 0) {
            await new Promise(resolve => setImmediate(resolve));
        }

        if (now - cached.timestamp >= CACHE_TTL) {
            accountCache.delete(accountId);
        }
    }
}

const cleanupInterval = setInterval(() => {
    cleanupRateLimits().catch(err => Logger.error('Rate limit cleanup failed', { error: err }));
}, 5 * 60 * 1000);

export function cleanupTrackingMiddleware() {
    clearInterval(cleanupInterval);
}

onShutdown(async () => {
    cleanupTrackingMiddleware();
});

registerRuntimeMetricsProvider('trackingMiddleware', () => ({
    accountValidationCacheSize: accountCache.size,
    accountRateLimitMapSize: accountRateLimits.size,
}));
