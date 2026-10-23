import { beforeEach, describe, expect, it, vi } from 'vitest';
const m = vi.hoisted(() => ({ items: vi.fn(), sales: vi.fn() }));
vi.mock('../../../utils/prisma', () => ({ prisma: { bOMItem: { findMany: m.items } } }));
vi.mock('./sales', () => ({ getHistoricalSales: m.sales }));
import { getBOMComponentMappings, calculateBOMDerivedDemand } from './bom';
const item = () => ({ isActive: true, childProductId: 'child', childProduct: { id: 'child', accountId: 'tenant', wooId: 2, boms: [] }, quantity: 2, wasteFactor: 0.1, bom: { productId: 'parent', variationId: 0, product: { accountId: 'tenant', wooId: 1, boms: [{ variationId: 10 }] } } });
beforeEach(() => { vi.resetAllMocks(); m.items.mockResolvedValue([item()]); m.sales.mockResolvedValue(new Map([[1, [{ date: '2026-10-01', quantity: 30 }]]])); });
describe('scoped explicit BOM demand support', () => {
    it('scopes SQL before reading and excludes overrides from default-parent demand', async () => {
        const mappings = await getBOMComponentMappings('tenant', ['child'], [], []); expect(m.items.mock.calls[0][0].where.bom.product.accountId).toBe('tenant');
        expect(m.items.mock.calls[0][0]).toMatchObject({ take: 10001, where: { isActive: true } });
        expect(mappings[0].componentWooId).toBe(2);
        expect(mappings[0].parentMappings[0].excludedVariationIds).toEqual([10]); expect((await calculateBOMDerivedDemand('tenant', mappings, 30)).get('child')).toBeCloseTo(2.2); expect(m.sales.mock.calls[0][4]).toEqual({ 1: [10] });
    });
    it('excludes disabled recipe lines consistently with stock calculation', async () => {
        m.items.mockResolvedValue([{ ...item(), isActive: false }]); await expect(getBOMComponentMappings('tenant', ['child'], [], [])).resolves.toEqual([]);
    });
    it('includes upstream demand even when assemblies are not managed-stock rows', async () => {
        m.items.mockResolvedValue([item(), { ...item(), childProductId: 'parent', childProduct: { id: 'parent', accountId: 'tenant', wooId: 1, boms: [{ variationId: 0 }] }, quantity: 3, wasteFactor: 0.2, bom: { productId: 'root', variationId: 0, product: { accountId: 'tenant', wooId: 3, boms: [] } } }]);
        m.sales.mockResolvedValue(new Map([[1, [{ quantity: 30 }]], [3, [{ quantity: 30 }]]]));
        const demand = await calculateBOMDerivedDemand('tenant', await getBOMComponentMappings('tenant', ['child'], [], []), 30);
        expect(demand.get('child')).toBeCloseTo(2.2 + 2.2 * 3.6);
        expect(m.items).toHaveBeenCalledTimes(1);
        expect(m.sales).toHaveBeenCalledTimes(1);
    });
    it('rejects truncated graph reads and propagates search failures', async () => {
        m.items.mockResolvedValue(Array(10001).fill(item()));
        await expect(getBOMComponentMappings('tenant', ['child'], [], [])).rejects.toThrow('coverage limit');
        m.sales.mockRejectedValue(new Error('Historical sales coverage unavailable'));
        m.items.mockResolvedValue([item()]);
        await expect(calculateBOMDerivedDemand('tenant', await getBOMComponentMappings('tenant', ['child'], [], []), 30)).rejects.toThrow('coverage unavailable');
    });
    it('never substitutes a parent when a requested component variation is missing', async () => {
        m.items.mockResolvedValue([{ ...item(), childVariationId: 10, childVariation: null }]); await expect(getBOMComponentMappings('tenant', [], [10], [])).rejects.toThrow('variation unresolved');
    });
});
