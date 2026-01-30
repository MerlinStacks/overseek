import { prisma } from '../utils/prisma';
import { Logger } from '../utils/logger';

/**
 * The Janitor - Automated Data Pruning Service
 * 
 * Runs on a schedule to clean old data based on retention policies:
 * - Analytics sessions > 90 days (includes events and visits)
 * - Audit logs > 365 days  
 * - Notifications > 30 days (read only)
 * - Sync logs > 30 days
 */
export class JanitorService {

    /**
     * Run all cleanup tasks
     */
    static async runCleanup(): Promise<{ deleted: Record<string, number> }> {
        Logger.info('Janitor starting cleanup...');

        const deleted: Record<string, number> = {};

        try {
            // 1. Prune old analytics sessions (> 90 days)
            deleted.analyticsSessions = await this.pruneAnalyticsSessions(90);

            // 2. Prune old audit logs (> 365 days)
            deleted.auditLogs = await this.pruneAuditLogs(365);

            // 3. Prune read notifications (> 30 days)
            deleted.notifications = await this.pruneNotifications(30);

            // 4. Prune old sync logs (> 30 days)
            deleted.syncLogs = await this.pruneSyncLogs(30);

            // 5. Prune notification delivery logs (> 30 days)
            deleted.notificationDeliveries = await this.pruneNotificationDeliveries(30);

            Logger.info('Janitor cleanup complete', { deleted });
        } catch (error) {
            Logger.error('Janitor cleanup failed', { error });
        }

        return { deleted };
    }

    /**
     * Prune analytics sessions older than specified days.
     * Also deletes related events and visits to prevent orphaned records.
     */
    private static async pruneAnalyticsSessions(daysOld: number): Promise<number> {
        const cutoff = new Date();
        cutoff.setDate(cutoff.getDate() - daysOld);

        // First delete related events
        const eventsDeleted = await prisma.analyticsEvent.deleteMany({
            where: {
                session: {
                    lastActiveAt: { lt: cutoff }
                }
            }
        });
        Logger.debug(`Pruned ${eventsDeleted.count} analytics events`);

        // Then delete related visits (prevents orphaned records)
        const visitsDeleted = await prisma.analyticsVisit.deleteMany({
            where: {
                session: {
                    lastActiveAt: { lt: cutoff }
                }
            }
        });
        Logger.debug(`Pruned ${visitsDeleted.count} analytics visits`);

        // Finally delete sessions
        const result = await prisma.analyticsSession.deleteMany({
            where: {
                lastActiveAt: { lt: cutoff }
            }
        });

        Logger.debug(`Pruned ${result.count} analytics sessions older than ${daysOld} days`);
        return result.count;
    }

    /**
     * Prune audit logs older than specified days
     */
    private static async pruneAuditLogs(daysOld: number): Promise<number> {
        const cutoff = new Date();
        cutoff.setDate(cutoff.getDate() - daysOld);

        const result = await prisma.auditLog.deleteMany({
            where: {
                createdAt: { lt: cutoff }
            }
        });

        Logger.debug(`Pruned ${result.count} audit logs older than ${daysOld} days`);
        return result.count;
    }

    /**
     * Prune read notifications older than specified days
     */
    private static async pruneNotifications(daysOld: number): Promise<number> {
        const cutoff = new Date();
        cutoff.setDate(cutoff.getDate() - daysOld);

        const result = await prisma.notification.deleteMany({
            where: {
                isRead: true,
                createdAt: { lt: cutoff }
            }
        });

        Logger.debug(`Pruned ${result.count} read notifications older than ${daysOld} days`);
        return result.count;
    }

    /**
     * Prune sync logs older than specified days.
     * Keeps recent logs for debugging while preventing table bloat.
     */
    private static async pruneSyncLogs(daysOld: number): Promise<number> {
        const cutoff = new Date();
        cutoff.setDate(cutoff.getDate() - daysOld);

        const result = await prisma.syncLog.deleteMany({
            where: {
                startedAt: { lt: cutoff }
            }
        });

        Logger.debug(`Pruned ${result.count} sync logs older than ${daysOld} days`);
        return result.count;
    }

    /**
     * Prune notification delivery logs older than specified days.
     * These are debug logs for tracking push/in-app delivery, not user-facing.
     */
    private static async pruneNotificationDeliveries(daysOld: number): Promise<number> {
        const cutoff = new Date();
        cutoff.setDate(cutoff.getDate() - daysOld);

        const result = await prisma.notificationDelivery.deleteMany({
            where: {
                createdAt: { lt: cutoff }
            }
        });

        Logger.debug(`Pruned ${result.count} notification delivery logs older than ${daysOld} days`);
        return result.count;
    }
}

