import Fastify from 'fastify';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('zod', async () => {
    const actual = await vi.importActual<any>('zod');
    return { ...actual, z: actual.z ?? actual.default };
});

const m = vi.hoisted(() => ({
    prisma: {
        wooProduct: { findFirst: vi.fn(), update: vi.fn() },
        productVariation: { findUnique: vi.fn(), updateMany: vi.fn() },
        bOM: { upsert: vi.fn(), findUnique: vi.fn() },
        bOMItem: { deleteMany: vi.fn(), create: vi.fn() },
        $transaction: vi.fn(),
    },
    update: vi.fn(), variation: vi.fn(),
}));
vi.mock('../../utils/prisma', () => ({ prisma: m.prisma }));
vi.mock('../../middleware/auth', () => ({ requireAuthFastify: async (req: any) => { req.accountId = 'a'; } }));
vi.mock('../../utils/logger', () => ({ Logger: { error: vi.fn() } }));
vi.mock('../../services/BOMInventorySyncService', () => ({ BOMInventorySyncService: {} }));
vi.mock('../../services/woo', () => ({ WooService: { forAccount: async () => ({ updateProduct: m.update, updateProductVariation: m.variation }) } }));
import routes from './bom-products';

describe('BOM-derived outbound COGS', () => {
    let app: ReturnType<typeof Fastify>;
    beforeEach(async () => {
        vi.resetAllMocks();
        m.prisma.wooProduct.findFirst.mockResolvedValue({ id: 'p', wooId: 10 });
        m.prisma.productVariation.findUnique.mockResolvedValue({ wooId: 11 });
        m.prisma.bOM.upsert.mockResolvedValue({ id: 'bom' });
        m.prisma.$transaction.mockImplementation(async fn => fn(m.prisma));
        app = Fastify();
        await app.register(routes);
    });
    afterEach(async () => { await app.close(); });

    it.each([0, 11])('exports calculated costs and zero for target %i after persistence', async variationId => {
        for (const cost of [8, 0]) {
            m.prisma.bOM.findUnique.mockResolvedValue({ items: [{ childProduct: { cogs: cost }, quantity: 2, wasteFactor: 0.25 }] });
            const response = await app.inject({ method: 'POST', url: '/products/p/bom', payload: { items: [], variationId } });
            expect(response.statusCode).toBe(200);
            const payload = { cost_of_goods_sold: { values: [{ defined_value: cost * 2.5 }], ...(variationId ? { defined_value_is_additive: false } : {}) } };
            if (variationId) expect(m.variation).toHaveBeenLastCalledWith(10, 11, payload);
            else expect(m.update).toHaveBeenLastCalledWith(10, payload);
        }
        const local = variationId ? m.prisma.productVariation.updateMany : m.prisma.wooProduct.update;
        const remote = variationId ? m.variation : m.update;
        expect(local.mock.invocationCallOrder[0]).toBeLessThan(remote.mock.invocationCallOrder[0]);
    });

    it('does not reset Woo costs when a BOM is removed', async () => {
        m.prisma.bOM.findUnique.mockResolvedValue({ items: [] });
        expect((await app.inject({ method: 'POST', url: '/products/p/bom', payload: { items: [] } })).statusCode).toBe(200);
        expect(m.prisma.wooProduct.update).toHaveBeenCalledWith({ where: { id: 'p' }, data: { cogs: null } });
        expect(m.update).not.toHaveBeenCalled();
    });

    it('preserves a saved BOM and local cost when transport fails', async () => {
        m.prisma.bOM.findUnique.mockResolvedValue({ items: [{ childProduct: { cogs: 8 }, quantity: 1, wasteFactor: 0 }] });
        m.update.mockRejectedValue(new Error('offline'));
        expect((await app.inject({ method: 'POST', url: '/products/p/bom', payload: { items: [] } })).statusCode).toBe(200);
        expect(m.prisma.wooProduct.update).toHaveBeenCalledWith({ where: { id: 'p' }, data: { cogs: 8 } });
    });

    it('rejects a variation outside the parent before writes', async () => {
        m.prisma.productVariation.findUnique.mockResolvedValue(null);
        expect((await app.inject({ method: 'POST', url: '/products/p/bom', payload: { items: [], variationId: 11 } })).statusCode).toBe(404);
        expect(m.prisma.bOM.upsert).not.toHaveBeenCalled();
        expect(m.variation).not.toHaveBeenCalled();
    });
});
