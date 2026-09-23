import { beforeEach, describe, expect, it, vi } from 'vitest';

const m = vi.hoisted(() => ({
    parent: { findUnique: vi.fn(), update: vi.fn() },
    variation: { findMany: vi.fn(), upsert: vi.fn() },
    update: vi.fn(), updateVariation: vi.fn(),
}));
vi.mock('../../utils/prisma', () => ({ prisma: { wooProduct: m.parent, productVariation: m.variation } }));
vi.mock('../woo', () => ({ WooService: { forAccount: async () => ({ updateProduct: m.update, updateProductVariation: m.updateVariation }) } }));
vi.mock('../productSearch', () => ({ ProductSearchService: {} }));
vi.mock('../deliveryEstimates/intents', () => ({}));
vi.mock('../../utils/logger', () => ({ Logger: { info: vi.fn(), error: vi.fn() } }));
vi.mock('../../utils/redis', () => ({ redisClient: { del: vi.fn() } }));
import { ProductsService } from '../products';

describe('Overseek authoritative outbound native COGS', () => {
    beforeEach(() => {
        vi.resetAllMocks();
        m.parent.findUnique.mockResolvedValue({ id: 'p', cogs: 90, rawData: {}, manageStock: true, stockQuantity: 5 });
        m.parent.update.mockResolvedValue({ id: 'p' });
        m.variation.findMany.mockResolvedValue([{ wooId: 11 }]);
    });

    it.each([12.75, '12.75', 0, '0'])('exports parent and variation cost %j, including cost-only edits', async cogs => {
        await ProductsService.updateProduct('a', 10, { cogs, variations: [{ id: 11, cogs }] });
        expect(m.parent.update.mock.calls[0][0].data.cogs).toBe(Number(cogs));
        expect(m.variation.upsert.mock.calls[0][0].update.cogs).toBe(Number(cogs));
        expect(m.update).toHaveBeenCalledWith(10, {
            cost_of_goods_sold: { values: [{ defined_value: Number(cogs) }] },
            manage_stock: true, stock_quantity: 5,
        });
        expect(JSON.parse(JSON.stringify(m.updateVariation.mock.calls[0][2]))).toEqual({
            cost_of_goods_sold: { values: [{ defined_value: Number(cogs) }], defined_value_is_additive: false },
        });
    });

    it.each([undefined, null, '', '  '])('never turns absent/blank %j costs into outbound zero', async cogs => {
        await ProductsService.updateProduct('a', 10, { name: 'Edit', cogs, variations: [{ id: 11, price: '20', cogs }] });
        expect(m.update.mock.calls[0][1]).not.toHaveProperty('cost_of_goods_sold');
        expect(m.updateVariation.mock.calls[0][2]).not.toHaveProperty('cost_of_goods_sold');
        expect(m.updateVariation.mock.calls[0][2]).not.toHaveProperty('dimensions');
        expect(m.updateVariation.mock.calls[0][2]).not.toHaveProperty('weight');
    });

    it.each([-1, 'oops', Infinity, NaN, true, {}])('rejects invalid variation cost %j before any writes', async cogs => {
        await expect(ProductsService.updateProduct('a', 10, { cogs: 10, variations: [{ id: 11, cogs }] })).rejects.toThrow('COGS');
        expect(m.parent.update).not.toHaveBeenCalled();
        expect(m.variation.upsert).not.toHaveBeenCalled();
        expect(m.update).not.toHaveBeenCalled();
    });

    it('retains local authority after Woo fails and resends on explicit resave', async () => {
        m.update.mockRejectedValueOnce(new Error('offline'));
        m.updateVariation.mockRejectedValueOnce(new Error('offline'));
        const edit = { cogs: 4, variations: [{ id: 11, cogs: 0 }] };
        await ProductsService.updateProduct('a', 10, edit);
        expect(m.parent.update.mock.calls[0][0].data.cogs).toBe(4);
        expect(m.variation.upsert.mock.calls[0][0].update.cogs).toBe(0);
        await ProductsService.updateProduct('a', 10, edit);
        expect(m.update).toHaveBeenCalledTimes(2);
        expect(m.updateVariation).toHaveBeenCalledTimes(2);
    });
});
