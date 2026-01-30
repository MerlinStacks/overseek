/**
 * Sync Scheduler
 * 
 * Handles all WooCommerce sync-related scheduling:
 * - Global sync orchestrator (5 min)
 * - Fast order sync (30 sec)
 */
import { QueueFactory } from '../queue/QueueFactory';
import { Logger } from '../../utils/logger';
import { prisma } from '../../utils/prisma';

export class SyncScheduler {
    private static queue = QueueFactory.createQueue('scheduler');

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

        // Fast Order Sync (Every 30 seconds)
        await this.queue.add('fast-order-sync', {}, {
            repeat: { every: 30000 },
            jobId: 'fast-order-sync'
        });
        Logger.info('Scheduled Fast Order Sync (Every 30 seconds)');
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
            await service.runSync(acc.id, {
                types: ['orders'],
                incremental: true,
                priority: 1
            });
        }
    }
}
