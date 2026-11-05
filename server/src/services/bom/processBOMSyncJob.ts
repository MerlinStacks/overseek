import type { Job } from 'bullmq';
import { BOMInventorySyncService } from '../BOMInventorySyncService';
import { SyncCancellationService } from '../sync/SyncCancellationService';
import { assertJobLease } from '../queue/JobLease';
import { QueueFactory, QUEUES } from '../queue/QueueFactory';
import { Logger } from '../../utils/logger';
import { buildBOMRecoveryPlan, bomSyncJobIds } from './BOMSyncRecovery';
import type { BOMSyncTarget } from './BOMSyncCheckpoint';

export async function processBOMSyncJob(job: Job) {
    const { accountId } = job.data;
    try {
        if (typeof accountId !== 'string' || !accountId || accountId.length > 128) throw new Error('BOM worker requires a valid account scope');
        await SyncCancellationService.assertNotRequested(job);
        await assertJobLease(job);
        if (job.data.bomRepair) {
            const { processBOMRepairJob } = await import('./processBOMRepairJob');
            await processBOMRepairJob(job, QueueFactory.getQueue(QUEUES.BOM_SYNC));
            return;
        }
        let targets: BOMSyncTarget[] | undefined;
        if (job.data.bomRecovery) {
            if (job.id !== bomSyncJobIds(accountId)[2]) throw new Error('Invalid BOM recovery job identity');
            const plan = await buildBOMRecoveryPlan(QueueFactory.getQueue(QUEUES.BOM_SYNC), accountId, job.id);
            if (plan.fingerprint !== job.data.bomRecovery.fingerprint) throw new Error('BOM recovery evidence or dependencies changed; review again');
            targets = plan.targets;
            if (!targets.length) throw new Error('No unaffected BOM products remain');
        }
        const result = await BOMInventorySyncService.syncAllBOMProducts(accountId, job, { assertLease: () => assertJobLease(job), targets });
        Logger.info('[BOM Worker] Finished BOM sync', { accountId, synced: result.synced, skipped: result.skipped, failed: result.failed });
        // Product-level failures may include acknowledged writes followed by an
        // audit/DB failure. Do not mark those runs replayable by normal admission.
        if (result.failed > 0) throw new Error('BOM run finished with uncertain products; retain checkpoints for reconciliation');
    } finally {
        await SyncCancellationService.clear(job.queueName, String(job.id));
    }
}
