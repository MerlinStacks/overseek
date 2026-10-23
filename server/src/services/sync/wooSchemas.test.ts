import { expect, it } from 'vitest';
import { parseWooVariations, WooProductSchema, WooProductVariationSchema } from './wooSchemas';
it('accepts null, missing and valid dedicated variation images without inventing one', () => {
    expect(WooProductVariationSchema.parse({ id: 93780, image: null })).toEqual({ id: 93780, image: null });
    expect(WooProductVariationSchema.parse({ id: 93779 })).not.toHaveProperty('image');
    const image = { id: 2, src: 'https://store.example/image.jpg', alt: 'Example' };
    expect(WooProductVariationSchema.parse({ id: 93778, image }).image).toEqual(image);
});
it('continues rejecting malformed image objects/identities while retaining valid siblings', () => {
    const { variations, failures } = parseWooVariations([
        { id: 1, image: null }, { id: 2 }, { id: 3, image: 'not-an-image' },
        { id: 4, image: { id: 'invalid', src: 'https://store.example/image.jpg' } },
        { id: 'invalid', image: null },
    ]);
    expect(variations.map(row => row.id)).toEqual([1, 2]);
    expect(failures).toHaveLength(3);
    expect(failures[0].issues[0].path).toBe('image');
    expect(WooProductSchema.safeParse({ id: 5, name: 'Parent', images: [null] }).success).toBe(false);
});
