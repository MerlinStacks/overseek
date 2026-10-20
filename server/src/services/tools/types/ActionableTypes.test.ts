import { describe, expect, it } from 'vitest';
import { formatBudgetChange, formatCpcRecommendation, isBudgetAction, isKeywordAction, isProductAction, type BudgetAction, type KeywordAction } from './ActionableTypes';
describe('recommendation presentation', () => {
    it('preserves the sign for budget decreases', () => {
        expect(formatBudgetChange({ actionType: 'budget_decrease', changeAmount: -10 } as BudgetAction)).toBe('-$10/day');
        expect(formatBudgetChange({ actionType: 'budget_increase', changeAmount: 10 } as BudgetAction)).toBe('+$10/day');
    });
    it('does not display invalid money values', () => {
        expect(formatBudgetChange({ changeAmount: NaN } as BudgetAction)).toBe('Budget change unavailable');
        expect(formatCpcRecommendation({ suggestedCpc: Infinity } as KeywordAction)).toBe('CPC unavailable');
    });
    it('rejects null and mismatched action categories without throwing', () => {
        for (const guard of [isBudgetAction, isKeywordAction, isProductAction]) expect(guard(null as never)).toBe(false);
        expect(isBudgetAction({ actionType: 'add_keyword', currentBudget: 1, suggestedBudget: 2 } as never)).toBe(false);
        expect(isBudgetAction({ actionType: 'budget_increase', currentBudget: 1, suggestedBudget: 2 } as never)).toBe(true);
    });
});
