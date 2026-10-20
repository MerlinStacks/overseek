import { Prisma } from '@prisma/client';
import { describe, expect, it } from 'vitest';
import { calculateGoldCogs, calculateMargin, parseAccountGoldPrices } from './goldPriceCalculations';

const prices = {
    goldPrice18ct: 100,
    goldPrice9ct: 50,
    goldPrice18ctWhite: 110,
    goldPrice9ctWhite: 55,
};
const zeroPrices = {
    goldPrice18ct: 0,
    goldPrice9ct: 0,
    goldPrice18ctWhite: 0,
    goldPrice9ctWhite: 0,
};

describe('calculateGoldCogs', () => {
    it.each([
        ['18ct', 250], ['9ct', 125], ['18ctWhite', 275], ['9ctWhite', 137.5],
    ])('preserves the configured per-gram calculation for %s', (type, expected) => {
        expect(calculateGoldCogs(2.5, type, prices)).toBe(expected);
    });

    it.each([null, 0, -1, NaN, Infinity, -Infinity])('returns zero for an invalid or empty weight: %s', weight => {
        expect(calculateGoldCogs(weight, '18ct', prices)).toBe(0);
    });

    it.each([null, '', 'unknown', '24ct', 'toString', 'constructor', '__proto__', 'hasOwnProperty'])('returns zero for an unsupported gold type: %s', type => {
        expect(calculateGoldCogs(2, type, prices)).toBe(0);
    });

    it.each([-1, NaN, Infinity, -Infinity])('returns zero for an invalid configured rate: %s', rate => {
        expect(calculateGoldCogs(2, '18ct', { ...prices, goldPrice18ct: rate })).toBe(0);
    });

    it('accepts a zero rate and does not round valid fractional amounts', () => {
        expect(calculateGoldCogs(2, '18ct', zeroPrices)).toBe(0);
        expect(calculateGoldCogs(1.25, '18ct', { ...prices, goldPrice18ct: 12.5 })).toBe(15.625);
    });

    it('returns zero rather than infinity when multiplication overflows', () => {
        expect(calculateGoldCogs(Number.MAX_VALUE, '18ct', prices)).toBe(0);
    });
});

describe('calculateMargin', () => {
    it.each([
        [100, 40, 60], [100, 100, 0], [100, 150, -50], [100, 300, -200], [100, 0, 100],
    ])('preserves the margin for price %s and costs %s', (price, cogs, expected) => {
        expect(calculateMargin(price, cogs)).toBe(expected);
    });

    it('preserves fractional precision', () => {
        expect(calculateMargin(3, 2)).toBeCloseTo(100 / 3, 10);
    });

    it.each([0, -1, NaN, Infinity, -Infinity])('returns zero for an invalid selling price: %s', price => {
        expect(calculateMargin(price, 10)).toBe(0);
    });

    it.each([-1, NaN, Infinity, -Infinity])('returns zero for invalid costs: %s', cogs => {
        expect(calculateMargin(100, cogs)).toBe(0);
    });

    it('returns zero rather than infinity when the margin overflows', () => {
        expect(calculateMargin(Number.MIN_VALUE, Number.MAX_VALUE)).toBe(0);
    });
});

describe('parseAccountGoldPrices', () => {
    it('preserves numeric, string and Prisma Decimal rates', () => {
        expect(parseAccountGoldPrices({
            goldPrice18ct: 100.5,
            goldPrice9ct: '50.25',
            goldPrice18ctWhite: new Prisma.Decimal('110.125'),
            goldPrice9ctWhite: 0,
        })).toEqual({ goldPrice18ct: 100.5, goldPrice9ct: 50.25, goldPrice18ctWhite: 110.125, goldPrice9ctWhite: 0 });
    });

    it.each([undefined, null, {}])('defaults missing account data to zero: %j', account => {
        expect(parseAccountGoldPrices(account)).toEqual(zeroPrices);
    });

    it.each([
        undefined, null, '', ' ', -1, '-10', NaN, Infinity, -Infinity, 'Infinity', 'not-a-price',
        true, false, [], [42], {}, Symbol('price'), new Prisma.Decimal(-1), new Prisma.Decimal(Infinity),
    ])('defaults invalid fields to zero: %s', value => {
        expect(parseAccountGoldPrices({
            goldPrice18ct: value, goldPrice9ct: value, goldPrice18ctWhite: value, goldPrice9ctWhite: value,
        })).toEqual(zeroPrices);
    });

    it('does not discard valid fields when another rate is invalid', () => {
        expect(parseAccountGoldPrices({ ...prices, goldPrice9ct: Infinity })).toEqual({ ...prices, goldPrice9ct: 0 });
    });
});
