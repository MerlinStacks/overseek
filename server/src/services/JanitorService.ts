import { prisma } from '../utils/prisma';
import { Logger } from '../utils/logger';

/**
 * The Janitor - Automated Data Pruning Service
 * 
 * Runs on a schedule to clean old data based on retention policies:
 * - Analytics sessions > 90 days
 * - Audit logs > 365 days  
 * - Notifications > 30 days (read only)
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

            Logger.info('Janitor cleanup complete', { deleted });
        } catch (error) {
            Logger.error('Janitor cleanup failed', { error });
        }

        return { deleted };
    }

    /**
     * Prune analytics sessions older than specified days
     */
    private static async pruneAnalyticsSessions(daysOld: number): Promise<number> {
        const cutoff = new Date();
        cutoff.setDate(cutoff.getDate() - daysOld);

        // First delete related events
        await prisma.analyticsEvent.deleteMany({
            where: {
                session: {
                    lastActiveAt: { lt: cutoff }
                }
            }
        });

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
}
