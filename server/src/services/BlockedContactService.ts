/**
 * Blocked Contact Service
 * 
 * Manages blocked contacts for inbox filtering.
 * Blocked contacts have their messages auto-resolved without autoreplies.
 * 
 * OPTIMIZATION: Uses Redis set caching for O(1) blocked contact lookups during
 * email ingestion. Cache is invalidated on block/unblock operations.
 */

import { prisma } from '../utils/prisma';
import { Logger } from '../utils/logger';
import { redisClient as redis } from '../utils/redis';

// Cache TTL: 5 minutes - allows quick updates while avoiding constant DB queries
const BLOCKED_CACHE_TTL = 300;

/**
 * Get Redis key for blocked contacts set
 */
function getBlockedSetKey(accountId: string): string {
    return `blocked:emails:${accountId}`;
}

export class BlockedContactService {
    /**
     * Check if an email is blocked for a given account.
     * 
     * PERFORMANCE: Uses Redis set membership check (O(1)) with fallback to DB.
     * The blocked emails set is populated on first check and cached.
     */
    static async isBlocked(accountId: string, email: string): Promise<boolean> {
        const normalizedEmail = email.toLowerCase();
        const cacheKey = getBlockedSetKey(accountId);

        try {
            // Check if set exists and check membership in one call
            const [exists, isMember] = await Promise.all([
                redis.exists(cacheKey),
                redis.sismember(cacheKey, normalizedEmail)
            ]);

            if (exists) {
                return isMember === 1;
            }

            // Cache miss - populate from database
            const blocked = await prisma.blockedContact.findMany({
                where: { accountId },
                select: { email: true }
            });

            // Populate Redis set (or create empty marker)
            if (blocked.length > 0) {
                await redis.sadd(cacheKey, ...blocked.map(b => b.email));
            } else {
                // Use a special marker to indicate "set exists but is empty"
                await redis.sadd(cacheKey, '__EMPTY_SET__');
            }
            await redis.expire(cacheKey, BLOCKED_CACHE_TTL);

            return blocked.some(b => b.email === normalizedEmail);
        } catch (redisError) {
            // Redis unavailable - fall back to database
            Logger.debug('[BlockedContact] Redis unavailable, falling back to DB', { accountId });
            const blocked = await prisma.blockedContact.findUnique({
                where: {
                    accountId_email: { accountId, email: normalizedEmail }
                }
            });
            return !!blocked;
        }
    }

    /**
     * Block a contact by email.
     * 
     * NOTE: Invalidates cache to ensure consistency.
     */
    static async blockContact(
        accountId: string,
        email: string,
        blockedBy?: string,
        reason?: string
    ): Promise<{ success: boolean; error?: string }> {
        try {
            await prisma.blockedContact.upsert({
                where: {
                    accountId_email: { accountId, email: email.toLowerCase() }
                },
                create: {
                    accountId,
                    email: email.toLowerCase(),
                    blockedBy,
                    reason
                },
                update: {
                    blockedBy,
                    reason,
                    blockedAt: new Date()
                }
            });

            // Invalidate cache so next check repopulates
            try {
                await redis.del(getBlockedSetKey(accountId));
            } catch { /* Redis unavailable is fine */ }

            Logger.info('[BlockedContact] Contact blocked', { accountId, email });
            return { success: true };
        } catch (error) {
            Logger.error('[BlockedContact] Failed to block contact', { error, accountId, email });
            return { success: false, error: 'Failed to block contact' };
        }
    }

    /**
     * Unblock a contact by email.
     * 
     * NOTE: Invalidates cache to ensure consistency.
     */
    static async unblockContact(
        accountId: string,
        email: string
    ): Promise<{ success: boolean; error?: string }> {
        try {
            await prisma.blockedContact.deleteMany({
                where: {
                    accountId,
                    email: email.toLowerCase()
                }
            });

            // Invalidate cache so next check repopulates
            try {
                await redis.del(getBlockedSetKey(accountId));
            } catch { /* Redis unavailable is fine */ }

            Logger.info('[BlockedContact] Contact unblocked', { accountId, email });
            return { success: true };
        } catch (error) {
            Logger.error('[BlockedContact] Failed to unblock contact', { error, accountId, email });
            return { success: false, error: 'Failed to unblock contact' };
        }
    }

    /**
     * List all blocked contacts for an account.
     */
    static async listBlocked(accountId: string) {
        return prisma.blockedContact.findMany({
            where: { accountId },
            include: {
                blocker: { select: { id: true, fullName: true } }
            },
            orderBy: { blockedAt: 'desc' }
        });
    }

    /**
     * Get a single blocked contact.
     */
    static async getBlockedContact(accountId: string, email: string) {
        return prisma.blockedContact.findUnique({
            where: {
                accountId_email: { accountId, email: email.toLowerCase() }
            },
            include: {
                blocker: { select: { id: true, fullName: true } }
            }
        });
    }
}
