import { Prisma, type WooProduct } from '@prisma/client';
import { describe, expect, it } from 'vitest';
import { MerchantCenterService } from './MerchantCenterService';

function product(overrides: Record<string, unknown> = {}): Partial<WooProduct> {
    return {
        sku: 'SKU-1', name: 'Engraved travel mug', price: new Prisma.Decimal('29.95'), stockStatus: 'instock',
        rawData: {
            description: '<p>A sturdy travel mug for your morning coffee.</p>',
            images: [{ src: 'https://example.com/mug.jpg' }],
            meta_data: [{ key: '_gtin', value: '1234567890123' }],
        },
        ...overrides,
    } as Partial<WooProduct>;
}

const validate = MerchantCenterService.validateCompliance;

describe('MerchantCenterService', () => {
    it('preserves a complete product score and result shape', () => {
        expect(validate(product())).toEqual({ score: 100, issues: [] });
    });

    it('preserves existing penalty weights and clamps the minimum score', () => {
        expect(validate(product({ name: '' })).score).toBe(80);
        expect(validate(product({ name: 'x'.repeat(151) })).score).toBe(95);
        expect(validate({}).score).toBe(0);
    });

    it.each([null, [], 'invalid', 42, { images: [null], meta_data: [null] },
        { images: 'invalid', meta_data: {} }, { images: [false], meta_data: [{ key: 42 }] },
    ])('handles malformed WooCommerce JSON without throwing: %j', rawData => {
        const result = validate(product({ rawData }));
        expect(result.issues).toEqual(expect.arrayContaining([
            expect.objectContaining({ attribute: 'description' }),
            expect.objectContaining({ attribute: 'image_link' }),
            expect.objectContaining({ attribute: 'gtin' }),
        ]));
    });

    it('rejects blank identity, title, availability and markup-only descriptions', () => {
        const result = validate(product({ sku: ' ', name: ' ', stockStatus: '\t', rawData: { description: '<p>&nbsp;</p>' } }));
        for (const attribute of ['id', 'title', 'availability', 'description']) {
            expect(result.issues).toContainEqual(expect.objectContaining({ attribute }));
        }
    });

    it('uses the short description when the long description has no visible text', () => {
        const result = validate(product({ rawData: { description: '<p></p>', short_description: 'A useful mug' } }));
        expect(result.issues.some(issue => issue.attribute === 'description')).toBe(false);
    });

    it('requires the main image rather than silently accepting a later image', () => {
        const result = validate(product({ rawData: { images: [null, { src: 'https://example.com/mug.jpg' }] } }));
        expect(result.issues).toContainEqual(expect.objectContaining({ attribute: 'image_link' }));
    });

    it.each(['', ' ', null, false, {}, []])('does not count an empty or malformed GTIN value: %j', value => {
        const result = validate(product({ rawData: { meta_data: [{ key: '_gtin', value }] } }));
        expect(result.issues).toContainEqual(expect.objectContaining({ attribute: 'gtin' }));
    });

    it('recognizes populated metadata keys case-insensitively', () => {
        const result = validate(product({ rawData: { meta_data: [null, { key: '_EAN', value: '1234567890123' }] } }));
        expect(result.issues.some(issue => issue.attribute === 'gtin')).toBe(false);
    });

    it.each([0, '0', new Prisma.Decimal(0), '12.50', new Prisma.Decimal('12.50')])('accepts a supplied non-negative price: %s', price => {
        expect(validate(product({ price })).issues.some(issue => issue.attribute === 'price')).toBe(false);
    });

    it.each([undefined, null, '', ' ', -1, 'invalid', Infinity, NaN, false, {}, new Prisma.Decimal(-1)])('rejects a missing or invalid price: %s', price => {
        expect(validate(product({ price })).issues).toContainEqual(expect.objectContaining({ attribute: 'price' }));
    });
});
