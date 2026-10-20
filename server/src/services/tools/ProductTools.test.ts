import { beforeEach, describe, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ findMany: vi.fn() }));
vi.mock('../../utils/prisma', () => ({ prisma: { wooProduct: { findMany: mocks.findMany } } }));
vi.mock('../../utils/logger', () => ({ Logger: { error: vi.fn() } }));
import { ProductTools } from './ProductTools';
beforeEach(() => { vi.resetAllMocks(); mocks.findMany.mockResolvedValue([]); });
describe('product search tool', () => {
    it.each(['', ' ', null, 42, {}])('rejects malformed searches without querying: %j', async query => {
        expect(await ProductTools.searchProducts('tenant-1', query as string)).toBe('Product search query required.');
        expect(mocks.findMany).not.toHaveBeenCalled();
    });
    it('trims valid searches, scopes results and orders ties deterministically', async () => {
        mocks.findMany.mockResolvedValue([{ name: 'Mug' }]);
        expect(await ProductTools.searchProducts('tenant-1', ' Mug ')).toEqual([{ name: 'Mug' }]);
        expect(mocks.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: { accountId: 'tenant-1', name: { contains: 'Mug', mode: 'insensitive' } }, take: 5, orderBy: [{ name: 'asc' }, { id: 'asc' }] }));
    });
    it('blocks missing tenants and preserves empty/failure messages', async () => {
        expect(await ProductTools.searchProducts('', 'Mug')).toBe('Account ID required.');
        expect(mocks.findMany).not.toHaveBeenCalled();
        expect(await ProductTools.searchProducts('tenant-1', 'Mug')).toBe('No products found matching that name.');
        mocks.findMany.mockRejectedValue(new Error('Private error'));
        expect(await ProductTools.searchProducts('tenant-1', 'Mug')).toBe('Failed to search products.');
    });
});
