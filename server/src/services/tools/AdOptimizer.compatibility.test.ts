import { describe, expect, it, vi } from 'vitest';
vi.mock('./GoogleAdsTools', () => ({ GoogleAdsTools: {} }));
vi.mock('./MetaAdsTools', () => ({ MetaAdsTools: {} }));
vi.mock('./AdContext', () => ({ isBrandCampaign: () => false, getCampaignType: () => 'search' }));
vi.mock('./advisors', () => ({}));
vi.mock('./analyzers', () => ({}));
vi.mock('./knowledge', () => ({}));
import { AdOptimizer } from './AdOptimizer';
const optimizer = AdOptimizer as unknown as {
    addCrossPlatformSuggestion: (google: unknown, meta: unknown, suggestions: string[]) => void;
    processMetaSuggestions: (analysis: unknown, suggestions: string[], summary: Record<string, unknown>, season: null) => void;
};
describe('ad optimizer report compatibility', () => {
    it.each(['N/A (mixed currencies)', 'Infinity', 'invalid'])('does not turn %s into zero ROAS', value => {
        const suggestions: string[] = [];
        optimizer.addCrossPlatformSuggestion({ summary: { overall_roas: '4x' } }, { summary: { overall_roas: value } }, suggestions);
        expect(suggestions).toEqual([]);
    });
    it('does not make cross-platform recommendations from partial data', () => {
        const suggestions: string[] = [];
        optimizer.addCrossPlatformSuggestion({ summary: { overall_roas: '4x' } }, { partial_data: true, summary: { overall_roas: '1x' } }, suggestions);
        expect(suggestions).toEqual([]);
    });
    it('keeps valid cross-platform comparisons working', () => {
        const suggestions: string[] = [];
        optimizer.addCrossPlatformSuggestion({ summary: { overall_roas: '4x' } }, { summary: { overall_roas: '1x' } }, suggestions);
        expect(suggestions).toHaveLength(1);
    });
    it('preserves coverage metadata but suppresses confident Meta advice on partial results', () => {
        const suggestions: string[] = [];
        const summary = {};
        const data = { partial_data: true, failed_accounts: ['a1'], currency: 'USD' };
        optimizer.processMetaSuggestions({ partial_data: true, summary: data, underperformers: [{ campaign: 'Mugs' }] }, suggestions, summary, null);
        expect(summary).toEqual({ meta: data });
        expect(suggestions).toEqual([]);
    });
});
