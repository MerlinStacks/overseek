import { describe, expect, it } from 'vitest';
import { getFeedFieldCharacterLimit, getFeedFieldLengthError } from './feedFieldLimits';

describe('feed field character limits', () => {
    it('recognizes parent and variation title and description fields', () => {
        expect(getFeedFieldCharacterLimit('title')).toBe(150);
        expect(getFeedFieldCharacterLimit('123-456:description')).toBe(5_000);
        expect(getFeedFieldCharacterLimit('brand')).toBeUndefined();
    });

    it('returns a validation error only when a limited field is too long', () => {
        expect(getFeedFieldLengthError('title', 'a'.repeat(150))).toBeUndefined();
        expect(getFeedFieldLengthError('title', 'a'.repeat(151))).toBe(
            'Title must be 150 characters or fewer.',
        );
        expect(getFeedFieldLengthError('123-456:description', 'a'.repeat(5_001))).toBe(
            'Description must be 5,000 characters or fewer.',
        );
        expect(getFeedFieldLengthError('brand', 'a'.repeat(5_001))).toBeUndefined();
    });
});
