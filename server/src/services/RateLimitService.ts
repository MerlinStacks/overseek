/**
 * RateLimitService
 * 
 * Per-account rate limiting using Redis sliding window counters.
 * Provides distributed rate limiting for multi-instance deployments.
 */

import { prisma } from '../utils/prisma';
import { redisClient } from '../utils/redis';
import { Logger } from '../utils/logger';

/** Default rate limit configuration */
const DEFAULT_LIMITS = {
    STANDARD: { maxRequests: 1000, windowSeconds: 900 },
    PREMIUM: { maxRequests: 5000, windowSeconds: 900 },
    ENTERPRISE: { maxRequests: 20000, windowSeconds: 900 },
} as const;

/** Rate limit check result */
export interface RateLimitResult {
    allowed: boolean;
    remaining: number;
    limit: number;
    resetAt: Date;
    tier: string;
}

/** Account rate limit configuration */
export interface RateLimitConfig {
    maxRequests: number;
    windowSeconds: number;
    tier: string;
}

/**
 * Service for per-account API rate limiting.
 * Uses Redis for distributed counting across multiple server instances.
 */
export class RateLimitService {
    /** Cache for account configs to reduce DB lookups */
    private static configCache = new Map<string, { config: RateLimitConfig; expiresAt: number }>();
    private static CONFIG_CACHE_TTL_MS = 60_000; // 1 minute

    /**
     * Check if a request is allowed under the account's rate limit.
     * Atomically increments the counter and returns the result.
     */
    static async checkLimit(accountId: string): Promise<RateLimitResult> {
        const config = await this.getAccountConfig(accountId);
        const key = `ratelimit:${accountId}`;
        const now = Date.now();
        const windowStart = Math.floor(now / (config.windowSeconds * 1000)) * (config.windowSeconds * 1000);
        const windowKey = `${key}:${windowStart}`;

        try {
            // Atomic increment with expiry
            const count = await redisClient.incr(windowKey);

            // Set expiry on first request in window
            if (count === 1) {
                await redisClient.expire(windowKey, config.windowSeconds + 60); // Extra buffer
            }

            const allowed = count <= config.maxRequests;
            const remaining = Math.max(0, config.maxRequests - count);
            const resetAt = new Date(windowStart + config.windowSeconds * 1000);

            if (!allowed) {
                Logger.warn('[RateLimit] Account exceeded rate limit', {
                    accountId,
                    count,
                    limit: config.maxRequests,
                    tier: config.tier,
                });
            }

            return {
                allowed,
                remaining,
                limit: config.maxRequests,
                resetAt,
                tier: config.tier,
            };
        } catch (error) {
            // Fail open on Redis errors to avoid blocking legitimate traffic
            Logger.error('[RateLimit] Redis error, allowing request', { accountId, error });
            return {
                allowed: true,
                remaining: config.maxRequests,
                limit: config.maxRequests,
                resetAt: new Date(now + config.windowSeconds * 1000),
                tier: config.tier,
            };
        }
    }

    /**
     * Get the rate limit configuration for an account.
     * Uses caching to minimize database lookups.
     */
    static async getAccountConfig(accountId: string): Promise<RateLimitConfig> {
        // Check cache first
        const cached = this.configCache.get(accountId);
        if (cached && cached.expiresAt > Date.now()) {
            return cached.config;
        }

        // Lookup from database
        const accountConfig = await prisma.accountRateLimit.findUnique({
            where: { accountId },
        });

        const config: RateLimitConfig = accountConfig
            ? {
                maxRequests: accountConfig.maxRequests,
                windowSeconds: accountConfig.windowSeconds,
                tier: accountConfig.tier,
            }
            : {
                ...DEFAULT_LIMITS.STANDARD,
                tier: 'STANDARD',
            };

        // Cache the result
        this.configCache.set(accountId, {
            config,
            expiresAt: Date.now() + this.CONFIG_CACHE_TTL_MS,
        });

        return config;
    }

    /**
     * Update an account's rate limit configuration.
     * Clears the cache for the account.
     */
    static async setAccountConfig(
        accountId: string,
        updates: Partial<RateLimitConfig>
    ): Promise<RateLimitConfig> {
        const result = await prisma.accountRateLimit.upsert({
            where: { accountId },
            update: {
                maxRequests: updates.maxRequests,
                windowSeconds: updates.windowSeconds,
                tier: updates.tier,
            },
            create: {
                accountId,
                maxRequests: updates.maxRequests ?? DEFAULT_LIMITS.STANDARD.maxRequests,
                windowSeconds: updates.windowSeconds ?? DEFAULT_LIMITS.STANDARD.windowSeconds,
                tier: updates.tier ?? 'STANDARD',
            },
        });

        // Clear cache
        this.configCache.delete(accountId);

        Logger.info('[RateLimit] Account config updated', {
            accountId,
            maxRequests: result.maxRequests,
            windowSeconds: result.windowSeconds,
            tier: result.tier,
        });

        return {
            maxRequests: result.maxRequests,
            windowSeconds: result.windowSeconds,
            tier: result.tier,
        };
    }

    /**
     * Get current usage stats for an account.
     */
    static async getUsageStats(accountId: string): Promise<{
        currentCount: number;
        limit: number;
        remaining: number;
        windowSeconds: number;
        tier: string;
    }> {
        const config = await this.getAccountConfig(accountId);
        const now = Date.now();
        const windowStart = Math.floor(now / (config.windowSeconds * 1000)) * (config.windowSeconds * 1000);
        const windowKey = `ratelimit:${accountId}:${windowStart}`;

        try {
            const countStr = await redisClient.get(windowKey);
            const currentCount = countStr ? parseInt(countStr, 10) : 0;

            return {
                currentCount,
                limit: config.maxRequests,
                remaining: Math.max(0, config.maxRequests - currentCount),
                windowSeconds: config.windowSeconds,
                tier: config.tier,
            };
        } catch {
            return {
                currentCount: 0,
                limit: config.maxRequests,
                remaining: config.maxRequests,
                windowSeconds: config.windowSeconds,
                tier: config.tier,
            };
        }
    }

    /**
     * Reset an account's current rate limit counter.
     * Useful for admin override or after billing cycle.
     */
    static async resetCounter(accountId: string): Promise<void> {
        const config = await this.getAccountConfig(accountId);
        const now = Date.now();
        const windowStart = Math.floor(now / (config.windowSeconds * 1000)) * (config.windowSeconds * 1000);
        const windowKey = `ratelimit:${accountId}:${windowStart}`;

        try {
            await redisClient.del(windowKey);
            Logger.info('[RateLimit] Counter reset', { accountId });
        } catch (error) {
            Logger.error('[RateLimit] Failed to reset counter', { accountId, error });
        }
    }

    /**
     * Get default limits for each tier.
     */
    static getDefaultLimits(): typeof DEFAULT_LIMITS {
        return DEFAULT_LIMITS;
    }

    /**
     * Clear the config cache (for testing or after bulk updates).
     */
    static clearConfigCache(): void {
        this.configCache.clear();
    }
}
