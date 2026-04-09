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
 * - Conversion deliveries: SENT > 30 days, FAILED > 90 days
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

            // 6. Prune CAPI conversion delivery logs (SENT > 30 days, FAILED > 90 days)
            deleted.conversionDeliveries = await this.pruneConversionDeliveries(30, 90);

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

        // Why paginated: a single deleteMany on millions of rows holds a long Postgres lock
        // and generates excessive WAL. Batching at 5000 keeps lock windows short.
        const BATCH = 5_000;
        let totalDeleted = 0;

        while (true) {
            const expiredSessionIds = await prisma.analyticsSession.findMany({
                where: { lastActiveAt: { lt: cutoff } },
                select: { id: true },
                take: BATCH
            });
            if (expiredSessionIds.length === 0) break;

            const ids = expiredSessionIds.map(s => s.id);

            // Per-batch try/catch: a transient DB error on one batch should not abort
            // the entire cleanup run. The next Janitor tick will retry the remaining rows.
            try {
                await prisma.analyticsEvent.deleteMany({ where: { sessionId: { in: ids } } });
                await prisma.analyticsVisit.deleteMany({ where: { sessionId: { in: ids } } });

                const { count } = await prisma.analyticsSession.deleteMany({
                    where: { id: { in: ids } }
                });
                totalDeleted += count;
            } catch (err) {
                Logger.error('Janitor: batch session prune failed', { err, batchSize: ids.length });
                break; // Stop looping — next Janitor run will retry
            }

            if (expiredSessionIds.length < BATCH) break;
        }

        Logger.debug(`Pruned ${totalDeleted} analytics sessions older than ${daysOld} days`);
        return totalDeleted;
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

    /**
     * Prune CAPI conversion delivery logs.
     * Successful deliveries are debug/audit data — safe to drop after sentDaysOld.
     * Failed deliveries are kept longer for troubleshooting stale integrations.
     * PENDING records older than failedDaysOld are also pruned (likely orphaned).
     */
    private static async pruneConversionDeliveries(sentDaysOld: number, failedDaysOld: number): Promise<number> {
        const sentCutoff = new Date();
        sentCutoff.setDate(sentCutoff.getDate() - sentDaysOld);

        const failedCutoff = new Date();
        failedCutoff.setDate(failedCutoff.getDate() - failedDaysOld);

        const [sent, failed, pending] = await Promise.all([
            prisma.conversionDelivery.deleteMany({
                where: { status: 'SENT', createdAt: { lt: sentCutoff } },
            }),
            prisma.conversionDelivery.deleteMany({
                where: { status: 'FAILED', createdAt: { lt: failedCutoff } },
            }),
            prisma.conversionDelivery.deleteMany({
                where: { status: 'PENDING', createdAt: { lt: failedCutoff } },
            }),
        ]);

        const total = sent.count + failed.count + pending.count;
        Logger.debug(`Pruned ${total} conversion deliveries (${sent.count} sent, ${failed.count} failed, ${pending.count} stale pending)`);
        return total;
    }
}

