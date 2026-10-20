import { describe, expect, it } from 'vitest';
import { getStoredFeedVariationMode } from './feedVariationMode';

describe('getStoredFeedVariationMode', () => {
    it('reads the persisted parent-only mode', () => {
        expect(getStoredFeedVariationMode(JSON.stringify({ variationMode: 'variable_parent' })))
            .toBe('variable_parent');
    });

    it.each([null, 'invalid json', JSON.stringify({ variationMode: 'invalid' })])(
        'falls back to automatic for invalid state',
        (rawState) => expect(getStoredFeedVariationMode(rawState)).toBe('automatic'),
    );
    it.each(['automatic', 'all_variations', 'first_variation', 'last_variation', 'default_variation', 'variable_and_variations'])('preserves saved %s mode', (variationMode) => {
        expect(getStoredFeedVariationMode(JSON.stringify({ variationMode }))).toBe(variationMode);
    });
});
