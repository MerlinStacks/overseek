import { describe, expect, it, vi } from 'vitest';
import { buildInbound, projectInbound, supplierLead, MAX_INBOUND_LINES, MAX_INBOUND_TARGETS } from './inbound';

const now = new Date('2026-09-21T23:59:00Z');
const product = (overrides = {}) => ({ id: 'p', accountId: 'a', wooId: 10, supplierId: 's', supplier: { accountId: 'a', leadTimeMin: 2, leadTimeMax: 4, leadTimeDefault: 9 }, manageStock: true, rawData: { type: 'simple', manage_stock: true }, boms: [], variations: [], ...overrides });
const line = (overrides = {}) => ({ productId: 'p', variationWooId: null, quantity: 2, purchaseOrder: { accountId: 'a', status: 'ORDERED', expectedDate: new Date('2026-09-22T00:00:00Z') }, ...overrides });
describe('inbound full replacement safety contract', () => {
    it('uses UTC labels, full ordered quantities once, and never certifies receipts', () => {
        const result = projectInbound(10, product(), [line(), line({ quantity: 3 }), line({ purchaseOrder: { accountId: 'a', status: 'RECEIVED', expectedDate: now } }), line({ purchaseOrder: { accountId: 'a', status: 'ORDERED', expectedDate: null } }), line({ purchaseOrder: { accountId: 'a', status: 'ORDERED', expectedDate: new Date('2026-09-20') } })], now);
        expect(result).toEqual({ wooId: 10, generatedAt: now.toISOString(), expiresAt: '2026-09-22T23:59:00.000Z', receiptSafety: 'unverified', targets: [{ wooId: 10, stockOwnerWooId: 10, state: 'pending', supplierLead: { min: 2, max: 4 }, batches: [{ dueDate: '2026-09-22', quantity: 5 }] }] });
    });
    it('inherits only the assigned supplier and uses default only when the range is unset', () => {
        expect(supplierLead({ accountId: 'a', leadTimeMin: null, leadTimeMax: null, leadTimeDefault: 0 }, 'a')).toEqual({ lead: { min: 0, max: 0 }, invalid: false });
        expect(supplierLead(null, 'a')).toEqual({ lead: null, invalid: false });
        for (const supplier of [ { accountId: 'other', leadTimeMin: 2, leadTimeMax: 4, leadTimeDefault: 3 }, { accountId: 'a', leadTimeMin: null, leadTimeMax: 4, leadTimeDefault: 3 }, { accountId: 'a', leadTimeMin: 5, leadTimeMax: 4, leadTimeDefault: 3 }, { accountId: 'a', leadTimeMin: null, leadTimeMax: null, leadTimeDefault: 3651 } ]) {
            expect(projectInbound(10, product({ supplier }), [line()], now).targets).toEqual([{ wooId: 10, stockOwnerWooId: null, state: 'integrity_error', supplierLead: null, batches: [] }]);
        }
    });
    it('keeps independent variation quantities separate and rejects foreign mappings', () => {
        const variable = product({ rawData: { type: 'variable', manage_stock: false }, manageStock: false, variations: [11, 12].map(wooId => ({ wooId, productId: 'p', manageStock: true, rawData: { manage_stock: true } })) });
        const result = projectInbound(10, variable, [line({ variationWooId: 11 }), line({ variationWooId: 12, quantity: 7 })], now);
        expect(result.targets.map(t => [t.wooId, t.state, t.batches])).toEqual([[10, 'unsupported', []], [11, 'pending', [{ dueDate: '2026-09-22', quantity: 2 }]], [12, 'pending', [{ dueDate: '2026-09-22', quantity: 7 }]]]);
        expect(result.targets[1].supplierLead).toEqual({ min: 2, max: 4 });
        expect(projectInbound(10, variable, [line({ variationWooId: 99 })], now).targets[0].state).toBe('integrity_error');
        expect(projectInbound(10, variable, [line({ productId: 'other' })], now).targets[0].state).toBe('integrity_error');
    });
    it('does not support stock-derived BOM/custom types (source BOMs are pre-filtered)', () => {
        for (const source of [product({ boms: [{ id: 'bom' }] }), product({ rawData: { type: 'bundle' } })]) {
            const result = projectInbound(10, source, [line()], now);
            expect(result.targets.every(t => t.state === 'unsupported' && t.stockOwnerWooId === null && !t.batches.length)).toBe(true);
            expect(result.receiptSafety).toBe('unverified');
        }
    });
    it('pools parent and inherited variation lines once per owner, preserving independent siblings', () => {
        const variable = product({ rawData: { type: 'variable', manage_stock: true }, variations: [
            { wooId: 11, productId: 'p', manageStock: false, rawData: { manage_stock: 'parent' } },
            { wooId: 12, productId: 'p', manageStock: false, rawData: { manage_stock: false } },
            { wooId: 13, productId: 'p', manageStock: true, rawData: { manage_stock: true } },
        ] });
        const result = projectInbound(10, variable, [line(), line({ variationWooId: 11, quantity: 3 }), line({ variationWooId: 12, quantity: 5 }), line({ variationWooId: 13, quantity: 7 })], now);
        expect(result.targets.slice(1).map(t => [t.stockOwnerWooId, t.batches])).toEqual([
            [10, [{ dueDate: '2026-09-22', quantity: 10 }]], [10, [{ dueDate: '2026-09-22', quantity: 10 }]], [13, [{ dueDate: '2026-09-22', quantity: 7 }]],
        ]);
        const owners = new Map(result.targets.filter(t => t.stockOwnerWooId != null).map(t => [t.stockOwnerWooId, t]));
        expect([...owners.values()].flatMap(t => t.batches).reduce((n, b) => n + b.quantity, 0)).toBe(17);
        expect(result.receiptSafety).toBe('unverified');
    });
    it('bounds unique owner batches rather than rejecting repeated pool references', () => {
        const variable = product({ rawData: { type: 'variable', manage_stock: true }, variations: Array.from({ length: 1000 }, (_, i) => ({ wooId: 11 + i, productId: 'p', manageStock: false, rawData: { manage_stock: 'parent' } })) });
        const result = projectInbound(10, variable, [line(), line({ purchaseOrder: { accountId: 'a', status: 'ORDERED', expectedDate: new Date('2026-09-23') } })], now);
        expect(result.targets).toHaveLength(1001);
        expect(result.targets[1000]).toMatchObject({ stockOwnerWooId: 10, state: 'pending', batches: [{ dueDate: '2026-09-22', quantity: 2 }, { dueDate: '2026-09-23', quantity: 2 }] });
    });
    it('resolves overrides independently of shared stock pools and actual PO supply', () => {
        const supplier = { accountId: 'a', leadTimeMin: 7, leadTimeMax: 10, leadTimeDefault: null };
        const variable = product({ rawData: { type: 'variable', manage_stock: true }, variations: [
            { wooId: 11, productId: 'p', supplierId: null, supplier: null, manageStock: false, rawData: { manage_stock: 'parent' } },
            { wooId: 12, productId: 'p', supplierId: 'override', supplier, manageStock: false, rawData: { manage_stock: 'parent' } },
            { wooId: 13, productId: 'p', supplierId: 'override', supplier, manageStock: true, rawData: { manage_stock: true } },
        ] });
        const lines = [line(), line({ variationWooId: 12, quantity: 5 }), line({ variationWooId: 13, quantity: 9 })];
        const result = projectInbound(10, variable, lines, now);
        expect(result.targets.slice(1).map(t => [t.stockOwnerWooId, t.supplierLead, t.batches])).toEqual([
            [10, { min: 2, max: 4 }, [{ dueDate: '2026-09-22', quantity: 7 }]],
            [10, { min: 7, max: 10 }, [{ dueDate: '2026-09-22', quantity: 7 }]],
            [13, { min: 7, max: 10 }, [{ dueDate: '2026-09-22', quantity: 9 }]],
        ]);
        expect(result.targets[1].batches).toBe(result.targets[2].batches);
        const withoutParent = projectInbound(10, { ...variable, supplierId: null, supplier: null }, lines, now);
        expect(withoutParent.targets.slice(1).map(t => t.supplierLead)).toEqual([null, { min: 7, max: 10 }, { min: 7, max: 10 }]);
        const cleared = projectInbound(10, { ...variable, variations: variable.variations.map(v => ({ ...v, supplierId: null, supplier: null })) }, lines, now);
        expect(cleared.targets.slice(1).map(t => t.supplierLead)).toEqual(Array(3).fill({ min: 2, max: 4 }));
        expect(cleared.targets.map(t => t.batches)).toEqual(result.targets.map(t => t.batches));
    });
    it('does not inherit parent lead times from an assigned supplier with no lead, and rejects invalid overrides', () => {
        const source = (supplier: any) => product({ rawData: { type: 'variable' }, variations: [
            { wooId: 11, productId: 'p', supplierId: 'override', supplier, manageStock: true, rawData: { manage_stock: true } },
        ] });
        const empty = { accountId: 'a', leadTimeMin: null, leadTimeMax: null, leadTimeDefault: null };
        expect(projectInbound(10, source(empty), [line({ variationWooId: 11 })], now).targets[1]).toMatchObject({ supplierLead: null, batches: [{ dueDate: '2026-09-22', quantity: 2 }] });
        expect(projectInbound(10, source({ ...empty, leadTimeDefault: 6 }), [], now).targets[1].supplierLead).toEqual({ min: 6, max: 6 });
        for (const supplier of [null, { ...empty, accountId: 'other' }, { ...empty, leadTimeMin: 5, leadTimeMax: 2 }]) {
            expect(projectInbound(10, source(supplier), [], now).targets).toEqual([{ wooId: 10, stockOwnerWooId: null, state: 'integrity_error', supplierLead: null, batches: [] }]);
        }
    });
    it('clears removed batches, targets and deleted products without retaining derived data', () => {
        expect(projectInbound(10, product({ supplierId: null, supplier: null }), [], now).targets[0]).toMatchObject({ state: 'pending', supplierLead: null, batches: [] });
        expect(projectInbound(10, null, [], now).targets).toEqual([]);
        expect(projectInbound(10, product(), [line({ purchaseOrder: { accountId: 'other', status: 'ORDERED', expectedDate: now } })], now).targets[0].batches).toEqual([]);
    });
    it('fails closed on invalid quantities, aggregation overflow and source/target bounds', () => {
        for (const quantity of [0, -1, 1.5, NaN, 1_000_001]) expect(projectInbound(10, product(), [line({ quantity })], now).targets[0].state).toBe('integrity_error');
        for (const [source, lines] of [[product(), [line({ quantity: 1_000_000 }), line()]], [product(), Array.from({ length: MAX_INBOUND_LINES + 1 }, () => line())], [product({ variations: Array.from({ length: MAX_INBOUND_TARGETS }, (_, i) => ({ wooId: i + 11, productId: 'p', manageStock: true, rawData: {} })) }), []]] as const) {
            expect(projectInbound(10, source, [...lines], now).targets).toEqual([{ wooId: 10, stockOwnerWooId: null, state: 'integrity_error', supplierLead: null, batches: [] }]);
        }
    });
    it('bounds DB source reads and scopes direct PO lines to tenant-owned ORDERED orders', async () => {
        const tx = { receiptAccount: { findUnique: vi.fn().mockResolvedValue(null) }, wooProduct: { findFirst: vi.fn().mockResolvedValue(product()) }, purchaseOrderItem: { findMany: vi.fn().mockResolvedValue([]) } };
        await buildInbound(tx as any, 'a', 10);
        expect(tx.wooProduct.findFirst.mock.calls[0][0]).toMatchObject({ where: { accountId: 'a', wooId: 10 }, select: { variations: { take: 1001, select: { supplierId: true, supplier: { select: { accountId: true, leadTimeMin: true, leadTimeMax: true, leadTimeDefault: true } } } }, boms: { take: 1 } } });
        expect(tx.wooProduct.findFirst.mock.calls[0][0].select.boms.where.items.some.OR).toEqual([
            { childProductId: { not: null } }, { childVariationId: { not: null } }, { internalProductId: { not: null } },
        ]);
        expect(tx.purchaseOrderItem.findMany.mock.calls[0][0]).toMatchObject({ where: { productId: 'p', purchaseOrder: { accountId: 'a', status: 'ORDERED' } }, take: 1001 });
    });
});
