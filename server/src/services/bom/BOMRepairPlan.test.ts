import { beforeEach, describe, expect, it, vi } from 'vitest';
const m = vi.hoisted(() => ({ boms: vi.fn() }));
vi.mock('../../utils/prisma', () => ({ prisma: { bOM: { findMany: m.boms } } }));
import { assertRepairComponentDefinitions, loadBOMRepairPlan, orderBOMRepairTargets, repairDefinitionFingerprint } from './BOMRepairPlan';

function bom(productId: string, childProductId = 'leaf', variationId = 0, childVariant = 0): any {
    return { productId, variationId, product: { id: productId, accountId: 'a', wooId: 10, name: productId, sku: null },
        items: [{ id: `item-${productId}-${variationId}`, childProductId, childVariationId: childVariant ? 'variant' : null,
            childVariation: childVariant ? { wooId: childVariant, productId: childProductId } : null,
            internalProductId: null, supplierItemId: null, quantity: 1, wasteFactor: 0 }] };
}
beforeEach(() => vi.resetAllMocks());
describe('automatic BOM repair plan', () => {
    it('orders leaves before nested BOM parents regardless of input order', () => {
        const plan = orderBOMRepairTargets([bom('parent', 'middle'), bom('middle', 'child'), bom('child')]);
        expect(plan.ordered.map(row => row.productId)).toEqual(['child', 'middle', 'parent']);
        expect(plan.blocked).toEqual([]);
    });
    it('supports acyclic dependencies between sibling variation BOMs', () => {
        const plan = orderBOMRepairTargets([bom('parent', 'parent', 22, 21), bom('parent', 'leaf', 21)]);
        expect(plan.ordered.map(row => row.variationId)).toEqual([21, 22]);
        expect(plan.blocked).toEqual([]);
    });
    it('quarantines cycles and their downstream dependents but not unrelated targets', () => {
        const plan = orderBOMRepairTargets([bom('a', 'b'), bom('b', 'a'), bom('parent', 'a'), bom('safe')]);
        expect(plan.ordered.map(row => row.productId)).toEqual(['safe']);
        expect(plan.blocked.map(row => row.productId)).toEqual(['a', 'b', 'parent']);
    });
    it('binds a definition to quantities and mappings, not DB row order', () => {
        const first = bom('p'); first.items.push({ ...first.items[0], id: 'second', quantity: 2 });
        const hash = repairDefinitionFingerprint(first);
        first.items.reverse();
        expect(repairDefinitionFingerprint(first)).toBe(hash);
        first.items[0].quantity++;
        expect(repairDefinitionFingerprint(first)).not.toBe(hash);
    });
    it('scopes the query, omits deactivated/cost-only BOMs and retains broken mappings as exceptions', async () => {
        const costOnly = bom('cost'); costOnly.items[0].childProductId = null; costOnly.items[0].supplierItemId = 'supplier';
        const deactivated = bom('inactive'); deactivated.items = [];
        const broken = bom('broken'); broken.items[0].childProductId = null;
        m.boms.mockResolvedValue([bom('normal'), costOnly, deactivated, broken]);
        expect((await loadBOMRepairPlan('a')).boms.map(row => row.productId)).toEqual(['broken', 'normal']);
        expect(m.boms).toHaveBeenCalledWith(expect.objectContaining({ where: { product: { accountId: 'a' } }, take: 10001 }));
        expect(() => assertRepairComponentDefinitions(broken)).toThrow('BOM_REPAIR_COMPONENT_INVALID');
    });
    it.each([0, -1, NaN, Infinity])('rejects invalid required quantity %s before writes', quantity => {
        const row = bom('p'); row.items[0].quantity = quantity;
        expect(() => assertRepairComponentDefinitions(row)).toThrow('BOM_REPAIR_COMPONENT_INVALID');
    });
    it('rejects over-limit catalogues rather than silently repairing a prefix', async () => {
        m.boms.mockResolvedValue(Array.from({ length: 10001 }, () => bom('p')));
        await expect(loadBOMRepairPlan('a')).rejects.toMatchObject({ code: 'BOM_REPAIR_LIMIT' });
    });
    it('does not misclassify an orphaned variation mapping as a harmless supplier-only cost row', async () => {
        const row = bom('broken');
        row.items[0].childProductId = null;
        row.items[0].childVariationId = 'orphaned-variation';
        row.items[0].supplierItemId = 'supplier';
        row.items[0].childVariation = { wooId: 21, productId: 'missing-parent' };
        m.boms.mockResolvedValue([row]);
        expect((await loadBOMRepairPlan('a')).boms).toHaveLength(1);
        expect(() => assertRepairComponentDefinitions(row)).toThrow('BOM_REPAIR_COMPONENT_INVALID');
    });
});
