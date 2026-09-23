import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import Fastify from 'fastify';

vi.mock('zod', async () => {
    const actual = await vi.importActual<any>('zod');
    return { ...actual, z: actual.z ?? actual.default };
});
vi.mock('../services/products', () => ({ ProductValidationError: class extends Error {}, ProductsService: { updateProduct: vi.fn(), getProductByWooId: vi.fn() } }));
vi.mock('../middleware/auth', () => ({ requireAuthFastify: async (req: any) => { req.accountId = 'a'; req.user = { id: 'u' }; } }));
vi.mock('../utils/prisma', () => ({ prisma: {} }));
vi.mock('../utils/logger', () => ({ Logger: { error: vi.fn() } }));
vi.mock('../utils/elastic', () => ({ esClient: {} }));
vi.mock('../utils/cache', () => ({ invalidateCache: vi.fn(), CacheTTL: {} }));
vi.mock('../services/woo', () => ({ WooService: {} }));
vi.mock('../services/SeoScoringService', () => ({ SeoScoringService: {} }));
vi.mock('../services/MerchantCenterService', () => ({ MerchantCenterService: {} }));
vi.mock('../services/search/IndexingService', () => ({ IndexingService: {} }));
vi.mock('../services/search-console/SearchConsoleService', () => ({ SearchConsoleService: {} }));
vi.mock('../services/AuditService', () => ({ AuditService: { log: vi.fn() } }));
vi.mock('../services/wholesale/reconciliation', () => ({ reconcileWholesaleProductsBestEffort: vi.fn() }));
import routes from './products';
import { ProductsService } from '../services/products';

describe('product PATCH COGS input', () => {
    let app: ReturnType<typeof Fastify>;
    beforeEach(async () => {
        vi.resetAllMocks();
        vi.mocked(ProductsService.updateProduct, { partial: true }).mockResolvedValue({ id: 'p' });
        app = Fastify();
        await app.register(routes);
    });
    afterEach(async () => { await app.close(); });
    it.each([0, '0', 1.25, '1.25', '', '  '])('forwards %j without turning blanks into zero', async cogs => {
        const response = await app.inject({ method: 'PATCH', url: '/10', payload: { cogs, variations: [{ id: 11, cogs: 0 }] } });
        expect(response.statusCode).toBe(200);
        expect(ProductsService.updateProduct).toHaveBeenCalledWith('a', 10, expect.objectContaining({
            cogs: typeof cogs === 'string' && !cogs.trim() ? undefined : Number(cogs), variations: [{ id: 11, cogs: 0 }],
        }));
    });
    it.each([-1, 'invalid', 'Infinity'])('rejects invalid parent cost %j', async cogs => {
        expect((await app.inject({ method: 'PATCH', url: '/10', payload: { cogs } })).statusCode).toBe(400);
        expect(ProductsService.updateProduct).not.toHaveBeenCalled();
    });
});
