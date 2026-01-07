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

// Per-account rate limiting
const accountRateLimits = new Map<string, number[]>();
const MAX_EVENTS_PER_MINUTE = 100;

/**
 * Checks if account is rate limited (100 events/min).
 */
export function isRateLimited(accountId: string): boolean {
    const now = Date.now();
    const timestamps = accountRateLimits.get(accountId) || [];
    const recent = timestamps.filter(t => now - t < 60000);

    if (recent.length >= MAX_EVENTS_PER_MINUTE) {
        return true;
    }

    recent.push(now);
    accountRateLimits.set(accountId, recent);
    return false;
}

// Cleanup stale entries every 5 minutes
setInterval(() => {
    const now = Date.now();
    for (const [accountId, timestamps] of accountRateLimits.entries()) {
        const recent = timestamps.filter(t => now - t < 60000);
        if (recent.length === 0) {
            accountRateLimits.delete(accountId);
        } else {
            accountRateLimits.set(accountId, recent);
        }
    }
}, 5 * 60 * 1000);
