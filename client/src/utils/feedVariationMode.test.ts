import { describe, expect, it } from 'vitest';
import { getStoredFeedVariationMode } from './feedVariationMode';

describe('getStoredFeedVariationMode', () => {
    it('reads the persisted parent-only mode', () => {
        expect(getStoredFeedVariationMode(JSON.stringify({ variationMode: 'variable_parent' })))
            .toBe('variable_parent');
    });

    it.each([null, 'invalid json', JSON.stringify({ variationMode: 'invalid' })])(
        'falls back to all variations for invalid state',
        (rawState) => expect(getStoredFeedVariationMode(rawState)).toBe('all_variations'),
    );
});
