import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { InventorySummary } from '../../ads/types';
const mocks = vi.hoisted(() => ({ findMany: vi.fn(), count: vi.fn() }));
vi.mock('../../../utils/prisma', () => ({ prisma: { wooProduct: mocks } }));
vi.mock('../../../utils/logger', () => ({ Logger: { warn: vi.fn() } }));
import { processInventorySuggestions } from './InventoryAdvisor';
let summary: { inventory?: InventorySummary };
let suggestions: string[];
beforeEach(() => {
    vi.resetAllMocks(); summary = {}; suggestions = [];
    mocks.count.mockImplementation(async ({ where }) => where.OR ? 20 : where.stockStatus === 'outofstock' ? 100 : 1000);
    mocks.findMany.mockImplementation(async ({ where }) => where.stockStatus === 'instock' ? [] : [{ name: 'A' }, { name: 'B' }, { name: 'C' }]);
});
describe('inventory advisor', () => {
    it('uses actual counts, filters ad products before limiting examples, and avoids unsupported ad-suspension claims', async () => {
        await processInventorySuggestions('tenant-1', suggestions, summary, ['123', 'SKU-X']);
        expect(summary.inventory).toEqual({ total_products: 1000, out_of_stock_count: 100, relevant_out_of_stock: 20, low_stock_count: 0, ad_match_available: true });
        expect(mocks.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: { accountId: 'tenant-1', stockStatus: 'outofstock', OR: [
            { wooId: { in: [123] } }, { sku: { in: ['123', 'SKU-X'], mode: 'insensitive' } },
        ] }, take: 3 }));
        expect(suggestions[0]).toContain('and 17 more');
        expect(suggestions[0]).not.toContain('has auto-disabled');
    });
    it('treats an explicitly empty ad list as no matched advertised products', async () => {
        await processInventorySuggestions('tenant-1', suggestions, summary, []);
        expect(summary.inventory?.relevant_out_of_stock).toBe(0);
        expect(suggestions).toEqual([]);
        expect(mocks.findMany.mock.calls.every(([query]) => query.where.stockStatus === 'instock')).toBe(true);
    });
    it('does not claim products are advertised when ad membership is unknown', async () => {
        await processInventorySuggestions('tenant-1', suggestions, summary);
        expect(summary.inventory?.ad_match_available).toBe(false);
        expect(suggestions[0]).not.toContain('in your ad campaigns');
        expect(suggestions[0]).not.toContain('matched to your ad products');
    });
    it('counts low-stock products beyond the old 100-row and five-result caps', async () => {
        const page = Array.from({ length: 500 }, (_, i) => ({ id: `p-${i}`, name: 'Mug', manageStock: true, stockQuantity: 2, rawData: {} }));
        mocks.findMany.mockResolvedValueOnce(page).mockResolvedValueOnce([{ id: 'p-500', name: 'Cup', rawData: { stock_quantity: 3 } }]);
        await processInventorySuggestions('tenant-1', suggestions, summary, []);
        expect(summary.inventory?.low_stock_count).toBe(501);
        expect(mocks.findMany).toHaveBeenNthCalledWith(2, expect.objectContaining({ cursor: { id: 'p-499' }, skip: 1 }));
    });
    it('uses local stock overrides only when enabled and ignores malformed quantities', async () => {
        mocks.findMany.mockResolvedValue([
            { id: '1', name: 'Local', manageStock: true, stockQuantity: 10, rawData: { stock_quantity: 1 } },
            { id: '2', name: 'Woo', manageStock: false, stockQuantity: 10, rawData: { stock_quantity: 1 } },
            { id: '3', name: 'Bad', rawData: { stock_quantity: 'invalid' } },
        ]);
        await processInventorySuggestions('tenant-1', suggestions, summary, []);
        expect(summary.inventory?.low_stock_count).toBe(1);
    });
    it('does not produce a partial summary or advice on query failure', async () => {
        mocks.count.mockRejectedValue(new Error('Database unavailable'));
        await processInventorySuggestions('tenant-1', suggestions, summary);
        expect(summary.inventory).toBeUndefined();
        expect(suggestions).toEqual([]);
    });
});
