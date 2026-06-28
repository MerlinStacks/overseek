import { beforeEach, describe, expect, it, vi } from 'vitest';
import { automationContextService } from '../AutomationContextService';
import { automationConditionService } from '../AutomationConditionService';
import { prisma } from '../../utils/prisma';

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
