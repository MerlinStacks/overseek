/**
 * Abandoned cart detection and recovery service.
 *
 * Provides methods to find abandoned carts and mark them as notified
 * for automated recovery workflows.
 */

import { prisma } from '../../utils/prisma';

/**
 * Find Abandoned Carts.
 * Sessions with cartValue > 0, email set, inactive for X mins, not yet notified.
 *
 * @param accountId - The account ID to query
 * @param thresholdMinutes - Minutes of inactivity before cart is considered abandoned (default: 30)
 * @returns Array of abandoned cart sessions
 */
export async function findAbandonedCarts(accountId: string, thresholdMinutes: number = 30) {
    const cutoff = new Date(Date.now() - thresholdMinutes * 60 * 1000);

    return prisma.analyticsSession.findMany({
        where: {
            accountId,
            cartValue: { gt: 0 },
            email: { not: null },
            lastActiveAt: { lt: cutoff },
            abandonedNotificationSentAt: null
        }
    });
}

/**
 * Mark a session as having received an abandoned cart notification.
 *
 * @param sessionId - The session ID to update
 * @returns Updated session record
 */
export async function markAbandonedNotificationSent(sessionId: string) {
    return prisma.analyticsSession.update({
        where: { id: sessionId },
        data: { abandonedNotificationSentAt: new Date() }
    });
}
