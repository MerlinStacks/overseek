import { describe, expect, it } from 'vitest';
import { processSearchSuggestions } from './SearchAdvisor';
describe('search advisor', () => {
    it('preserves valid recommendations and thresholds', () => {
        const suggestions: string[] = [];
        processSearchSuggestions({ search_analysis: {
            negative_opportunities: [{ keyword: 'free mugs', spend: '$30.00', clicks: 50 }],
            top_keywords: [{ keyword: 'engraved mugs', roas: '4.1x' }, { keyword: 'threshold', roas: '4x' }],
            low_ctr_keywords: [{ keyword: 'mug', ctr: '0.5%', impressions: 2000 }],
        } }, suggestions);
        expect(suggestions).toHaveLength(3);
        expect(suggestions[1]).toContain('engraved mugs');
        expect(suggestions[1]).not.toContain('threshold');
    });
    it('ignores malformed arrays, null entries, blank keywords and non-finite metrics', () => {
        const suggestions: string[] = [];
        processSearchSuggestions({ search_analysis: {
            negative_opportunities: [null, { keyword: 'bad', spend: 'N/A', clicks: Infinity }],
            top_keywords: [null, { keyword: 'bad', roas: 'Infinity' }, { keyword: '', roas: '5x' }],
            low_ctr_keywords: [null, { keyword: 'bad', ctr: 'N/A', impressions: 2000 }],
        } } as any, suggestions);
        processSearchSuggestions({ search_analysis: { negative_opportunities: 'bad', top_keywords: {}, low_ctr_keywords: false } } as any, suggestions);
        expect(suggestions).toEqual([]);
    });
    it('does not emit a low-CTR claim for insufficient impressions or CTR at the boundary', () => {
        const suggestions: string[] = [];
        processSearchSuggestions({ search_analysis: { low_ctr_keywords: [
            { keyword: 'boundary', ctr: '1%', impressions: 5000 }, { keyword: 'small', ctr: '0.5%', impressions: 1000 },
        ] } }, suggestions);
        expect(suggestions).toEqual([]);
    });
});
