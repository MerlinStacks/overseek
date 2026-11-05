import { randomUUID } from 'node:crypto';
import type { Job, Queue } from 'bullmq';
import { prisma } from '../../utils/prisma';
import { bomSyncJobIds, getBOMJobs, recoveryError } from './BOMSyncRecovery';
import { bomReviewFingerprint, isBOMJobReconciled } from './BOMReconciliationEvidence';
import { bomArchiveEvidence } from './BOMReconciliation';
import { commitBOMReview } from './BOMReviewCommit';
import { readBOMRepairResult } from './BOMRepairState';
import { hasUnsettledBOMProgress, requiresBOMJobReview } from './BOMJobOutcome';

export function bomRepairEligibility(jobs: { job: Job; state: string }[], accountId: string) {
    const repairId = bomSyncJobIds(accountId)[3];
    const sources = jobs.filter(({ job }) => job.id !== repairId);
    const previous = jobs.find(({ job }) => job.id === repairId);
    const sourceFingerprint = bomReviewFingerprint(sources);
    const previousResult = previous ? readBOMRepairResult(previous.job) : null;
    const priorConfirmationApplies = previous?.state === 'completed'
        && previous.job.data.bomRepair?.sourceFingerprint === sourceFingerprint
        && previous.job.data.bomRepair?.confirmedStoppedAndSettled === true;
    const sourceNeedsConfirmation = sources.some(({ job, state }) => (state === 'failed' || hasUnsettledBOMProgress(job)) && !isBOMJobReconciled(job));
    const previousNeedsConfirmation = Boolean(previous && (previous.state !== 'completed' || !previousResult || previousResult.uncertainWrites > 0));
    const blocked = jobs.some(({ job, state }) => requiresBOMJobReview(job, state, bomSyncJobIds(accountId).slice(2).includes(String(job.id))));
    const admissionClaimed = Boolean(previous?.job.data.bomRepairAdmissionClaim);
    return {
        sources, previous, sourceFingerprint,
        canStart: blocked && !admissionClaimed && jobs.every(({ state }) => ['failed', 'completed'].includes(state)),
        blockedReason: admissionClaimed
            ? 'A repair submission is still finishing or was interrupted while archiving its slot. Refresh status. If this persists, an administrator must verify that admission request has stopped before using manual review; do not reset the claim or delete the job.'
            : null,
        requiresStoppedConfirmation: (sourceNeedsConfirmation && !priorConfirmationApplies) || previousNeedsConfirmation
    };
}

export async function admitBOMRepair(queue: Queue, accountId: string, userId: string, input: { fingerprint: string; confirmedStoppedAndSettled: boolean }) {
    const jobs = await getBOMJobs(queue, accountId);
    if (bomReviewFingerprint(jobs) !== input.fingerprint) throw recoveryError('The run changed. Refresh repair details before trying again.', 'BOM_REPAIR_CHANGED');
    const eligibility = bomRepairEligibility(jobs, accountId);
    if (!eligibility.canStart) throw recoveryError(eligibility.blockedReason || 'Repair cannot start while BOM work is running, queued, or in an unknown state.', eligibility.blockedReason ? 'BOM_REPAIR_ADMISSION_PENDING' : 'BOM_REPAIR_NOT_STOPPED');
    if (eligibility.requiresStoppedConfirmation && !input.confirmedStoppedAndSettled) {
        throw recoveryError('The older run cannot prove its worker and pending writes have stopped. Confirm request settlement first; no catalogue-wide inventory review is needed.', 'BOM_REPAIR_SETTLEMENT_REQUIRED');
    }
    const jobId = bomSyncJobIds(accountId)[3];
    if (eligibility.previous) {
        const { job } = eligibility.previous;
        // Archive before reusing this slot. An atomic claim prevents concurrent
        // requests from deleting a newly admitted occurrence under the same ID.
        await prisma.auditLog.create({ data: {
            accountId, userId, action: 'BOM_REPAIR_ATTEMPT_ARCHIVED', resource: 'BOM_SYNC', resourceId: accountId,
            details: { executions: bomArchiveEvidence([eligibility.previous], accountId) }
        } });
        if (!await commitBOMReview(queue, job, { ...job.data, bomRepairAdmissionClaim: randomUUID() })) {
            throw recoveryError('Another request changed the repair slot. Refresh its status.', 'BOM_REPAIR_CHANGED');
        }
        await job.remove();
    }
    await queue.add(queue.name, { accountId, bomRepair: {
        sourceFingerprint: eligibility.sourceFingerprint, requestedBy: userId,
        confirmedStoppedAndSettled: true, requestedAt: new Date().toISOString()
    } }, { jobId, priority: 1, attempts: 1, removeOnComplete: false, removeOnFail: false });
    return { status: 'queued', jobId };
}
