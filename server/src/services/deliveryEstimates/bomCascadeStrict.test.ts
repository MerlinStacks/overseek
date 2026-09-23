import { beforeEach, describe, expect, it, vi } from 'vitest';
const m = vi.hoisted(() => ({ items: vi.fn(), sync: vi.fn() }));
vi.mock('../../utils/prisma', () => ({ prisma: { bOMItem: { findMany: m.items } } }));
vi.mock('../../utils/redis', () => ({ redisClient: {} }));
vi.mock('../../utils/logger', () => ({ Logger: { info: vi.fn(), debug: vi.fn(), warn: vi.fn(), error: vi.fn() } }));
vi.mock('../woo', () => ({ WooService: {} }));
vi.mock('./intents', () => ({ lockDeliveryAccount: vi.fn() }));
vi.mock('../BOMInventorySyncService', () => ({ BOMInventorySyncService: { syncProductToWoo: m.sync } }));
import { BOMConsumptionService } from '../BOMConsumptionService';
const target = (productId: string, variationId = 0) => ({ bom: { productId, variationId, product: { id: productId, wooId: 20, name: productId, accountId: 'a' } } });
beforeEach(() => { vi.resetAllMocks(); m.sync.mockResolvedValue({ success: true }); });
describe('strict post-receipt BOM cascade', () => {
    it('syncs duplicate references once and updates sibling variants before recursing to dependent parents', async () => {
        m.items.mockImplementation(async ({ where }) => where.childProductId === 'component'
            ? [target('parent', 21), target('parent', 21), target('parent', 22)]
            : where.childProductId === 'parent' ? [target('grandparent')] : []);
        const beforeWrite = vi.fn().mockResolvedValue(undefined);
        await BOMConsumptionService.cascadeSyncAffectedProducts('a', 'component', undefined, 'wooProduct', new Set(), { strict: true, beforeWrite });
        expect(m.sync.mock.calls.map(c => [c[1], c[2]])).toEqual([['parent', 21], ['parent', 22], ['grandparent', 0]]);
        expect(m.sync.mock.calls.every(c => c[3].requireLiveStock === true)).toBe(true);
    });
    it.each(['returned_failure', 'exception'])('propagates %s so durable work cannot be marked complete silently', async kind => {
        m.items.mockImplementation(async ({ where }) => where.childProductId === 'component' ? [target('parent')] : []);
        if (kind === 'returned_failure') m.sync.mockResolvedValue({ success: false, error: 'Woo unavailable' });
        else m.sync.mockRejectedValue(new Error('Woo unavailable'));
        await expect(BOMConsumptionService.cascadeSyncAffectedProducts('a', 'component', undefined, 'wooProduct', new Set(), { strict: true })).rejects.toThrow('Woo unavailable');
    });
    it('orders shared ancestors after every changed child and syncs each target once', async () => {
        const graph: Record<string, string[]> = { component: ['ancestor', 'middle'], middle: ['child'], child: ['ancestor'], ancestor: ['top'] };
        m.items.mockImplementation(async ({ where }) => (graph[where.childProductId] ?? []).map(id => target(id)));
        await BOMConsumptionService.cascadeSyncAffectedProducts('a', 'component', undefined, 'wooProduct', new Set(), { strict: true });
        expect(m.sync.mock.calls.map(c => c[1])).toEqual(['middle', 'child', 'ancestor', 'top']);
    });
    it('reports dependency cycles before derived writes rather than silently pruning them', async () => {
        m.items.mockImplementation(async ({ where }) => where.childProductId === 'component' ? [target('parent')] : [target('component')]);
        await expect(BOMConsumptionService.cascadeSyncAffectedProducts('a', 'component', undefined, 'wooProduct', new Set(), { strict: true })).rejects.toThrow('dependency cycle');
        expect(m.sync).not.toHaveBeenCalled();
    });
    it('does not mistake an acyclic dependency between sibling BOM variants for a product-level cycle', async () => {
        m.items.mockImplementation(async ({ where }) => where.childProductId === 'component' ? [target('parent', 21)]
            : where.childProductId === 'parent' && where.childVariationId === 21 ? [target('parent', 22)] : []);
        await BOMConsumptionService.cascadeSyncAffectedProducts('a', 'component', undefined, 'wooProduct', new Set(), { strict: true });
        expect(m.sync.mock.calls.map(c => [c[1], c[2]])).toEqual([['parent', 21], ['parent', 22]]);
    });
});
