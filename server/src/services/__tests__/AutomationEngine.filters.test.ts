import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AutomationEngine } from '../AutomationEngine';
import { prisma } from '../../utils/prisma';

vi.mock('../../utils/prisma', () => ({
    prisma: {
        wooProduct: {
            findMany: vi.fn()
        }
    }
}));

vi.mock('../../utils/logger', () => ({
    Logger: {
        debug: vi.fn(),
        info: vi.fn(),
        warn: vi.fn(),
        error: vi.fn()
    }
}));

vi.mock('../AutomationQueueService', () => ({
    automationQueueService: {
        enqueueEnrollment: vi.fn()
    }
}));

const buildAutomation = (config: Record<string, unknown>) => ({
    id: 'automation-1',
    accountId: 'account-1',
    triggerType: 'ORDER_CREATED',
    flowDefinition: {
        nodes: [
            {
                id: 'trigger',
                type: 'trigger',
                data: { config }
            }
        ],
        edges: []
    }
});

describe('AutomationEngine trigger filters', () => {
    const engine = new AutomationEngine();

    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('fails closed when category filtering is enabled without a category', async () => {
        const result = await (engine as any).checkTriggerFilters(
            buildAutomation({ filterByCategory: true }),
            { line_items: [{ product_id: 10 }] }
        );

        expect(result).toBe(false);
        expect(prisma.wooProduct.findMany).not.toHaveBeenCalled();
    });

    it('resolves category filters from synced product data when order items omit categories', async () => {
        vi.mocked(prisma.wooProduct.findMany).mockResolvedValue([
            {
                rawData: {
                    categories: [{ id: 25, name: 'Rings' }]
                }
            }
        ] as any);

        const result = await (engine as any).checkTriggerFilters(
            buildAutomation({ filterByCategory: true, filterCategoryId: '25' }),
            { line_items: [{ product_id: 10 }] }
        );

        expect(result).toBe(true);
        expect(prisma.wooProduct.findMany).toHaveBeenCalledWith({
            where: {
                accountId: 'account-1',
                wooId: { in: [10] }
            },
            select: { rawData: true }
        });
    });

    it('fails closed when product filtering is enabled without a product', async () => {
        const result = await (engine as any).checkTriggerFilters(
            buildAutomation({ filterByProduct: true }),
            { line_items: [{ product_id: 10 }] }
        );

        expect(result).toBe(false);
    });

    it('includes artwork proof version in dedupe keys', () => {
        const v1Key = (engine as any).buildDedupeKey(
            'ARTWORK_APPROVAL_REQUESTED',
            'buyer@example.com',
            '1001',
            { proofVersion: 1 }
        );
        const v2Key = (engine as any).buildDedupeKey(
            'ARTWORK_APPROVAL_REQUESTED',
            'buyer@example.com',
            '1001',
            { proofVersion: 2 }
        );

        expect(v1Key).toBe('ARTWORK_APPROVAL_REQUESTED:1001:1:buyer@example.com');
        expect(v2Key).toBe('ARTWORK_APPROVAL_REQUESTED:1001:2:buyer@example.com');
        expect(v1Key).not.toBe(v2Key);
    });
});
