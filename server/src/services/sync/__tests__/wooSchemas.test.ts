import { describe, expect, it } from 'vitest';
import { parseWooVariations } from '../wooSchemas';

describe('Woo variation image validation', () => {
    it('quarantines explicit foreign-parent identities without discarding valid siblings', () => {
        const result = parseWooVariations([{ id: 11, parent_id: 10, image: null }, { id: 12, parent_id: 99 }], 10);
        expect(result.variations).toEqual([{ id: 11, parent_id: 10, image: null }]);
        expect(result.failures[0]).toMatchObject({ variationId: 12, issues: [{ path: 'parent_id' }] });
    });
    it('preserves null, absent and real images without manufacturing a parent image', () => {
        const rows = [{ id: 35273, image: null }, { id: 35272 }, { id: 4, image: { id: 8, src: 'https://example.com/image.jpg' } }];
        expect(parseWooVariations(rows)).toEqual({ variations: rows, failures: [] });
    });
    it('still quarantines malformed images and invalid identities while ingesting good siblings', () => {
        const result = parseWooVariations([{ id: 1, image: null }, { id: 2, image: 'bad' }, { id: 0 }, { id: 1.5 }]);
        expect(result.variations).toEqual([{ id: 1, image: null }]);
        expect(result.failures).toHaveLength(3);
        expect(result.failures[0].issues[0].path).toBe('image');
    });
});
