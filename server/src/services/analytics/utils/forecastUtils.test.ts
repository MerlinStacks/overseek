import { describe, expect, it } from 'vitest';
import { calculateDaysUntilStockout, calculateReorderPoint, calculateReorderQuantity, calculateSeasonalityCoefficients, classifyStockoutRisk, predictDailyDemand, weightedMovingAverage } from './forecastUtils';
describe('forecast numeric correctness', () => {
    it('weights each observation once even when the history is shorter than the weight list', () => {
        expect(weightedMovingAverage([10, 20])).toBeCloseTo((20 * 0.4 + 10 * 0.3) / 0.7);
        expect(weightedMovingAverage([10, 20, 30])).toBeCloseTo((30 * 0.4 + 20 * 0.3 + 10 * 0.2) / 0.9);
        expect(weightedMovingAverage([10])).toBe(10);
    });
    it('supports zero weights without substituting another weight', () => {
        expect(weightedMovingAverage([10, 20], [0, 1])).toBe(10);
        expect(() => weightedMovingAverage([10, 20], [])).toThrow(RangeError);
    });
    it('does not award seasonal confidence for default-filled months', () => {
        const history = Array(30).fill(10);
        const empty = calculateSeasonalityCoefficients(new Map());
        const one = calculateSeasonalityCoefficients(new Map([[1, 100]]));
        const all = calculateSeasonalityCoefficients(new Map(Array.from({ length: 12 }, (_, index) => [index + 1, 100])));
        expect(empty.size).toBe(12);
        expect(predictDailyDemand(history, 1, empty).confidence).toBe(predictDailyDemand(history, 1, one).confidence);
        expect(predictDailyDemand(history, 1, all).confidence).toBe(predictDailyDemand(history, 1, one).confidence + 5);
    });
    it('does not lower confidence as history crosses confidence boundaries', () => {
        let previous = 0;
        for (let days = 1; days <= 365; days++) {
            const confidence = predictDailyDemand(Array(days).fill(1), 1, new Map()).confidence;
            expect(confidence).toBeGreaterThanOrEqual(previous); previous = confidence;
        }
    });
    it('does not infer growth from a single observation', () => {
        expect(predictDailyDemand([10], 1, new Map())).toEqual(expect.objectContaining({ trendDirection: 'stable', trendPercent: 0 }));
    });
    it.each([NaN, Infinity, -1])('rejects invalid demand data %s rather than producing misleading numbers', value => {
        expect(() => weightedMovingAverage([value, 1])).toThrow(RangeError);
        expect(() => calculateReorderQuantity(value, 7, 3)).toThrow(RangeError);
    });
    it('keeps out-of-stock distinct from no demand, and handles valid reorders', () => {
        expect(calculateDaysUntilStockout(0, 0)).toBe(0); expect(calculateDaysUntilStockout(10, 0)).toBe(999);
        expect(calculateReorderPoint(2, 7, 3)).toBe(20); expect(calculateReorderQuantity(2, 7, 3)).toBe(20);
        expect(() => classifyStockoutRisk(NaN, 7)).toThrow(RangeError);
    });
});
