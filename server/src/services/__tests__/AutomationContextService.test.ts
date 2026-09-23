import { beforeEach, describe, expect, it, vi } from 'vitest';
import { automationContextService } from '../AutomationContextService';
import { automationConditionService } from '../AutomationConditionService';
import { prisma } from '../../utils/prisma';
import { snapshotFixture } from '../deliveryEstimates/__tests__/snapshotFixture';

vi.mock('../../utils/prisma', () => ({
    prisma: {
        wooOrder: {
            findUnique: vi.fn(),
            findFirst: vi.fn()
        },
        wooCustomer: {
            findFirst: vi.fn()
        },
        wooProduct: {
            findMany: vi.fn()
        },
        message: {
            findFirst: vi.fn()
        },
        wooReview: {
            findFirst: vi.fn()
        }
    }
}));

describe('AutomationContextService', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        vi.mocked(prisma.wooOrder.findUnique).mockResolvedValue(null);
        vi.mocked(prisma.wooOrder.findFirst).mockResolvedValue(null);
        vi.mocked(prisma.wooCustomer.findFirst).mockResolvedValue(null);
        vi.mocked(prisma.wooProduct.findMany).mockResolvedValue([]);
        vi.mocked(prisma.message.findFirst).mockResolvedValue(null);
        vi.mocked(prisma.wooReview.findFirst).mockResolvedValue(null);
    });

    it('loads Woo shipping lines for order shipping type conditions', async () => {
        vi.mocked(prisma.wooOrder.findUnique).mockResolvedValue({
            dateCreated: new Date('2026-01-01T00:00:00.000Z'),
            rawData: {
                id: 123,
                shipping_lines: [{ method_id: 'local_pickup:1', method_title: 'Click and Collect' }]
            }
        } as any);

        const context = await automationContextService.buildContext({
            accountId: 'account-1',
            contextData: { orderId: 123 },
            requiredFields: ['order.shippingType']
        });

        expect(prisma.wooOrder.findUnique).toHaveBeenCalledWith({
            where: { accountId_wooId: { accountId: 'account-1', wooId: 123 } },
            select: {
                rawData: true,
                deliveryEstimateSnapshot: true,
                dateCreated: true
            }
        });
        expect(context.order?.shipping_lines).toEqual([
            { method_id: 'local_pickup:1', method_title: 'Click and Collect' }
        ]);
        expect(automationConditionService.evaluate({
            conditions: [{ field: 'order.shippingType', operator: 'eq', value: 'click_and_collect' }]
        }, context)).toBe(true);
    });

    it('email enrichment reads only customer-scoped purchase dates for a welcome context', async () => {
        const dateCreated = new Date(Date.now() - 5 * 24 * 60 * 60 * 1000);
        vi.mocked(prisma.wooOrder.findFirst).mockResolvedValue({ dateCreated } as any);
        const context = await automationContextService.buildContext({ accountId: 'a', email: 'Customer@Example.com', exactEmailOrder: true });
        expect(prisma.wooOrder.findFirst).toHaveBeenCalledExactlyOnceWith({
            where: { accountId: 'a', status: { in: ['processing', 'on-hold', 'completed'] }, OR: [{ billingEmail: 'customer@example.com' }] },
            orderBy: { dateCreated: 'desc' }, select: { dateCreated: true }
        });
        expect(context.customer.lastOrderDate).toBe(dateCreated.toISOString());
        expect(context.customer.daysSinceLastOrder).toBe(5);
        expect(context.order).toBeUndefined();
        expect(context.billing).toBeUndefined();
        expect(prisma.wooOrder.findUnique).not.toHaveBeenCalled();
    });

    it('exact email customer-created context with billing never hydrates a colliding order', async () => {
        vi.mocked(prisma.wooOrder.findFirst).mockResolvedValue({ rawData: { id: 42, billing: { email: 'private@example.com' } }, deliveryEstimateSnapshot: snapshotFixture() } as any);
        const context = await automationContextService.buildContext({
            accountId: 'account-1', exactEmailOrder: true,
            contextData: { id: 42, wooId: 42, billing: { email: 'new@example.com' } }
        });
        expect(context.order).toBeUndefined();
        expect(prisma.wooOrder.findFirst).toHaveBeenCalledExactlyOnceWith({
            where: { accountId: 'account-1', status: { in: ['processing', 'on-hold', 'completed'] }, OR: [{ billingEmail: 'new@example.com' }] },
            orderBy: { dateCreated: 'desc' }, select: { dateCreated: true }
        });
        expect(context.billing).toEqual({ email: 'new@example.com' });
        expect(prisma.wooOrder.findUnique).not.toHaveBeenCalled();
    });

    it('exact order billing and snapshot coexist with the customer latest purchase date', async () => {
        const latestDate = new Date(Date.now() - 2 * 24 * 60 * 60 * 1000);
        const billing = { email: 'buyer@example.com', address_1: 'Exact order address' };
        vi.mocked(prisma.wooOrder.findFirst)
            .mockResolvedValueOnce({ rawData: { id: 42, billing, date_created: '2020-01-01T00:00:00Z' }, deliveryEstimateSnapshot: snapshotFixture() } as any)
            .mockResolvedValueOnce({ dateCreated: latestDate } as any);
        const context = await automationContextService.buildContext({
            accountId: 'account-1', exactEmailOrder: true, wooCustomerId: 7, contextData: { orderId: 42 }
        });
        expect(prisma.wooOrder.findFirst).toHaveBeenLastCalledWith({
            where: { accountId: 'account-1', status: { in: ['processing', 'on-hold', 'completed'] }, OR: [{ wooCustomerId: 7 }, { billingEmail: 'buyer@example.com' }] },
            orderBy: { dateCreated: 'desc' }, select: { dateCreated: true }
        });
        expect(context.customer.lastOrderDate).toBe(latestDate.toISOString());
        expect(context.customer.daysSinceLastOrder).toBe(2);
        expect(context.billing).toEqual(billing);
        expect(context.order).toMatchObject({ id: 42, billing, deliveryEstimateSnapshot: snapshotFixture() });
    });

    it('customer ID alone scopes the date-only history lookup', async () => {
        const dateCreated = new Date('2026-01-01T00:00:00Z');
        vi.mocked(prisma.wooOrder.findFirst).mockResolvedValue({ dateCreated } as any);
        const context = await automationContextService.buildContext({ accountId: 'a', wooCustomerId: 7, exactEmailOrder: true });
        expect(prisma.wooOrder.findFirst).toHaveBeenCalledExactlyOnceWith({
            where: { accountId: 'a', status: { in: ['processing', 'on-hold', 'completed'] }, OR: [{ wooCustomerId: 7 }] },
            orderBy: { dateCreated: 'desc' }, select: { dateCreated: true }
        });
        expect(context.customer.lastOrderDate).toBe(dateCreated.toISOString());
        expect(context.order).toBeUndefined();
    });

    it.each([{ requiredFields: [] }, { requiredFields: ['customer.ordersCount'] }])('no-email exact order retains billing and snapshot with required fields %j', async ({ requiredFields }) => {
        const billing = { first_name: 'Buyer', address_1: 'Exact address' };
        vi.mocked(prisma.wooOrder.findFirst).mockResolvedValue({ rawData: { id: 42, billing }, deliveryEstimateSnapshot: snapshotFixture() } as any);
        const context = await automationContextService.buildContext({
            accountId: 'a', exactEmailOrder: true, contextData: { order: { id: 42 } }, requiredFields
        });
        expect(context.order).toMatchObject({ id: 42, billing, deliveryEstimateSnapshot: snapshotFixture() });
        expect(context.billing).toEqual(billing);
        expect(prisma.wooOrder.findFirst).toHaveBeenCalledExactlyOnceWith({
            where: { accountId: 'a', wooId: 42 }, select: { rawData: true, deliveryEstimateSnapshot: true }
        });
        expect(prisma.wooCustomer.findFirst).not.toHaveBeenCalled();
    });

    it('exact reference event enriches the order without overwriting its identity or status', async () => {
        vi.mocked(prisma.wooOrder.findFirst).mockResolvedValue({ rawData: {
            id: 42, status: 'processing', line_items: [{ product_id: 7, name: 'Ordered item' }]
        }, deliveryEstimateSnapshot: snapshotFixture() } as any);
        vi.mocked(prisma.wooProduct.findMany).mockResolvedValue([{ wooId: 7, permalink: 'https://store.test/product/seven', rawData: { categories: [{ id: 8 }] } }] as any);
        const context = await automationContextService.buildContext({
            accountId: 'account-1', exactEmailOrder: true,
            contextData: { id: 'shipment-id', orderId: 'order-id', status: 'in_transit' }
        });
        expect(context.id).toBe('shipment-id');
        expect(context.status).toBe('in_transit');
        expect(context.order).toMatchObject({ id: 42, status: 'processing', deliveryEstimateSnapshot: snapshotFixture(),
            line_items: [{ product_id: 7, permalink: 'https://store.test/product/seven', categoryIds: ['8'] }] });
        expect(prisma.wooOrder.findFirst).toHaveBeenCalledTimes(1);
        expect(prisma.wooOrder.findFirst).toHaveBeenCalledWith(expect.objectContaining({ where: { accountId: 'account-1', id: 'order-id' } }));
        expect(prisma.wooOrder.findUnique).not.toHaveBeenCalled();
    });

    it.each(['lineItems', 'items'])('exact legacy %s context without ID retains items and clears snapshot', async field => {
        const context = await automationContextService.buildContext({ accountId: 'account-1', exactEmailOrder: true,
            contextData: { [field]: [{ name: 'Legacy item' }], deliveryEstimateSnapshot: snapshotFixture() } });
        expect(context.order?.[field]).toEqual([{ name: 'Legacy item' }]);
        expect(context.order?.deliveryEstimateSnapshot).toBeNull();
        expect(prisma.wooOrder.findFirst).not.toHaveBeenCalled();
    });

    it('persisted snapshot overrides the base event and exact lookup failure never chooses latest', async () => {
        vi.mocked(prisma.wooOrder.findUnique).mockResolvedValue({ rawData: { id: 42 }, deliveryEstimateSnapshot: snapshotFixture() } as any);
        const context = await automationContextService.buildContext({ accountId: 'a', contextData: { order: { id: 42, deliveryEstimateSnapshot: null } } });
        expect(context.order?.deliveryEstimateSnapshot).toEqual(snapshotFixture());
        vi.mocked(prisma.wooOrder.findUnique).mockResolvedValue(null);
        const missing = await automationContextService.buildContext({ accountId: 'a', email: 'customer@example.com', contextData: { orderId: 42 } });
        expect(missing.order?.deliveryEstimateSnapshot).toBeNull();
        expect(prisma.wooOrder.findFirst).not.toHaveBeenCalled();
    });

    it('enriches order line items with product category IDs for category conditions', async () => {
        vi.mocked(prisma.wooOrder.findUnique).mockResolvedValue({
            dateCreated: new Date('2026-01-01T00:00:00.000Z'),
            rawData: {
                id: 123,
                line_items: [{ product_id: 42, quantity: 1 }]
            }
        } as any);
        vi.mocked(prisma.wooProduct.findMany).mockResolvedValue([
            {
                wooId: 42,
                permalink: null,
                rawData: { categories: [{ id: 25, name: 'Rings' }] }
            }
        ] as any);

        const context = await automationContextService.buildContext({
            accountId: 'account-1',
            contextData: { orderId: 123 },
            requiredFields: ['order.categoryId']
        });

        expect(prisma.wooProduct.findMany).toHaveBeenCalledWith({
            where: {
                accountId: 'account-1',
                wooId: { in: [42] }
            },
            select: {
                wooId: true,
                permalink: true,
                rawData: true
            }
        });
        expect(context.order?.line_items?.[0]?.categoryIds).toEqual(['25']);
        expect(automationConditionService.evaluate({
            conditions: [{ field: 'order.categoryId', operator: 'eq', value: '25' }]
        }, context)).toBe(true);
    });
});
