import { describe, expect, it } from 'vitest';
import { buildBOMComponentMappings, type BOMPlanningItem } from './bomGraph';
import { BOMForecastCycleError } from './errors';

const ids = new Map<string, number>();
const wooId = (id: string) => { if (!ids.has(id)) ids.set(id, ids.size + 1); return ids.get(id)!; };
function edge(parent: string, child: string, quantity = 1, wasteFactor = 0): BOMPlanningItem {
    return { isActive: true, supplierItemId: null, childProductId: child, childVariationId: null,
        internalProductId: null, quantity, wasteFactor,
        childProduct: { id: child, accountId: 'tenant', wooId: wooId(child), boms: [] },
        childVariation: null, internalProduct: null,
        bom: { productId: parent, variationId: 0, product: { accountId: 'tenant', wooId: wooId(parent), boms: [{ variationId: 0 }] } } };
}
function plan(items: BOMPlanningItem[], target = 'leaf') {
    return buildBOMComponentMappings('tenant', items, [target], [], []);
}
function factors(items: BOMPlanningItem[], target = 'leaf') {
    return Object.fromEntries(plan(items, target)[0].parentMappings.map(parent => [`${parent.parentProductId}:${parent.parentVariationId}`, parent.quantity]));
}

describe('bounded multi-level gross BOM planning', () => {
    it('multiplies quantities and waste at every level', () => {
        const result = factors([edge('middle', 'leaf', 2, 0.1), edge('root', 'middle', 3, 0.2)]);
        expect(result['middle:0']).toBeCloseTo(2.2);
        expect(result['root:0']).toBeCloseTo(7.92);
    });
    it('sums diamond paths and direct requirements without counting ancestor sales twice', () => {
        expect(factors([edge('a', 'leaf', 2), edge('b', 'leaf', 3), edge('root', 'a', 4), edge('root', 'b', 5), edge('root', 'leaf')]))
            .toEqual({ 'a:0': 2, 'b:0': 3, 'root:0': 24 });
    });
    it('adds duplicate recipe lines but emits a single sales source per ancestor', () => {
        expect(factors([edge('middle', 'leaf', 2), edge('middle', 'leaf', 3), edge('root', 'middle', 4)]))
            .toEqual({ 'middle:0': 5, 'root:0': 20 });
    });
    it('keeps internal-product requirements distinct and supports nested internal leaves', () => {
        const internal = { ...edge('middle', 'leaf', 2), childProductId: null, childProduct: null,
            internalProductId: 'material', internalProduct: { id: 'material', accountId: 'tenant' } };
        expect(factors([internal, edge('root', 'middle', 3)], 'material')).toEqual({ 'middle:0': 2, 'root:0': 6 });
        expect(plan([internal], 'material')[0].componentWooId).toBe(0);
    });
    it('uses variant overrides and default fallback without mixing their recipes', () => {
        const defaultLine = edge('middle', 'leaf', 2);
        defaultLine.bom.product.boms.push({ variationId: 100 });
        const override = edge('middle', 'leaf', 5);
        override.bom.variationId = 100;
        override.bom.product.boms = defaultLine.bom.product.boms;
        const reference = (root: string, variation: number, quantity: number) => {
            const line = edge(root, 'middle', quantity);
            line.childVariationId = variation;
            line.childVariation = { id: `variant-${variation}`, productId: 'middle', wooId: variation };
            line.childProduct!.boms = defaultLine.bom.product.boms;
            return line;
        };
        const items = [defaultLine, override, reference('fallback-root', 101, 3), reference('override-root', 100, 4)];
        expect(factors(items)).toEqual({ 'middle:0': 2, 'middle:100': 5, 'fallback-root:0': 6, 'override-root:0': 20 });
        expect(plan(items)[0].parentMappings.find(parent => parent.parentVariationId === 0 && parent.parentProductId === 'middle')?.excludedVariationIds).toEqual([100]);
    });
    it('does not apply a default recipe to an explicitly empty variant override', () => {
        const defaultLine = edge('middle', 'leaf', 2);
        defaultLine.bom.product.boms.push({ variationId: 100 });
        const reference = edge('root', 'middle', 3);
        reference.childVariationId = 100;
        reference.childVariation = { id: 'variant-100', productId: 'middle', wooId: 100 };
        reference.childProduct!.boms = defaultLine.bom.product.boms;
        expect(factors([defaultLine, reference])).toEqual({ 'middle:0': 2 });
    });
    it('keeps a managed variation separate from its parent and siblings', () => {
        const line = edge('root', 'leaf', 2);
        line.childVariationId = 100;
        line.childVariation = { id: 'v100', productId: 'leaf', wooId: 100 };
        expect(plan([line])).toEqual([]);
        const mappings = buildBOMComponentMappings('tenant', [line], [], [100], [{ id: 'v100', productId: 'leaf', wooId: 100, isVariation: true }]);
        expect(mappings[0]).toMatchObject({ componentProductId: 'v100', componentWooId: 100, parentMappings: [{ quantity: 2 }] });
        expect(buildBOMComponentMappings('tenant', [line], [], [101], [{ id: 'v101', productId: 'leaf', wooId: 101, isVariation: true }])).toEqual([]);
    });
    it.each([
        [edge('root', 'leaf'), edge('root', 'root')],
        [edge('a', 'leaf'), edge('b', 'a'), edge('a', 'b')],
    ])('rejects real self/indirect cycles in the requested ancestry', (...items) => {
        expect(() => plan(items)).toThrow(BOMForecastCycleError);
    });
    it('allows repeated shared nodes and ignores disconnected cycles', () => {
        expect(factors([edge('root', 'leaf'), edge('x', 'y'), edge('y', 'x')])).toEqual({ 'root:0': 1 });
    });
    it('detects a cycle through default-recipe variation fallback', () => {
        const line = edge('root', 'middle');
        line.childVariationId = 100;
        line.childVariation = { id: 'variant', productId: 'middle', wooId: 100 };
        line.childProduct!.boms = [{ variationId: 0 }];
        expect(() => plan([edge('middle', 'leaf'), line, edge('middle', 'root')])).toThrow(BOMForecastCycleError);
    });
    it('does not mistake distinct variant recipes for a product-level cycle', () => {
        const leaf = edge('assembly', 'leaf', 2);
        leaf.bom.variationId = 100;
        leaf.bom.product.boms = [{ variationId: 0 }, { variationId: 100 }];
        const line = edge('assembly', 'assembly', 3);
        line.childVariationId = 100;
        line.childVariation = { id: 'variant', productId: 'assembly', wooId: 100 };
        line.childProduct!.boms = leaf.bom.product.boms;
        line.bom.product.boms = leaf.bom.product.boms;
        expect(factors([leaf, line])).toEqual({ 'assembly:100': 2, 'assembly:0': 6 });
    });
    it('handles deep valid chains iteratively', () => {
        const items = Array.from({ length: 500 }, (_, i) => edge(`level-${i}`, i ? `level-${i - 1}` : 'leaf'));
        expect(plan(items)[0].parentMappings).toHaveLength(500);
    });
    it('never folds a source product own direct sales into its derived demand', () => {
        const mappings = buildBOMComponentMappings('tenant', [edge('middle', 'leaf', 2), edge('root', 'middle', 3)], ['leaf', 'middle'], [], []);
        expect(mappings.find(row => row.componentProductId === 'middle')?.parentMappings).toMatchObject([{ parentProductId: 'root', quantity: 3 }]);
    });
    it.each([0, -1, NaN, Infinity])('rejects invalid quantities %s', quantity => {
        expect(() => plan([edge('root', 'leaf', quantity)])).toThrow('quantity/waste');
    });
    it.each([-1, 1.1, NaN, Infinity])('rejects invalid waste %s', waste => {
        expect(() => plan([edge('root', 'leaf', 1, waste)])).toThrow('quantity/waste');
    });
    it('rejects foreign, missing and ambiguous ACTIVE references rather than lowering demand', () => {
        const foreign = edge('root', 'leaf'); foreign.childProduct!.accountId = 'other';
        const foreignParent = edge('root', 'leaf'); foreignParent.bom.product.accountId = 'other';
        const missing = { ...edge('root', 'leaf'), childProduct: null };
        const ambiguous = { ...edge('root', 'leaf'), supplierItemId: 'also-cost' };
        for (const line of [foreign, foreignParent, missing, ambiguous]) expect(() => plan([line])).toThrow();
    });
    it('ignores disabled legacy lines, including their unresolved references and disconnected cycles', () => {
        const disabled = { ...edge('old', 'leaf', 99), isActive: false, childProduct: null };
        expect(factors([edge('root', 'leaf', 2), disabled, { ...edge('old', 'old'), isActive: false }])).toEqual({ 'root:0': 2 });
    });
    it('rejects overflowing multipliers', () => {
        expect(() => plan([edge('a', 'leaf', 1e200), edge('root', 'a', 1e200)])).toThrow('overflow');
    });
    it('bounds transitive contributions even when the underlying graph is small', () => {
        const targets = Array.from({ length: 500 }, (_, i) => `leaf-${i}`);
        const items = [...targets.map(id => edge('hub', id)),
            ...Array.from({ length: 210 }, (_, i) => edge(`parent-${i}`, i ? `parent-${i - 1}` : 'hub'))];
        expect(() => buildBOMComponentMappings('tenant', items, targets, [], [])).toThrow('coverage limit');
    });
    it('agrees with a small independent path-summing oracle on generated DAGs', () => {
        let seed = 73;
        const random = () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 2 ** 32; };
        for (let sample = 0; sample < 40; sample++) {
            const items = [edge('node-0', 'leaf')];
            for (let parent = 1; parent < 8; parent++) for (let child = -1; child < parent; child++) {
                if (random() < 0.3) items.push(edge(`node-${parent}`, child < 0 ? 'leaf' : `node-${child}`, 1 + Math.floor(random() * 3), 0.1));
            }
            const coefficient = (node: string): number => node === 'leaf' ? 1 : items.filter(row => row.bom.productId === node)
                .reduce((sum, row) => sum + Number(row.quantity) * (1 + Number(row.wasteFactor)) * coefficient(row.childProductId!), 0);
            const result = factors(items);
            for (let node = 0; node < 8; node++) expect(result[`node-${node}:0`] || 0).toBeCloseTo(coefficient(`node-${node}`));
        }
    });
});
