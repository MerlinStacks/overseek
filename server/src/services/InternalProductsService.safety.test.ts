import { beforeEach, describe, expect, it, vi } from 'vitest';
const m = vi.hoisted(() => ({ findUnique: vi.fn(), update: vi.fn(), audit: vi.fn(), lock: vi.fn(), transaction: vi.fn(), parents: vi.fn(), removeLinks: vi.fn(), removeProduct: vi.fn(), sync: vi.fn(), cascade: vi.fn() }));
vi.mock('../utils/prisma', () => ({ prisma: { $transaction: m.transaction } }));
vi.mock('../utils/logger', () => ({ Logger: { info: vi.fn() } }));
vi.mock('./BOMInventorySyncService', () => ({ BOMInventorySyncService: { syncProductToWoo: m.sync } }));
vi.mock('./BOMConsumptionService', () => ({ BOMConsumptionService: { cascadeSyncAffectedProducts: m.cascade } }));
import { InternalProductsService } from './InternalProductsService';
beforeEach(() => { vi.resetAllMocks(); m.transaction.mockImplementation(work => work({ $queryRaw: m.lock, internalProduct: { findUnique: m.findUnique, update: m.update, delete: m.removeProduct }, bOMItem: { findMany: m.parents, deleteMany: m.removeLinks }, auditLog: { create: m.audit } })); m.findUnique.mockResolvedValue({ accountId: 'tenant', stockQuantity: 5, name: 'Part' }); m.update.mockResolvedValue({ stockQuantity: 3, cogs: 0, images: [], _count: { bomItems: 0 } }); });
describe('internal stock adjustment safety', () => {
    it('locks stock and writes its audit in the same transaction', async () => {
        await InternalProductsService.adjustStock('id', -2, 'Correction', 'SYSTEM_BOM', 'tenant');
        expect(m.lock).toHaveBeenCalledOnce(); expect(m.update).toHaveBeenCalledWith(expect.objectContaining({ where: { id: 'id', accountId: 'tenant' }, data: { stockQuantity: 3 } })); expect(m.audit).toHaveBeenCalledOnce();
    });
    it('does not permit missing or foreign tenant scope', async () => {
        await expect(InternalProductsService.adjustStock('id', 1, 'Reason')).rejects.toThrow('Account ID');
        m.findUnique.mockResolvedValue(null); await expect(InternalProductsService.adjustStock('id', 1, 'Reason', 'SYSTEM_BOM', 'other')).rejects.toThrow('not found'); expect(m.update).not.toHaveBeenCalled();
    });
    it('captures affected parents before deleting links and synchronizes them after commit', async () => {
        m.findUnique.mockResolvedValue({ accountId: 'tenant', name: 'Part', _count: { bomItems: 1 } });
        m.parents.mockResolvedValue([{ bom: { productId: 'parent', variationId: 0 } }]);
        await expect(InternalProductsService.forceDelete('id', 'tenant')).resolves.toEqual({ success: true, bomItemsRemoved: 1 });
        expect(m.removeLinks).toHaveBeenCalledWith({ where: { internalProductId: 'id', bom: { product: { accountId: 'tenant' } } } });
        expect(m.removeProduct).toHaveBeenCalledWith({ where: { id: 'id', accountId: 'tenant' } });
        expect(m.sync).toHaveBeenCalledWith('tenant', 'parent', 0); expect(m.cascade).toHaveBeenCalledWith('tenant', 'parent', 0);
    });
    it('refuses force deletion if BOM ownership is inconsistent', async () => {
        m.findUnique.mockResolvedValue({ accountId: 'tenant', _count: { bomItems: 2 } }); m.parents.mockResolvedValue([{ bom: { productId: 'parent', variationId: 0 } }]);
        await expect(InternalProductsService.forceDelete('id', 'tenant')).rejects.toThrow('ownership'); expect(m.removeLinks).not.toHaveBeenCalled(); expect(m.removeProduct).not.toHaveBeenCalled();
    });
});
