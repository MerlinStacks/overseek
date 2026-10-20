import { describe, expect, it } from 'vitest';
import { processBudgetSuggestions } from './BudgetAdvisor';
describe('budget advisor', () => {
    it('frames high ROAS as a review opportunity without inventing budget amounts or forecasts', () => {
        const suggestions: string[] = [];
        processBudgetSuggestions({ summary: { total_spend: 'AUD 700.00', days: 7, period: 'Last 7 days', currency: 'AUD' },
            top_spenders: [{ campaign: 'Mugs', spend: 'AUD 700.00', roas: '4.00x' }] }, 'Meta', suggestions);
        expect(suggestions).toHaveLength(1);
        expect(suggestions[0]).toContain('controlled budget test');
        expect(suggestions[0]).toContain('Last 7 days');
        expect(suggestions[0]).not.toContain('/month');
        expect(suggestions[0]).not.toContain('additional revenue');
    });
    it('uses the actual period for low-spend observations and does not infer a budget constraint', () => {
        const suggestions: string[] = [];
        processBudgetSuggestions({ summary: { total_spend: 'EUR 35.00', days: 7, currency: 'EUR' },
            top_spenders: [{ campaign: 'Mugs', spend: 'EUR 35.00', roas: '2x' }] }, 'Meta', suggestions);
        expect(suggestions[0]).toContain('EUR 5.00/day over 7 days');
        expect(suggestions[0]).toContain('does not establish');
    });
    it('does not generate advice from partial or malformed data', () => {
        const suggestions: string[] = [];
        processBudgetSuggestions({ partial_data: true, top_spenders: [{ campaign: 'Mugs', spend: '$100', roas: '5x' }] }, 'Meta', suggestions);
        processBudgetSuggestions({ top_spenders: [null, { campaign: 'Mugs', spend: 'Infinity', roas: 'Infinity' }] } as any, 'Meta', suggestions);
        expect(suggestions).toEqual([]);
    });
    it('handles mixed-currency analyses separately rather than pooling budgets', () => {
        const suggestions: string[] = [];
        processBudgetSuggestions({ summary: { total_spend: 'N/A', currency: 'MULTIPLE' }, by_currency: {
            USD: { top_spenders: [{ campaign: 'US', spend: 'USD 100', roas: '4x' }] },
            EUR: { top_spenders: [{ campaign: 'EU', spend: 'EUR 100', roas: '4x' }] },
        } }, 'Meta', suggestions);
        expect(suggestions).toHaveLength(2);
        expect(suggestions[0]).toContain('Meta (USD)');
        expect(suggestions[1]).toContain('Meta (EUR)');
    });
});
