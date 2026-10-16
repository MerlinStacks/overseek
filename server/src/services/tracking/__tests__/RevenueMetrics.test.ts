import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../../utils/prisma', () => ({ prisma: {
    account: { findUnique: vi.fn() },
    wooOrder: { findMany: vi.fn() },
    analyticsEvent: { findMany: vi.fn() }
} }));

import { prisma } from '../../../utils/prisma';
import { getRevenue } from '../RevenueMetrics';

describe('revenue metrics account settings', () => {
    beforeEach(() => {
        vi.useFakeTimers();
        vi.setSystemTime(new Date('2026-10-16T04:00:00Z'));
        vi.mocked(prisma.account.findUnique).mockResolvedValue({
            timezone: 'Australia/Sydney', revenueTaxInclusive: true
        } as any);
        vi.mocked(prisma.analyticsEvent.findMany).mockResolvedValue([]);
        vi.mocked(prisma.wooOrder.findMany).mockResolvedValue([
            { wooId: 1, total: 110, rawData: { total_tax: '10', billing: { country: 'AU' } } },
            { wooId: 2, total: 55, rawData: { total_tax: '5', billing: { country: 'AU' } } }
        ] as any);
    });

    afterEach(() => { vi.useRealTimers(); vi.resetAllMocks(); });

    it('uses store midnight, not browser midnight, for Today', async () => {
        const result = await getRevenue('acct-1', 1, 'America/Los_Angeles');
        const dateFilter = {
            gte: new Date('2026-10-15T13:00:00Z'), lte: new Date('2026-10-16T04:00:00Z')
        };
        expect(prisma.wooOrder.findMany).toHaveBeenCalledWith(expect.objectContaining({
            where: { accountId: 'acct-1', dateCreated: dateFilter, status: {
                notIn: ['cancelled', 'refunded', 'failed', 'trash', 'auto-draft', 'checkout-draft']
            } }
        }));
        expect(prisma.analyticsEvent.findMany).toHaveBeenCalledWith(expect.objectContaining({
            where: { session: { accountId: 'acct-1' }, type: 'purchase', createdAt: dateFilter }
        }));
        expect(result).toMatchObject({ totalRevenue: 165, orderCount: 2, aov: 82.5 });
    });

    it('applies the account tax-exclusive setting to totals, AOV and breakdowns', async () => {
        vi.mocked(prisma.account.findUnique).mockResolvedValue({
            timezone: 'Australia/Sydney', revenueTaxInclusive: false
        } as any);
        expect(await getRevenue('acct-1', 1, 'UTC')).toMatchObject({
            totalRevenue: 150, orderCount: 2, aov: 75,
            byFirstTouch: [{ source: 'direct', revenue: 150 }],
            byLastTouch: [{ source: 'direct', revenue: 150 }],
            byCountry: [{ country: 'AU', revenue: 150 }],
            byDevice: [{ device: 'unknown', revenue: 150 }]
        });
    });

    it('falls back to the browser timezone if no store timezone is configured', async () => {
        vi.mocked(prisma.account.findUnique).mockResolvedValue(null);
        await getRevenue('acct-1', 1, 'UTC');
        expect(prisma.wooOrder.findMany).toHaveBeenCalledWith(expect.objectContaining({
            where: expect.objectContaining({ dateCreated: {
                gte: new Date('2026-10-16T00:00:00Z'), lte: new Date('2026-10-16T04:00:00Z')
            } })
        }));
    });
});
