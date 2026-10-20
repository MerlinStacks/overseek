import { describe, expect, it, vi } from 'vitest';
vi.mock('../../../utils/prisma', () => ({ prisma: {} }));
import { CrossChannelAnalyzer } from './CrossChannelAnalyzer';
const analyzer = CrossChannelAnalyzer as unknown as {
    generateBudgetRecommendation: (channels: Array<{ channel: string; revenue: number; aov: number; orders: number; revenueShare: number }>, total: number) => unknown;
};
const channel = (name: string) => ({ channel: name, revenue: 100, aov: 100, orders: 1, revenueShare: 50 });
describe('channel attribution compatibility', () => {
    it.each(['paid_other', 'other'])('does not count %s as organic or recommend an unsupported Google/Meta allocation', ambiguous => {
        expect(analyzer.generateBudgetRecommendation([channel('google'), channel(ambiguous)], 200)).toBeNull();
    });
    it('preserves comparisons when both paid providers are known', () => {
        expect(analyzer.generateBudgetRecommendation([channel('google'), channel('meta')], 200)).toEqual(expect.objectContaining({ currentSplit: { google: 50, meta: 50, organic: 0 } }));
    });
});
