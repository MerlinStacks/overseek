import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import Fastify from 'fastify';
import productsRoutes from './products';
import { ProductsService, ProductValidationError } from '../services/products';

vi.mock('zod', async () => {
    const actual = await vi.importActual<any>('zod');
    return { ...actual, z: actual.z ?? actual.default };
});
vi.mock('../services/products', () => ({
    ProductValidationError: class extends Error {},
    ProductsService: { updateProduct: vi.fn(), getProductByWooId: vi.fn() },
}));
vi.mock('../middleware/auth', () => ({ requireAuthFastify: async (request: any) => { request.accountId = 'a'; } }));
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

describe('product variation supplier route', () => {
    const apps: ReturnType<typeof Fastify>[] = [];
    beforeEach(() => vi.resetAllMocks());
    afterEach(async () => { await Promise.all(apps.splice(0).map(app => app.close())); });
    async function patch(variation: unknown) {
        const app = Fastify();
        apps.push(app);
        await app.register(productsRoutes, { prefix: '/products' });
        return app.inject({ method: 'PATCH', url: '/products/10', payload: { variations: [variation] } });
    }

    it.each(['s', null, '', undefined])('passes supplier override %s through validation', async supplierId => {
        vi.mocked(ProductsService.updateProduct, { partial: true }).mockResolvedValue({ id: 'p' });
        vi.mocked(ProductsService.getProductByWooId).mockResolvedValue(null);
        const response = await patch({ id: 11, supplierId, binLocation: 'A' });
        expect(response.statusCode).toBe(200);
        expect(ProductsService.updateProduct).toHaveBeenCalledWith('a', 10, expect.objectContaining({
            variations: [expect.objectContaining({ id: 11, ...(supplierId !== undefined ? { supplierId } : {}), binLocation: 'A' })],
        }));
    });

    it.each([{ id: 11, supplierId: 123 }, { id: 0, supplierId: 's' }, null])('rejects malformed override %j', async variation => {
        const response = await patch(variation);
        expect(response.statusCode).toBe(400);
        expect(ProductsService.updateProduct).not.toHaveBeenCalled();
    });

    it('returns service ownership validation failures rather than reporting success', async () => {
        vi.mocked(ProductsService.updateProduct).mockRejectedValue(new ProductValidationError('Variation supplier not found in this account'));
        const response = await patch({ id: 11, supplierId: 'foreign' });
        expect(response.statusCode).toBe(400);
        expect(response.json()).toEqual({ error: 'Variation supplier not found in this account' });
        expect(ProductsService.getProductByWooId).not.toHaveBeenCalled();
    });
});
