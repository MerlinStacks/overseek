import { beforeEach, describe, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ transaction: vi.fn(), woo: vi.fn(), dirty: vi.fn(), cascade: vi.fn(), update: vi.fn(), variation: vi.fn() }));
vi.mock('../../utils/prisma', () => ({ prisma: { $transaction: mocks.transaction, receiptLegacyWork: { updateMany: vi.fn() }, receiptAccount: { findUnique: vi.fn().mockResolvedValue({ receivingFrozen: false }) } } }));
vi.mock('./intents', () => ({ lockDeliveryAccount: vi.fn(), dirtyInboundProducts: mocks.dirty, dirtyInboundProductIds: mocks.dirty }));
vi.mock('../woo', () => ({ WooService: { forAccount: mocks.woo } }));
vi.mock('../BOMConsumptionService', () => ({ BOMConsumptionService: { cascadeSyncAffectedProducts: mocks.cascade } }));
vi.mock('../../utils/logger', () => ({ Logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));
import { PurchaseOrderService } from '../PurchaseOrderService';

const product = (accountId = 'a', id = 'p', wooId = 10) => ({ id, accountId, wooId, name: id, manageStock: true, rawData: { id: wooId, type: 'simple', manage_stock: true }, boms: [], usedInBOMItems: [] });
let db: any;
let failLedger: boolean;
const service = new PurchaseOrderService();
beforeEach(() => {
    vi.clearAllMocks(); failLedger = false;
    mocks.dirty.mockResolvedValue(undefined); mocks.update.mockResolvedValue(undefined); mocks.variation.mockResolvedValue(undefined);
    mocks.woo.mockResolvedValue({ updateProduct: mocks.update, updateProductVariation: mocks.variation });
    db = { mode: 'GUARDED', status: 'ORDERED', stock: 5, products: [product()], variations: [], items: [{ productId: 'p', variationWooId: null, quantity: 3 }], cycles: [], ops: [], owners: {}, audits: [] };
    mocks.transaction.mockImplementation(async callback => {
        const staged = structuredClone(db);
        const tx = {
            $executeRaw: vi.fn(),
            $queryRaw: async (parts: TemplateStringsArray, ...args: any[]) => {
                const sql = parts.join('?');
                if (sql.includes('SELECT "receiptTransportMode"')) return [{ receiptTransportMode: staged.mode }];
                if (sql.includes('FOR UPDATE') && (sql.includes('"WooProduct"') || sql.includes('"ProductVariation"'))) return [{ id: 'locked' }];
                if (sql.includes('UPDATE "WooProduct"') || sql.includes('UPDATE "ProductVariation"')) {
                    staged.stock += sql.includes(' - ') ? -args[0] : args[0];
                    return [{ stock: staged.stock, stock_quantity: staged.stock }];
                }
                return [];
            },
            purchaseOrder: {
                findFirst: async ({ where }: any) => where.accountId === 'a' ? { id: 'po', accountId: 'a', status: staged.status, items: staged.items.map((i: any) => ({ ...i, product: staged.products.find((p: any) => p.id === i.productId) })) } : null,
                update: async ({ data }: any) => { staged.status = data.status; },
            },
            wooProduct: { findFirst: async ({ where }: any) => staged.products.find((p: any) => (where.id === undefined || p.id === where.id) && (where.wooId === undefined || p.wooId === where.wooId) && p.accountId === where.accountId) },
            productVariation: { findUnique: async () => staged.variations[0], findMany: async () => staged.variations },
            receiptCycle: {
                findFirst: async ({ where }: any) => { const c = staged.cycles.find((c: any) => c.accountId === where.accountId && c.purchaseOrderId === where.purchaseOrderId && c.active); return c ? { ...c, operations: staged.ops.filter((o: any) => o.cycleId === c.id && o.delta > 0) } : null; },
                create: async ({ data }: any) => { const c = { id: `cycle${staged.cycles.length}`, ...data, active: true }; staged.cycles.push(c); return c; },
                update: async ({ where, data }: any) => Object.assign(staged.cycles.find((c: any) => c.id === where.id), data),
            },
            receiptAccount: { upsert: vi.fn(), findUnique: async () => ({ receivingFrozen: staged.frozen ?? false }) },
            receiptLegacyWork: { create: async () => ({ id: 'legacy-job' }) },
            receiptOwner: { upsert: async ({ create }: any) => { const key = `${create.accountId}:${create.stockOwnerWooId}`; const lastSequence = (staged.owners[key] ?? 0n) + 1n; staged.owners[key] = lastSequence; return { lastSequence }; } },
            receiptOperation: { create: async ({ data }: any) => { if (failLedger) throw new Error('ledger unavailable'); const op = { state: 'pending', ...data }; staged.ops.push(op); return op; } },
            auditLog: { create: async ({ data }: any) => staged.audits.push(data) },
        };
        const result = await callback(tx); db = staged; return result;
    });
});

function settle() { for (const op of db.ops) { op.state = 'applied'; op.cascadeState = 'done'; } }

describe('guarded transactional receipt intent', () => {
    it.each([null, 11])('rejects new stock movements for trashed parents (variation=%s)', async variationId => {
        db.products[0].status = 'trash';
        db.items[0].variationWooId = variationId;
        if (variationId) {
            db.products[0].rawData = { ...db.products[0].rawData, type: 'variable', variations: [variationId] };
            db.variations = [{ id: 'v', productId: 'p', wooId: variationId, manageStock: true, rawData: { id: variationId, manage_stock: true }, bomItemsAsChild: [] }];
        }
        await expect(service.receiveStock('a', 'po')).rejects.toThrow('trashed products');
        expect(db.stock).toBe(5);
        expect(db.status).toBe('ORDERED');
        expect(db.ops).toEqual([]);
    });
    it('freezes both legacy and guarded receiving while cutover is transitioning', async () => {
        for (const mode of ['LEGACY', 'GUARDED']) {
            db.mode = mode; db.frozen = true;
            await expect(service.receiveStock('a', 'po')).rejects.toThrow('receiving is frozen');
            expect(db.stock).toBe(5); expect(db.ops).toEqual([]);
        }
    });
    it('uses the real parent owner without forcing variation-local stock', async () => {
        db.products[0].rawData = { id: 10, type: 'variable', manage_stock: true, variations: [11] };
        db.items[0].variationWooId = 11;
        db.items.push({ productId: 'p', variationWooId: null, quantity: 4 });
        db.variations = [{ id: 'v', productId: 'p', wooId: 11, manageStock: false, rawData: { id: 11, manage_stock: 'parent' }, bomItemsAsChild: [] }];
        await service.receiveStock('a', 'po');
        expect(db.ops[0]).toMatchObject({ stockOwnerWooId: 10, variationId: null, variationWooId: 11, delta: 7 });
        expect(db.ops).toHaveLength(1);
        expect(db.stock).toBe(12);
        settle();
        db.variations = []; db.products[0].rawData.variations = []; // Original sibling removed; real stock owner remains.
        await service.unreceiveStock('a', 'po'); expect(db.stock).toBe(5);
        expect(db.ops[1]).toMatchObject({ stockOwnerWooId: 10, variationWooId: null, variationId: null, delta: -7 });
    });
    it('aggregates duplicate owners, records immutable identity, and does not call Woo on save', async () => {
        db.items.push({ productId: 'p', variationWooId: null, quantity: 4 });
        await service.receiveStock('a', 'po');
        expect(db.stock).toBe(12); expect(db.status).toBe('RECEIVED');
        expect(db.ops).toHaveLength(1);
        expect(db.ops[0]).toMatchObject({ accountId: 'a', purchaseOrderId: 'po', delta: 7, sequence: 1n, productWooId: 10, variationWooId: null, stockOwnerWooId: 10 });
        expect(db.ops[0].operationId).toMatch(/^[A-Za-z0-9_-]{1,128}$/);
        expect(mocks.woo).not.toHaveBeenCalled(); expect(mocks.cascade).not.toHaveBeenCalled();
    });
    it('duplicate receipt/reversal calls are no-ops, and reversal ignores edited current lines', async () => {
        await service.receiveStock('a', 'po'); await service.receiveStock('a', 'po');
        settle();
        db.items = [{ productId: 'edited-other-product', variationWooId: 999, quantity: 888 }];
        await service.unreceiveStock('a', 'po'); await service.unreceiveStock('a', 'po');
        expect(db.stock).toBe(5); expect(db.ops.map((o: any) => [o.stockOwnerWooId, o.sequence, o.delta])).toEqual([[10, 1n, 3], [10, 2n, -3]]);
        expect(new Set(db.ops.map((o: any) => o.operationId)).size).toBe(2);
    });
    it('rolls stock, PO, sequence, and ledger back if the commit intent fails after stock changed', async () => {
        const before = structuredClone(db); mocks.dirty.mockRejectedValueOnce(new Error('crash before commit'));
        await expect(service.receiveStock('a', 'po')).rejects.toThrow('crash before commit');
        expect(db).toEqual(before); expect(mocks.woo).not.toHaveBeenCalled();
        await service.receiveStock('a', 'po'); expect(db.ops[0].sequence).toBe(1n);
    });
    it('does not mutate stock if recording ledger intent fails', async () => {
        failLedger = true; const before = structuredClone(db);
        await expect(service.receiveStock('a', 'po')).rejects.toThrow('ledger unavailable'); expect(db).toEqual(before);
    });
    it.each(['unmanaged', 'fractional', 'overflow'])('fails %s before local stock mutation', async kind => {
        if (kind === 'unmanaged') db.products[0].rawData.manage_stock = false;
        if (kind === 'fractional') db.items[0].quantity = 1.5;
        if (kind === 'overflow') db.items[0].quantity = 1_000_001;
        const before = structuredClone(db);
        await expect(service.receiveStock('a', 'po')).rejects.toThrow('Guarded receipt:'); expect(db).toEqual(before);
    });
    it('receives native components, preserves finished-BOM/unlinked skips, and reverses only applied ledger targets', async () => {
        db.products[0].usedInBOMItems = [{ id: 'component-reference' }];
        db.products.push({ ...product('a', 'finished', 20), boms: [{ id: 'bom', items: [{ id: 'component' }] }] });
        db.items.push({ productId: 'finished', variationWooId: null, quantity: 7 }, { productId: null, variationWooId: null, quantity: 8 });
        const result = await service.receiveStock('a', 'po');
        expect(result).toMatchObject({ updated: 1, errors: ['finished is a BOM product - stock not updated'] });
        expect(db.status).toBe('RECEIVED'); expect(db.stock).toBe(8);
        expect(db.ops[0]).toMatchObject({ stockOwnerWooId: 10, delta: 3, cascadeState: 'waiting_receipt' });
        expect(db.cycles[0].skippedLines.map((s: any) => s.reason)).toEqual(['finished_bom', 'unlinked_or_supplier_only']);
        await expect(service.unreceiveStock('a', 'po')).rejects.toThrow('finish receipt application');
        settle(); db.items = [{ productId: 'finished', variationWooId: null, quantity: 999 }];
        await service.unreceiveStock('a', 'po');
        expect(db.stock).toBe(5); expect(db.ops[1]).toMatchObject({ productId: 'p', delta: -3 });
    });
    it('supports variation components without treating bomItemsAsChild as a finished BOM', async () => {
        db.products[0].rawData = { id: 10, type: 'variable', manage_stock: false, variations: [11] };
        db.items[0].variationWooId = 11;
        db.variations = [{ id: 'v', productId: 'p', wooId: 11, manageStock: true, rawData: { id: 11, manage_stock: true }, bomItemsAsChild: [{ id: 'reference' }] }];
        await service.receiveStock('a', 'po'); expect(db.ops[0]).toMatchObject({ stockOwnerWooId: 11, delta: 3 });
    });
    it.each(['empty', 'supplier', 'finished'])('keeps %s cycles as provenance without fictional stock operations', async kind => {
        db.items = kind === 'empty' ? [] : [{ productId: kind === 'supplier' ? null : 'p', variationWooId: null, quantity: 5 }];
        if (kind === 'finished') db.products[0].boms = [{ id: 'bom', items: [{ id: 'stock-item' }] }];
        await service.receiveStock('a', 'po'); expect(db.status).toBe('RECEIVED'); expect(db.cycles).toHaveLength(1); expect(db.ops).toEqual([]);
        db.items = [{ productId: 'p', variationWooId: null, quantity: 99 }]; db.products[0].boms = [];
        await service.unreceiveStock('a', 'po'); expect(db.status).toBe('ORDERED'); expect(db.ops).toEqual([]); expect(db.stock).toBe(5);
        expect(db.cycles[0].active).toBe(false);
    });
    it('supports independent variations, but rejects parent-managed variations', async () => {
        db.products[0].rawData = { id: 10, type: 'variable', variations: [11] };
        db.items[0].variationWooId = 11;
        db.variations = [{ id: 'v', productId: 'p', wooId: 11, manageStock: true, rawData: { id: 11, manage_stock: 'parent' }, bomItemsAsChild: [] }];
        await expect(service.receiveStock('a', 'po')).rejects.toThrow('independent stock ownership');
        db.variations[0].rawData.manage_stock = true;
        await service.receiveStock('a', 'po');
        expect(db.ops[0]).toMatchObject({ variationId: 'v', productWooId: 10, variationWooId: 11, stockOwnerWooId: 11 });
    });
    it('refuses to reverse a legacy receipt without guarded provenance', async () => {
        db.status = 'RECEIVED'; await expect(service.unreceiveStock('a', 'po')).rejects.toThrow('no guarded receipt ledger'); expect(db.stock).toBe(5);
    });
    it('tenant-scopes the PO before ledger or stock writes', async () => {
        await expect(service.receiveStock('b', 'po')).rejects.toThrow('Purchase Order not found'); expect(db.ops).toEqual([]);
    });
    it('retains the legacy absolute receive/reversal path and BOM cascade', async () => {
        db.mode = 'LEGACY';
        await service.receiveStock('a', 'po'); await new Promise(resolve => setImmediate(resolve));
        expect(mocks.update).toHaveBeenLastCalledWith(10, { manage_stock: true, stock_quantity: 8 });
        await service.unreceiveStock('a', 'po'); await new Promise(resolve => setImmediate(resolve));
        expect(mocks.update).toHaveBeenLastCalledWith(10, { stock_quantity: 5 });
        expect(mocks.woo).toHaveBeenCalledTimes(2); expect(mocks.cascade).toHaveBeenCalledTimes(2); expect(db.ops).toEqual([]);
    });
    it('retains legacy variation transport payloads without creating receipt intent', async () => {
        db.mode = 'LEGACY'; db.items[0].variationWooId = 11;
        db.variations = [{ id: 'v', productId: 'p', wooId: 11 }];
        await service.receiveStock('a', 'po'); await new Promise(resolve => setImmediate(resolve));
        expect(mocks.variation).toHaveBeenLastCalledWith(10, 11, { manage_stock: true, stock_quantity: 8 });
        await service.unreceiveStock('a', 'po'); await new Promise(resolve => setImmediate(resolve));
        expect(mocks.variation).toHaveBeenLastCalledWith(10, 11, { stock_quantity: 5 }); expect(mocks.update).not.toHaveBeenCalled(); expect(db.ops).toEqual([]);
    });
    it('rejects reversal when the original received identity was remapped instead of targeting the replacement', async () => {
        await service.receiveStock('a', 'po'); db.products[0].wooId = 20; db.products[0].rawData.id = 20;
        settle();
        const before = structuredClone(db);
        await expect(service.unreceiveStock('a', 'po')).rejects.toThrow('original received target changed'); expect(db).toEqual(before);
    });
    it('keeps original ledger identity while resolving rebuilt cache rows by the original physical Woo IDs', async () => {
        await service.receiveStock('a', 'po'); settle();
        db.products[0].id = 'rebuilt-cache-row'; db.items = [];
        await service.unreceiveStock('a', 'po');
        expect(db.ops[0].productId).toBe('p');
        expect(db.ops[1]).toMatchObject({ productId: 'rebuilt-cache-row', productWooId: 10, stockOwnerWooId: 10, delta: -3 });
        expect(db.stock).toBe(5);
    });
});
