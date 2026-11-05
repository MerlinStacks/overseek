import { createHash } from 'node:crypto';
import type { Job, Queue } from 'bullmq';
import { prisma } from '../../utils/prisma';
import { readBOMCheckpoint, targetKey, MAX_BOM_SYNC_TARGETS, type BOMSyncTarget } from './BOMSyncCheckpoint';
import { isBOMJobReconciled } from './BOMReconciliationEvidence';
import { hasUnsettledBOMProgress } from './BOMJobOutcome';

export const bomRunningStates = ['active', 'waiting', 'delayed', 'prioritized', 'waiting-children'];
export function bomSyncJobIds(accountId: string) {
    const suffix = accountId.replace(/:/g, '_');
    return [`bom_sync_${suffix}`, `sync_bom_${suffix}`, `bom_recovery_${suffix}`, `bom_repair_${suffix}`];
}

export function recoveryError(message: string, code = 'BOM_RECOVERY_UNAVAILABLE') {
    return Object.assign(new Error(message), { statusCode: 409, code });
}

export async function getBOMJobs(queue: Queue, accountId: string) {
    const jobs: { job: Job; state: string }[] = [];
    for (const id of bomSyncJobIds(accountId)) {
        const job = await queue.getJob(id);
        if (!job) continue;
        if (job.data?.accountId !== accountId) throw recoveryError('BOM job ownership could not be verified.');
        jobs.push({ job, state: await job.getState() });
    }
    return jobs;
}

/** Passive, local-only observation. Never infers target identity from a counter. */
export async function buildBOMRecoveryPlan(queue: Queue, accountId: string, executingRecoveryId?: string) {
    const observed = (await getBOMJobs(queue, accountId)).filter(({ job }) => job.id !== executingRecoveryId);
    if (observed.some(({ state }) => bomRunningStates.includes(state))) throw recoveryError('A BOM sync is still running or queued.');
    const jobs = observed.filter(({ job }) => !isBOMJobReconciled(job));
    if (jobs.some(({ job }) => bomSyncJobIds(accountId).slice(2).includes(String(job.id)))) {
        throw recoveryError('A continuation or repair has already been attempted. Review its retained results and use Repair & resume rather than replaying its targets.');
    }
    const failed = jobs.filter(({ job, state }) => state === 'failed' || hasUnsettledBOMProgress(job));
    if (!failed.length || jobs.some(({ state }) => !['completed', 'failed'].includes(state))) {
        throw recoveryError('No stable failed BOM run is available for continuation.');
    }
    const snapshots = failed.map(({ job }) => ({ job, snapshot: readBOMCheckpoint(job.data, job.progress) }));
    if (snapshots.some(({ snapshot }) => !snapshot)) {
        throw recoveryError('This older run has no reliable per-product checkpoint. Its remaining products cannot be identified safely; inventory review is required.', 'BOM_RECOVERY_LEGACY_CHECKPOINT');
    }
    if (snapshots.some(({ job }) => !job.id || ![job.timestamp, job.processedOn, job.finishedOn].every(value => typeof value === 'number' && Number.isSafeInteger(value) && value > 0))) {
        throw recoveryError('The failed execution identity is incomplete. Preserve the job for inventory review.');
    }

    let candidates: BOMSyncTarget[] | null = null;
    const uncertainProducts = new Set<string>();
    for (const { snapshot } of snapshots) {
        const { targets, checkpoint } = snapshot!;
        const uncertain = new Set(checkpoint.uncertainIndexes);
        if (checkpoint.inFlightIndex !== null) uncertain.add(checkpoint.inFlightIndex);
        for (const index of uncertain) uncertainProducts.add(targets[index].productId);
        const pending = targets.filter((_, index) => index >= checkpoint.nextIndex && index !== checkpoint.inFlightIndex);
        const keys = new Set(pending.map(targetKey));
        candidates = candidates === null ? pending : candidates.filter(target => keys.has(targetKey(target)));
    }

    // Quarantine downstream dependencies too; a different variation of an uncertain
    // product is conservatively excluded. New/removed BOMs are never added to a run.
    const boms = await prisma.bOM.findMany({
        where: { product: { accountId } },
        select: { productId: true, variationId: true, items: { where: { isActive: true }, select: { childProductId: true } } },
        take: MAX_BOM_SYNC_TARGETS + 1
    });
    if (boms.length > MAX_BOM_SYNC_TARGETS) throw recoveryError('BOM recovery exceeds the bounded review limit.');
    const affected = new Set(uncertainProducts);
    const dependents = new Map<string, Set<string>>();
    for (const bom of boms) for (const item of bom.items) {
        if (!item.childProductId) continue;
        const parents = dependents.get(item.childProductId) ?? new Set<string>();
        parents.add(bom.productId);
        dependents.set(item.childProductId, parents);
    }
    const pendingAffected = [...affected];
    for (let index = 0; index < pendingAffected.length; index++) {
        for (const parent of dependents.get(pendingAffected[index]) ?? []) {
            if (!affected.has(parent)) { affected.add(parent); pendingAffected.push(parent); }
        }
    }
    const current = new Set(boms.map(targetKey));
    const targets = (candidates ?? []).filter(target => current.has(targetKey(target)) && !affected.has(target.productId));
    const fingerprint = createHash('sha256').update(JSON.stringify({
        accountId,
        sources: snapshots.map(({ job }) => ({ id: job.id, timestamp: job.timestamp, processedOn: job.processedOn, finishedOn: job.finishedOn, failedReason: job.failedReason, manifest: job.data.bomManifest, progress: job.progress })),
        targets,
        graph: boms.map(bom => ({ productId: bom.productId, variationId: bom.variationId, children: bom.items.map(item => item.childProductId).sort() }))
            .sort((a, b) => targetKey(a).localeCompare(targetKey(b)))
    })).digest('hex');
    return {
        fingerprint, targets,
        sourceJobIds: failed.map(({ job }) => String(job.id)),
        eligibleProducts: targets.length,
        uncertainProducts: uncertainProducts.size,
        excludedProducts: (candidates?.length ?? 0) - targets.length
    };
}
