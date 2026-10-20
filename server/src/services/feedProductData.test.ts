import { describe, expect, it } from 'vitest';
import { feedAmount, feedAttribute, feedAvailabilityDate, feedDate, feedIdentifier, feedIdentifierExists, feedPricing, validGtin } from './feedProductData';

const now = new Date('2026-10-20T12:00:00Z');
const saleProduct = (raw: Record<string, unknown> = {}, price: unknown = '8') => ({ price, rawData: {
    regular_price: '10', sale_price: '8', on_sale: true,
    date_on_sale_from_gmt: '2026-10-19T12:00:00', date_on_sale_to_gmt: '2026-10-21T12:00:00', ...raw,
} });

describe('feed pricing', () => {
    it('uses regular price and a genuine active sale with UTC range', () => {
        expect(feedPricing(saleProduct(), 'Australia/Sydney', now)).toEqual({
            price: 10, salePrice: 8, salePriceEffectiveDate: '2026-10-19T12:00:00Z/2026-10-21T12:00:00Z', invalidSaleWindow: false,
        });
    });
    it.each([
        [{ date_on_sale_from_gmt: '2026-10-21T00:00:00' }, '10'],
        [{ date_on_sale_to_gmt: '2026-10-20T00:00:00' }, '10'],
        [{ sale_price: '12' }, '10'],
        [{ sale_price: '10' }, '10'],
        [{ sale_price: '' }, '10'],
        [{ on_sale: false }, '10'],
        [{ date_on_sale_to_gmt: 'not-a-date' }, '8'],
        [{ date_on_sale_from_gmt: '2026-10-22T00:00:00' }, '8'],
    ])('does not export an inactive/invalid sale (%j)', (raw, price) => {
        const result = feedPricing(saleProduct(raw, price), 'UTC', now);
        expect(result.salePrice).toBeNull();
        expect(result.salePriceEffectiveDate).toBeNull();
        expect(result.price).toBe(Number(price));
    });
    it('respects store timezone for local-only sale dates', () => {
        const product = saleProduct({ date_on_sale_from_gmt: null, date_on_sale_to_gmt: null,
            date_on_sale_from: '2026-10-20T22:00:00', date_on_sale_to: '2026-10-21T22:00:00' });
        expect(feedPricing(product, 'Australia/Sydney', now).salePrice).toBe(8);
        expect(feedPricing(product, 'UTC', now).salePrice).toBeNull();
    });
    it('supports open-ended active sales without inventing a date range', () => {
        const result = feedPricing(saleProduct({ date_on_sale_to_gmt: null }), 'UTC', now);
        expect(result.salePrice).toBe(8);
        expect(result.salePriceEffectiveDate).toBeNull();
    });
    it('preserves zero and missing prices without inventing free items', () => {
        expect(feedPricing({ price: '0' }).price).toBe(0);
        expect(feedPricing({ price: '' }).price).toBeNull();
        expect(feedAmount('not a price')).toBeNull();
        expect(feedAmount('-1')).toBeNull();
    });
});

describe('feed identifiers and attributes', () => {
    it('reads native global IDs and plugin metadata, never SKU', () => {
        expect(feedIdentifier({ global_unique_id: '4006381333931', sku: 'SKU' }, 'gtin')).toBe('4006381333931');
        expect(feedIdentifier({ meta_data: [{ key: '_mpn', value: 'MANUFACTURER-1' }] }, 'mpn')).toBe('MANUFACTURER-1');
        expect(feedIdentifier({ sku: 'SKU' }, 'mpn')).toBeNull();
    });
    it.each(['96385074', '036000291452', '4006381333931', '10012345000017'])('validates GTIN %s', (value) => {
        expect(validGtin(value)).toBe(true);
    });
    it.each(['4006381333932', '0000000000000', '123', 'ABC', ' 4006381333931'])('rejects invalid GTIN %s', (value) => {
        expect(validGtin(value)).toBe(false);
    });
    it('requires explicit confirmation for identifier-free products', () => {
        expect(feedIdentifierExists({ name: 'Personalised mug' })).toBeNull();
        expect(feedIdentifierExists({ identifier_exists: false })).toBe('no');
        expect(feedIdentifierExists({ meta_data: [{ key: '_identifier_exists', value: 'no' }] })).toBe('no');
        expect(feedIdentifierExists({ global_unique_id: '4006381333931' })).toBe('yes');
    });
    it('uses selected variation attributes or a single real parent choice', () => {
        expect(feedAttribute({ attributes: [{ name: 'Colour', option: 'Blue' }] }, 'color')).toBe('Blue');
        expect(feedAttribute({ attributes: [{ slug: 'pa_size', option: 'Large' }] }, 'size')).toBe('Large');
        expect(feedAttribute({ attributes: [{ name: 'Material', options: ['Cotton'] }] }, 'material')).toBe('Cotton');
        expect(feedAttribute({ attributes: [{ name: 'Colour', options: ['Red', 'Blue'] }] }, 'color')).toBeNull();
    });
});

describe('feed dates', () => {
    it('handles offsets, UTC and IANA local time deterministically', () => {
        expect(feedDate('2026-10-20T22:00:00+1100')?.toISOString()).toBe('2026-10-20T11:00:00.000Z');
        expect(feedDate('2026-10-20T22:00:00', 'Australia/Sydney')?.toISOString()).toBe('2026-10-20T11:00:00.000Z');
        expect(feedDate('2026-10-20')?.toISOString()).toBe('2026-10-20T00:00:00.000Z');
    });
    it('rejects invalid calendar dates and DST gaps', () => {
        expect(feedDate('2026-02-30T00:00:00Z')).toBeNull();
        expect(feedDate('2026-03-08T02:30:00', 'America/New_York')).toBeNull();
    });
    it('reads explicit availability dates without inventing a fallback', () => {
        expect(feedAvailabilityDate({}, 'Australia/Sydney')).toBeNull();
        expect(feedAvailabilityDate({ availability_date: '2026-11-01T12:00:00+1100' })).toBe('2026-11-01T01:00:00Z');
        expect(feedAvailabilityDate({ availability_date: 'bad-date' })).toBe('bad-date');
    });
});
