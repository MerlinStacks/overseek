import { describe, expect, it } from 'vitest';
import { acceptTermsSuggestion, applyBrandingCandidate, applyBrandingCandidates, applyTaxImportCandidate, canExtendGenerationValidity, generationValidityMaximum, isValidValidityExtension, moveTermsSection, updateTermsSection } from './wholesaleEditorHelpers';

describe('wholesale editor helpers', () => {
    const sections = [{ heading: 'First', content: 'One' }, { heading: 'Second', content: 'Two' }];

    it('updates and reorders terms without mutating the source', () => {
        expect(moveTermsSection(sections, 1, -1).map(section => section.heading)).toEqual(['Second', 'First']);
        expect(updateTermsSection(sections, 0, { content: 'Changed' })[0].content).toBe('Changed');
        expect(sections[0].content).toBe('One');
    });

    it('accepts an AI suggestion only into the requested unsaved section', () => {
        const result = acceptTermsSuggestion(sections, 1, { heading: 'Short', content: 'Shorter terms' });
        expect(result).toEqual([sections[0], { heading: 'Short', content: 'Shorter terms' }]);
        expect(sections[1].heading).toBe('Second');
    });

    it('applies reviewed branding candidates to editable fields', () => {
        const branding = { logoUrl: null, primaryColor: null, accentColor: null, headingFont: null, bodyFont: null, businessDetails: {} };
        expect(applyBrandingCandidate(branding, 'logoUrls', 'https://store.test/logo.png').logoUrl).toBe('https://store.test/logo.png');
        const colored = applyBrandingCandidate(branding, 'colors', '#112233');
        expect(colored.primaryColor).toBe('#112233');
        expect(applyBrandingCandidate(colored, 'colors', '#445566').accentColor).toBe('#445566');
        expect(applyBrandingCandidate(branding, 'contactHints', 'sales@store.test').businessDetails.contactEmail).toBe('sales@store.test');
        expect(applyBrandingCandidate(branding, 'contactHints', '+61 400 000 000').businessDetails.contactPhone).toBe('+61 400 000 000');
    });

    it('fills blank branding fields without replacing existing values', () => {
        const branding = { logoUrl: 'https://store.test/existing.png', primaryColor: null, accentColor: null, headingFont: null, bodyFont: null, businessDetails: { contactEmail: 'existing@store.test' } };
        const result = applyBrandingCandidates(branding, { logoUrls: ['https://store.test/new.png'], colors: ['#112233', '#445566'], businessNames: ['Store'], contactHints: ['new@store.test', '+61 400 000 000'] });
        expect(result.logoUrl).toBe(branding.logoUrl);
        expect(result.primaryColor).toBe('#112233');
        expect(result.accentColor).toBe('#445566');
        expect(result.businessDetails).toMatchObject({ name: 'Store', contactEmail: 'existing@store.test', contactPhone: '+61 400 000 000' });
    });

    it('applies a reviewed tax candidate only to the unsaved tax fields', () => {
        const defaults = { priceTaxBasis: 'EXCLUSIVE' as const, gstRate: '10', termsDocument: { sections }, confidentialityNotice: 'Private', privacyNotice: 'Privacy', setupChecklist: [] };
        const candidate = { priceTaxBasis: 'INCLUSIVE' as const, gstRate: '12.5', source: { priceTaxBasis: 'WOOCOMMERCE_SETTINGS' as const, gstRate: 'WOOCOMMERCE_TAX_RATES' as const }, warnings: [] };
        const result = applyTaxImportCandidate(defaults, candidate);

        expect(result).toEqual({ ...defaults, priceTaxBasis: 'INCLUSIVE', gstRate: '12.5' });
        expect(defaults.priceTaxBasis).toBe('EXCLUSIVE');
    });

    it('limits approved non-stale validity to 30 days from the original date', () => {
        const generation = { status: 'APPROVED' as const, staleAt: null, validityArtifactStatus: 'CURRENT' as const, originalGeneratedAt: '2026-08-01T10:00:00Z', effectiveDate: '2026-07-31T10:00:00Z' };
        expect(canExtendGenerationValidity(generation)).toBe(true);
        expect(generationValidityMaximum(generation)).toBe('2026-08-31');
        expect(isValidValidityExtension(generation, '2026-08-31', new Date(2026, 7, 7))).toBe(true);
        expect(isValidValidityExtension(generation, '2026-09-01', new Date(2026, 7, 7))).toBe(false);
        expect(canExtendGenerationValidity({ ...generation, staleAt: '2026-08-07T00:00:00Z' })).toBe(false);
        expect(canExtendGenerationValidity({ ...generation, validityArtifactStatus: 'UPDATING' })).toBe(false);
        expect(canExtendGenerationValidity({ ...generation, validityArtifactStatus: 'FAILED' })).toBe(true);
    });
});
