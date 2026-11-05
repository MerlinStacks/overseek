import type { Job } from 'bullmq';
import { isBOMJobReconciled } from './BOMReconciliationEvidence';
import { isVerifiedBOMRepair } from './BOMRepairState';

/** Older workers could complete the queue job despite failed product writes. */
export function hasUnsettledBOMProgress(job: Pick<Job, 'progress'>): boolean {
    if (!job.progress || typeof job.progress !== 'object') return false;
    const progress = job.progress as { failed?: unknown; checkpoint?: { inFlightIndex?: unknown; uncertainIndexes?: unknown } };
    const failed = Number(progress.failed ?? 0);
    if (!Number.isSafeInteger(failed) || failed !== 0) return true;
    const checkpoint = progress.checkpoint;
    if (checkpoint !== undefined && checkpoint !== null && typeof checkpoint !== 'object') return true;
    if (checkpoint?.uncertainIndexes !== undefined && !Array.isArray(checkpoint.uncertainIndexes)) return true;
    return Boolean(checkpoint && ((checkpoint.inFlightIndex !== undefined && checkpoint.inFlightIndex !== null)
        || (Array.isArray(checkpoint.uncertainIndexes) && checkpoint.uncertainIndexes.length > 0)));
}

export function requiresBOMJobReview(job: Job, state: string, specialSlot = false): boolean {
    if (!['failed', 'completed'].includes(state)) return true;
    if (isBOMJobReconciled(job) || (state === 'completed' && isVerifiedBOMRepair(job))) return false;
    return state === 'failed' || specialSlot || hasUnsettledBOMProgress(job);
}
