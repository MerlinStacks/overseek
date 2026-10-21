import { beforeEach, describe, expect, it, vi } from 'vitest';
const m = vi.hoisted(() => ({ products: vi.fn() }));
vi.mock('../../../utils/prisma', () => ({ prisma: { wooProduct: { findMany: m.products } } }));
vi.mock('../../../utils/logger', () => ({ Logger: { warn: vi.fn() } }));
import { processProductAdMatch } from './ProductAdMatcher';
beforeEach(() => vi.resetAllMocks());
describe('unambiguous inventory ad matching', () => {
    it('prefers authoritative variant identifiers over a conflicting title', async () => {
        m.products.mockResolvedValue([{ wooId: 1, name: 'Parent', sku: 'P1', price: 100, cogs: 10, variations: [{ wooId: 2, sku: 'V2', price: 100, cogs: 90 }] }]);
        const suggestions: string[] = []; await processProductAdMatch('tenant', { top_products: [{ product_id: 'v2', product: 'Parent', roas: '3.00x' }] } as any, suggestions);
        expect(suggestions.join(' ')).toContain('inventory ID 2'); expect(suggestions.join(' ')).toContain('10.0%'); expect(suggestions.join(' ')).not.toContain('Ad Opportunity');
    });
    it('declines ambiguous title matches and does not infer campaign absence', async () => {
        m.products.mockResolvedValue([1, 2].map(id => ({ wooId: id, name: 'Same', price: 100, cogs: 99, variations: [] })));
        const suggestions: string[] = []; await processProductAdMatch('tenant', { top_products: [{ product: 'Same', roas: '3.00x' }] } as any, suggestions);
        expect(suggestions.join(' ')).toContain('missing/ambiguous'); expect(suggestions.join(' ')).not.toContain('Low unit-margin review');
    });
});
