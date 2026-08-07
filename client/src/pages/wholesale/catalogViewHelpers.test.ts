import { describe, expect, it } from 'vitest';
import { CONFIDENTIALITY_AGREEMENT, clampCatalogPage, isValidViewerEmail, nextCatalogViewStep, shouldLoadProtectedImageImmediately } from './catalogViewHelpers';

describe('public catalog viewer helpers', () => {
    it('uses the required confidentiality wording', () => expect(CONFIDENTIALITY_AGREEMENT).toBe('I agree to keep this confidential'));
    it('validates viewer email format', () => {
        expect(isValidViewerEmail('viewer@example.com')).toBe(true);
        expect(isValidViewerEmail('viewer@invalid')).toBe(false);
    });
    it('advances the protected flow in order', () => {
        expect(nextCatalogViewStep('password')).toBe('identity');
        expect(nextCatalogViewStep('identity')).toBe('consent');
        expect(nextCatalogViewStep('consent')).toBe('viewer');
    });
    it('clamps navigation to available pages', () => {
        expect(clampCatalogPage(0, 8)).toBe(1);
        expect(clampCatalogPage(12, 8)).toBe(8);
    });
    it('loads full pages and observer-less thumbnails immediately', () => {
        expect(shouldLoadProtectedImageImmediately(false, true)).toBe(true);
        expect(shouldLoadProtectedImageImmediately(true, false)).toBe(true);
        expect(shouldLoadProtectedImageImmediately(true, true)).toBe(false);
    });
});
