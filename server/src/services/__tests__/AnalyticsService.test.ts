
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { AnalyticsService } from '../AnalyticsService';
import { prisma } from '../../utils/prisma';

// Mock prisma
vi.mock('../../utils/prisma', () => ({
    prisma: {
        wooOrder: {
            findMany: vi.fn(),
        },
        wooProduct: {
            findMany: vi.fn(),
        },
        productVariation: {
            findMany: vi.fn(),
        },
        // Mocks for other methods in AnalyticsService if they are called (they are not in this test)
        analyticsSession: {
            findMany: vi.fn(),
            count: vi.fn(),
        },
        analyticsEvent: {
            findMany: vi.fn(),
            count: vi.fn(),
        }
    }
}));

// Mock prismaReplica to prevent connection errors during import
vi.mock('../../utils/prismaReplica', () => ({
    prismaReplica: {},
    isReplicaConfigured: false
}));

// Mock cache
vi.mock('../../utils/cache', () => ({
    cacheAside: vi.fn((key, fn) => fn()),
    CacheTTL: { MEDIUM: 300 },
    CacheNamespace: { ANALYTICS: 'analytics' }
}));

// Mock logger
vi.mock('../../utils/logger', () => ({
    Logger: {
        info: vi.fn(),
        warn: vi.fn(),
        error: vi.fn(),
    }
}));

describe('AnalyticsService.getProfitabilityReport', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('should calculate profit including payment fees', async () => {
        const accountId = 'acc_123';
        const startDate = new Date('2023-01-01');
        const endDate = new Date('2023-01-31');

        // Mock Orders
        const mockOrders = [
            {
                id: 'ord_1',
                wooId: 101,
                number: '1001',
                dateCreated: new Date('2023-01-10'),
                rawData: {
                    total: '100.00',
                    line_items: [
                        { product_id: 1, quantity: 1, total: '100.00', name: 'Product A' }
                    ],
                    meta_data: [
                        { key: '_stripe_fee', value: '3.00' }
                    ]
                }
            },
            {
                id: 'ord_2',
                wooId: 102,
                number: '1002',
                dateCreated: new Date('2023-01-11'),
                rawData: {
                    total: '200.00',
                    line_items: [
                        { product_id: 2, quantity: 2, total: '200.00', name: 'Product B' }
                    ],
                    meta_data: [
                        { key: '_paypal_transaction_fee', value: '5.00' }
                    ]
                }
            }
        ];
        (prisma.wooOrder.findMany as any).mockResolvedValue(mockOrders);

        // Mock Products (COGS)
        (prisma.wooProduct.findMany as any).mockResolvedValue([
            { wooId: 1, cogs: '40.00', sku: 'A' },
            { wooId: 2, cogs: '40.00', sku: 'B' } // 2 units * 40 = 80 cost
        ]);
        (prisma.productVariation.findMany as any).mockResolvedValue([]);

        const result = await AnalyticsService.getProfitabilityReport(accountId, startDate, endDate);

        // Revenue: 100 + 200 = 300
        // Cost: 40 + (40 * 2) = 120
        // Fees: 3 + 5 = 8
        // Profit: 300 - 120 - 8 = 172

        expect(result.summary.revenue).toBe(300);
        expect(result.summary.cost).toBe(120);
        expect(result.summary.paymentFees).toBe(8);
        expect(result.summary.profit).toBe(172);
    });
});
