/**
 * Tracking Middleware
 * 
 * Security utilities for tracking endpoints: account validation, rate limiting.
 */

import { prisma } from '../utils/prisma';

// Account validation cache
const accountCache = new Map<string, number>();
const CACHE_TTL = 60000;

/**
 * Validates that an account exists (with 1-minute caching).
 */
export async function isValidAccount(accountId: string): Promise<boolean> {
    const cached = accountCache.get(accountId);
    if (cached && Date.now() - cached < CACHE_TTL) {
        return true;
    }

    const account = await prisma.account.findUnique({
        where: { id: accountId },
        select: { id: true }
    });

    if (account) {
        accountCache.set(accountId, Date.now());
        return true;
    }
    return false;
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

    return ++window.count >= MAX_EVENTS_PER_MINUTE;
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
}

setInterval(() => {
    cleanupRateLimits().catch(err => console.error('Rate limit cleanup failed', err));
}, 5 * 60 * 1000);

