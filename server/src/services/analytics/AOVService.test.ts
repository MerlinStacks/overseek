import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../utils/prisma', () => ({ prisma: { wooOrder: { findMany: vi.fn() }, account: { findUnique: vi.fn() } } }));
vi.mock('../../utils/logger', () => ({ Logger: { error: vi.fn() } }));

import { prisma } from '../../utils/prisma';
import { aovService } from './AOVService';
import { getDateRangeForDays } from '../../utils/dateRange';

describe('AOV revenue date windows', () => {
    beforeEach(() => {
        vi.useFakeTimers();
        vi.setSystemTime(new Date('2026-10-16T04:00:00Z'));
        vi.mocked(prisma.wooOrder.findMany).mockResolvedValue([]);
        vi.mocked(prisma.account.findUnique).mockResolvedValue(null);
    });

    afterEach(() => {
        vi.useRealTimers();
        vi.resetAllMocks();
    });

    it.each([-1, 1, 7, 30, 90, 365])('uses the revenue window for preset %i', async days => {
        const { startDate, endDate } = getDateRangeForDays(days, 'Australia/Sydney');
        await aovService.getAOVTrend('acct-1', days, 'Australia/Sydney');
        await aovService.getAOVComparison('acct-1', days, 'Australia/Sydney');
        for (const call of [0, 1]) {
            expect(prisma.wooOrder.findMany).toHaveBeenNthCalledWith(call + 1, expect.objectContaining({
                where: expect.objectContaining({ accountId: 'acct-1', dateCreated: { gte: startDate, lte: endDate } })
            }));
        }
        const previous = vi.mocked(prisma.wooOrder.findMany).mock.calls[2][0]?.where?.dateCreated as { gte: Date; lte: Date };
        expect(previous.lte.getTime()).toBe(startDate.getTime() - 1);
        expect(previous.gte.getTime()).toBeLessThan(previous.lte.getTime());
    });

    it('groups orders by the same local dates used for filtering', async () => {
        vi.mocked(prisma.wooOrder.findMany).mockResolvedValue([
            { dateCreated: new Date('2026-10-14T14:00:00Z'), total: 100 },
            { dateCreated: new Date('2026-10-15T12:00:00Z'), total: 50 }
        ] as any);
        expect(await aovService.getAOVTrend('acct-1', -1, 'Australia/Sydney')).toEqual([
            { date: '2026-10-15', aov: 75, orders: 2 }
        ]);
    });

    it('uses the store timezone and tax setting for both AOV endpoints', async () => {
        vi.mocked(prisma.account.findUnique).mockResolvedValue({ timezone: 'Australia/Sydney', revenueTaxInclusive: false } as any);
        vi.mocked(prisma.wooOrder.findMany).mockResolvedValue([
            { dateCreated: new Date('2026-10-15T14:00:00Z'), total: 110, rawData: { total_tax: '10' } }
        ] as any);
        expect(await aovService.getAOVTrend('acct-1', 1, 'UTC')).toEqual([
            { date: '2026-10-16', aov: 100, orders: 1 }
        ]);
        expect((await aovService.getAOVComparison('acct-1', 1, 'UTC')).current).toBe(100);
        expect(prisma.wooOrder.findMany).toHaveBeenCalledWith(expect.objectContaining({
            where: expect.objectContaining({
                dateCreated: { gte: new Date('2026-10-15T13:00:00Z'), lte: new Date('2026-10-16T04:00:00Z') },
                status: { notIn: expect.arrayContaining(['cancelled', 'refunded', 'failed']) }
            })
        }));
    });

    it('compares yesterday with the preceding calendar day across daylight saving', async () => {
        vi.setSystemTime(new Date('2026-10-05T04:00:00Z'));
        await aovService.getAOVComparison('acct-1', -1, 'Australia/Sydney');
        expect(prisma.wooOrder.findMany).toHaveBeenNthCalledWith(2, expect.objectContaining({
            where: expect.objectContaining({ dateCreated: {
                gte: new Date('2026-10-02T14:00:00Z'), lte: new Date('2026-10-03T13:59:59.999Z')
            } })
        }));
    });
});
