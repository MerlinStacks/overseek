import { describe, expect, it } from 'vitest';
import { getStatusConfig, getStatusBadgeClasses } from './orderStatus';
import { lintOutboundMessage } from './outboundSafety';
import { calculateSeoScore } from './seoScoring';
import { isBudgetAction, isKeywordAction, isProductAction } from '../types/ActionableTypes';
describe('runtime-safe display and advisory helpers', () => {
    it.each([null, undefined, 42, {}, '', 'constructor', '__proto__', 'not-a-status'])('keeps unknown status %j unknown', value => {
        expect(getStatusConfig(value).label).toBe('Unknown'); expect(getStatusBadgeClasses(value)).toContain('dark:');
    });
    it('normalizes Woo status without inventing advancement rules or sharing mutable configs', () => {
        expect(getStatusConfig(' WC-PROCESSING ').label).toBe('Processing'); expect(getStatusConfig('processing')).not.toHaveProperty('next');
        getStatusConfig('pending').label = 'Changed'; expect(getStatusConfig('pending').label).toBe('Pending');
    });
    it.each([13, 16, 17, 18, 19])('flags a complete %i digit card candidate', length => {
        expect(lintOutboundMessage('Card: ' + '4'.repeat(length)).some(issue => issue.code === 'pii_card')).toBe(true);
    });
    it('does not take fragments of a longer number or match tone substrings', () => {
        expect(lintOutboundMessage('Reference ' + '4'.repeat(22)).some(issue => issue.code === 'pii_card')).toBe(false);
        expect(lintOutboundMessage('Your dumbbell is ready')).toEqual([]);
        expect(lintOutboundMessage('A GUARANTEED\n\t refund').some(issue => issue.code === 'forbidden_guaranteed_refund')).toBe(true);
        expect(lintOutboundMessage('Ｓｈｕｔ　ｕｐ').some(issue => issue.code === 'tone_shut_up')).toBe(true);
    });
    it('scores visible content, valid numeric price and URL path rather than attributes/host/query', () => {
        const result = calculateSeoScore({ name: 'Product name', description: '<div title="gold '.repeat(30) + '">short</div>', permalink: 'https://gold.test/item?q=gold', images: [null], price: 'free' }, 'gold');
        for (const name of ['Product Description', 'Keyword in Description', 'Keyword in URL', 'Images', 'Price']) expect(result.tests.find(test => test.test === name)?.passed).toBe(false);
        expect(result.methodology).toMatch(/Heuristic/);
        const good = calculateSeoScore({ name: 'Gold ring', description: '<p>' + 'Gold ring '.repeat(10) + '</p>', permalink: 'https://store.test/gold-ring', images: [{ src: 'https://store.test/image.jpg' }], price: '0' }, ' gold   ring ');
        expect(good.score).toBe(100);
        expect(() => calculateSeoScore(null)).not.toThrow();
    });
    it.each([null, undefined, {}, [], 1, 'action', { currentBudget: 10, suggestedBudget: 20 }])('rejects malformed action %j safely', value => {
        expect(isBudgetAction(value)).toBe(false); expect(isKeywordAction(value)).toBe(false); expect(isProductAction(value)).toBe(false);
    });
    it('validates action discriminants, identifiers and finite amounts', () => {
        const budget = { actionType: 'budget_increase', campaignId: 'c', campaignName: 'Campaign', platform: 'google', currentBudget: 10, suggestedBudget: 20, changeAmount: 10, changePercent: 100, reason: 'Observed performance' };
        expect(isBudgetAction(budget)).toBe(true); expect(isBudgetAction({ ...budget, suggestedBudget: Infinity })).toBe(false); expect(isBudgetAction({ ...budget, campaignId: '' })).toBe(false);
        expect(isProductAction({ actionType: 'adjust_bid', productId: 'p', productName: 'Product', sku: '', reason: 'high_margin' })).toBe(true);
    });
});
