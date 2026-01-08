import { prisma } from '../../utils/prisma';
import { WooService } from '../woo';
import { Logger } from '../../utils/logger';
import { SyncJobData } from '../queue/SyncQueue';


export abstract class BaseSync {

    protected abstract entityType: string;

    async perform(jobData: SyncJobData, job?: any): Promise<void> {
        const { accountId, incremental } = jobData;

        Logger.info(`Starting ${this.entityType} sync`, { accountId, incremental });

        const log = await this.createLog(accountId, this.entityType);

        try {
            const woo = await WooService.forAccount(accountId);
            await this.sync(woo, accountId, incremental || false, job);

            await this.updateLog(log.id, 'SUCCESS');
            await this.updateState(accountId, this.entityType);

        } catch (error: any) {
            Logger.error(`Sync Failed: ${this.entityType}`, { accountId, error: error.message });
            await this.updateLog(log.id, 'FAILED', error.message);
            throw error; // Bubble up to BullMQ for retry
        }
    }

    protected abstract sync(woo: WooService, accountId: string, incremental: boolean, job?: any): Promise<void>;

    // --- Helpers ---

    private async createLog(accountId: string, type: string) {
        return prisma.syncLog.create({
            data: { accountId, entityType: type, status: 'IN_PROGRESS' }
        });
    }

    private async updateLog(logId: string, status: 'SUCCESS' | 'FAILED', error?: string) {
        await prisma.syncLog.update({
            where: { id: logId },
            data: {
                status,
                errorMessage: error,
                completedAt: new Date(),
                // We'd ideally track itemsProcessed too, can add to BaseSync state if needed
            }
        });
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
        return state?.lastSyncedAt?.toISOString();
    }
}
