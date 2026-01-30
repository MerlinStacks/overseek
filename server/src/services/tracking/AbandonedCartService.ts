/**
 * Abandoned cart detection and recovery service.
 *
 * Provides methods to find abandoned carts and mark them as notified
 * for automated recovery workflows.
 */

import { prisma } from '../../utils/prisma';
import { Logger } from '../../utils/logger';

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

/**
 * Get high-value abandoned carts above a minimum threshold.
 *
 * @param accountId - The account ID to query
 * @param minValue - Minimum cart value to include
 * @param thresholdMinutes - Minutes of inactivity (default: 30)
 * @returns Array of high-value abandoned cart sessions
 */
export async function getHighValueCarts(accountId: string, minValue: number, thresholdMinutes: number = 30) {
    const cutoff = new Date(Date.now() - thresholdMinutes * 60 * 1000);

    return prisma.analyticsSession.findMany({
        where: {
            accountId,
            cartValue: { gte: minValue },
            email: { not: null },
            lastActiveAt: { lt: cutoff },
            abandonedNotificationSentAt: null
        },
        orderBy: { cartValue: 'desc' }
    });
}

/**
 * Trigger abandoned cart automations for all accounts.
 * This function is called by a cron job to enroll abandoned carts into recovery flows.
 *
 * For each account with active ABANDONED_CART automations:
 * 1. Find sessions with abandoned carts (inactive 30+ min, has email, not yet notified)
 * 2. Create AutomationEnrollment records for each qualifying session
 * 3. Mark sessions as notified to prevent duplicate enrollments
 *
 * @returns Object with counts of processed accounts, carts, and enrollments
 */
export async function triggerAbandonedCartAutomations() {
    const stats = { accountsProcessed: 0, cartsFound: 0, enrollmentsCreated: 0 };

    try {
        // Find all active ABANDONED_CART automations
        const automations = await prisma.marketingAutomation.findMany({
            where: {
                triggerType: 'ABANDONED_CART',
                isActive: true,
                status: 'ACTIVE'
            },
            select: {
                id: true,
                accountId: true,
                triggerConfig: true
            }
        });

        // Group automations by account
        const automationsByAccount = new Map<string, typeof automations>();
        for (const automation of automations) {
            const existing = automationsByAccount.get(automation.accountId) || [];
            existing.push(automation);
            automationsByAccount.set(automation.accountId, existing);
        }

        // Process each account
        for (const [accountId, accountAutomations] of automationsByAccount) {
            stats.accountsProcessed++;

            // Get trigger config from first automation (usually only one per account)
            const config = (accountAutomations[0].triggerConfig as any) || {};
            const thresholdMinutes = config.thresholdMinutes || 30;
            const minCartValue = config.minCartValue || 0;

            // Find abandoned carts for this account
            const abandonedCarts = minCartValue > 0
                ? await getHighValueCarts(accountId, minCartValue, thresholdMinutes)
                : await findAbandonedCarts(accountId, thresholdMinutes);

            stats.cartsFound += abandonedCarts.length;

            // Enroll each cart in the automation
            for (const cart of abandonedCarts) {
                if (!cart.email) continue; // Safety check

                // Create enrollment for the first active automation
                const automation = accountAutomations[0];

                try {
                    await prisma.automationEnrollment.create({
                        data: {
                            automationId: automation.id,
                            email: cart.email,
                            wooCustomerId: cart.wooCustomerId,
                            status: 'ACTIVE',
                            contextData: {
                                sessionId: cart.id,
                                cartValue: Number(cart.cartValue),
                                currency: cart.currency,
                                cartItems: cart.cartItems,
                                triggeredAt: new Date().toISOString()
                            },
                            nextRunAt: new Date() // Process immediately
                        }
                    });

                    // Mark session as notified
                    await markAbandonedNotificationSent(cart.id);
                    stats.enrollmentsCreated++;

                    Logger.info('Abandoned cart enrolled in automation', {
                        accountId,
                        automationId: automation.id,
                        sessionId: cart.id,
                        email: cart.email,
                        cartValue: Number(cart.cartValue)
                    });
                } catch (enrollError: any) {
                    // Log but don't fail the whole batch
                    Logger.error('Failed to enroll abandoned cart', {
                        accountId,
                        sessionId: cart.id,
                        error: enrollError.message
                    });
                }
            }
        }

        Logger.info('Abandoned cart automation trigger completed', stats);
        return stats;
    } catch (error: any) {
        Logger.error('Abandoned cart automation trigger failed', { error: error.message });
        throw error;
    }
}
