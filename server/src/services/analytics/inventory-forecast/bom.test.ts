import { beforeEach, describe, expect, it, vi } from 'vitest';
const m = vi.hoisted(() => ({ items: vi.fn(), ancestor: vi.fn(), sales: vi.fn() }));
vi.mock('../../../utils/prisma', () => ({ prisma: { bOMItem: { findMany: m.items, findFirst: m.ancestor } } }));
vi.mock('./sales', () => ({ getHistoricalSales: m.sales }));
import { getBOMComponentMappings, calculateBOMDerivedDemand } from './bom';
const item = () => ({ isActive: true, childProductId: 'child', childProduct: { id: 'child', accountId: 'tenant', wooId: 2 }, quantity: 2, wasteFactor: 0.1, bom: { productId: 'parent', variationId: 0, product: { accountId: 'tenant', wooId: 1, boms: [{ variationId: 10 }] } } });
beforeEach(() => { vi.resetAllMocks(); m.items.mockResolvedValue([item()]); m.ancestor.mockResolvedValue(null); m.sales.mockResolvedValue(new Map([[1, [{ date: '2026-10-01', quantity: 30 }]]])); });
describe('scoped explicit BOM demand support', () => {
    it('scopes SQL before reading and excludes overrides from default-parent demand', async () => {
        const mappings = await getBOMComponentMappings('tenant', ['child'], [], []); expect(m.items.mock.calls[0][0].where.bom.product.accountId).toBe('tenant');
        expect(mappings[0].parentMappings[0].excludedVariationIds).toEqual([10]); expect((await calculateBOMDerivedDemand('tenant', mappings, 30)).get('child')).toBeCloseTo(2.2); expect(m.sales.mock.calls[0][4]).toEqual({ 1: [10] });
    });
    it('refuses nested/cyclic or inactive planning instead of silently omitting demand', async () => {
        m.ancestor.mockResolvedValueOnce({ id: 'nested' }); await expect(getBOMComponentMappings('tenant', ['child'], [], [])).rejects.toThrow('nested/cyclic');
        m.items.mockResolvedValue([{ ...item(), isActive: false }]); await expect(getBOMComponentMappings('tenant', ['child'], [], [])).rejects.toThrow('inactive');
    });
    it('never substitutes a parent when a requested component variation is missing', async () => {
        m.items.mockResolvedValue([{ ...item(), childVariationId: 10, childVariation: null }]); await expect(getBOMComponentMappings('tenant', [], [10], [])).rejects.toThrow('variation unresolved');
    });
});
