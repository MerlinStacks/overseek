import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ProductsService } from '../products';
import { prisma } from '../../utils/prisma';
import { WooService } from '../woo';

vi.mock('../../utils/prisma', () => ({ prisma: { wooProduct: { findUnique: vi.fn(), update: vi.fn() }, productVariation: { findMany: vi.fn() } } }));
vi.mock('../woo', () => ({ WooService: { forAccount: vi.fn() } }));
vi.mock('../productSearch', () => ({ ProductSearchService: {} }));
vi.mock('../deliveryEstimates/intents', () => ({ dirtyInboundProducts: vi.fn(), lockDeliveryAccount: vi.fn() }));
vi.mock('../../utils/redis', () => ({ redisClient: {} }));
vi.mock('../../utils/logger', () => ({ Logger: { info: vi.fn(), error: vi.fn() } }));

describe('ProductsService taxonomy assignments', () => {
    const updateWoo = vi.fn();
    const oldCategories = [{ id: 2, name: 'Old category', slug: 'old-category' }];
    const oldTags = [{ id: 3, name: 'Old tag', slug: 'old-tag' }];
    let stored: any;

    beforeEach(() => {
        vi.resetAllMocks();
        stored = { id: 'p', manageStock: true, stockQuantity: 17, rawData: { categories: oldCategories, tags: oldTags, custom: 'preserved' } };
        vi.mocked(prisma.wooProduct.findUnique).mockImplementation((async () => stored) as any);
        vi.mocked(prisma.wooProduct.update).mockImplementation((async ({ data }: any) => {
            stored = { ...stored, ...structuredClone(data) };
            return stored;
        }) as any);
        vi.mocked(prisma.productVariation.findMany).mockResolvedValue([]);
        vi.mocked(WooService.forAccount).mockResolvedValue({ updateProduct: updateWoo } as any);
    });

    it('deduplicates IDs and persists canonical objects without overwriting unrelated raw data', async () => {
        const categories = [{ id: 8, name: 'Category', slug: 'category' }];
        const tags = [{ id: 9, name: 'Tag', slug: 'tag' }];
        updateWoo.mockResolvedValue({ categories, tags, custom: 'remote' });
        const result = await ProductsService.updateProduct('a', 10, {
            categories: [{ id: 8 }, { id: 8 }], tags: [{ id: 9 }, { id: 9 }], name: 'Renamed',
        });
        expect(WooService.forAccount).toHaveBeenCalledWith('a');
        expect(updateWoo).toHaveBeenCalledExactlyOnceWith(10, {
            categories: [{ id: 8 }], tags: [{ id: 9 }], name: 'Renamed', manage_stock: true, stock_quantity: 17,
        });
        expect(result.rawData).toMatchObject({ categories, tags, custom: 'preserved' });
        expect(await ProductsService.getProductByWooId('a', 10)).toMatchObject({ categories, tags });
    });

    it('clears tags and stores Woo default category when categories is cleared', async () => {
        const categories = [{ id: 1, name: 'Uncategorized', slug: 'uncategorized' }];
        updateWoo.mockResolvedValue({ categories, tags: [] });
        await ProductsService.updateProduct('a', 10, { categories: [], tags: [] });
        expect(updateWoo).toHaveBeenCalledWith(10, expect.objectContaining({ categories: [], tags: [] }));
        expect(stored.rawData).toMatchObject({ categories, tags: [] });
    });

    it.each(['categories', 'tags'])('preserves omitted taxonomy when editing %s only', async field => {
        const other = field === 'categories' ? 'tags' : 'categories';
        const previous = stored.rawData[other];
        updateWoo.mockResolvedValue({ [field]: [], [other]: [] });
        await ProductsService.updateProduct('a', 10, { [field]: [] });
        expect(updateWoo.mock.calls[0][1]).not.toHaveProperty(other);
        expect(stored.rawData[other]).toEqual(previous);
        expect(stored.rawData[field]).toEqual([]);
    });

    it.each(['credentials', 'update', 'missing response'])('propagates %s failures without persisting requested taxonomy', async failure => {
        if (failure === 'credentials') vi.mocked(WooService.forAccount).mockRejectedValue(new Error('Woo unavailable'));
        else if (failure === 'update') updateWoo.mockRejectedValue(new Error('Woo unavailable'));
        else updateWoo.mockResolvedValue({ categories: [] });
        await expect(ProductsService.updateProduct('a', 10, { categories: [], tags: [] })).rejects.toThrow();
        expect(stored.rawData).toMatchObject({ categories: oldCategories, tags: oldTags });
        expect(prisma.wooProduct.update).toHaveBeenCalledTimes(1);
    });

    it('keeps non-taxonomy updates best-effort and preserves both assignments', async () => {
        updateWoo.mockRejectedValue(new Error('Woo unavailable'));
        await ProductsService.updateProduct('a', 10, { name: 'Renamed' });
        expect(stored).toMatchObject({ name: 'Renamed', rawData: { categories: oldCategories, tags: oldTags } });
        expect(updateWoo.mock.calls[0][1]).not.toHaveProperty('categories');
        expect(updateWoo.mock.calls[0][1]).not.toHaveProperty('tags');
    });

    it.each([null, {}, [1], [{}], [{ id: 0 }], [{ id: -1 }], [{ id: 1.5 }], [{ id: '1' }], [{ id: Number.MAX_SAFE_INTEGER + 1 }]])('rejects malformed assignments before writes: %j', async terms => {
        await expect(ProductsService.updateProduct('a', 10, { categories: terms })).rejects.toThrow('Invalid categories assignment');
        expect(prisma.wooProduct.update).not.toHaveBeenCalled();
        expect(WooService.forAccount).not.toHaveBeenCalled();
    });
});
