/**
 * Sync Scheduler
 * 
 * Handles all WooCommerce sync-related scheduling:
 * - Global sync orchestrator (5 min)
 * - Fast order sync (2 min)
 */
import { QueueFactory } from '../queue/QueueFactory';
import { Logger } from '../../utils/logger';
import { prisma } from '../../utils/prisma';
import { SCHEDULER_LIMITS } from '../../config/limits';


export class SyncScheduler {
    private static queue = QueueFactory.createQueue('scheduler');
    private static readonly MAINTENANCE_LOG_WINDOW_MS = 12 * 60 * 60 * 1000;

    /**
     * Check if an account has ≥3 consecutive failures in the last 30 minutes.
     * Used internally by the scheduler to gate dispatch.
     * See isAccountCircuitBroken for the public version.
     */
    private static async isAccountBlocked(accountId: string): Promise<boolean> {
        return SyncScheduler.isAccountCircuitBroken(accountId);
    }

    /**
     * isAccountCircuitBroken — public method for use by the sync health route.
     *
     * Why: Consecutive FAILED logs (no SUCCESS in between) in the last 30 min
     * indicates the WooCommerce store is persistently down. We open the circuit
     * to stop retry storms from exhausting the Node.js heap (OOM/exit 137).
     * Manual trigger syncs are excluded from the breaker — users can always force.
     */
    static async isAccountCircuitBroken(accountId: string, entityType?: string): Promise<boolean> {
        const CONSECUTIVE_FAILURE_THRESHOLD = 3;
        const WINDOW_MS = 30 * 60 * 1000; // 30 minutes

        try {
            const account = await prisma.account.findUnique({
                where: { id: accountId },
                select: { wooNeedsReconnect: true }
            });
            if (account?.wooNeedsReconnect) return true;

            const maintenanceDeferral = await this.getMaintenanceDeferral(accountId, entityType);
            if (maintenanceDeferral.isDeferred) return true;

            const since = new Date(Date.now() - WINDOW_MS);
            const recentLogs = await prisma.syncLog.findMany({
                where: {
                    accountId,
                    ...(entityType ? { entityType } : {}),
                    startedAt: { gte: since },
                    // Manual retries indicate user intent — exclude from breaker logic
                    triggerSource: { not: 'MANUAL' }
                },
                orderBy: { startedAt: 'desc' },
                take: CONSECUTIVE_FAILURE_THRESHOLD,
                select: { status: true }
            });

            if (recentLogs.length < CONSECUTIVE_FAILURE_THRESHOLD) return false;

            // All N most recent non-manual logs must be FAILED (no SUCCESS mixed in)
            return recentLogs
                .slice(0, CONSECUTIVE_FAILURE_THRESHOLD)
                .every(l => l.status === 'FAILED');
        } catch (err: any) {
            // Fail open — on DB error allow dispatch to avoid deadlocking all accounts
            Logger.warn('[SyncScheduler] Circuit breaker check failed — allowing dispatch', { accountId, error: err.message });
            return false;
        }
    }

    private static async getMaintenanceDeferral(accountId: string, entityType?: string): Promise<{ isDeferred: boolean; retryAt?: Date }> {
        const since = new Date(Date.now() - this.MAINTENANCE_LOG_WINDOW_MS);
        const latestFailure = await prisma.syncLog.findFirst({
            where: {
                accountId,
                status: 'FAILED',
                startedAt: { gte: since },
                ...(entityType ? { entityType } : {})
            },
            orderBy: { startedAt: 'desc' },
            select: {
                errorMessage: true,
                completedAt: true,
                startedAt: true
            }
        });

        const message = latestFailure?.errorMessage || '';
        const match = message.match(/maintenance mode(?:\.|.*)retry after (\d+)s/i);
        if (!match) return { isDeferred: false };

        const retryAfterSeconds = Number.parseInt(match[1], 10);
        if (!Number.isFinite(retryAfterSeconds) || retryAfterSeconds <= 0) {
            return { isDeferred: false };
        }

        const baseTime = latestFailure?.completedAt || latestFailure?.startedAt;
        if (!baseTime) return { isDeferred: false };

        const retryAt = new Date(baseTime.getTime() + retryAfterSeconds * 1000);
        return {
            isDeferred: retryAt.getTime() > Date.now(),
            retryAt
        };
    }

    /**
     * Register all sync-related repeatable jobs
     */
    static async register() {
        // Global Sync Orchestrator (Every 5 mins)
        await this.queue.add('orchestrate-sync', {}, {
            repeat: { pattern: SCHEDULER_LIMITS.FULL_SYNC_CRON },
            jobId: 'orchestrator'
        });
        Logger.info(`Scheduled Global Sync Orchestrator (${SCHEDULER_LIMITS.FULL_SYNC_CRON})`);

        // Fast Order Sync (Every 2 minutes)
        // Webhooks handle real-time order events; this is a safety-net
        // to catch anything webhooks miss.
        await this.queue.add('fast-order-sync', {}, {
            repeat: { every: SCHEDULER_LIMITS.FAST_SYNC_INTERVAL_MS },
            jobId: 'fast-order-sync'
        });
        Logger.info(`Scheduled Fast Order Sync (Every ${Math.floor(SCHEDULER_LIMITS.FAST_SYNC_INTERVAL_MS / 1000)} seconds)`);
    }

    /**
     * Dispatch sync jobs to all accounts
     */
    static async dispatchToAllAccounts() {
        const accounts = await prisma.account.findMany({ select: { id: true } });
        Logger.info(`Orchestrator: Dispatching sync for ${accounts.length} accounts`);

        const { SyncService } = await import('../sync');
        const service = new SyncService();

        for (const acc of accounts) {
            try {
                if (await this.isAccountBlocked(acc.id)) {
                    Logger.warn(`Orchestrator: Skipping account ${acc.id} due to circuit breaker`);
                    continue;
                }
                await service.runSync(acc.id, {
                    incremental: true,
                    priority: 1
                });
            } catch (err: any) {
                Logger.error(`Orchestrator: Failed to dispatch sync for account ${acc.id}`, { error: err.message });
            }
        }
    }

    /**
     * Fast Order Sync: Dispatches order-only sync for near-realtime order visibility.
     */
    static async dispatchFastOrderSync() {
        const accounts = await prisma.account.findMany({ select: { id: true } });
        Logger.info(`Fast Order Sync: Dispatching for ${accounts.length} accounts`);

        const { SyncService } = await import('../sync');
        const service = new SyncService();

        for (const acc of accounts) {
            try {
                if (await this.isAccountBlocked(acc.id)) {
                    Logger.warn(`Fast Order Sync: Skipping account ${acc.id} due to circuit breaker`);
                    continue;
                }
                await service.runSync(acc.id, {
                    types: ['orders'],
                    incremental: true,
                    priority: 1
                });
            } catch (err: any) {
                Logger.error(`Fast Order Sync: Failed to dispatch for account ${acc.id}`, { error: err.message });
            }
        }
    }
}
