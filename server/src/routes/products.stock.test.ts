import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import Fastify from 'fastify';

const m = vi.hoisted(() => ({ find: vi.fn(), update: vi.fn(), wooUpdate: vi.fn() }));
vi.mock('../services/products', () => ({ ProductValidationError: class extends Error {}, ProductsService: {} }));
vi.mock('../middleware/auth', () => ({ requireAuthFastify: async (req: any) => { req.accountId = 'a'; req.user = { id: 'u' }; } }));
vi.mock('../utils/prisma', () => ({ prisma: { wooProduct: { findUnique: m.find, update: m.update } } }));
vi.mock('../utils/logger', () => ({ Logger: { error: vi.fn(), warn: vi.fn() } }));
vi.mock('../utils/elastic', () => ({ esClient: {} }));
vi.mock('../utils/cache', () => ({ invalidateCache: vi.fn(), CacheTTL: {} }));
vi.mock('../services/woo', () => ({ WooService: { forAccount: async () => ({ updateProduct: m.wooUpdate }) } }));
vi.mock('../services/SeoScoringService', () => ({ SeoScoringService: {} }));
vi.mock('../services/MerchantCenterService', () => ({ MerchantCenterService: {} }));
vi.mock('../services/search/IndexingService', () => ({ IndexingService: {} }));
vi.mock('../services/search-console/SearchConsoleService', () => ({ SearchConsoleService: {} }));
vi.mock('../services/AuditService', () => ({ AuditService: {} }));
import routes from './products';

describe('base product stock edits', () => {
    let app: ReturnType<typeof Fastify>;
    beforeEach(async () => {
        vi.resetAllMocks();
        m.find.mockResolvedValue({ id: 'base', status: 'publish', rawData: { type: 'simple' }, boms: [{ id: 'empty', items: [] }] });
        app = Fastify();
        await app.register(routes);
    });
    afterEach(async () => { await app.close(); });

    it('updates base stock with an empty BOM record and syncs it to WooCommerce', async () => {
        const response = await app.inject({ method: 'PUT', url: '/10/stock', payload: { stockQuantity: 23 } });
        expect(response.statusCode).toBe(200);
        expect(response.json()).toMatchObject({ success: true, stockQuantity: 23 });
        expect(m.update).toHaveBeenCalledWith({ where: { id: 'base' }, data: { stockQuantity: 23, manageStock: true } });
        expect(m.wooUpdate).toHaveBeenCalledWith(10, { manage_stock: true, stock_quantity: 23 });
        expect(m.find.mock.calls[0][0].include.boms.select.items.where).toEqual({ isActive: true, OR: [{ childProductId: { not: null } }, { internalProductId: { not: null } }] });
    });

    it.each(['childProductId', 'internalProductId'])('blocks manual stock edits for active %s BOMs', async field => {
        m.find.mockResolvedValue({ id: 'finished', status: 'publish', rawData: { type: 'simple' }, boms: [{ id: 'bom', items: [{ id: 'component', [field]: 'base' }] }] });
        const response = await app.inject({ method: 'PUT', url: '/10/stock', payload: { stockQuantity: 23 } });
        expect(response.statusCode).toBe(400);
        expect(m.update).not.toHaveBeenCalled();
        expect(m.wooUpdate).not.toHaveBeenCalled();
    });
});
