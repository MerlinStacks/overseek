import { describe, expect, it } from 'vitest';
import { createInitialDraft, validateStep, type CampaignDraft } from './types';

function validDraft(): CampaignDraft {
    return { ...createInitialDraft(), name: 'Summer', adCopy: { headlines: ['One', 'Two', 'Three'], descriptions: ['First', 'Second'], finalUrl: 'https://example.com' } };
}
describe('campaign step validation', () => {
    it.each(['SEARCH'] as const)('preserves optional product selection for %s', type => {
        const draft = { ...validDraft(), type };
        for (let step = 1; step <= 4; step++) expect(validateStep(step, draft).isValid).toBe(true);
    });
    it.each([NaN, Infinity, -Infinity, 0, -1])('rejects budget %s', budget => {
        expect(validateStep(4, { ...validDraft(), budget }).isValid).toBe(false);
    });
    it.each(['', ' ', 'invalid', 'javascript:alert(1)', 'ftp://example.com', 'https://user:pass@example.com'])('rejects final URL %s', finalUrl => {
        const draft = validDraft(); draft.adCopy.finalUrl = finalUrl;
        expect(validateStep(3, draft).isValid).toBe(false);
    });
    it('rejects blank, excessive, too long, and insufficient copy', () => {
        for (const headlines of [['One', 'Two'], ['One', 'Two', ' '], ['One', 'Two', 'x'.repeat(31)], Array(16).fill('Headline')]) {
            const draft = validDraft(); draft.adCopy.headlines = headlines;
            expect(validateStep(3, draft).isValid).toBe(false);
        }
        for (const descriptions of [['One'], ['One', ' '], ['One', 'x'.repeat(91)], Array(5).fill('Description')]) {
            const draft = validDraft(); draft.adCopy.descriptions = descriptions;
            expect(validateStep(3, draft).isValid).toBe(false);
        }
    });
    it('accepts copy at the declared limits', () => {
        const draft = validDraft();
        draft.adCopy.headlines = Array(15).fill('x'.repeat(30));
        draft.adCopy.descriptions = Array(4).fill('x'.repeat(90));
        expect(validateStep(3, draft).isValid).toBe(true);
    });
    it('rejects unknown steps, blank names and unsupported types', () => {
        expect(validateStep(0, validDraft()).isValid).toBe(false);
        expect(validateStep(1, { ...validDraft(), name: ' ' }).isValid).toBe(false);
        expect(validateStep(1, { ...validDraft(), type: 'UNKNOWN' as CampaignDraft['type'] }).isValid).toBe(false);
    });
});
