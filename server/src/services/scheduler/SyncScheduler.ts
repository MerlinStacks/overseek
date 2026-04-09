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


export class SyncScheduler {
    private static queue = QueueFactory.createQueue('scheduler');

    /**
     * Check if an account has ≥5 consecutive failures in the last 90 minutes.
     * Used internally by the scheduler to gate dispatch.
     * See isAccountCircuitBroken for the public version.
     */
    private static async isAccountBlocked(accountId: string): Promise<boolean> {
        return SyncScheduler.isAccountCircuitBroken(accountId);
    }

    /**
     * isAccountCircuitBroken — public method for use by the sync health route.
     *
     * Why: Consecutive FAILED logs (no SUCCESS in between) in the last 90 min
     * indicates the WooCommerce store is persistently down. We open the circuit
     * to stop retry storms from exhausting the Node.js heap (OOM/exit 137).
     * Manual trigger syncs are excluded from the breaker — users can always force.
     */
    static async isAccountCircuitBroken(accountId: string, entityType?: string): Promise<boolean> {
        const CONSECUTIVE_FAILURE_THRESHOLD = 5;
        const WINDOW_MS = 90 * 60 * 1000; // 90 minutes

        try {
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
                take: CONSECUTIVE_FAILURE_THRESHOLD + 1,
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

    /**
     * Register all sync-related repeatable jobs
     */
    static async register() {
        // Global Sync Orchestrator (Every 5 mins)
        await this.queue.add('orchestrate-sync', {}, {
            repeat: { pattern: '*/5 * * * *' },
            jobId: 'orchestrator'
        });
        Logger.info('Scheduled Global Sync Orchestrator (Every 5 mins)');

        // Fast Order Sync (Every 2 minutes)
        // Webhooks handle real-time order events; this is a safety-net
        // to catch anything webhooks miss.
        await this.queue.add('fast-order-sync', {}, {
            repeat: { every: 120000 },
            jobId: 'fast-order-sync'
        });
        Logger.info('Scheduled Fast Order Sync (Every 2 minutes)');
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
            if (await this.isAccountBlocked(acc.id)) {
                Logger.warn(`Orchestrator: Skipping account ${acc.id} due to circuit breaker`);
                continue;
            }
            await service.runSync(acc.id, {
                incremental: true,
                priority: 1
            });
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
            if (await this.isAccountBlocked(acc.id)) {
                Logger.warn(`Fast Order Sync: Skipping account ${acc.id} due to circuit breaker`);
                continue;
            }
            await service.runSync(acc.id, {
                types: ['orders'],
                incremental: true,
                priority: 1
            });
        }
    }
}
