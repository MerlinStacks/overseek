import Fastify from 'fastify';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
    prisma: {
        bOM: { findMany: vi.fn(), findUnique: vi.fn(), count: vi.fn() },
        wooProduct: { findFirst: vi.fn() },
        productVariation: { findUnique: vi.fn() }
    },
    queue: { getJob: vi.fn(), add: vi.fn() },
    requestCancellation: vi.fn(),
    forAccount: vi.fn()
}));
vi.mock('../../utils/prisma', () => ({ prisma: mocks.prisma }));
vi.mock('../../middleware/auth', () => ({
    requireAuthFastify: async (request: any) => { request.accountId = 'account:one'; }
}));
vi.mock('../../utils/logger', () => ({
    Logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }
}));
vi.mock('../../services/woo', () => ({ WooService: { forAccount: mocks.forAccount } }));
vi.mock('../../services/StockValidationService', () => ({ StockValidationService: {} }));
vi.mock('../../services/sync/SyncCancellationService', () => ({
    SyncCancellationService: { request: mocks.requestCancellation }
}));
vi.mock('../../services/queue/QueueFactory', () => ({
    QueueFactory: { getQueue: () => mocks.queue },
    QUEUES: { BOM_SYNC: 'bom-inventory-sync' }
}));

import { bomSyncRoutes } from './bomSync';
import { BOMInventorySyncService, localBOMItems } from '../../services/BOMInventorySyncService';

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
        expect(result?.components[0]).toMatchObject({ childWooId: 20, childName: 'Part (Variant BLUE)', childStock: -3 });
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
            expect.objectContaining({ jobId: 'bom_sync_account_one' }));
    });

    it('checks shared running work even when a completed legacy job exists', async () => {
        const completed = { getState: vi.fn().mockResolvedValue('completed'), remove: vi.fn() };
        const active = { getState: vi.fn().mockResolvedValue('active') };
        mocks.queue.getJob.mockImplementation(async (id) => id.startsWith('bom_sync_') ? completed : active);
        expect((await app.inject({ method: 'POST', url: '/bom/sync-all' })).json().status).toBe('already_running');
        expect((await app.inject('/bom/sync-status')).json()).toMatchObject({ isSyncing: true, state: 'active' });
        expect(completed.remove).not.toHaveBeenCalled();
        expect(mocks.queue.add).not.toHaveBeenCalled();
    });

    it('does not enqueue if a terminal job becomes locked during removal', async () => {
        const completed = {
            getState: vi.fn().mockResolvedValue('completed'),
            remove: vi.fn().mockRejectedValue(new Error('locked by another worker'))
        };
        mocks.queue.getJob.mockImplementation(async (id) => id.startsWith('bom_sync_') ? completed : null);
        const response = await app.inject({ method: 'POST', url: '/bom/sync-all' });
        expect(response.statusCode).toBe(500);
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
        mocks.queue.getJob.mockImplementation(async (id) => id.startsWith('bom_sync_') ? legacy : shared);
        const response = await app.inject({ method: 'DELETE', url: '/bom/sync-cancel' });
        expect(response.json()).toMatchObject({ success: true, cancellationRequested: true });
        expect(mocks.requestCancellation).toHaveBeenCalledExactlyOnceWith('bom-inventory-sync', 'bom_sync_account_one');
        expect(shared.remove).toHaveBeenCalledOnce();
        expect(legacy.remove).not.toHaveBeenCalled();
    });

    it('does not let a completed legacy job hide active shared work from cancellation', async () => {
        const legacy = queueJob('completed');
        const shared = queueJob('active');
        mocks.queue.getJob.mockImplementation(async (id) => id.startsWith('bom_sync_') ? legacy : shared);
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
});
