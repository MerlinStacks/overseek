import { beforeEach, expect, it, vi } from 'vitest';
const m = vi.hoisted(() => ({ groups: vi.fn(), statuses: vi.fn(), logs: vi.fn(), unsubs: vi.fn(), count: vi.fn() }));
vi.mock('../utils/prisma', () => ({ prisma: { campaignEvent: { groupBy: m.groups }, emailLog: { groupBy: m.statuses, findMany: m.logs }, emailUnsubscribe: { count: m.count, findMany: m.unsubs } } }));
import { EmailDashboardService } from './EmailDashboardService';
beforeEach(() => { vi.clearAllMocks(); m.groups.mockResolvedValue([{ campaignType: 'automation', eventType: 'send', _count: 2 }]); m.statuses.mockResolvedValue([{ status: 'SENT', _count: 3 }, { status: 'FAILED', _count: 1 }, { status: 'QUEUED', _count: 5 }]); m.logs.mockResolvedValue([]); m.unsubs.mockResolvedValue([]); m.count.mockResolvedValue(0); });
it('uses explicit terminal-status denominator, nullable revenue/currency and UTC bounds', async () => {
    const result = await EmailDashboardService.get('a', 7); expect(result.kpis).toMatchObject({ attemptedCount: 4, failedCount: 1, failureRate: 25, bounceRate: null, flowRevenue: null }); expect(result.currency).toBeNull(); expect(result.coverage.unknownStatusRows).toBe(5); expect(m.logs.mock.calls[0][0]).toMatchObject({ where: { accountId: 'a', createdAt: { lt: expect.any(Date), gte: expect.any(Date) } }, take: 10001 });
});
it('does not fabricate daily zeroes from truncated trend samples', async () => { m.logs.mockResolvedValue(Array.from({ length: 10001 }, () => ({ status: 'SENT', createdAt: new Date() }))); const result = await EmailDashboardService.get('a', 7); expect(result.coverage.trendComplete).toBe(false); expect(result.trends).toEqual([]); });
it('distinguishes unavailable ratios from known zero failure counts', async () => { m.statuses.mockResolvedValue([]); expect((await EmailDashboardService.get('a', 7)).kpis.failureRate).toBeNull(); await expect(EmailDashboardService.get('a', 999)).rejects.toThrow(); });
