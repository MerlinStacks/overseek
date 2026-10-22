import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AutomationContextService } from '../AutomationContextService';
import { automationConditionService } from '../AutomationConditionService';
import { prisma } from '../../utils/prisma';

vi.mock('../../utils/prisma', () => ({ prisma: { wooCustomer: { findFirst: vi.fn() }, wooOrder: { findFirst: vi.fn(), findUnique: vi.fn(), findMany: vi.fn() }, wooProduct: { findMany: vi.fn() } } }));
describe('automation WooCommerce product tags', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        vi.mocked(prisma.wooCustomer.findFirst).mockResolvedValue(null);
        vi.mocked(prisma.wooOrder.findFirst).mockResolvedValue(null);
        vi.mocked(prisma.wooOrder.findUnique).mockResolvedValue(null);
        vi.mocked(prisma.wooOrder.findMany).mockResolvedValue([]);
        vi.mocked(prisma.wooProduct.findMany).mockResolvedValue([{ wooId: 7, rawData: { tags: [{ id: 94, name: '9ct' }] } }] as any);
    });
    it.each([undefined, 'buyer@example.com'])('enriches parent product tags on order variation lines with email %s', async email => {
        const context = await new AutomationContextService().buildContext({ accountId: 'a', email, contextData: { order: { id: 42, line_items: [{ product_id: 7, variation_id: 99 }] } }, requiredFields: ['order.productTagId'] });
        expect(automationConditionService.evaluate({ field: 'order.productTagId', operator: 'contains', value: '94' }, context)).toBe(true);
        expect(automationConditionService.evaluate({ field: 'order.productTagId', operator: 'not_contains', value: '94' }, context)).toBe(false);
        expect(automationConditionService.evaluate({ field: 'order.productTagId', operator: 'contains', value: '9' }, context)).toBe(false);
        expect(prisma.wooProduct.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: { accountId: 'a', wooId: { in: [7] } } }));
    });
    it('matches older purchases and scopes history to the customer and account', async () => {
        vi.mocked(prisma.wooOrder.findMany).mockResolvedValue([{ id: 'old-order', rawData: { line_items: [{ product_id: 7 }] } }] as any);
        const context = await new AutomationContextService().buildContext({ accountId: 'a', email: 'Buyer@Example.com', requiredFields: ['customer.purchasedProductTagIds'] });
        expect(automationConditionService.evaluate({ field: 'customer.purchasedProductTagIds', operator: 'contains', value: '94' }, context)).toBe(true);
        expect(prisma.wooOrder.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: { accountId: 'a', status: { in: ['processing', 'on-hold', 'completed'] }, OR: [{ billingEmail: { equals: 'buyer@example.com', mode: 'insensitive' } }] } }));
    });
    it('enriches a root-level order payload even before the order is synced locally', async () => {
        const context = await new AutomationContextService().buildContext({ accountId: 'a', contextData: { line_items: [{ product_id: 7 }] }, requiredFields: ['order.productTagId'] });
        expect(automationConditionService.evaluate({ field: 'order.productTagId', operator: 'contains', value: '94' }, context)).toBe(true);
    });
    it('continues beyond the first page of purchase history', async () => {
        vi.mocked(prisma.wooOrder.findMany)
            .mockResolvedValueOnce(Array.from({ length: 250 }, (_, i) => ({ id: `order-${i}`, rawData: { line_items: [] } })) as any)
            .mockResolvedValueOnce([{ id: 'older', rawData: { line_items: [{ product_id: 7 }] } }] as any);
        const context = await new AutomationContextService().buildContext({ accountId: 'a', wooCustomerId: 12, requiredFields: ['customer.purchasedProductTagIds'] });
        expect(prisma.wooOrder.findMany).toHaveBeenNthCalledWith(2, expect.objectContaining({ cursor: { id: 'order-249' }, skip: 1 }));
        expect(automationConditionService.evaluate({ field: 'customer.purchasedProductTagIds', operator: 'contains', value: '94' }, context)).toBe(true);
    });
    it('does not read history for unrelated conditions or without a customer identity', async () => {
        await new AutomationContextService().buildContext({ accountId: 'a', email: 'buyer@example.com', requiredFields: ['order.total'] });
        await new AutomationContextService().buildContext({ accountId: 'a', requiredFields: ['customer.purchasedProductTagIds'] });
        expect(prisma.wooOrder.findMany).not.toHaveBeenCalled();
    });
    it('does not match missing products or empty history', async () => {
        const context = await new AutomationContextService().buildContext({ accountId: 'a', email: 'buyer@example.com', requiredFields: ['customer.purchasedProductTagIds'] });
        expect(automationConditionService.evaluate({ field: 'customer.purchasedProductTagIds', operator: 'contains', value: '94' }, context)).toBe(false);
    });
});
