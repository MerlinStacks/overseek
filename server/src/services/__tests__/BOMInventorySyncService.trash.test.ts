import { describe, expect, it, vi } from 'vitest';
vi.mock('../../utils/prisma', () => ({ prisma: {} }));
vi.mock('../woo', () => ({ WooService: {} }));
vi.mock('../../utils/logger', () => ({ Logger: {} }));
import { BOMInventorySyncService } from '../BOMInventorySyncService';

describe('BOM stock with preserved trash', () => {
    it.each([false, true])('treats a trashed component as unavailable, not an omitted constraint (variation=%s)', variant => {
        const parent = { id: 'p', wooId: 10, stockQuantity: 5, rawData: {} };
        const component = { id: 'c', wooId: 20, name: 'Component', stockQuantity: 10, rawData: { status: 'trash' } };
        const bom: any = { variationId: 0, items: [{ quantity: 2, wasteFactor: 0, childProduct: component, childProductId: 'c', childVariationId: variant ? 21 : null, childVariation: variant ? { wooId: 21, stockQuantity: 10 } : null }] };
        expect(BOMInventorySyncService.calculateEffectiveStockFromLocalData(parent, bom)?.effectiveStock).toBe(0);
        component.rawData.status = 'publish';
        expect(BOMInventorySyncService.calculateEffectiveStockFromLocalData(parent, bom)?.effectiveStock).toBe(5);
    });

    it('does not calculate stock for a trashed finished product', () => {
        expect(BOMInventorySyncService.calculateEffectiveStockFromLocalData({ id: 'p', wooId: 10, stockQuantity: 5, rawData: { status: 'trash' } }, { items: [] } as any)).toBeNull();
    });
});
