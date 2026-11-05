import type { Job, Queue } from 'bullmq';
import { prisma } from '../../utils/prisma';
import { bomSyncJobIds, getBOMJobs, recoveryError } from './BOMSyncRecovery';
import { bomExecutionEvidence, bomExecutionFingerprint, bomReviewFingerprint } from './BOMReconciliationEvidence';
import { describeBOMFailure } from './BOMFailureReason';
import { bomManifestSchema, readBOMCheckpoint } from './BOMSyncCheckpoint';
import { commitBOMReview } from './BOMReviewCommit';
import { readBOMRepairResult } from './BOMRepairState';
import { requiresBOMJobReview } from './BOMJobOutcome';

export interface BOMInventoryReview {
    fingerprint: string;
    notes: string;
    confirmedStoppedAndSettled: true;
    confirmedInventoryReviewed: true;
}

export function bomArchiveEvidence(jobs: { job: Job; state: string }[], accountId: string) {
    const archive = JSON.parse(JSON.stringify(jobs.map(({ job, state }) => {
        const evidence = bomExecutionEvidence(job);
        const manifest = bomManifestSchema.safeParse(evidence.manifest);
        if (evidence.manifest !== undefined && !manifest.success) {
            throw recoveryError('The retained manifest is malformed. Preserve it for a separately reviewed administrative archive.');
        }
        const snapshot = readBOMCheckpoint(job.data, job.progress);
        const progress = job.progress && typeof job.progress === 'object' ? job.progress as Record<string, unknown> : {};
        const counters = Object.fromEntries(['current', 'total', 'synced', 'skipped', 'failed'].map(key => [key,
            typeof progress[key] === 'number' && Number.isFinite(progress[key]) ? progress[key] : null]));
        return {
            state, id: evidence.id, accountId, timestamp: evidence.timestamp,
            processedOn: evidence.processedOn, finishedOn: evidence.finishedOn, attemptsMade: evidence.attemptsMade,
            evidenceFingerprint: bomExecutionFingerprint(job), failedReason: describeBOMFailure(evidence.failedReason),
            manifest: manifest.success ? manifest.data : null,
            progress: { ...counters, checkpoint: snapshot?.checkpoint ?? null,
                productFailures: Array.isArray(progress.productFailures) ? progress.productFailures.slice(0, 100)
                    .filter(failure => failure && Number.isInteger(failure.index) && failure.index >= 0)
                    .map(failure => ({ index: failure.index, reason: describeBOMFailure(failure.reason) })) : [] },
            recovery: Boolean(evidence.recovery),
            repairResult: readBOMRepairResult(job),
            repairSourceFingerprint: typeof evidence.repair?.sourceFingerprint === 'string' && /^[a-f0-9]{64}$/.test(evidence.repair.sourceFingerprint) ? evidence.repair.sourceFingerprint : null,
            repairDefinitionFingerprint: typeof evidence.repairDefinitionFingerprint === 'string' && /^[a-f0-9]{64}$/.test(evidence.repairDefinitionFingerprint) ? evidence.repairDefinitionFingerprint : null
        };
    })));
    if (Buffer.byteLength(JSON.stringify(archive)) > 8 * 1024 * 1024) {
        throw recoveryError('Retained evidence exceeds the review limit. Ask an administrator to archive it through a separately reviewed procedure.');
    }
    return archive;
}

/** Archive first; release only these exact executions. No stock writes or job deletion. */
export async function reconcileBOMInventory(queue: Queue, accountId: string, userId: string, review: BOMInventoryReview) {
    const jobs = await getBOMJobs(queue, accountId);
    if (!jobs.length || jobs.some(({ state }) => !['failed', 'completed'].includes(state))) {
        throw recoveryError('All BOM jobs must be stopped and terminal before inventory review can be completed.', 'BOM_REVIEW_NOT_STOPPED');
    }
    if (bomReviewFingerprint(jobs) !== review.fingerprint) {
        throw recoveryError('The retained run changed. Refresh the details and review again.', 'BOM_REVIEW_CHANGED');
    }
    const blocked = jobs.filter(({ job, state }) => requiresBOMJobReview(job, state, bomSyncJobIds(accountId).slice(2).includes(String(job.id))));
    if (!blocked.length) throw recoveryError('No unreconciled run remains. Refresh sync status.', 'BOM_REVIEW_CHANGED');

    // AuditService.log intentionally swallows errors; this safety-critical archive must not.
    const archive = bomArchiveEvidence(jobs, accountId);
    const audit = await prisma.auditLog.create({ data: {
        accountId, userId, action: 'BOM_INVENTORY_RECONCILED', resource: 'BOM_SYNC', resourceId: accountId,
        details: { ...review, executions: archive }
    } });
    const current = await getBOMJobs(queue, accountId);
    if (bomReviewFingerprint(current) !== review.fingerprint) {
        throw recoveryError('The run changed while its evidence was archived. No new review was applied; refresh and inspect it again.', 'BOM_REVIEW_CHANGED');
    }
    for (const { job } of blocked) {
        const committed = await commitBOMReview(queue, job, { ...job.data, bomReconciliation: {
            auditId: audit.id, fingerprint: bomExecutionFingerprint(job), reviewedBy: userId,
            reviewedAt: new Date().toISOString()
        } });
        if (!committed) throw recoveryError('An execution changed before its review could be applied. Refresh run details; archived evidence is preserved.', 'BOM_REVIEW_CHANGED');
    }
    return { success: true, auditId: audit.id };
}
