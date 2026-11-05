import Fastify from 'fastify';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
    prisma: {
        bOM: { findMany: vi.fn(), findUnique: vi.fn(), count: vi.fn() },
        wooProduct: { findFirst: vi.fn(), findMany: vi.fn() },
        auditLog: { create: vi.fn() },
        productVariation: { findUnique: vi.fn() }
    },
    queue: { name: 'bom-inventory-sync', getJob: vi.fn(), add: vi.fn() },
    requestCancellation: vi.fn(),
    hasPermission: vi.fn(),
    enforceMaxQueueDepth: vi.fn(),
    forAccount: vi.fn()
}));
vi.mock('../../utils/prisma', () => ({ prisma: mocks.prisma }));
vi.mock('../../middleware/auth', () => ({
    requireAuthFastify: async (request: any) => { request.accountId = 'account:one'; request.user = { id: 'operator' }; }
}));
vi.mock('../../services/PermissionService', () => ({ PermissionService: { hasPermission: mocks.hasPermission } }));
vi.mock('../../utils/logger', () => ({
    Logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }
}));
vi.mock('../../services/woo', () => ({ WooService: { forAccount: mocks.forAccount } }));
vi.mock('../../services/StockValidationService', () => ({ StockValidationService: {} }));
vi.mock('../../services/sync/SyncCancellationService', () => ({
    SyncCancellationService: { request: mocks.requestCancellation }
}));
vi.mock('../../services/queue/QueueFactory', () => ({
    QueueFactory: { getQueue: () => mocks.queue, enforceMaxQueueDepth: mocks.enforceMaxQueueDepth },
    QUEUES: { BOM_SYNC: 'bom-inventory-sync' }
}));

import { bomSyncRoutes } from './bomSync';
import { BOMInventorySyncService, localBOMItems } from '../../services/BOMInventorySyncService';
import { bomExecutionFingerprint } from '../../services/bom/BOMReconciliationEvidence';

function fixture(variationId = 0): any {
    return {
        productId: 'parent', variationId,
        product: {
            id: 'parent', wooId: 10, name: 'Bundle', sku: 'BASE', mainImage: 'base.jpg',
            stockQuantity: null, rawData: { stock_quantity: 4 },
            variations: [{
                wooId: 11, sku: 'RED', images: [{ src: 'red.jpg' }], stockQuantity: null,
                rawData: { stock_quantity: 9, attributes: [{ option: 'Red' }] }
            }]
        },
        items: [{
            childProductId: 'child', childVariationId: null, internalProductId: null,
            quantity: 2, wasteFactor: 0.25,
            childProduct: { id: 'child', wooId: 20, name: 'Part', stockQuantity: null, rawData: { stock_quantity: 20 } }
        }, {
            childProductId: 'child', childVariationId: null, internalProductId: null,
            quantity: 2.5, wasteFactor: 0,
            childProduct: { id: 'child', wooId: 20, name: 'Part', stockQuantity: 20, rawData: {} }
        }, {
            internalProductId: 'internal', quantity: 1, wasteFactor: 0,
            internalProduct: { id: 'internal', name: 'Box', stockQuantity: 10 }
        }]
    };
}

describe('BOM local preview', () => {
    let app: ReturnType<typeof Fastify>;
    beforeEach(async () => {
        vi.resetAllMocks();
        app = Fastify();
        await app.register(bomSyncRoutes);
        mocks.prisma.bOM.count.mockResolvedValue(3);
        mocks.hasPermission.mockResolvedValue(true);
    });
    afterEach(async () => { await app.close(); });

    it.each([1, 100])('preloads %i BOMs without per-BOM reads or Woo calls', async (count) => {
        mocks.prisma.bOM.findMany.mockResolvedValue(Array.from({ length: count }, () => fixture()));
        const response = await app.inject('/bom/pending-changes');
        expect(response.statusCode).toBe(200);
        expect(response.json()).toMatchObject({ total: count, needsSync: 0, inSync: count });
        expect(response.json().products[0]).toMatchObject({ effectiveStock: 4, currentWooStock: 4 });
        expect(mocks.prisma.bOM.findMany).toHaveBeenCalledTimes(1);
        expect(mocks.prisma.bOM.findMany).toHaveBeenCalledWith(expect.objectContaining({
            where: { product: { accountId: 'account:one' }, items: { some: localBOMItems.where } },
            include: expect.objectContaining({ items: localBOMItems })
        }));
        expect(mocks.prisma.bOM.findUnique).not.toHaveBeenCalled();
        expect(mocks.prisma.wooProduct.findFirst).not.toHaveBeenCalled();
        expect(mocks.prisma.productVariation.findUnique).not.toHaveBeenCalled();
        expect(mocks.forAccount).not.toHaveBeenCalled();
    });

    it('preserves variation display, stock fallback, sorting and invalid-BOM omission', async () => {
        const invalid = fixture();
        invalid.items = [{ quantity: 0 }, { quantity: 2, supplierItemId: 'supplier' }];
        mocks.prisma.bOM.findMany.mockResolvedValue([fixture(), invalid, fixture(11)]);
        const response = await app.inject('/bom/pending-changes');
        expect(response.json()).toMatchObject({ total: 2, needsSync: 1, inSync: 1 });
        expect(response.json().products[0]).toMatchObject({
            wooId: 11, variationId: 11, name: 'Bundle - Red', sku: 'RED', mainImage: 'red.jpg',
            currentWooStock: 9, effectiveStock: 4, needsSync: true,
            components: [
                { childProductId: 'child', requiredQty: 5, childStock: 20, buildableUnits: 4 },
                { childProductId: 'internal', childName: '[Internal] Box', buildableUnits: 10 }
            ]
        });
    });

    it.each([0, 11, 999])('shares single-product calculation semantics for target %i', async (variationId) => {
        const bom = fixture(variationId);
        const variation = bom.product.variations.find((v: any) => v.wooId === variationId) ?? null;
        mocks.prisma.wooProduct.findFirst.mockResolvedValue(bom.product);
        mocks.prisma.bOM.findUnique.mockResolvedValue(bom);
        mocks.prisma.productVariation.findUnique.mockResolvedValue(variation);
        const single = await BOMInventorySyncService.calculateEffectiveStockLocal('account:one', 'parent', variationId);
        const bulk = BOMInventorySyncService.calculateEffectiveStockFromLocalData(bom.product, bom, variation);
        expect(single).toEqual(bulk);
        expect(single?.currentWooStock).toBe(variationId === 0 ? 4 : variationId === 11 ? 9 : null);
        expect(mocks.prisma.wooProduct.findFirst).toHaveBeenCalledWith(expect.objectContaining({
            where: { id: 'parent', accountId: 'account:one' }
        }));
    });

    it('preserves zero, negative and child-variation stock semantics', () => {
        const bom = fixture(11);
        bom.items = [{
            childProductId: 'child', childVariationId: 'variation', quantity: 2, wasteFactor: 0,
            childProduct: { id: 'child', wooId: 20, name: 'Part' },
            childVariation: { wooId: 21, sku: 'BLUE', stockQuantity: -3 }
        }];
        const result = BOMInventorySyncService.calculateEffectiveStockFromLocalData(
            bom.product, bom, { stockQuantity: 0, rawData: { stock_quantity: 100 } }
        );
        expect(result).toMatchObject({ currentWooStock: 0, effectiveStock: -2, needsSync: true });
        expect(result?.components[0]).toMatchObject({ childWooId: 21, childName: 'Part (Variant BLUE)', childStock: -3 });
    });

    it.each([false, true])('matches live physical-owner pooling for sibling components (inherited=%s)', inherited => {
        const row = fixture();
        row.product.stockQuantity = inherited ? 49 : 98;
        row.items = [21, 22].map(wooId => ({ childProductId: 'child', childVariationId: `v${wooId}`, quantity: 1, wasteFactor: 0,
            childProduct: { id: 'child', wooId: 20, name: 'Part', stockQuantity: 98, rawData: { manage_stock: true } },
            childVariation: { wooId, sku: `PART-${wooId}`, stockQuantity: inherited ? null : 98, rawData: { manage_stock: inherited ? 'parent' : true } }
        }));
        const result = BOMInventorySyncService.calculateEffectiveStockFromLocalData(row.product, row);
        expect(result).toMatchObject({ effectiveStock: inherited ? 49 : 98, needsSync: false });
        expect(result?.components.map(component => component.childWooId)).toEqual(inherited ? [20] : [21, 22]);
    });

    it('returns null without loading a BOM for a product outside the account', async () => {
        mocks.prisma.wooProduct.findFirst.mockResolvedValue(null);
        expect(await BOMInventorySyncService.calculateEffectiveStockLocal('other-account', 'parent')).toBeNull();
        expect(mocks.prisma.bOM.findUnique).not.toHaveBeenCalled();
    });

    it('returns the existing error contract for a failed bulk read', async () => {
        mocks.prisma.bOM.findMany.mockRejectedValue(new Error('DB unavailable'));
        const response = await app.inject('/bom/pending-changes');
        expect(response.statusCode).toBe(500);
        expect(response.json().code).toBe('BOM_PENDING_CHANGES_FETCH_FAILED');
    });

    it('returns an empty preview for an account without eligible BOMs', async () => {
        mocks.prisma.bOM.findMany.mockResolvedValue([]);
        expect((await app.inject('/bom/pending-changes')).json()).toEqual({
            total: 0, needsSync: 0, inSync: 0, products: []
        });
    });

    it('isolates a malformed BOM calculation from other preview rows', async () => {
        const malformed = fixture();
        malformed.items = [null];
        mocks.prisma.bOM.findMany.mockResolvedValue([malformed, fixture()]);
        const response = await app.inject('/bom/pending-changes');
        expect(response.statusCode).toBe(200);
        expect(response.json()).toMatchObject({ total: 1, inSync: 1 });
    });

    it.each(['bom_sync_account_one', 'sync_bom_account_one'])('recognizes running jobs at %s', async (id) => {
        const job = {
            data: { accountId: 'account:one' },
            getState: vi.fn().mockResolvedValue('prioritized'), remove: vi.fn(),
            processedOn: Date.now() - 3600000, progress: { current: 2, total: 3 }
        };
        mocks.queue.getJob.mockImplementation(async (key) => key === id ? job : null);
        const dispatch = await app.inject({ method: 'POST', url: '/bom/sync-all' });
        expect(dispatch.json().status).toBe('already_running');
        expect(mocks.queue.add).not.toHaveBeenCalled();
        expect(job.remove).not.toHaveBeenCalled();
        const status = await app.inject('/bom/sync-status');
        expect(status.json()).toMatchObject({ isSyncing: true, state: 'prioritized', progress: { current: 2, total: 3 } });
        job.getState.mockResolvedValue('active');
        expect((await app.inject({ method: 'POST', url: '/bom/sync-all' })).json().status).toBe('already_running');
        expect(job.remove).not.toHaveBeenCalled();
    });

    it('keeps the scheduler-compatible ID when dispatching new work', async () => {
        mocks.queue.getJob.mockResolvedValue(null);
        const response = await app.inject({ method: 'POST', url: '/bom/sync-all' });
        expect(response.json()).toMatchObject({ status: 'queued', jobId: 'bom_sync_account_one' });
        expect(mocks.queue.add).toHaveBeenCalledWith('bom-inventory-sync', { accountId: 'account:one' },
            expect.objectContaining({ jobId: 'bom_sync_account_one', removeOnComplete: false, removeOnFail: false }));
    });
    it.each([false, true])('requires permission and explicit review confirmations (permission=%s)', async permission => {
        mocks.hasPermission.mockResolvedValue(permission);
        const response = await app.inject({ method: 'POST', url: '/bom/sync-reconcile', payload: {} });
        expect(response.statusCode).toBe(permission ? 400 : 403);
        expect(mocks.queue.add).not.toHaveBeenCalled();
    });
    it('starts automatic repair of a legacy run after a single settlement confirmation, not inventory notes', async () => {
        const job = { id: 'bom_sync_account_one', ...queueJob('failed'), progress: { current: 367, total: 1908 }, failedReason: 'job stalled' };
        mocks.queue.getJob.mockImplementation(async id => id === job.id ? job : null);
        const diagnostics = (await app.inject('/bom/sync-diagnostics')).json();
        expect(diagnostics.repair).toEqual({ canStart: true, requiresStoppedConfirmation: true });
        expect(diagnostics.runs[0].hasCheckpoint).toBe(false);
        const denied = await app.inject({ method: 'POST', url: '/bom/sync-repair', payload: { fingerprint: diagnostics.fingerprint } });
        expect(denied.statusCode).toBe(409);
        expect(denied.json().code).toBe('BOM_REPAIR_SETTLEMENT_REQUIRED');
        expect(mocks.queue.add).not.toHaveBeenCalled();
        const admitted = await app.inject({ method: 'POST', url: '/bom/sync-repair', payload: { fingerprint: diagnostics.fingerprint, confirmedStoppedAndSettled: true } });
        expect(admitted.json()).toEqual({ status: 'queued', jobId: 'bom_repair_account_one' });
        expect(mocks.queue.add).toHaveBeenCalledWith('bom-inventory-sync', expect.objectContaining({ accountId: 'account:one', bomRepair: expect.objectContaining({ requestedBy: 'operator' }) }), expect.objectContaining({ attempts: 1, removeOnComplete: false, removeOnFail: false }));
        expect(job.remove).not.toHaveBeenCalled();
    });
    it('does not replay an older completed job which still reports product failures', async () => {
        const job = { id: 'bom_sync_account_one', ...queueJob('completed'), progress: { current: 3, total: 3, failed: 1 } };
        mocks.queue.getJob.mockImplementation(async id => id === job.id ? job : null);
        const status = (await app.inject('/bom/sync-status')).json();
        expect(status.requiresReconciliation).toBe(true);
        const dispatch = await app.inject({ method: 'POST', url: '/bom/sync-all' });
        expect(dispatch.statusCode).toBe(409);
        expect(job.remove).not.toHaveBeenCalled(); expect(mocks.queue.add).not.toHaveBeenCalled();
        const diagnostics = (await app.inject('/bom/sync-diagnostics')).json();
        expect(diagnostics.repair).toMatchObject({ canStart: true, requiresStoppedConfirmation: true });
        expect(diagnostics.runs[0].jobId).toBe(job.id);
    });
    it('enforces repair permission and rejects malformed requests', async () => {
        mocks.hasPermission.mockResolvedValue(false);
        expect((await app.inject({ method: 'POST', url: '/bom/sync-repair', payload: {} })).statusCode).toBe(403);
        mocks.hasPermission.mockResolvedValue(true);
        expect((await app.inject({ method: 'POST', url: '/bom/sync-repair', payload: { fingerprint: 'not-a-fingerprint' } })).statusCode).toBe(400);
        expect(mocks.queue.add).not.toHaveBeenCalled();
    });
    it('treats active repair as running work and prevents individual stock sync overlap', async () => {
        const job = { id: 'bom_repair_account_one', ...queueJob('active'), progress: { current: 1, total: 3 } };
        mocks.queue.getJob.mockImplementation(async id => id === job.id ? job : null);
        expect((await app.inject('/bom/sync-status')).json()).toMatchObject({ isSyncing: true, isRepair: true });
        expect((await app.inject({ method: 'POST', url: '/bom/sync-all' })).json().status).toBe('already_running');
        expect((await app.inject({ method: 'POST', url: '/products/parent/bom/sync' })).statusCode).toBe(409);
        expect(mocks.prisma.wooProduct.findFirst).not.toHaveBeenCalled();
    });
    it.each([false, true])('only resumes after a fully verified repair report (verified=%s)', async verified => {
        const job = { id: 'bom_repair_account_one', ...queueJob('completed'), processedOn: 100 };
        Object.assign(job.data, { bomRepair: { requestedBy: 'operator' }, bomRepairResult: { total: 2, checked: 2, repaired: 1, unchanged: verified ? 1 : 0,
            failed: verified ? 0 : 1, uncertainWrites: 0, issues: [], verified, processedOn: 100, auditId: 'audit' } });
        mocks.queue.getJob.mockImplementation(async id => id === job.id ? job : null);
        const status = (await app.inject('/bom/sync-status')).json();
        expect(status.repairSummary.verified).toBe(verified);
        expect(Boolean(status.requiresReconciliation)).toBe(!verified);
        const dispatch = await app.inject({ method: 'POST', url: '/bom/sync-all' });
        expect(dispatch.statusCode).toBe(verified ? 200 : 409);
        expect(mocks.queue.add.mock.calls.length).toBe(verified ? 1 : 0);
    });
    it('never removes or exposes a verified repair owned by a colliding normalized account ID', async () => {
        const job = { id: 'bom_repair_account_one', ...queueJob('completed', 'account_one'), processedOn: 100 };
        Object.assign(job.data, { bomRepair: {}, bomRepairResult: { total: 0, checked: 0, repaired: 0, unchanged: 0,
            failed: 0, uncertainWrites: 0, issues: [], verified: true, processedOn: 100, auditId: 'foreign-audit' } });
        mocks.queue.getJob.mockImplementation(async id => id === job.id ? job : null);
        expect((await app.inject({ method: 'POST', url: '/bom/sync-all' })).statusCode).toBe(403);
        expect((await app.inject('/bom/sync-status')).statusCode).toBe(503);
        expect(job.remove).not.toHaveBeenCalled(); expect(job.getState).not.toHaveBeenCalled();
        expect(mocks.queue.add).not.toHaveBeenCalled();
    });
    it('unlocks status and manual bulk admission for archived, occurrence-bound reviews', async () => {
        const job = { id: 'bom_recovery_account_one', data: { accountId: 'account:one' } as any, progress: { current: 1 },
            getState: vi.fn().mockResolvedValue('completed'), remove: vi.fn() };
        job.data.bomReconciliation = { auditId: 'audit', fingerprint: bomExecutionFingerprint(job as any) };
        mocks.queue.getJob.mockImplementation(async id => id === job.id ? job : null);
        expect((await app.inject('/bom/sync-status')).json()).toEqual({ isSyncing: false, state: null });
        const response = await app.inject({ method: 'POST', url: '/bom/sync-all' });
        expect(response.json().status).toBe('queued');
        expect(job.remove).toHaveBeenCalledOnce();
        expect(mocks.queue.add).toHaveBeenCalledOnce();
    });
    it.each(['bom_sync_account_one', 'sync_bom_account_one'])('preserves failed stock-write evidence and surfaces reconciliation at %s', async id => {
        const job = { data: { accountId: 'account:one' }, getState: vi.fn().mockResolvedValue('failed'), remove: vi.fn(), progress: { current: 2, total: 3, failed: 1 } };
        mocks.queue.getJob.mockImplementation(async key => key === id ? job : null);
        const response = await app.inject({ method: 'POST', url: '/bom/sync-all' });
        expect(response.statusCode).toBe(409);
        expect(response.json().code).toBe('BOM_SYNC_RECONCILIATION_REQUIRED');
        expect(job.remove).not.toHaveBeenCalled(); expect(mocks.queue.add).not.toHaveBeenCalled();
        expect((await app.inject('/bom/sync-status')).json()).toMatchObject({ isSyncing: false, state: 'failed', requiresReconciliation: true, progress: { current: 2, total: 3 } });
    });

    it('checks shared running work even when a completed legacy job exists', async () => {
        const completed = { data: { accountId: 'account:one' }, getState: vi.fn().mockResolvedValue('completed'), remove: vi.fn() };
        const active = { data: { accountId: 'account:one' }, getState: vi.fn().mockResolvedValue('active') };
        mocks.queue.getJob.mockImplementation(async (id) => id.startsWith('bom_sync_') ? completed : active);
        expect((await app.inject({ method: 'POST', url: '/bom/sync-all' })).json().status).toBe('already_running');
        expect((await app.inject('/bom/sync-status')).json()).toMatchObject({ isSyncing: true, state: 'active' });
        expect(completed.remove).not.toHaveBeenCalled();
        expect(mocks.queue.add).not.toHaveBeenCalled();
    });

    it('does not enqueue if a terminal job becomes locked during removal', async () => {
        const completed = {
            data: { accountId: 'account:one' },
            getState: vi.fn().mockResolvedValue('completed'),
            remove: vi.fn().mockRejectedValue(new Error('locked by another worker'))
        };
        mocks.queue.getJob.mockImplementation(async (id) => id.startsWith('bom_sync_') ? completed : null);
        const response = await app.inject({ method: 'POST', url: '/bom/sync-all' });
        expect(response.statusCode).toBe(500);
        expect(mocks.queue.add).not.toHaveBeenCalled();
    });
    it('does not erase an unreviewed failure discovered after admission preflight', async () => {
        const job = { data: { accountId: 'account:one' }, getState: vi.fn().mockResolvedValueOnce('completed').mockResolvedValue('failed'), remove: vi.fn() };
        mocks.queue.getJob.mockImplementation(async id => id === 'bom_sync_account_one' ? job : null);
        const response = await app.inject({ method: 'POST', url: '/bom/sync-all' });
        expect(response.statusCode).toBe(409);
        expect(job.remove).not.toHaveBeenCalled();
        expect(mocks.queue.add).not.toHaveBeenCalled();
    });

    function queueJob(state: string, accountId = 'account:one') {
        return {
            data: { accountId }, getState: vi.fn().mockResolvedValue(state),
            remove: vi.fn().mockResolvedValue(undefined), moveToFailed: vi.fn()
        };
    }

    it.each(['bom_sync_account_one', 'sync_bom_account_one'])('can safely cancel a running job shown by status at %s', async (id) => {
        const job = queueJob('active');
        mocks.queue.getJob.mockImplementation(async (key) => key === id ? job : null);
        expect((await app.inject('/bom/sync-status')).json().isSyncing).toBe(true);
        const response = await app.inject({ method: 'DELETE', url: '/bom/sync-cancel' });
        expect(response.statusCode).toBe(200);
        expect(response.json()).toMatchObject({ success: true, cancellationRequested: true, previousState: 'active' });
        expect(mocks.requestCancellation).toHaveBeenCalledExactlyOnceWith('bom-inventory-sync', id);
        expect(job.remove).not.toHaveBeenCalled();
        expect(job.moveToFailed).not.toHaveBeenCalled();
    });

    it.each(['waiting', 'prioritized', 'delayed', 'waiting-children'])('removes shared %s jobs normally', async (state) => {
        const job = queueJob(state);
        mocks.queue.getJob.mockImplementation(async (id) => id === 'sync_bom_account_one' ? job : null);
        const response = await app.inject({ method: 'DELETE', url: '/bom/sync-cancel' });
        expect(response.json()).toMatchObject({ success: true, cancellationRequested: false, previousState: state });
        expect(job.remove).toHaveBeenCalledOnce();
        expect(mocks.requestCancellation).not.toHaveBeenCalled();
        expect(job.moveToFailed).not.toHaveBeenCalled();
    });

    it('cancels both IDs if legacy and shared work coexist', async () => {
        const legacy = queueJob('active');
        const shared = queueJob('prioritized');
        mocks.queue.getJob.mockImplementation(async (id) => id.startsWith('bom_sync_') ? legacy : id.startsWith('sync_bom_') ? shared : null);
        const response = await app.inject({ method: 'DELETE', url: '/bom/sync-cancel' });
        expect(response.json()).toMatchObject({ success: true, cancellationRequested: true });
        expect(mocks.requestCancellation).toHaveBeenCalledExactlyOnceWith('bom-inventory-sync', 'bom_sync_account_one');
        expect(shared.remove).toHaveBeenCalledOnce();
        expect(legacy.remove).not.toHaveBeenCalled();
    });

    it('does not let a completed legacy job hide active shared work from cancellation', async () => {
        const legacy = queueJob('completed');
        const shared = queueJob('active');
        mocks.queue.getJob.mockImplementation(async (id) => id.startsWith('bom_sync_') ? legacy : id.startsWith('sync_bom_') ? shared : null);
        const response = await app.inject({ method: 'DELETE', url: '/bom/sync-cancel' });
        expect(response.json()).toMatchObject({ success: true, cancellationRequested: true, previousState: 'active' });
        expect(mocks.requestCancellation).toHaveBeenCalledExactlyOnceWith('bom-inventory-sync', 'sync_bom_account_one');
        expect(legacy.remove).not.toHaveBeenCalled();
    });

    it('requests cooperative cancellation when queued work becomes locked', async () => {
        const job = queueJob('prioritized');
        job.remove.mockRejectedValue(new Error('Job is locked by another worker'));
        mocks.queue.getJob.mockImplementation(async (id) => id === 'sync_bom_account_one' ? job : null);
        const response = await app.inject({ method: 'DELETE', url: '/bom/sync-cancel' });
        expect(response.json()).toMatchObject({ success: true, cancellationRequested: true });
        expect(mocks.requestCancellation).toHaveBeenCalledExactlyOnceWith('bom-inventory-sync', 'sync_bom_account_one');
        expect(job.moveToFailed).not.toHaveBeenCalled();
    });

    it.each(['removal', 'request'])('preserves error reporting when cancellation %s fails', async (failure) => {
        const job = queueJob(failure === 'removal' ? 'waiting' : 'active');
        if (failure === 'removal') job.remove.mockRejectedValue(new Error('Redis unavailable'));
        else mocks.requestCancellation.mockRejectedValue(new Error('Redis unavailable'));
        mocks.queue.getJob.mockImplementation(async (id) => id === 'sync_bom_account_one' ? job : null);
        const response = await app.inject({ method: 'DELETE', url: '/bom/sync-cancel' });
        expect(response.statusCode).toBe(500);
        expect(response.json().code).toBe('BOM_SYNC_CANCEL_FAILED');
        expect(job.moveToFailed).not.toHaveBeenCalled();
        if (failure === 'removal') expect(mocks.requestCancellation).not.toHaveBeenCalled();
    });

    it('rejects cancellation when a normalized ID belongs to another account', async () => {
        const job = queueJob('active', 'account_one');
        mocks.queue.getJob.mockResolvedValue(job);
        const response = await app.inject({ method: 'DELETE', url: '/bom/sync-cancel' });
        expect(response.statusCode).toBe(403);
        expect(mocks.requestCancellation).not.toHaveBeenCalled();
        expect(job.remove).not.toHaveBeenCalled();
    });

    it('returns the no-active-job response when both IDs are absent', async () => {
        mocks.queue.getJob.mockResolvedValue(null);
        const response = await app.inject({ method: 'DELETE', url: '/bom/sync-cancel' });
        expect(response.json()).toEqual({ success: true, message: 'No active sync job found to cancel' });
        expect(mocks.requestCancellation).not.toHaveBeenCalled();
    });

    function recoverySource() {
        const targets = ['done', 'uncertain', 'safe'].map(productId => ({ productId, variationId: 0 }));
        const source = {
            id: 'bom_sync_account_one', data: { accountId: 'account:one', bomManifest: { version: 1, targets } },
            timestamp: 100, processedOn: 110, finishedOn: 200,
            progress: { checkpoint: { version: 1, nextIndex: 1, inFlightIndex: 1, uncertainIndexes: [] } },
            getState: vi.fn().mockResolvedValue('failed'), remove: vi.fn()
        };
        mocks.prisma.bOM.findMany.mockResolvedValue(targets.map(target => ({ ...target, items: [] })));
        mocks.queue.getJob.mockImplementation(async id => id === source.id ? source : null);
        return source;
    }

    it('offers a passive plan and queues only one retained continuation without deleting failed evidence', async () => {
        const source = recoverySource();
        const preview = await app.inject('/bom/sync-recovery');
        expect(preview.statusCode).toBe(200);
        expect(preview.json()).toMatchObject({ eligibleProducts: 1, uncertainProducts: 1, sourceJobIds: [source.id] });
        expect(preview.json()).not.toHaveProperty('targets');
        expect(mocks.queue.add).not.toHaveBeenCalled();
        const payload = { fingerprint: preview.json().fingerprint, confirmedStoppedAndSettled: true };
        const response = await app.inject({ method: 'POST', url: '/bom/sync-recovery', payload });
        expect(response.statusCode).toBe(200);
        expect(response.json().status).toBe('queued');
        expect(mocks.queue.add).toHaveBeenCalledWith('bom-inventory-sync', expect.objectContaining({
            accountId: 'account:one', bomRecovery: expect.objectContaining({ fingerprint: payload.fingerprint, requestedBy: 'operator', sourceJobIds: [source.id] })
        }), expect.objectContaining({ jobId: 'bom_recovery_account_one', attempts: 1, removeOnComplete: false, removeOnFail: false }));
        expect(source.remove).not.toHaveBeenCalled();
        const recovery = { id: 'bom_recovery_account_one', data: mocks.queue.add.mock.calls[0][1], getState: vi.fn().mockResolvedValue('active') };
        mocks.queue.getJob.mockImplementation(async id => id === source.id ? source : id === recovery.id ? recovery : null);
        expect((await app.inject({ method: 'POST', url: '/bom/sync-recovery', payload })).json().status).toBe('already_running');
        expect(mocks.queue.add).toHaveBeenCalledTimes(1);
        expect((await app.inject('/bom/sync-status')).json()).toMatchObject({ isSyncing: true, isRecovery: true });
        expect((await app.inject({ method: 'POST', url: '/bom/sync-all' })).json().status).toBe('already_running');
        recovery.getState.mockResolvedValue('completed');
        expect((await app.inject('/bom/sync-status')).json()).toMatchObject({ isSyncing: false, requiresReconciliation: true });
        expect((await app.inject({ method: 'POST', url: '/bom/sync-all' })).statusCode).toBe(409);
    });

    it('requires current inventory management permission for both recovery routes', async () => {
        mocks.hasPermission.mockResolvedValue(false);
        for (const method of ['GET', 'POST'] as const) {
            expect((await app.inject({ method, url: '/bom/sync-recovery' })).statusCode).toBe(403);
        }
        expect(mocks.queue.getJob).not.toHaveBeenCalled();
        expect(mocks.queue.add).not.toHaveBeenCalled();
    });

    it('rejects stale plans, missing confirmations and caller-supplied target lists', async () => {
        const source = recoverySource();
        const fingerprint = (await app.inject('/bom/sync-recovery')).json().fingerprint;
        for (const payload of [{ fingerprint }, { fingerprint, confirmedStoppedAndSettled: false }, { fingerprint, confirmedStoppedAndSettled: true, targets: ['uncertain'] }]) {
            expect((await app.inject({ method: 'POST', url: '/bom/sync-recovery', payload })).statusCode).toBe(400);
        }
        source.processedOn++;
        expect((await app.inject({ method: 'POST', url: '/bom/sync-recovery', payload: { fingerprint, confirmedStoppedAndSettled: true } })).json().code).toBe('BOM_RECOVERY_CHANGED');
        expect(mocks.queue.add).not.toHaveBeenCalled();
    });

    it('does not offer continuation for legacy counters or unavailable Redis evidence', async () => {
        const source = recoverySource(); source.data.bomManifest = undefined as any;
        expect((await app.inject('/bom/sync-recovery')).json().code).toBe('BOM_RECOVERY_LEGACY_CHECKPOINT');
        mocks.queue.getJob.mockRejectedValue(new Error('Redis unavailable'));
        expect((await app.inject('/bom/sync-recovery')).statusCode).toBe(503);
        expect(mocks.queue.add).not.toHaveBeenCalled();
    });

    it('cooperatively cancels active recovery without removing source evidence', async () => {
        const source = recoverySource();
        const recovery = { id: 'bom_recovery_account_one', ...queueJob('active') };
        mocks.queue.getJob.mockImplementation(async id => id === source.id ? source : id === recovery.id ? recovery : null);
        const response = await app.inject({ method: 'DELETE', url: '/bom/sync-cancel' });
        expect(response.json().cancellationRequested).toBe(true);
        expect(mocks.requestCancellation).toHaveBeenCalledExactlyOnceWith('bom-inventory-sync', recovery.id);
        expect(source.remove).not.toHaveBeenCalled();
        expect(recovery.remove).not.toHaveBeenCalled();
    });

    it('reports unavailable status instead of falsely reporting a stopped worker', async () => {
        mocks.queue.getJob.mockRejectedValue(new Error('Redis unavailable'));
        const response = await app.inject('/bom/sync-status');
        expect(response.statusCode).toBe(503);
        expect(response.json().code).toBe('BOM_SYNC_STATUS_UNAVAILABLE');
        expect(response.json()).not.toHaveProperty('isSyncing');
    });
});
