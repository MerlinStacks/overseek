import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import Fastify from 'fastify';
import productsRoutes from './products';
import { ProductsService } from '../services/products';
import { ProductSearchService } from '../services/productSearch';
import { cacheAside } from '../utils/cache';

vi.mock('zod', async () => {
    const actual = await vi.importActual<any>('zod');
    return { ...actual, z: actual.z ?? actual.default };
});
vi.mock('../services/products', () => ({
    ProductValidationError: class extends Error {},
    ProductsService: { searchProducts: vi.fn() }
}));
vi.mock('../services/productSearch', () => ({ ProductSearchService: { searchPurchaseOrderProducts: vi.fn() } }));
vi.mock('../middleware/auth', () => ({ requireAuthFastify: async (request: any) => { request.accountId = 'account-1'; } }));
vi.mock('../utils/prisma', () => ({ prisma: {} }));
vi.mock('../utils/logger', () => ({ Logger: { error: vi.fn() } }));
vi.mock('../utils/elastic', () => ({ esClient: {} }));
vi.mock('../utils/cache', () => ({ invalidateCache: vi.fn(), cacheAside: vi.fn(), CacheTTL: { SHORT: 30 } }));
vi.mock('../services/woo', () => ({ WooService: {} }));
vi.mock('../services/SeoScoringService', () => ({ SeoScoringService: {} }));
vi.mock('../services/MerchantCenterService', () => ({ MerchantCenterService: {} }));
vi.mock('../services/search/IndexingService', () => ({ IndexingService: {} }));
vi.mock('../services/search-console/SearchConsoleService', () => ({ SearchConsoleService: {} }));
vi.mock('../services/AuditService', () => ({ AuditService: {} }));

describe('product list filters', () => {
    let app: ReturnType<typeof Fastify>;
    beforeEach(async () => {
        vi.resetAllMocks();
        vi.mocked(cacheAside).mockImplementation(async (_key, loader) => loader());
        vi.mocked(ProductsService.searchProducts).mockResolvedValue({ products: [], total: 0, page: 1, totalPages: 0 });
        app = Fastify();
        await app.register(productsRoutes, { prefix: '/products' });
    });
    afterEach(async () => { await app.close(); });

    it('uses tenant-scoped compact PO search instead of the cached catalog search', async () => {
        const result = { products: [{ id: 'hoodie', wooId: 12, name: 'Hoodie', type: 'simple' }], total: 21, page: 2, totalPages: 2 };
        vi.mocked(ProductSearchService.searchPurchaseOrderProducts).mockResolvedValue(result);
        const response = await app.inject('/products/purchase-order-search?q=hoodie&page=2&limit=20');
        expect(response.statusCode).toBe(200);
        expect(response.json()).toEqual(result);
        expect(ProductSearchService.searchPurchaseOrderProducts).toHaveBeenCalledWith('account-1', 'hoodie', 2, 20);
        expect(ProductsService.searchProducts).not.toHaveBeenCalled();
        expect(cacheAside).not.toHaveBeenCalled();
    });

    it('validates PO pagination before searching', async () => {
        const response = await app.inject('/products/purchase-order-search?q=hoodie&page=0');
        expect(response.statusCode).toBe(400);
        expect(ProductSearchService.searchPurchaseOrderProducts).not.toHaveBeenCalled();
    });

    it('reports PO search failures rather than returning a successful empty list', async () => {
        vi.mocked(ProductSearchService.searchPurchaseOrderProducts).mockRejectedValue(new Error('Database unavailable'));
        expect((await app.inject('/products/purchase-order-search?q=hoodie')).statusCode).toBe(500);
    });

    it.each(['publish', 'private', 'draft', 'pending', 'future'])('accepts %s and numeric taxonomy IDs', async status => {
        const response = await app.inject(`/products/?status=${status}&category=12&tag=34&stockStatus=onbackorder&q=shirt&page=2&limit=5&sortField=name&sortDirection=desc`);
        expect(response.statusCode).toBe(200);
        expect(ProductsService.searchProducts).toHaveBeenCalledWith(
            'account-1', 'shirt', 2, 5, 'name', 'desc', { status, category: 12, tag: [34], stockStatus: 'onbackorder' }
        );
    });

    it.each([
        'stockStatus=', 'stockStatus=invalid', 'stockStatus=INSTOCK', 'stockStatus=instock,outofstock',
        'stockStatus=instock&stockStatus=outofstock',
        'status=trash', 'status=', 'category=0', 'category=-1', 'category=1.5', 'category=nope',
        'category=', 'category=9007199254740992', 'tag=0', 'tag=-1', 'tag=1.5', 'tag=nope',
        'tag=', 'tag=9007199254740992', 'category=1&category=2',
        'tag=1&tag=0', 'tag=1&tag=-2', 'tag=1&tag=1.5', 'tag=1&tag=nope',
        'tag=1&tag=', 'tag=1&tag=9007199254740992', 'tag=1,2'
    ])('returns 400 before cache/search for %s', async query => {
        const response = await app.inject(`/products/?${query}`);
        expect(response.statusCode).toBe(400);
        expect(response.json().error).toBe('Invalid product search parameters');
        expect(cacheAside).not.toHaveBeenCalled();
        expect(ProductsService.searchProducts).not.toHaveBeenCalled();
    });

    it('varies the cache key for each filter and keeps unfiltered defaults', async () => {
        for (const query of ['', 'status=publish', 'status=draft', 'category=1', 'category=2', 'tag=1', 'tag=2',
            'stockStatus=instock', 'stockStatus=outofstock', 'stockStatus=onbackorder']) {
            expect((await app.inject(`/products/?${query}`)).statusCode).toBe(200);
        }
        const keys = vi.mocked(cacheAside).mock.calls.map(([key]) => key);
        expect(new Set(keys).size).toBe(10);
        expect(ProductsService.searchProducts).toHaveBeenNthCalledWith(
            1, 'account-1', '', 1, 20, null, 'asc', { status: undefined, category: undefined, tag: undefined, stockStatus: undefined }
        );
    });

    it('normalizes tag sets before searching and reuses only equivalent cached sets', async () => {
        const cached = new Map<string, unknown>();
        vi.mocked(cacheAside).mockImplementation(async (key, loader) => {
            if (!cached.has(key)) cached.set(key, await loader());
            return cached.get(key) as any;
        });
        const queries = ['tag=34&tag=12', 'tag=012&tag=34&tag=12', 'tag=12', 'tag=12&tag=12', 'tag=12&tag=35'];
        for (const query of queries) {
            expect((await app.inject(`/products/?${query}&status=publish&category=9&stockStatus=instock&q=mug`)).statusCode).toBe(200);
        }
        expect(ProductsService.searchProducts).toHaveBeenCalledTimes(3);
        expect(ProductsService.searchProducts).toHaveBeenNthCalledWith(1,
            'account-1', 'mug', 1, 20, null, 'asc', { status: 'publish', category: 9, stockStatus: 'instock', tag: [12, 34] });
        const keys = vi.mocked(cacheAside).mock.calls.map(([key]) => key);
        expect(keys[0]).toBe(keys[1]);
        expect(keys[2]).toBe(keys[3]);
        expect(new Set(keys).size).toBe(3);
    });

    it.each(['instock', 'outofstock', 'onbackorder'])('accepts stockStatus=%s alone', async stockStatus => {
        const response = await app.inject(`/products/?stockStatus=${stockStatus}`);
        expect(response.statusCode).toBe(200);
        expect(ProductsService.searchProducts).toHaveBeenCalledWith(
            'account-1', '', 1, 20, null, 'asc', { status: undefined, category: undefined, tag: undefined, stockStatus }
        );
    });

    it('isolates cached combined filters by stock status and reuses identical requests', async () => {
        const cached = new Map<string, unknown>();
        vi.mocked(cacheAside).mockImplementation(async (key, loader) => {
            if (!cached.has(key)) cached.set(key, await loader());
            return cached.get(key) as any;
        });
        vi.mocked(ProductsService.searchProducts).mockImplementation(async (...args) => ({
            products: [{ id: args[6]?.stockStatus ?? 'all' }], total: 1, page: 1, totalPages: 1
        }));
        for (const stockStatus of [undefined, 'instock', 'outofstock', 'onbackorder', 'instock']) {
            const response = await app.inject(`/products/?status=publish&category=12&tag=34&q=shirt${stockStatus ? `&stockStatus=${stockStatus}` : ''}`);
            expect(response.statusCode).toBe(200);
            expect(response.json().products).toEqual([{ id: stockStatus ?? 'all' }]);
        }
        expect(ProductsService.searchProducts).toHaveBeenCalledTimes(4);
        expect(cached.size).toBe(4);
    });
});
