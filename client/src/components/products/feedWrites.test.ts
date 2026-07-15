import { describe, expect, it } from 'vitest';
import { getFeedOverrideKey, isProductFeedWriteField, type FeedWriteRow } from './feedWrites';

describe('product feed writes', () => {
    it.each([
        'id',
        'mpn',
        'sku',
        'price',
        'sale_price',
        'link',
        'canonical_link',
        'image_link',
        'additional_image_link',
        'identifier_exists',
        'store_code',
    ])(
        'excludes %s from product-level editing',
        (field) => expect(isProductFeedWriteField(field)).toBe(false),
    );

    it('allows matched descriptive and classification fields', () => {
        expect(isProductFeedWriteField('title')).toBe(true);
        expect(isProductFeedWriteField('description')).toBe(true);
        expect(isProductFeedWriteField('google_product_category')).toBe(true);
    });

    it('uses the feed variation key format for variation writes', () => {
        const row = { wooId: 123, variationWooId: 456 } as FeedWriteRow;
        expect(getFeedOverrideKey(row, 'title')).toBe('123-456:title');
    });
});
