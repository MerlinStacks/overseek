import { describe, expect, it } from 'vitest';
import { channelAvailability, validateFeedColumns } from './feedValidation';

const now = new Date('2026-10-20T12:00:00Z');
const values = { id: '1', title: 'Mug', description: 'A ceramic mug', link: 'https://example.com/mug', image_link: 'https://example.com/mug.jpg',
    condition: 'new', availability: 'in_stock', price: '10.00 AUD', gtin: '4006381333931' };
const check = (overrides: Record<string, string> = {}, channel = 'google') => validateFeedColumns(channel,
    Object.entries({ ...values, ...overrides }).map(([targetField, finalValue]) => ({ targetField, finalValue })), now);

describe('feed validation', () => {
    it('accepts a complete valid Google product', () => expect(check()).toEqual([]));
    it('uses Meta availability wording', () => {
        expect(channelAvailability('backorder', 'meta')).toBe('available for order');
        expect(check({ availability: 'in stock' }, 'meta')).toEqual([]);
        expect(check({ availability: 'backorder' }, 'meta').some((issue) => issue.code === 'invalid_availability')).toBe(true);
    });
    it('reports missing platform-required fields even with custom mapping flags disabled', () => {
        expect(check({ image_link: '', description: '' }).map((issue) => issue.field)).toEqual(['description', 'image_link']);
    });
    it('validates URLs, prices, discounts, conditions, identifiers and lengths', () => {
        const issues = check({ image_link: '/relative.jpg', link: 'javascript:alert(1)', price: 'free', sale_price: '-2 AUD',
            gtin: '123', condition: 'broken', title: 'X'.repeat(151) });
        expect(issues.map((issue) => issue.code)).toEqual(expect.arrayContaining(['invalid_url', 'invalid_price', 'invalid_gtin', 'invalid_condition', 'too_long']));
        expect(check({ sale_price: '10.00 AUD' }).some((issue) => issue.code === 'invalid_sale_price')).toBe(true);
        expect(check({ sale_price: '9.00 USD' }).some((issue) => issue.code === 'invalid_sale_price')).toBe(true);
    });
    it('flags missing, past, too-distant and invalid backorder dates', () => {
        expect(check({ availability: 'backorder' }).some((issue) => issue.code === 'missing_availability_date')).toBe(true);
        expect(check({ availability: 'backorder', availability_date: '2026-11-01T12:00:00Z' })).toEqual([]);
        expect(check({ availability: 'backorder', availability_date: '2026-10-01T12:00:00Z' }).some((issue) => issue.code === 'unusable_availability_date')).toBe(true);
        expect(check({ availability: 'preorder', availability_date: '2028-11-01T12:00:00Z' }).some((issue) => issue.code === 'unusable_availability_date')).toBe(true);
        expect(check({ availability: 'backorder', availability_date: 'bad-date' }).some((issue) => issue.code === 'invalid_availability_date')).toBe(true);
    });
    it('warns about unknown identifiers without declaring them absent', () => {
        expect(check({ gtin: '' }).some((issue) => issue.code === 'missing_identifiers' && issue.severity === 'warning')).toBe(true);
        expect(check({ gtin: '', identifier_exists: 'no' })).toEqual([]);
        expect(check({ identifier_exists: 'no' }).some((issue) => issue.code === 'identifier_conflict')).toBe(true);
    });
    it('validates sale ranges and stale manual overrides', () => {
        expect(check({ sale_price: '8.00 AUD', sale_price_effective_date: '2026-10-01T12:00:00Z/2026-10-02T12:00:00Z' }).some((issue) => issue.code === 'expired_sale')).toBe(true);
        expect(check({ sale_price_effective_date: 'bad/range' }).some((issue) => issue.code === 'invalid_sale_dates')).toBe(true);
    });
    it('does not change other channels', () => expect(check({ price: 'bad' }, 'pinterest')).toEqual([]));
    it('validates channel-specific variant enums without reinterpreting unknown values', () => {
        expect(check({ gender: 'female', age_group: 'adult', size_system: 'AU', size_type: 'regular' })).toEqual([]);
        expect(check({ age_group: 'teen' }).some((issue) => issue.code === 'invalid_variant_value')).toBe(true);
        expect(check({ availability: 'in stock', age_group: 'teen' }, 'meta')).toEqual([]);
        expect(check({ gender: 'unknown' }).some((issue) => issue.field === 'gender')).toBe(true);
    });
});
