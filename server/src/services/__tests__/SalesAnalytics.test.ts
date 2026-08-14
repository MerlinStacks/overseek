import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../utils/prisma', () => ({
    prisma: {
        account: { findUnique: vi.fn() },
        wooOrder: { findMany: vi.fn() }
    }
}));

vi.mock('../../utils/elastic', () => ({
    esClient: { search: vi.fn() }
}));

vi.mock('../../utils/logger', () => ({
    Logger: { error: vi.fn() }
}));

vi.mock('../analytics/SalesForecast', () => ({
    SalesForecastService: { getSalesForecast: vi.fn() }
}));

vi.mock('../analytics/CustomReport', () => ({
    CustomReportService: { getCustomReport: vi.fn() }
}));

import { prisma } from '../../utils/prisma';
import { SalesAnalytics } from '../analytics/sales';

const findAccount = vi.mocked(prisma.account.findUnique);
const findOrders = vi.mocked(prisma.wooOrder.findMany);

describe('SalesAnalytics.getSalesOverTime', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        findAccount.mockResolvedValue({
            timezone: 'Australia/Sydney',
            revenueTaxInclusive: true
        } as any);
    });

    it('uses store-local boundaries and groups authoritative orders by store day', async () => {
        findOrders.mockResolvedValue([
            {
                dateCreated: new Date('2026-08-13T14:15:00.000Z'),
                total: '236.50',
                rawData: { total_tax: '21.50' }
            },
            {
                dateCreated: new Date('2026-08-14T01:30:00.000Z'),
                total: '271.65',
                rawData: { total_tax: '24.70' }
            }
        ] as any);

        const result = await SalesAnalytics.getSalesOverTime(
            'account-1',
            '2026-08-14',
            '2026-08-14',
            'day'
        );

        expect(findOrders).toHaveBeenCalledWith(expect.objectContaining({
            where: expect.objectContaining({
                accountId: 'account-1',
                dateCreated: {
                    gte: new Date('2026-08-13T14:00:00.000Z'),
                    lte: new Date('2026-08-14T13:59:59.999Z')
                }
            })
        }));
        expect(result).toEqual([{ date: '2026-08-14', sales: 508.15, orders: 2 }]);
    });

    it('matches the dashboard tax-exclusive revenue calculation', async () => {
        findAccount.mockResolvedValue({
            timezone: 'Australia/Sydney',
            revenueTaxInclusive: false
        } as any);
        findOrders.mockResolvedValue([{
            dateCreated: new Date('2026-08-14T01:30:00.000Z'),
            total: '110.00',
            rawData: { total_tax: '10.00' }
        }] as any);

        const result = await SalesAnalytics.getSalesOverTime(
            'account-1', '2026-08-14', '2026-08-14', 'day'
        );

        expect(result).toEqual([{ date: '2026-08-14', sales: 100, orders: 1 }]);
    });
});
