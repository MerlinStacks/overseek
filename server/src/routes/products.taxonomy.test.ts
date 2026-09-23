import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import Fastify from 'fastify';
import productsRoutes from './products';
import { ProductsService } from '../services/products';
import { AuditService } from '../services/AuditService';
import { invalidateCache } from '../utils/cache';

vi.mock('zod', async () => {
    const actual = await vi.importActual<any>('zod');
    return { ...actual, z: actual.z ?? actual.default };
});
vi.mock('../services/products', () => ({
    ProductValidationError: class extends Error {},
    ProductsService: { updateProduct: vi.fn(), getProductByWooId: vi.fn() },
}));
vi.mock('../middleware/auth', () => ({ requireAuthFastify: async (request: any) => { request.accountId = 'a'; request.user = { id: 'u' }; } }));
vi.mock('../utils/prisma', () => ({ prisma: {} }));
vi.mock('../utils/logger', () => ({ Logger: { error: vi.fn() } }));
vi.mock('../utils/elastic', () => ({ esClient: {} }));
vi.mock('../utils/cache', () => ({ invalidateCache: vi.fn(), cacheAside: vi.fn(), CacheTTL: {} }));
vi.mock('../services/woo', () => ({ WooService: {} }));
vi.mock('../services/SeoScoringService', () => ({ SeoScoringService: {} }));
vi.mock('../services/MerchantCenterService', () => ({ MerchantCenterService: {} }));
vi.mock('../services/search/IndexingService', () => ({ IndexingService: {} }));
vi.mock('../services/search-console/SearchConsoleService', () => ({ SearchConsoleService: {} }));
vi.mock('../services/AuditService', () => ({ AuditService: { log: vi.fn() } }));
vi.mock('../services/wholesale/reconciliation', () => ({ reconcileWholesaleProductsBestEffort: vi.fn() }));

describe('product PATCH taxonomy assignments', () => {
    const apps: ReturnType<typeof Fastify>[] = [];
    beforeEach(() => {
        vi.resetAllMocks();
        vi.mocked(ProductsService.updateProduct, { partial: true }).mockResolvedValue({ id: 'p' });
        vi.mocked(ProductsService.getProductByWooId).mockResolvedValue(null);
    });
    afterEach(async () => { await Promise.all(apps.splice(0).map(app => app.close())); });
    async function patch(payload: Record<string, unknown>) {
        const app = Fastify();
        apps.push(app);
        await app.register(productsRoutes, { prefix: '/products' });
        return app.inject({ method: 'PATCH', url: '/products/10', payload });
    }

    it('forwards and audits deduplicated IDs, stripping client taxonomy metadata', async () => {
        const response = await patch({ categories: [{ id: 8, name: 'Ignored' }, { id: 8 }], tags: [{ id: Number.MAX_SAFE_INTEGER }] });
        const expected = { categories: [{ id: 8 }], tags: [{ id: Number.MAX_SAFE_INTEGER }] };
        expect(response.statusCode).toBe(200);
        expect(ProductsService.updateProduct).toHaveBeenCalledWith('a', 10, expect.objectContaining(expected));
        expect(AuditService.log).toHaveBeenCalledExactlyOnceWith('a', 'u', 'UPDATE', 'PRODUCT', '10', expected);
        expect(invalidateCache).toHaveBeenCalledWith('products', 'a');
    });

    it.each(['categories', 'tags'])('forwards and audits clearing %s while leaving the other omitted', async field => {
        expect((await patch({ [field]: [] })).statusCode).toBe(200);
        const forwarded = vi.mocked(ProductsService.updateProduct).mock.calls[0][2];
        expect(forwarded[field]).toEqual([]);
        expect(forwarded[field === 'categories' ? 'tags' : 'categories']).toBeUndefined();
        expect(AuditService.log).toHaveBeenCalledWith('a', 'u', 'UPDATE', 'PRODUCT', '10', { [field]: [] });
    });

    it.each(['categories', 'tags'])('rejects malformed %s without service calls or audit', async field => {
        for (const terms of [null, {}, [1], [null], [{}], [{ id: 0 }], [{ id: -1 }], [{ id: 1.5 }], [{ id: '1' }], [{ id: Number.MAX_SAFE_INTEGER + 1 }]]) {
            expect((await patch({ [field]: terms })).statusCode).toBe(400);
        }
        expect(ProductsService.updateProduct).not.toHaveBeenCalled();
        expect(AuditService.log).not.toHaveBeenCalled();
    });

    it('does not add taxonomy to unrelated edits or their audit', async () => {
        expect((await patch({ name: 'Renamed' })).statusCode).toBe(200);
        const forwarded = vi.mocked(ProductsService.updateProduct).mock.calls[0][2];
        expect(forwarded.categories).toBeUndefined();
        expect(forwarded.tags).toBeUndefined();
        expect(AuditService.log).toHaveBeenCalledWith('a', 'u', 'UPDATE', 'PRODUCT', '10', { name: 'Renamed' });
    });

    it('returns failure without a success audit when the taxonomy service rejects', async () => {
        vi.mocked(ProductsService.updateProduct).mockRejectedValue(new Error('Woo unavailable'));
        expect((await patch({ categories: [] })).statusCode).toBe(500);
        expect(AuditService.log).not.toHaveBeenCalled();
        expect(invalidateCache).not.toHaveBeenCalled();
    });
});
