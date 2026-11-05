import type { Queue } from 'bullmq';
import { prisma } from '../../utils/prisma';
import { bomRunningStates, bomSyncJobIds, getBOMJobs } from './BOMSyncRecovery';
import { readBOMCheckpoint } from './BOMSyncCheckpoint';
import { bomReviewFingerprint, isBOMJobReconciled } from './BOMReconciliationEvidence';
import { describeBOMFailure } from './BOMFailureReason';
import { bomRepairEligibility } from './BOMRepairAdmission';
import { readBOMRepairResult } from './BOMRepairState';
import { hasUnsettledBOMProgress, requiresBOMJobReview } from './BOMJobOutcome';

/** Read-only, bounded diagnostics. Never reconstruct product identity from counters. */
export async function getBOMSyncDiagnostics(queue: Queue, accountId: string) {
    const allJobs = await getBOMJobs(queue, accountId);
    const jobs = allJobs.filter(({ state, job }) => !bomRunningStates.includes(state)
        && requiresBOMJobReview(job, state, bomSyncJobIds(accountId).slice(2).includes(String(job.id))));
    const runs = jobs.map(({ job, state }) => {
        const snapshot = readBOMCheckpoint(job.data, job.progress);
        const indexes = snapshot ? [...new Set([
            ...snapshot.checkpoint.uncertainIndexes,
            ...(snapshot.checkpoint.inFlightIndex === null ? [] : [snapshot.checkpoint.inFlightIndex])
        ])] : [];
        const progress = job.progress as { productFailures?: { index: number; reason: string }[] } | null;
        return {
            jobId: String(job.id), state,
            finishedAt: job.finishedOn ? new Date(job.finishedOn).toISOString() : null,
            cause: state === 'completed' && hasUnsettledBOMProgress(job)
                ? 'The previous worker reported failed or unfinished products even though its queue job was marked completed. Their stock outcomes still need verification.'
                : describeBOMFailure(job.failedReason),
            hasCheckpoint: Boolean(snapshot), affectedCount: indexes.length,
            products: indexes.slice(0, 100).map(index => ({
                ...snapshot!.targets[index],
                reason: index === snapshot!.checkpoint.inFlightIndex
                    ? 'Interrupted while processing this product; the outcome of its stock write is unknown.'
                    : describeBOMFailure(Array.isArray(progress?.productFailures)
                        ? progress.productFailures.find(failure => failure.index === index)?.reason : undefined)
            }))
        };
    });
    const ids = [...new Set(runs.flatMap(run => run.products.map(product => product.productId)))];
    const products = ids.length ? await prisma.wooProduct.findMany({
        where: { accountId, id: { in: ids } }, select: { id: true, name: true, sku: true }
    }) : [];
    const byId = new Map(products.map(product => [product.id, product]));
    const repair = bomRepairEligibility(allJobs, accountId);
    return { fingerprint: bomReviewFingerprint(allJobs),
        repair: { canStart: repair.canStart, requiresStoppedConfirmation: repair.requiresStoppedConfirmation, ...(repair.blockedReason ? { blockedReason: repair.blockedReason } : {}) },
        repairResult: repair.previous && !isBOMJobReconciled(repair.previous.job) ? readBOMRepairResult(repair.previous.job) : null,
        canReconcile: (jobs.length > 0 || repair.canStart) && allJobs.every(({ state }) => ['failed', 'completed'].includes(state)), runs: runs.map(run => ({ ...run, products: run.products.map(product => ({
        ...product, name: byId.get(product.productId)?.name ?? 'Product no longer available in this account',
        sku: byId.get(product.productId)?.sku ?? null,
        available: byId.has(product.productId)
    })) })) };
}
