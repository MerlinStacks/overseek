import { prisma } from '../../utils/prisma';
import { WooService } from '../woo';
import { Logger } from '../../utils/logger';
import { SyncJobData } from '../queue/SyncQueue';
import { randomUUID } from 'crypto';
import { EventBus, EVENTS } from '../events';

/** Result returned from sync operations for observability */
export interface SyncResult {
    itemsProcessed: number;
    itemsDeleted?: number;
}

/**
 * Emit sync status via Socket.IO if available.
 * Uses dynamic import to avoid circular dependencies.
 */
async function emitSyncEvent(event: string, data: any) {
    try {
        const { getIO } = await import('../../socket');
        const io = getIO();
        if (io) {
            io.to(`account:${data.accountId}`).emit(event, data);
        }
    } catch {
        // Socket not initialized yet (startup) - ignore
    }
}

export abstract class BaseSync {

    protected abstract entityType: string;

    async perform(jobData: SyncJobData, job?: any): Promise<void> {
        const { accountId, incremental } = jobData;
        const syncId = randomUUID().slice(0, 8); // Short correlation ID
        const retryCount = job?.attemptsMade || 0;

        Logger.info(`Starting ${this.entityType} sync`, { accountId, incremental, syncId });

        // Emit sync started event
        await emitSyncEvent('sync:started', { accountId, type: this.entityType, syncId });

        const log = await this.createLog(accountId, this.entityType, jobData.triggerSource, retryCount);

        try {
            const woo = await WooService.forAccount(accountId);
            const result = await this.sync(woo, accountId, incremental || false, job, syncId);

            await this.updateLog(log.id, 'SUCCESS', undefined, result.itemsProcessed, retryCount);
            await this.updateState(accountId, this.entityType);

            Logger.info(`Sync Complete: ${this.entityType}`, {
                accountId,
                syncId,
                itemsProcessed: result.itemsProcessed,
                itemsDeleted: result.itemsDeleted || 0
            });

            // Emit sync completed event
            await emitSyncEvent('sync:completed', {
                accountId,
                type: this.entityType,
                syncId,
                itemsProcessed: result.itemsProcessed,
                status: 'SUCCESS'
            });

        } catch (error: any) {
            Logger.error(`Sync Failed: ${this.entityType}`, { accountId, syncId, error: error.message });
            await this.updateLog(log.id, 'FAILED', error.message, undefined, retryCount);
            await this.maybeEmitFailureAlert(accountId, this.entityType, error.message);

            // Emit sync failed event
            await emitSyncEvent('sync:completed', {
                accountId,
                type: this.entityType,
                syncId,
                status: 'FAILED',
                error: error.message
            });

            throw error; // Bubble up to BullMQ for retry
        }
    }

    protected abstract sync(woo: WooService, accountId: string, incremental: boolean, job?: any, syncId?: string): Promise<SyncResult>;

    // --- Helpers ---

    private async createLog(accountId: string, type: string, triggerSource?: string, retryCount: number = 0) {
        return prisma.syncLog.create({
            data: {
                accountId,
                entityType: type,
                status: 'IN_PROGRESS',
                triggerSource: triggerSource || 'SYSTEM',
                retryCount
            }
        });
    }

    private async updateLog(
        logId: string,
        status: 'SUCCESS' | 'FAILED',
        error?: string,
        itemsProcessed?: number,
        retryCount: number = 0
    ) {
        await prisma.syncLog.update({
            where: { id: logId },
            data: {
                status,
                errorMessage: error,
                completedAt: new Date(),
                itemsProcessed: itemsProcessed || 0,
                retryCount
            }
        });
    }

    private async maybeEmitFailureAlert(accountId: string, entityType: string, lastError?: string) {
        try {
            const since = new Date(Date.now() - 24 * 60 * 60 * 1000);
            const failureCount = await prisma.syncLog.count({
                where: {
                    accountId,
                    entityType,
                    status: 'FAILED',
                    startedAt: { gte: since }
                }
            });

            if (failureCount < 3) return;

            // Use SyncLog to check if we already have recent failures (dedup check)
            // If we have exactly 3 failures, emit the alert; otherwise skip to prevent spam
            if (failureCount !== 3) return;

            EventBus.emit(EVENTS.SYNC.FAILURE_THRESHOLD, {
                accountId,
                entityType,
                failureCount,
                lastError
            });
        } catch (error: any) {
            Logger.warn('Failed to emit sync failure alert', { accountId, entityType, error: error.message });
        }
    }

    protected async updateState(accountId: string, type: string) {
        await prisma.syncState.upsert({
            where: { accountId_entityType: { accountId, entityType: type } },
            update: { lastSyncedAt: new Date(), updatedAt: new Date() },
            create: { accountId, entityType: type, lastSyncedAt: new Date() }
        });
    }

    protected async getLastSync(accountId: string): Promise<string | undefined> {
        const state = await prisma.syncState.findUnique({
            where: { accountId_entityType: { accountId, entityType: this.entityType } }
        });
        if (!state?.lastSyncedAt) return undefined;

        // Add 5-minute buffer for incremental syncs to handle clock skew/API delays
        const bufferedDate = new Date(state.lastSyncedAt.getTime() - 5 * 60 * 1000);
        return bufferedDate.toISOString();
    }
}
