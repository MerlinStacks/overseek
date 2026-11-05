import { createHash } from 'node:crypto';
import type { Job } from 'bullmq';

/** Bind a review to an execution, never merely a reusable BullMQ job ID. */
export function bomExecutionEvidence(job: Job) {
    return {
        id: job.id, accountId: job.data?.accountId,
        timestamp: job.timestamp, processedOn: job.processedOn, finishedOn: job.finishedOn,
        attemptsMade: job.attemptsMade, failedReason: job.failedReason,
        manifest: job.data?.bomManifest, recovery: job.data?.bomRecovery, repair: job.data?.bomRepair,
        repairResult: job.data?.bomRepairResult, repairDefinitionFingerprint: job.data?.bomRepairDefinitionFingerprint, progress: job.progress
    };
}

export function bomExecutionFingerprint(job: Job) {
    return createHash('sha256').update(JSON.stringify(bomExecutionEvidence(job))).digest('hex');
}

export function isBOMJobReconciled(job: Job) {
    const review = job.data?.bomReconciliation;
    return typeof review?.auditId === 'string' && review.auditId.length > 0
        && review.fingerprint === bomExecutionFingerprint(job);
}

export function bomReviewFingerprint(jobs: { job: Job; state: string }[]) {
    return createHash('sha256').update(JSON.stringify(jobs.map(({ job, state }) => ({
        fingerprint: bomExecutionFingerprint(job), state,
        reconciliation: job.data?.bomReconciliation ?? null
    })))).digest('hex');
}
