import Fastify from 'fastify';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { REVENUE_STATUSES } from '../../constants/orderStatus';

vi.mock('zod', async () => {
    const actual = await vi.importActual<any>('zod');
    return { ...actual, z: actual.z ?? actual.default };
});
const m = vi.hoisted(() => ({
    wooProduct: { findFirst: vi.fn(), findMany: vi.fn() },
    internalProduct: { findMany: vi.fn() },
    auditLog: { findMany: vi.fn() },
    bOMDeductionLedger: { findMany: vi.fn() },
    bOMItem: { findMany: vi.fn() },
    bOM: { findMany: vi.fn() },
    wooOrder: { findMany: vi.fn() },
    productVariation: { findMany: vi.fn() }
}));
vi.mock('../../utils/prisma', () => ({ prisma: m }));
vi.mock('../../utils/logger', () => ({ Logger: { error: vi.fn() } }));
import { stockMovementRoutes } from './stock-movements';

const product = { id: 'product', wooId: 42, name: 'Widget', sku: 'W' };
const date = new Date('2026-09-01T00:00:00Z');
const audit = (id: string, details: Record<string, unknown> = { stock_quantity: 8 }) => ({
    id, resourceId: 'product', source: 'USER', previousValue: { stock_quantity: 10 }, details, createdAt: date
});
const ledger = (status = 'COMPLETED') => ({
    id: 'ledger', orderId: 90, componentType: 'WooProduct', componentId: 'product',
    componentName: 'Widget', wooId: 42, quantityDeducted: 2, previousStock: 10, newStock: 8,
    status, createdAt: date, rolledBackAt: status === 'REVERSED' ? new Date('2026-09-02') : null
});
const sale = (wooId: number) => ({
    wooId, number: `ORD-${wooId}`, dateCreated: date,
    rawData: { line_items: [{ product_id: 42, quantity: 1 }, { product_id: 42, quantity: 1 }, { product_id: 99, quantity: 20 }] }
});

describe('stock movement history', () => {
    let app: ReturnType<typeof Fastify>;
    beforeEach(async () => {
        vi.resetAllMocks();
        for (const model of Object.values(m)) model.findMany.mockResolvedValue([]);
        m.wooProduct.findFirst.mockResolvedValue(product);
        m.wooProduct.findMany.mockResolvedValue([product]);
        app = Fastify();
        app.addHook('preHandler', async request => { request.accountId = 'account'; });
        await app.register(stockMovementRoutes);
    });
    afterEach(async () => { await app.close(); });

    it.each(['page=0', 'page=1.5', 'limit=201', 'productId='])('validates %s', async query => {
        expect((await app.inject(`/stock-movements?${query}`)).statusCode).toBe(400);
        expect(m.auditLog.findMany).not.toHaveBeenCalled();
    });

    it('rejects absent or other-account products before querying history', async () => {
        m.wooProduct.findFirst.mockResolvedValue(null);
        expect((await app.inject('/stock-movements?productId=foreign')).statusCode).toBe(404);
        expect(m.wooProduct.findFirst).toHaveBeenCalledWith(expect.objectContaining({ where: { accountId: 'account', id: 'foreign' } }));
        expect(m.auditLog.findMany).not.toHaveBeenCalled();
        expect(m.wooOrder.findMany).not.toHaveBeenCalled();
    });

    it('filters all scoped audits before pagination, resolves legacy IDs and includes BOM sync', async () => {
        m.auditLog.findMany.mockResolvedValue([
            ...Array.from({ length: 12 }, (_, i) => audit(`noise-${i}`, { name: 'Renamed' })),
            { ...audit('a'), resourceId: '42', source: 'SYSTEM_BOM' },
            audit('b'), audit('c'),
            audit('null', { stock_quantity: null }), audit('empty', { stock_quantity: '' }),
            audit('same', { stock_quantity: 10 }), audit('internal', { stock_quantity: 8, productType: 'INTERNAL' })
        ]);
        const first = (await app.inject('/stock-movements?productId=product&limit=2')).json();
        expect(first).toMatchObject({ total: 3, page: 1, limit: 2, totalPages: 2 });
        expect(first.movements[0]).toMatchObject({ id: 'audit:a', productId: 'product', productName: 'Widget', type: 'BOM_SYNC', quantity: -2 });
        const second = (await app.inject('/stock-movements?productId=product&limit=2&page=2')).json();
        expect(second.movements.map((movement: any) => movement.id)).toEqual(['audit:c']);
        expect((await app.inject('/stock-movements?productId=product&limit=2&page=3')).json().movements).toEqual([]);
        const query = m.auditLog.findMany.mock.calls[0][0];
        expect(query.where).toEqual({ accountId: 'account', resource: 'PRODUCT', action: 'UPDATE', resourceId: { in: ['product', '42'] } });
        expect(query).not.toHaveProperty('take');
        expect(m.bOMDeductionLedger.findMany.mock.calls[0][0]).toMatchObject({ where: { accountId: 'account', componentId: 'product', componentType: { in: ['WooProduct', 'ProductVariation'] } } });
        expect(m.bOMDeductionLedger.findMany.mock.calls[0][0]).not.toHaveProperty('take');
    });

    it('merges ordinary sales with audits and ledger reversals, retaining structured order links', async () => {
        m.auditLog.findMany.mockResolvedValue([audit('order', { stock_quantity: 8, orderId: '91', movementType: 'SALE' })]);
        m.bOMDeductionLedger.findMany.mockResolvedValue([ledger('REVERSED')]);
        m.wooOrder.findMany.mockImplementation(async query => query.where.rawData
            ? [sale(90), sale(91), sale(92)]
            : [{ wooId: 90, number: 'ORD-90' }]);
        const body = (await app.inject('/stock-movements?productId=product&limit=2')).json();
        expect(body).toMatchObject({ total: 4, totalPages: 2 });
        expect(body.movements[0]).toMatchObject({ type: 'ORDER_REVERSAL', orderId: 90, quantity: 2, reference: 'ORD-90' });
        const second = (await app.inject('/stock-movements?productId=product&limit=2&page=2')).json();
        expect(second.movements).toEqual(expect.arrayContaining([
            expect.objectContaining({ type: 'ORDER_CONSUMPTION', orderId: 90 }),
            expect.objectContaining({ id: 'sale:92:product', type: 'SALE', orderId: 92, quantity: -2, previousStock: null, newStock: null, reference: 'ORD-92' })
        ]));
        expect(m.wooOrder.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: {
            accountId: 'account', status: { in: REVENUE_STATUSES },
            rawData: { path: ['line_items'], array_contains: [{ product_id: 42 }] }
        } }));
    });

    it('returns empty pagination metadata for products without history', async () => {
        expect((await app.inject('/stock-movements?productId=product')).json()).toEqual({ movements: [], total: 0, page: 1, limit: 100, totalPages: 0 });
    });

    it('retains a sale when an order-linked deduction only covers part of its quantity', async () => {
        m.auditLog.findMany.mockResolvedValue([audit('partial', { stock_quantity: 9, orderId: 92 })]);
        m.wooOrder.findMany.mockImplementation(async query => query.where.rawData ? [sale(92)] : []);
        const body = (await app.inject('/stock-movements?productId=product')).json();
        expect(body.total).toBe(2);
        expect(body.movements).toEqual(expect.arrayContaining([expect.objectContaining({ type: 'SALE', orderId: 92, quantity: -2 })]));
    });

    it('resolves legacy variation audits and variation ledger labels under the scoped parent', async () => {
        m.auditLog.findMany.mockResolvedValue([{ ...audit('variation', { stock_quantity: 8, variationWooId: 43 }), resourceId: '42' }]);
        m.bOMDeductionLedger.findMany.mockResolvedValue([{ ...ledger(), componentType: 'ProductVariation', wooId: 43 }]);
        m.productVariation.findMany.mockResolvedValue([{ productId: 'product', wooId: 43, sku: 'W-BLUE', rawData: { attributes: [{ option: 'Blue' }] } }]);
        const body = (await app.inject('/stock-movements?productId=product')).json();
        expect(body.total).toBe(2);
        for (const movement of body.movements) {
            expect(movement).toMatchObject({ productId: 'product', productName: 'Widget - Blue', sku: 'W-BLUE' });
        }
        expect(m.productVariation.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: { OR: [{ productId: 'product', wooId: 43 }] } }));
    });

    it('preserves global limits, total semantics and BOM sync exclusion without loading sales', async () => {
        m.auditLog.findMany.mockResolvedValue([{ ...audit('sync'), source: 'SYSTEM_BOM' }, audit('a'), audit('b')]);
        const body = (await app.inject('/stock-movements?limit=1')).json();
        expect(body).toMatchObject({ total: 1, movements: [{ type: 'ADJUSTMENT' }] });
        expect(body).not.toHaveProperty('page');
        expect(m.auditLog.findMany.mock.calls[0][0]).toMatchObject({ take: 2 });
        expect(m.bOMDeductionLedger.findMany.mock.calls[0][0]).toMatchObject({ take: 1 });
        expect(m.wooProduct.findFirst).not.toHaveBeenCalled();
        expect(m.wooOrder.findMany).toHaveBeenCalledTimes(1);
    });

    it('reports data-source failures', async () => {
        m.wooOrder.findMany.mockRejectedValue(new Error('database unavailable'));
        expect((await app.inject('/stock-movements?productId=product')).statusCode).toBe(500);
    });
});
