import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { TrendsSummary } from '../../ads/types';
const mocks = vi.hoisted(() => ({ account: vi.fn(), accounts: vi.fn(), google: vi.fn(), meta: vi.fn() }));
vi.mock('../../../utils/prisma', () => ({ prisma: { account: { findUnique: mocks.account }, adAccount: { findMany: mocks.accounts } } }));
vi.mock('../../ads', () => ({ AdsService: { getGoogleDailyTrends: mocks.google, getMetaDailyTrends: mocks.meta } }));
vi.mock('../../../utils/logger', () => ({ Logger: { debug: vi.fn(), warn: vi.fn() } }));
import { processTrendAnalysis } from './TrendAdvisor';
const rows = () => Array.from({ length: 14 }, (_, i) => ({ date: `2026-10-${String(i + 6).padStart(2, '0')}`,
    spend: 10, conversionsValue: i < 7 ? 20 : 40, clicks: 10, impressions: 100 }));
let summary: { trends?: TrendsSummary };
let suggestions: string[];
beforeEach(() => {
    vi.resetAllMocks(); vi.useFakeTimers(); vi.setSystemTime(new Date('2026-10-20T12:00:00Z'));
    summary = {}; suggestions = [];
    mocks.account.mockResolvedValue({ timezone: 'UTC' });
    mocks.accounts.mockResolvedValue([{ id: 'a1', platform: 'GOOGLE', currency: 'USD' }]);
    mocks.google.mockResolvedValue(rows()); mocks.meta.mockResolvedValue(rows());
});
afterEach(() => { vi.useRealTimers(); });
describe('trend advisor', () => {
    it('aligns by calendar date regardless of row ordering and excludes partial today/extra provider dates', async () => {
        mocks.google.mockResolvedValue([...rows().reverse(), { ...rows()[0], date: '2026-10-20', spend: 999999 }, { ...rows()[0], date: '2026-10-05', spend: 999999 }]);
        await processTrendAnalysis('tenant-1', suggestions, summary);
        expect(summary.trends).toEqual(expect.objectContaining({ this_week_roas: '4.00', last_week_roas: '2.00', roas_change: '+100%',
            period_start: '2026-10-06', period_end: '2026-10-19', partial_data: false, currency: 'USD' }));
        expect(mocks.google).toHaveBeenCalledWith('a1', 16);
    });
    it('does not silently replace missing dates with zeros', async () => {
        mocks.google.mockResolvedValue(rows().slice(1));
        await processTrendAnalysis('tenant-1', suggestions, summary);
        expect(summary.trends).toEqual(expect.objectContaining({ available: false, partial_data: true, unavailable_accounts: ['a1'], roas_change: 'N/A' }));
        expect(suggestions).toEqual([]);
    });
    it('does not double-count duplicate dates or accept non-finite metrics', async () => {
        mocks.google.mockResolvedValue([...rows(), rows()[0]]);
        await processTrendAnalysis('tenant-1', suggestions, summary);
        expect(summary.trends?.available).toBe(false);
        mocks.google.mockResolvedValue(rows().map((row, i) => i === 0 ? { ...row, spend: Infinity } : row));
        await processTrendAnalysis('tenant-1', suggestions, summary);
        expect(summary.trends?.available).toBe(false);
    });
    it('does not mix monetary values across currencies', async () => {
        mocks.accounts.mockResolvedValue([{ id: 'a1', platform: 'GOOGLE', currency: 'USD' }, { id: 'a2', platform: 'META', currency: 'EUR' }]);
        await processTrendAnalysis('tenant-1', suggestions, summary);
        expect(summary.trends?.this_week_roas).toBe('N/A');
        expect(summary.trends?.by_currency?.USD.this_week_roas).toBe('4.00');
        expect(summary.trends?.by_currency?.EUR.this_week_roas).toBe('4.00');
        expect(summary.trends?.currency).toBe('MULTIPLE');
    });
    it('reports zero current spend without claiming zero-spend ROAS is a defined ratio', async () => {
        mocks.google.mockResolvedValue(rows().map((row, i) => i >= 7 ? { ...row, spend: 0, conversionsValue: 0, clicks: 0, impressions: 0 } : row));
        await processTrendAnalysis('tenant-1', suggestions, summary);
        expect(summary.trends?.this_week_spend).toBe(0);
        expect(summary.trends?.this_week_roas).toBe('N/A');
        expect(suggestions[0]).toContain('Spend Stopped');
    });
    it('marks partial account coverage and suppresses confident advice', async () => {
        mocks.accounts.mockResolvedValue([{ id: 'a1', platform: 'GOOGLE', currency: 'USD' }, { id: 'a2', platform: 'META', currency: 'USD' }]);
        mocks.meta.mockRejectedValue(new Error('Provider unavailable'));
        await processTrendAnalysis('tenant-1', suggestions, summary);
        expect(summary.trends?.partial_data).toBe(true);
        expect(summary.trends?.unavailable_accounts).toEqual(['a2']);
        expect(suggestions).toEqual([]);
    });
    it('requires known currencies rather than inventing a shared unit', async () => {
        mocks.accounts.mockResolvedValue([{ id: 'a1', platform: 'GOOGLE', currency: null }]);
        await processTrendAnalysis('tenant-1', suggestions, summary);
        expect(summary.trends?.available).toBe(false);
    });
});
