import { describe, expect, it } from 'vitest';
import { isFeedVariable, platformVariantValue, resolvedVariantRaw, variantAttributeField, variantLandingLink } from './feedVariants';

describe('automatic feed variant data', () => {
    it.each([
        [null, null], [null, {}], [{}, null], [undefined, undefined],
    ])('handles missing Woo payloads (%j, %j) without inventing attributes', (raw, parent) => {
        expect(resolvedVariantRaw(raw, parent)).toEqual({ attributes: [] });
    });

    it('preserves available variant data when the parent Woo payload is null', () => {
        const raw = { price: '12', attributes: [{ name: 'Size', option: 'Large' }] };
        expect(resolvedVariantRaw(raw, null)).toEqual(raw);
        expect(variantLandingLink({ wooId: 11, rawData: null }, { rawData: null, permalink: 'https://example.com/product/' }))
            .toEqual({ url: 'https://example.com/product/?variation_id=11', preselected: false });
    });

    it('ignores malformed entries inside Woo attribute arrays', () => {
        const resolved = resolvedVariantRaw({ attributes: [null, 'bad', 12, [], { id: 7, option: 'Blue' }] }, {
            attributes: [null, 'bad', { id: 7, name: 'Colour', slug: 'pa_colour' }],
        });
        expect(resolved.attributes).toEqual([{ id: 7, name: 'Colour', slug: 'pa_colour', option: 'Blue' }]);
        expect(variantAttributeField(null)).toBeNull();
        expect(variantAttributeField('Size')).toBeNull();
    });

    it('detects actual relations, Woo type and Woo variant IDs', () => {
        expect(isFeedVariable({ rawData: { type: 'simple' }, variations: [] })).toBe(false);
        expect(isFeedVariable({ rawData: { type: 'variable' } })).toBe(true);
        expect(isFeedVariable({ rawData: { variations: [11] } })).toBe(true);
        expect(isFeedVariable({ variations: [{ wooId: 11 }] })).toBe(true);
    });
    it('resolves ID-only global attributes against parent definitions without changing source data', () => {
        const raw = { attributes: [{ id: 7, option: 'Blue' }] };
        const parent = { attributes: [{ id: 7, name: 'Colour', slug: 'pa_colour', options: ['Blue', 'Red'] }] };
        expect(resolvedVariantRaw(raw, parent).attributes[0]).toMatchObject({ name: 'Colour', slug: 'pa_colour', option: 'Blue' });
        expect(raw.attributes[0]).not.toHaveProperty('name');
        expect(variantAttributeField(resolvedVariantRaw(raw, parent).attributes[0])).toBe('color');
    });
    it.each([
        ['pa_colour', 'color'], ['attribute_pa_size', 'size'], ['Age Group', 'age_group'],
        ['size-system', 'size_system'], ['Material', 'material'], ['Gender', 'gender'], ['Engraving', null],
    ])('maps %s only to a known platform field', (name, field) => {
        expect(variantAttributeField({ name })).toBe(field);
    });
    it('normalizes actual enum values but never guesses an unknown value', () => {
        expect(platformVariantValue('gender', 'Female')).toBe('female');
        expect(platformVariantValue('age_group', 'Adult')).toBe('adult');
        expect(platformVariantValue('size_system', 'au')).toBe('AU');
        expect(platformVariantValue('age_group', 'Teen', 'meta')).toBe('teen');
        expect(platformVariantValue('age_group', 'Teen', 'google')).toBe('Teen');
        expect(platformVariantValue('color', 'Ocean')).toBe('Ocean');
    });
    it('preserves Woo native variant URLs with preselected attributes', () => {
        const url = 'https://example.com/mug/?attribute_pa_colour=navy-blue';
        expect(variantLandingLink({ wooId: 11, rawData: { permalink: url } }, { permalink: 'https://example.com/mug/' })).toEqual({ url, preselected: true });
    });
    it('builds fallback links using exact custom options and real taxonomy slugs', () => {
        const result = variantLandingLink({ wooId: 11, rawData: { attributes: [
            { name: 'Size', option: 'Large' }, { name: 'Colour', slug: 'pa_colour', option: 'Blue', option_slug: 'custom-blue' },
        ] } }, { permalink: 'https://example.com/mug/?campaign=summer' });
        const url = new URL(result.url!);
        expect(url.searchParams.get('variation_id')).toBe('11');
        expect(url.searchParams.get('attribute_size')).toBe('Large');
        expect(url.searchParams.get('attribute_pa_colour')).toBe('custom-blue');
        expect(url.searchParams.get('campaign')).toBe('summer');
        expect(result.preselected).toBe(true);
    });
    it('never guesses a taxonomy term slug from its display name', () => {
        const result = variantLandingLink({ wooId: 11, rawData: { attributes: [{ id: 7, slug: 'pa_colour', option: 'Ocean Blue' }] } }, { permalink: 'https://example.com/mug/' });
        expect(result.preselected).toBe(false);
        expect(new URL(result.url!).searchParams.has('attribute_pa_colour')).toBe(false);
        expect(new URL(result.url!).searchParams.get('variation_id')).toBe('11');
    });
    it('removes stale parent attribute selections before building a fallback', () => {
        const result = variantLandingLink({ wooId: 11, rawData: { attributes: [{ slug: 'pa_colour', option: 'Blue' }] } }, { permalink: 'https://example.com/mug/?attribute_pa_colour=red&campaign=summer' });
        const url = new URL(result.url!);
        expect(url.searchParams.has('attribute_pa_colour')).toBe(false);
        expect(url.searchParams.get('campaign')).toBe('summer');
        expect(url.searchParams.get('variation_id')).toBe('11');
        expect(result.preselected).toBe(false);
    });
    it('uses real parent term metadata when available', () => {
        const result = variantLandingLink({ wooId: 11, rawData: { attributes: [{ id: 7, option: 'Blue' }] } }, {
            permalink: 'https://example.com/mug/', rawData: { attributes: [{ id: 7, slug: 'pa_colour', options: [{ name: 'Blue', slug: 'special-blue' }] }] },
        });
        expect(new URL(result.url!).searchParams.get('attribute_pa_colour')).toBe('special-blue');
        expect(result.preselected).toBe(true);
    });
    it('does not invent a choice for an Any-option variation or a malformed URL', () => {
        expect(variantLandingLink({ wooId: 11, rawData: { attributes: [{ name: 'Size', option: '' }] } }, { permalink: 'https://example.com/mug/' }).preselected).toBe(false);
        expect(variantLandingLink({ wooId: 11, rawData: {} }, { permalink: '/relative' })).toEqual({ url: '/relative', preselected: false });
    });
});
