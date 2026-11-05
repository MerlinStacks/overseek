/**
 * BOM Inventory Sync Routes
 * 
 * Handles BOM-based inventory synchronization with WooCommerce.
 * Extracted from inventory.ts for maintainability.
 */

import { FastifyPluginAsync } from 'fastify';
import { prisma } from '../../utils/prisma';
import { requireAuthFastify } from '../../middleware/auth';
import { Logger } from '../../utils/logger';
import { BOMInventorySyncService, localBOMItems } from '../../services/BOMInventorySyncService';
import { z } from 'zod';
import { PermissionService } from '../../services/PermissionService';
import { bomSyncJobIds, buildBOMRecoveryPlan, bomRunningStates, getBOMJobs } from '../../services/bom/BOMSyncRecovery';
import { getBOMSyncDiagnostics } from '../../services/bom/BOMSyncDiagnostics';
import { isBOMJobReconciled } from '../../services/bom/BOMReconciliationEvidence';
import { reconcileBOMInventory } from '../../services/bom/BOMReconciliation';
import { admitBOMRepair } from '../../services/bom/BOMRepairAdmission';
import { isVerifiedBOMRepair, readBOMRepairResult } from '../../services/bom/BOMRepairState';
import { requiresBOMJobReview } from '../../services/bom/BOMJobOutcome';

const variationQuerySchema = z.object({
    variationId: z.coerce.number().int().nonnegative().default(0)
});

const limitQuerySchema = z.object({
    limit: z.coerce.number().int().positive().max(100).default(50)
});

const runningJobStates = bomRunningStates;
const bomJobIds = bomSyncJobIds;
const recoverySchema = z.object({
    fingerprint: z.string().regex(/^[a-f0-9]{64}$/),
    confirmedStoppedAndSettled: z.literal(true)
}).strict();
const inventoryReviewSchema = z.object({
    fingerprint: z.string().regex(/^[a-f0-9]{64}$/),
    notes: z.string().trim().min(20).max(4000),
    confirmedStoppedAndSettled: z.literal(true),
    confirmedInventoryReviewed: z.literal(true)
}).strict();
const repairSchema = z.object({
    fingerprint: z.string().regex(/^[a-f0-9]{64}$/),
    confirmedStoppedAndSettled: z.boolean().default(false)
}).strict();

function sendBomError(reply: any, statusCode: number, error: string, code: string, details?: unknown) {
    if (details !== undefined) {
        return reply.code(statusCode).send({ error, code, details });
    }
    return reply.code(statusCode).send({ error, code });
}

export const bomSyncRoutes: FastifyPluginAsync = async (fastify) => {
    fastify.addHook('preHandler', requireAuthFastify);

    /**
     * POST /products/:productId/bom/sync
     * Sync a single product's inventory to WooCommerce based on BOM calculation.
     */
    fastify.post<{ Params: { productId: string } }>('/products/:productId/bom/sync', async (request, reply) => {
        const accountId = request.accountId!;
        const { productId } = request.params;
        const parsedQuery = variationQuerySchema.safeParse(request.query);
        if (!parsedQuery.success) {
            return sendBomError(reply, 400, parsedQuery.error.issues[0]?.message || 'Invalid variationId', 'INVALID_VARIATION_ID');
        }
        const { variationId } = parsedQuery.data;

        try {
            const { QueueFactory, QUEUES } = await import('../../services/queue/QueueFactory');
            const jobs = await getBOMJobs(QueueFactory.getQueue(QUEUES.BOM_SYNC), accountId);
            if (jobs.some(({ state }) => runningJobStates.includes(state))) return sendBomError(reply, 409, 'BOM work is already running. Wait for it to finish before syncing individual products.', 'BOM_SYNC_ACTIVE');
            if (jobs.some(({ job, state }) => requiresBOMJobReview(job, state, bomJobIds(accountId).slice(2).includes(String(job.id))))) {
                return sendBomError(reply, 409, 'Use Repair & resume before syncing individual products from an uncertain run.', 'BOM_SYNC_RECONCILIATION_REQUIRED');
            }
            const result = await BOMInventorySyncService.syncProductToWoo(accountId, productId, variationId);

            if (!result.success) {
                return sendBomError(reply, 400, result.error || 'Sync failed', 'BOM_SYNC_FAILED', result);
            }

            return result;
        } catch (error) {
            Logger.error('Error syncing BOM inventory', { error, accountId, productId });
            return sendBomError(reply, 500, 'Failed to sync inventory to WooCommerce', 'BOM_SYNC_EXCEPTION');
        }
    });

    /**
     * GET /products/:productId/bom/diagnose
     * Diagnose why a product's BOM sync might not be working.
     */
    fastify.get<{ Params: { productId: string } }>('/products/:productId/bom/diagnose', async (request, reply) => {
        const accountId = request.accountId!;
        const { productId } = request.params;
        const parsedQuery = variationQuerySchema.safeParse(request.query);
        if (!parsedQuery.success) {
            return sendBomError(reply, 400, parsedQuery.error.issues[0]?.message || 'Invalid variationId', 'INVALID_VARIATION_ID');
        }
        const { variationId } = parsedQuery.data;

        try {
            // Step 1: Check if product exists
            const product = await prisma.wooProduct.findUnique({
                where: { id: productId },
                select: { id: true, wooId: true, name: true, accountId: true }
            });

            if (!product) {
                return {
                    status: 'error',
                    reason: 'PRODUCT_NOT_FOUND',
                    message: `Product with ID ${productId} does not exist in the database.`
                };
            }

            if (product.accountId !== accountId) {
                return {
                    status: 'error',
                    reason: 'WRONG_ACCOUNT',
                    message: `Product belongs to a different account.`
                };
            }

            // Step 2: Check if BOM exists
            const bom = await prisma.bOM.findUnique({
                where: {
                    productId_variationId: { productId, variationId }
                },
                include: {
                    items: {
                        include: {
                            childProduct: { select: { id: true, wooId: true, name: true } },
                            childVariation: { select: { wooId: true, sku: true, stockQuantity: true } },
                            internalProduct: { select: { id: true, name: true, stockQuantity: true } }
                        }
                    }
                }
            });

            if (!bom) {
                return {
                    status: 'error',
                    reason: 'NO_BOM',
                    message: `No BOM found for product "${product.name}" with variationId=${variationId}. ` +
                        `If this is a variation, make sure variationId matches the WooCommerce variation ID.`,
                    productName: product.name,
                    wooId: product.wooId,
                    variationIdUsed: variationId
                };
            }

            if (bom.items.length === 0) {
                return {
                    status: 'error',
                    reason: 'NO_BOM_ITEMS',
                    message: `BOM exists but has no component items. Add child products or internal products to the BOM.`,
                    productName: product.name,
                    bomId: bom.id
                };
            }

            // Step 3: Categorize items
            const activeItems = bom.items.filter(i => i.isActive);
            const deactivatedItems = bom.items.filter(i => !i.isActive);
            const wooItems = activeItems.filter(i => i.childProductId);
            const internalItems = activeItems.filter(i => i.internalProductId);

            // Step 4: Try the calculation
            const calculation = await BOMInventorySyncService.calculateEffectiveStockLocal(accountId, productId, variationId);

            return {
                status: 'ok',
                message: 'BOM configuration looks correct. Sync should work.',
                productName: product.name,
                wooId: product.wooId,
                variationId,
                bomId: bom.id,
                itemBreakdown: {
                    total: bom.items.length,
                    active: activeItems.length,
                    deactivated: deactivatedItems.length,
                    wooCommerceProducts: wooItems.length,
                    internalProducts: internalItems.length
                },
                items: bom.items.map(item => ({
                    type: item.internalProductId ? 'internal' : 'woocommerce',
                    quantity: item.quantity,
                    isActive: item.isActive,
                    deactivatedReason: item.deactivatedReason || null,
                    childName: item.childProduct?.name || item.internalProduct?.name || 'Unknown',
                    childStock: item.childVariation?.stockQuantity ??
                        item.internalProduct?.stockQuantity ??
                        'N/A (fetch from WooCommerce)'
                })),
                effectiveStockCalculation: calculation ? {
                    effectiveStock: calculation.effectiveStock,
                    currentWooStock: calculation.currentWooStock,
                    needsSync: calculation.needsSync,
                    components: calculation.components
                } : 'Calculation returned null - check component stock values'
            };
        } catch (error: any) {
            Logger.error('Error diagnosing BOM sync', { error, accountId, productId });
            return sendBomError(reply, 500, 'Failed to diagnose BOM sync', 'BOM_DIAGNOSE_EXCEPTION', {
                reason: 'EXCEPTION',
                message: error.message
            });
        }
    });

    /**
     * POST /bom/sync-all
     * Bulk sync ALL BOM parent products for the account to WooCommerce.
     */
    fastify.post('/bom/sync-all', async (request, reply) => {
        const accountId = request.accountId!;

        const { QueueFactory, QUEUES } = await import('../../services/queue/QueueFactory');

        const bomCount = await prisma.bOM.count({
            where: {
                product: { accountId },
                items: {
                    some: {
                        OR: [
                            { childProductId: { not: null } },
                            { internalProductId: { not: null } }
                        ]
                    }
                }
            }
        });

        const queue = QueueFactory.getQueue(QUEUES.BOM_SYNC);
        const [jobId] = bomJobIds(accountId);

        // Recognize jobs dispatched through the shared sync endpoint as well.
        for (const candidateId of [bomJobIds(accountId)[3], bomJobIds(accountId)[2], ...bomJobIds(accountId).slice(0, 2)]) {
            const candidate = await queue.getJob(candidateId);
            if (candidate) {
                if (candidate.data?.accountId !== accountId) return sendBomError(reply, 403, 'BOM job ownership could not be verified.', 'BOM_SYNC_SCOPE_INVALID');
                const state = await candidate.getState();
                if (runningJobStates.includes(state)) {
                    // A long-running active job is not necessarily stale. Let BullMQ
                    // recover stalled workers rather than starting duplicate work.
                    return {
                        status: 'already_running',
                        message: `BOM sync is already ${state} for this account.`,
                        estimatedProducts: bomCount
                    };
                }
                if (requiresBOMJobReview(candidate, state, bomJobIds(accountId).slice(2).includes(candidateId))) return sendBomError(reply, 409, 'Previous BOM sync needs repair. Use Repair & resume to check fresh stock and resolve mismatches.', 'BOM_SYNC_RECONCILIATION_REQUIRED');
            }
        }

        // Reviewed executions are archived in the audit trail before their reusable slots are released.
        for (const id of bomJobIds(accountId).filter(id => id !== jobId)) {
            const reviewed = await queue.getJob(id);
            if (reviewed && reviewed.data?.accountId !== accountId) return sendBomError(reply, 403, 'BOM job ownership could not be verified.', 'BOM_SYNC_SCOPE_INVALID');
            if (reviewed && (isBOMJobReconciled(reviewed) || (await reviewed.getState() === 'completed' && isVerifiedBOMRepair(reviewed)))) await reviewed.remove();
        }
        const existingJob = await queue.getJob(jobId);
        if (existingJob) {
            if (existingJob.data?.accountId !== accountId) return sendBomError(reply, 403, 'BOM job ownership could not be verified.', 'BOM_SYNC_SCOPE_INVALID');
            const state = await existingJob.getState();
            if (runningJobStates.includes(state)) return { status: 'already_running', estimatedProducts: bomCount };
            if (requiresBOMJobReview(existingJob, state)) {
                return sendBomError(reply, 409, 'A new or changed failed BOM run requires inventory review before another run.', 'BOM_SYNC_RECONCILIATION_REQUIRED');
            }
            // Fail closed if removal races with a worker acquiring the job.
            await existingJob.remove();
        }

        await queue.add(QUEUES.BOM_SYNC, { accountId }, {
            jobId,
            priority: 10,
            removeOnComplete: false,
            removeOnFail: false
        });

        Logger.info(`[BOMInventorySync] Dispatched queue job`, { accountId, jobId, bomCount });

        return {
            status: 'queued',
            message: `BOM sync queued for ${bomCount} products. Check sync history for results.`,
            estimatedProducts: bomCount,
            jobId
        };
    });

    fastify.post('/bom/sync-repair', async (request, reply) => {
        const accountId = request.accountId!;
        if (!request.user?.id || !await PermissionService.hasPermission(request.user.id, accountId, 'manage_inventory')) {
            return sendBomError(reply, 403, 'Inventory management permission required', 'BOM_REPAIR_FORBIDDEN');
        }
        const parsed = repairSchema.safeParse(request.body);
        if (!parsed.success) return sendBomError(reply, 400, 'Refresh repair details before starting.', 'BOM_REPAIR_INVALID');
        try {
            const { QueueFactory, QUEUES } = await import('../../services/queue/QueueFactory');
            await QueueFactory.enforceMaxQueueDepth(QUEUES.BOM_SYNC);
            return await admitBOMRepair(QueueFactory.getQueue(QUEUES.BOM_SYNC), accountId, request.user.id, parsed.data);
        } catch (error: any) {
            if (error.statusCode === 409) return sendBomError(reply, 409, error.message, error.code);
            Logger.error('BOM repair admission not acknowledged', { error, accountId });
            return sendBomError(reply, 503, 'Repair was not acknowledged. Refresh sync status before retrying; it may already be queued.', 'BOM_REPAIR_UNCERTAIN');
        }
    });

    fastify.post('/bom/sync-reconcile', async (request, reply) => {
        const accountId = request.accountId!;
        if (!request.user?.id || !await PermissionService.hasPermission(request.user.id, accountId, 'manage_inventory')) {
            return sendBomError(reply, 403, 'Inventory management permission required', 'BOM_REVIEW_FORBIDDEN');
        }
        const parsed = inventoryReviewSchema.safeParse(request.body);
        if (!parsed.success) return sendBomError(reply, 400, 'Confirm both safety checks and provide review notes (20–4000 characters).', 'BOM_REVIEW_CONFIRMATION_REQUIRED');
        try {
            const { QueueFactory, QUEUES } = await import('../../services/queue/QueueFactory');
            return await reconcileBOMInventory(QueueFactory.getQueue(QUEUES.BOM_SYNC), accountId, request.user.id, parsed.data);
        } catch (error: any) {
            if (error.statusCode === 409) return sendBomError(reply, 409, error.message, error.code);
            Logger.error('BOM inventory review could not be acknowledged', { error, accountId });
            return sendBomError(reply, 503, 'Inventory review was not acknowledged. Refresh run details and sync status before retrying. Retained evidence has not been deleted.', 'BOM_REVIEW_UNCERTAIN');
        }
    });

    fastify.get('/bom/sync-diagnostics', async (request, reply) => {
        try {
            const { QueueFactory, QUEUES } = await import('../../services/queue/QueueFactory');
            return await getBOMSyncDiagnostics(QueueFactory.getQueue(QUEUES.BOM_SYNC), request.accountId!);
        } catch (error) {
            Logger.error('Could not load BOM sync diagnostics', { error, accountId: request.accountId });
            return sendBomError(reply, 503, 'Failed-run details are unavailable. Retry, or ask an administrator to inspect the BOM worker logs.', 'BOM_DIAGNOSTICS_UNAVAILABLE');
        }
    });

    /** Read-only plan. No provider requests and no failed-job removal. */
    fastify.get('/bom/sync-recovery', async (request, reply) => {
        const accountId = request.accountId!;
        if (!request.user?.id || !await PermissionService.hasPermission(request.user.id, accountId, 'manage_inventory')) {
            return sendBomError(reply, 403, 'Inventory management permission required', 'BOM_RECOVERY_FORBIDDEN');
        }
        try {
            const { QueueFactory, QUEUES } = await import('../../services/queue/QueueFactory');
            const { targets: _targets, ...plan } = await buildBOMRecoveryPlan(QueueFactory.getQueue(QUEUES.BOM_SYNC), accountId);
            return plan;
        } catch (error: any) {
            if (error.statusCode === 409) return sendBomError(reply, 409, error.message, error.code);
            Logger.error('Could not inspect BOM recovery', { error, accountId });
            return sendBomError(reply, 503, 'Recovery evidence is unavailable. No continuation was started.', 'BOM_RECOVERY_UNAVAILABLE');
        }
    });

    fastify.post('/bom/sync-recovery', async (request, reply) => {
        const accountId = request.accountId!;
        if (!request.user?.id || !await PermissionService.hasPermission(request.user.id, accountId, 'manage_inventory')) {
            return sendBomError(reply, 403, 'Inventory management permission required', 'BOM_RECOVERY_FORBIDDEN');
        }
        const parsed = recoverySchema.safeParse(request.body);
        if (!parsed.success) return sendBomError(reply, 400, 'Review the recovery plan and confirm the previous worker and outstanding stock requests have stopped.', 'BOM_RECOVERY_CONFIRMATION_REQUIRED');
        try {
            const { QueueFactory, QUEUES } = await import('../../services/queue/QueueFactory');
            const queue = QueueFactory.getQueue(QUEUES.BOM_SYNC);
            const jobId = bomJobIds(accountId)[2];
            const existing = await queue.getJob(jobId);
            if (existing) {
                if (existing.data.accountId !== accountId || existing.data.bomRecovery?.fingerprint !== parsed.data.fingerprint) {
                    return sendBomError(reply, 409, 'A different recovery already exists. Refresh its status.', 'BOM_RECOVERY_CHANGED');
                }
                const state = await existing.getState();
                return { status: runningJobStates.includes(state) ? 'already_running' : state, jobId };
            }
            const plan = await buildBOMRecoveryPlan(queue, accountId);
            if (plan.fingerprint !== parsed.data.fingerprint) return sendBomError(reply, 409, 'The failed run or BOM dependencies changed. Review a fresh recovery plan.', 'BOM_RECOVERY_CHANGED');
            if (!plan.targets.length) return sendBomError(reply, 409, 'No provably unaffected products remain to continue.', 'BOM_RECOVERY_EMPTY');
            await QueueFactory.enforceMaxQueueDepth(QUEUES.BOM_SYNC);
            await queue.add(QUEUES.BOM_SYNC, {
                accountId,
                bomRecovery: { fingerprint: plan.fingerprint, sourceJobIds: plan.sourceJobIds, requestedBy: request.user.id, confirmedStoppedAndSettledAt: new Date().toISOString() }
            }, { jobId, priority: 10, attempts: 1, removeOnComplete: false, removeOnFail: false });
            Logger.info('BOM continuation requested; failed jobs retained', { accountId, jobId, requestedBy: request.user.id, sourceJobIds: plan.sourceJobIds, eligibleProducts: plan.eligibleProducts });
            return { status: 'queued', jobId, estimatedProducts: plan.eligibleProducts };
        } catch (error: any) {
            if (error.statusCode === 409) return sendBomError(reply, 409, error.message, error.code);
            Logger.error('BOM continuation admission not acknowledged', { error, accountId });
            return sendBomError(reply, 503, 'Continuation was not acknowledged. Refresh status before retrying; the same recovery identity is retained.', 'BOM_RECOVERY_UNCERTAIN');
        }
    });

    /**
     * GET /bom/sync-status
     * Check current status of BOM sync job for this account.
     */
    fastify.get('/bom/sync-status', async (request, reply) => {
        const accountId = request.accountId!;
        const { QueueFactory, QUEUES } = await import('../../services/queue/QueueFactory');

        const queue = QueueFactory.getQueue(QUEUES.BOM_SYNC);

        try {
            // Running work wins over retained failed evidence from the source run.
            const jobs = await Promise.all(bomJobIds(accountId).map(async jobId => {
                const job = await queue.getJob(jobId);
                if (job && job.data?.accountId !== accountId) throw new Error('BOM job ownership could not be verified');
                return job ? { job, state: await job.getState() } : null;
            }));
            const ordered = [...jobs.filter(entry => entry && runningJobStates.includes(entry.state)), ...jobs.filter(entry => entry && !runningJobStates.includes(entry.state))];
            const repairJob = jobs.find(entry => entry?.job.id === bomJobIds(accountId)[3])?.job;
            const report = repairJob && !isBOMJobReconciled(repairJob) ? readBOMRepairResult(repairJob) : null;
            const repairSummary = report ? { total: report.total, checked: report.checked, repaired: report.repaired,
                unchanged: report.unchanged, failed: report.failed, verified: report.verified } : null;
            for (const entry of ordered) {
                const existingJob = entry!.job;
                const state = entry!.state;
                if (existingJob) {
                    const rawProgress = existingJob.progress as any;
                    const progress = rawProgress && typeof rawProgress === 'object'
                        ? {
                            current: Number(rawProgress.current || 0),
                            total: Number(rawProgress.total || 0),
                            synced: Number(rawProgress.synced || 0),
                            skipped: Number(rawProgress.skipped || 0),
                            failed: Number(rawProgress.failed || 0)
                        }
                        : null;
                    if (runningJobStates.includes(state)) {
                        return { isSyncing: true, state, progress, isRecovery: existingJob.id === bomJobIds(accountId)[2], isRepair: existingJob.id === bomJobIds(accountId)[3], ...(repairSummary ? { repairSummary } : {}) };
                    }
                    if (requiresBOMJobReview(existingJob, state, bomJobIds(accountId).slice(2).includes(String(existingJob.id)))) return { isSyncing: false, state, progress, requiresReconciliation: true, code: 'BOM_SYNC_RECONCILIATION_REQUIRED', ...(repairSummary ? { repairSummary } : {}) };
                }
            }
            return { isSyncing: false, state: null, ...(repairSummary ? { repairSummary } : {}) };
        } catch (err) {
            Logger.error('Error checking BOM sync status', { error: err, accountId });
            return sendBomError(reply, 503, 'BOM sync status is unavailable. Do not assume the worker has stopped.', 'BOM_SYNC_STATUS_UNAVAILABLE');
        }
    });

    /**
     * DELETE /bom/sync-cancel
     * Cancel queued work or request cooperative cancellation of running BOM jobs.
     */
    fastify.delete('/bom/sync-cancel', async (request, reply) => {
        const accountId = request.accountId!;
        const { QueueFactory, QUEUES } = await import('../../services/queue/QueueFactory');
        const { SyncCancellationService } = await import('../../services/sync/SyncCancellationService');

        const queue = QueueFactory.getQueue(QUEUES.BOM_SYNC);

        try {
            let previousState: string | undefined;
            let cancellationRequested = false;
            for (const jobId of bomJobIds(accountId)) {
                const existingJob = await queue.getJob(jobId);
                if (!existingJob) continue;
                // IDs are normalized, so verify ownership from the job payload too.
                if (existingJob.data?.accountId !== accountId) {
                    return sendBomError(reply, 403, 'Cannot cancel jobs for another account', 'BOM_SYNC_CANCEL_FORBIDDEN');
                }
                const state = await existingJob.getState();
                if (!runningJobStates.includes(state)) continue;
                previousState ??= state;

                if (state === 'active') {
                    await SyncCancellationService.request(QUEUES.BOM_SYNC, jobId);
                    cancellationRequested = true;
                } else {
                    try {
                        await existingJob.remove();
                    } catch (error: any) {
                        // Match shared sync cancellation: a worker may have acquired
                        // the job between getState and remove.
                        if (!String(error?.message || '').includes('locked')) throw error;
                        await SyncCancellationService.request(QUEUES.BOM_SYNC, jobId);
                        cancellationRequested = true;
                    }
                }
                Logger.info('[BOMSync] Cancelled or requested cancellation', { accountId, jobId, previousState: state });
            }

            if (previousState !== undefined) {
                return {
                    success: true,
                    message: cancellationRequested ? 'Sync job cancellation requested' : 'Sync job cancelled successfully',
                    previousState,
                    cancellationRequested
                };
            }

            return {
                success: true,
                message: 'No active sync job found to cancel'
            };
        } catch (err: any) {
            Logger.error('Error cancelling BOM sync', { error: err.message, accountId });
            return sendBomError(reply, 500, 'Failed to cancel sync job', 'BOM_SYNC_CANCEL_FAILED', {
                message: err.message
            });
        }
    });

    /**
     * GET /bom/pending-changes
     * Returns all BOM products with current vs effective stock comparison.
     */
    fastify.get('/bom/pending-changes', async (request, reply) => {
        const accountId = request.accountId!;

        try {
            const bomsWithChildProducts = await prisma.bOM.findMany({
                where: {
                    product: { accountId },
                    items: {
                        some: {
                            isActive: true,
                            OR: [
                                { childProductId: { not: null } },
                                { internalProductId: { not: null } }
                            ]
                        }
                    }
                },
                include: {
                    items: localBOMItems,
                    product: {
                        select: {
                            id: true,
                            wooId: true,
                            name: true,
                            sku: true,
                            mainImage: true,
                            stockQuantity: true,
                            rawData: true,
                            // Include variations so we can lookup variant-specific data
                            variations: {
                                select: {
                                    wooId: true,
                                    sku: true,
                                    images: true,
                                    stockQuantity: true,
                                    rawData: true
                                }
                            }
                        }
                    }
                }
            });

            Logger.info(`[BOMSync] Found ${bomsWithChildProducts.length} BOMs with child products`, { accountId });

            let calculationFailures = 0;

            const mapped = bomsWithChildProducts.map((bom) => {
                try {
                    const calculation = BOMInventorySyncService.calculateEffectiveStockFromLocalData(
                        bom.product,
                        bom,
                        bom.product.variations.find(v => v.wooId === bom.variationId) ?? null
                    );

                    if (!calculation) {
                        calculationFailures++;
                        Logger.warn(`[BOMSync] calculateEffectiveStock returned null for product`, {
                            productId: bom.productId,
                            variationId: bom.variationId,
                            productName: bom.product.name
                        });
                        return null;
                    }

                    // For variants, get variant-specific data
                    let displayName = bom.product.name;
                    let displaySku = bom.product.sku;
                    let displayImage = bom.product.mainImage;
                    let displayWooId = bom.product.wooId;

                    if (bom.variationId > 0) {
                        // Find the matching variation
                        const variation = bom.product.variations.find(v => v.wooId === bom.variationId);
                        if (variation) {
                            displayWooId = variation.wooId;
                            displaySku = variation.sku || displaySku;

                            // Get variant name from rawData or construct from attributes
                            const rawData = variation.rawData as any;
                            if (rawData?.attributes?.length > 0) {
                                const attrStr = rawData.attributes
                                    .map((a: any) => a.option)
                                    .filter(Boolean)
                                    .join(', ');
                                displayName = `${bom.product.name} - ${attrStr}`;
                            } else {
                                displayName = `${bom.product.name} (Variant #${variation.wooId})`;
                            }

                            // Get variant image
                            const images = variation.images as any[];
                            if (images?.length > 0 && images[0]?.src) {
                                displayImage = images[0].src;
                            } else if (rawData?.image?.src) {
                                displayImage = rawData.image.src;
                            }
                        }
                    }

                    return {
                        productId: bom.product.id,
                        wooId: displayWooId,
                        name: displayName,
                        sku: displaySku,
                        mainImage: displayImage,
                        variationId: bom.variationId,
                        currentWooStock: calculation.currentWooStock,
                        effectiveStock: calculation.effectiveStock,
                        needsSync: calculation.needsSync,
                        components: calculation.components
                    };
                } catch (calcError) {
                    calculationFailures++;
                    Logger.error(`[BOMSync] calculateEffectiveStock threw error`, {
                        productId: bom.productId,
                        variationId: bom.variationId,
                        error: calcError
                    });
                    return null;
                }
            });

            const pendingChanges = mapped.filter((entry): entry is NonNullable<typeof entry> => Boolean(entry));

            Logger.info(`[BOMSync] Results: ${pendingChanges.length} success, ${calculationFailures} failures`, { accountId });

            pendingChanges.sort((a, b) => {
                if (a.needsSync !== b.needsSync) return a.needsSync ? -1 : 1;
                return a.name.localeCompare(b.name);
            });

            return {
                total: pendingChanges.length,
                needsSync: pendingChanges.filter(p => p.needsSync).length,
                inSync: pendingChanges.filter(p => !p.needsSync).length,
                products: pendingChanges
            };
        } catch (error) {
            Logger.error('Error fetching pending BOM changes', { error, accountId });
            return sendBomError(reply, 500, 'Failed to fetch pending changes', 'BOM_PENDING_CHANGES_FETCH_FAILED');
        }
    });

    /**
     * GET /bom/sync-history
     * Returns recent BOM sync logs from AuditLog.
     */
    fastify.get('/bom/sync-history', async (request, reply) => {
        const accountId = request.accountId!;
        const parsedLimit = limitQuerySchema.safeParse(request.query);
        if (!parsedLimit.success) {
            return sendBomError(reply, 400, parsedLimit.error.issues[0]?.message || 'Invalid limit', 'INVALID_LIMIT');
        }
        const { limit } = parsedLimit.data;

        try {
            const logs = await prisma.auditLog.findMany({
                where: {
                    accountId,
                    source: 'SYSTEM_BOM'
                },
                orderBy: { createdAt: 'desc' },
                take: limit,
                select: {
                    id: true,
                    resourceId: true,
                    previousValue: true,
                    details: true,
                    createdAt: true
                }
            });

            const productIds = [...new Set(logs.map(l => l.resourceId))];
            const products = await prisma.wooProduct.findMany({
                where: { id: { in: productIds } },
                select: { id: true, name: true, sku: true }
            });
            const productMap = new Map(products.map(p => [p.id, p]));

            const enrichedLogs = logs.map(log => {
                const product = productMap.get(log.resourceId);
                const prev = log.previousValue as any;
                const details = log.details as any;

                return {
                    id: log.id,
                    productId: log.resourceId,
                    productName: product?.name || 'Unknown Product',
                    productSku: product?.sku,
                    previousStock: prev?.stock_quantity ?? null,
                    newStock: details?.stock_quantity ?? null,
                    trigger: details?.trigger || 'BOM_SYNC',
                    createdAt: log.createdAt
                };
            });

            return {
                total: enrichedLogs.length,
                logs: enrichedLogs
            };
        } catch (error) {
            Logger.error('Error fetching BOM sync history', { error, accountId });
            return sendBomError(reply, 500, 'Failed to fetch sync history', 'BOM_SYNC_HISTORY_FETCH_FAILED');
        }
    });

    /**
     * GET /bom/consumption-history
     * Returns recent BOM component consumption (deduction ledger entries) for this account.
     * Why: The frontend `useBOMSync` hook exposes `consumptionHistory` state — this endpoint feeds it.
     */
    fastify.get('/bom/consumption-history', async (request, reply) => {
        const accountId = request.accountId!;
        const parsedLimit = limitQuerySchema.safeParse(request.query);
        if (!parsedLimit.success) {
            return sendBomError(reply, 400, parsedLimit.error.issues[0]?.message || 'Invalid limit', 'INVALID_LIMIT');
        }
        const { limit } = parsedLimit.data;

        try {
            const entries = await prisma.bOMDeductionLedger.findMany({
                where: {
                    accountId,
                    status: { in: ['COMPLETED', 'REVERSED'] }
                },
                orderBy: { createdAt: 'desc' },
                take: limit,
                select: {
                    id: true,
                    orderId: true,
                    componentName: true,
                    componentType: true,
                    quantityDeducted: true,
                    previousStock: true,
                    newStock: true,
                    status: true,
                    createdAt: true
                }
            });

            // Enrich with order numbers via a single batch lookup
            const orderIds = [...new Set(entries.map(e => e.orderId))];
            const orders = await prisma.wooOrder.findMany({
                where: { accountId, wooId: { in: orderIds } },
                select: { wooId: true, number: true }
            });
            const orderMap = new Map(orders.map(o => [o.wooId, o.number]));

            const enriched = entries.map(e => ({
                id: e.id,
                orderId: e.orderId,
                orderNumber: orderMap.get(e.orderId) || `#${e.orderId}`,
                productName: e.componentName,
                componentName: e.componentName,
                quantityDeducted: e.quantityDeducted,
                previousStock: e.previousStock,
                newStock: e.newStock,
                createdAt: e.createdAt
            }));

            return { entries: enriched };
        } catch (error) {
            Logger.error('Error fetching consumption history', { error, accountId });
            return sendBomError(reply, 500, 'Failed to fetch consumption history', 'BOM_CONSUMPTION_HISTORY_FETCH_FAILED');
        }
    });
};
