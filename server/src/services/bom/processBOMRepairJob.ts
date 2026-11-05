import type { Job, Queue } from 'bullmq';
import { prisma } from '../../utils/prisma';
import { BOMInventorySyncService } from '../BOMInventorySyncService';
import { PermissionService } from '../PermissionService';
import { assertJobLease, JobLeaseLostError } from '../queue/JobLease';
import { SyncCancellationService } from '../sync/SyncCancellationService';
import { bomSyncJobIds, getBOMJobs, recoveryError } from './BOMSyncRecovery';
import { bomExecutionFingerprint, bomReviewFingerprint } from './BOMReconciliationEvidence';
import { bomArchiveEvidence } from './BOMReconciliation';
import { commitBOMReview } from './BOMReviewCommit';
import { assertRepairComponentDefinitions, loadBOMRepairPlan, repairBOMSelection, repairDefinitionFingerprint, type RepairBOM } from './BOMRepairPlan';
import { targetKey, type BOMSyncCheckpoint } from './BOMSyncCheckpoint';
import type { BOMRepairResult } from './BOMRepairState';
import { describeBOMFailure } from './BOMFailureReason';

function repairIssue(error: unknown) {
    const text = error instanceof Error ? error.message : '';
    if (text.includes('BOM_REPAIR_TARGET_INVALID')) return { code: 'BOM_REPAIR_TARGET_INVALID', message: 'Check this target’s WooCommerce mapping and stock-management settings. Repair will not enable stock management or change a variation’s stock owner.' };
    if (text.includes('BOM_REPAIR_COMPONENT_INVALID') || /cross-account|parent mismatch|no BOM/i.test(text)) return { code: 'BOM_REPAIR_COMPONENT_INVALID', message: 'Check component mappings, quantities, waste factors and managed stock. Missing or invalid stock inputs were not guessed or treated as zero.' };
    if (text.includes('BOM_REPAIR_VERIFY_FAILED')) return { code: 'BOM_REPAIR_VERIFY_FAILED', message: 'The written stock could not be verified against fresh component stock. Check concurrent stock changes, then run repair again.' };
    if (text.includes('BOM_REPAIR_DEFINITION_CHANGED')) return { code: 'BOM_REPAIR_DEFINITION_CHANGED', message: 'This BOM changed during repair. Keep definitions stable and run repair again.' };
    if (text.includes('BOM_REPAIR_STOCK_UNSETTLED')) return { code: 'BOM_REPAIR_STOCK_UNSETTLED', message: 'Pending receipts, component deductions, legacy stock work or another stock cascade must finish first. Repair did not supersede those stock movements.' };
    return { code: 'BOM_REPAIR_PRODUCT_FAILED', message: describeBOMFailure(text) };
}

/** Fresh calculations in dependency order; source failures are never replayed. */
export async function processBOMRepairJob(job: Job, queue: Queue) {
    const accountId = job.data.accountId as string;
    const request = job.data.bomRepair;
    if (job.id !== bomSyncJobIds(accountId)[3] || typeof request?.requestedBy !== 'string'
        || request.confirmedStoppedAndSettled !== true || typeof job.processedOn !== 'number') throw new Error('Invalid BOM repair execution');
    if (job.data.bomManifest) throw new Error('An initialized repair must not be replayed. Start a freshly reviewed repair instead.');
    if (!await PermissionService.hasPermission(request.requestedBy, accountId, 'manage_inventory')) throw new Error('Inventory management permission is no longer available');

    const assertLease = async () => { await assertJobLease(job); await SyncCancellationService.assertNotRequested(job); };
    const assertSources = async () => {
        await assertLease();
        const sources = (await getBOMJobs(queue, accountId)).filter(entry => entry.job.id !== job.id);
        if (sources.some(({ state }) => !['failed', 'completed'].includes(state)) || bomReviewFingerprint(sources) !== request.sourceFingerprint) {
            throw recoveryError('Source jobs changed or new BOM work appeared. Repair stopped; refresh its details.', 'BOM_REPAIR_CHANGED');
        }
        return sources;
    };
    await assertSources();
    const plan = await loadBOMRepairPlan(accountId);
    const targets = [...plan.ordered, ...plan.blocked];
    const targetIndexes = new Map(targets.map((target, index) => [targetKey(target), index]));
    await job.updateData({ ...job.data, bomRepairDefinitionFingerprint: plan.fingerprint,
        bomManifest: { version: 1, targets: targets.map(({ productId, variationId }) => ({ productId, variationId })) } });
    const result: BOMRepairResult = {
        total: targets.length, checked: 0, repaired: 0, unchanged: 0, failed: 0, uncertainWrites: 0,
        issues: [], verified: false, processedOn: job.processedOn
    };
    const checkpoint: BOMSyncCheckpoint = { version: 1, nextIndex: 0, inFlightIndex: null, uncertainIndexes: [] };
    const blocked = new Set(plan.blocked.map(bom => bom.productId));
    const cycles = new Set(blocked);
    const saveProgress = () => job.updateProgress({
        current: result.checked, total: result.total, synced: result.repaired, skipped: result.unchanged, failed: result.failed,
        checkpoint: { ...checkpoint, uncertainIndexes: [...checkpoint.uncertainIndexes] },
        productFailures: result.issues.slice(0, 100).map(issue => ({ index: targetIndexes.get(targetKey(issue)), reason: issue.message }))
    });
    const fail = (bom: RepairBOM, code: string, message: string) => {
        result.failed++; blocked.add(bom.productId); checkpoint.uncertainIndexes.push(result.checked);
        result.issues.push({ productId: bom.productId, variationId: bom.variationId, name: bom.product.name, sku: bom.product.sku, code, message });
    };
    await saveProgress();
    for (const bom of targets) {
        await assertSources();
        const dependencyBlocked = bom.items.some(item => item.childProductId && blocked.has(item.childProductId));
        if (cycles.has(bom.productId)) {
            fail(bom, 'BOM_REPAIR_CYCLE', 'A dependency cycle, or a dependency on that cycle, prevents a safe calculation. Fix the linked BOM graph.');
        } else if (blocked.has(bom.productId) || dependencyBlocked) {
            fail(bom, 'BOM_REPAIR_DEPENDENCY', 'Another variation or component BOM needs attention. Its dependent stock was not overwritten.');
        } else {
            checkpoint.inFlightIndex = result.checked;
            await saveProgress();
            const beforeWrite = async () => {
                await assertSources();
                const current = await prisma.bOM.findUnique({ where: { productId_variationId: { productId: bom.productId, variationId: bom.variationId } }, select: repairBOMSelection });
                if (!current || repairDefinitionFingerprint(current) !== plan.definitions.get(targetKey(bom))) throw new Error('BOM_REPAIR_DEFINITION_CHANGED');
            };
            try {
                assertRepairComponentDefinitions(bom);
                const outcome = await BOMInventorySyncService.syncProductToWoo(accountId, bom.productId, bom.variationId, { requireLiveStock: true, repairMode: true, beforeWrite });
                if (outcome.success !== true) {
                    const issue = repairIssue(new Error(outcome.error));
                    fail(bom, issue.code, issue.message);
                    if (outcome.writeUncertain) result.uncertainWrites++;
                } else if (outcome.localDbUpdated === true) result.unchanged++;
                else result.repaired++;
            } catch (error) {
                if (error instanceof JobLeaseLostError || SyncCancellationService.isCancellation(error)
                    || (error as { code?: string }).code === 'BOM_REPAIR_CHANGED') throw error;
                // The sync helper reports provider write errors as outcomes. Errors
                // escaping it occur before a write, unless lease ownership is lost.
                const issue = repairIssue(error); fail(bom, issue.code, issue.message);
            }
        }
        result.checked++; checkpoint.nextIndex = result.checked; checkpoint.inFlightIndex = null;
        await saveProgress();
    }
    const sources = await assertSources();
    if ((await loadBOMRepairPlan(accountId)).fingerprint !== plan.fingerprint) throw new Error('BOM_REPAIR_DEFINITION_CHANGED: definitions changed; source jobs remain blocked');
    if (!await PermissionService.hasPermission(request.requestedBy, accountId, 'manage_inventory')) throw new Error('Inventory management permission is no longer available');
    const archiveDetails = {
        repairJobId: job.id, sourceFingerprint: request.sourceFingerprint, definitionFingerprint: plan.fingerprint,
        sourceStoppedAndSettled: true, verification: 'fresh_woo_and_internal_stock_with_write_ack_and_readback',
        manifest: job.data.bomManifest, result: JSON.parse(JSON.stringify(result)),
        releasePending: result.failed === 0, executions: bomArchiveEvidence(sources, accountId)
    };
    const audit = await prisma.auditLog.create({ data: {
        accountId, userId: request.requestedBy,
        action: result.failed ? 'BOM_REPAIR_EXCEPTIONS' : 'BOM_INVENTORY_AUTO_REPAIRED', resource: 'BOM_SYNC', resourceId: accountId,
        details: archiveDetails
    } });
    await assertSources();
    if ((await loadBOMRepairPlan(accountId)).fingerprint !== plan.fingerprint) throw new Error('BOM_REPAIR_DEFINITION_CHANGED: definitions changed during archival; source jobs remain blocked');
    if (result.failed === 0) {
        for (const { job: source } of sources) {
            await assertLease();
            if (!await commitBOMReview(queue, source, { ...source.data, bomReconciliation: {
                auditId: audit.id, fingerprint: bomExecutionFingerprint(source), reviewedBy: request.requestedBy,
                reviewedAt: new Date().toISOString(), mode: 'AUTOMATIC_REPAIR'
            } })) throw new Error('BOM_REPAIR_CHANGED: source occurrence changed during finalization');
        }
        result.verified = true;
    }
    result.auditId = audit.id;
    await assertLease();
    if (result.verified) {
        // Preserve the final verified report in the database before its reusable
        // Redis slot can ever be cleaned up by a subsequent ordinary admission.
        await prisma.auditLog.update({ where: { id: audit.id }, data: {
            details: { ...archiveDetails, releasePending: false, result }
        } });
        await assertLease();
        if ((await loadBOMRepairPlan(accountId)).fingerprint !== plan.fingerprint) throw new Error('BOM_REPAIR_DEFINITION_CHANGED: definitions changed during final persistence; repair approval was not published');
    }
    await job.updateData({ ...job.data, bomRepairResult: result });
    // Exceptions are a completed *repair report*, not approval of the old run.
    // They stay visible and block ordinary bulk replay until resolved.
    return result;
}
