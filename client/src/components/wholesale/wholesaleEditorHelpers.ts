import type { WholesaleBranding, WholesaleBrandingImportCandidates, WholesaleCatalogGeneration, WholesaleDefaults, WholesaleTaxImportCandidate, WholesaleTermsSection } from '../../types/wholesaleCatalog';

export function moveTermsSection(sections: WholesaleTermsSection[], index: number, direction: -1 | 1): WholesaleTermsSection[] {
    const destination = index + direction;
    if (index < 0 || index >= sections.length || destination < 0 || destination >= sections.length) return sections;
    const next = [...sections];
    [next[index], next[destination]] = [next[destination], next[index]];
    return next;
}

export function updateTermsSection(sections: WholesaleTermsSection[], index: number, patch: Partial<WholesaleTermsSection>): WholesaleTermsSection[] {
    return sections.map((section, sectionIndex) => sectionIndex === index ? { ...section, ...patch } : section);
}

export function acceptTermsSuggestion(sections: WholesaleTermsSection[], index: number, suggestion: WholesaleTermsSection): WholesaleTermsSection[] {
    return updateTermsSection(sections, index, suggestion);
}

export type BrandingCandidateKind = keyof WholesaleBrandingImportCandidates;

export function applyBrandingCandidate(branding: WholesaleBranding, kind: BrandingCandidateKind, value: string): WholesaleBranding {
    if (kind === 'logoUrls') return { ...branding, logoUrl: value };
    if (kind === 'colors') {
        return branding.primaryColor ? { ...branding, accentColor: value } : { ...branding, primaryColor: value };
    }
    if (kind === 'businessNames') return { ...branding, businessDetails: { ...branding.businessDetails, name: value } };
    const key = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value) ? 'contactEmail'
        : /^\+?[\d\s().-]{7,}$/.test(value) ? 'contactPhone'
            : /\d.+\b(?:street|st|road|rd|avenue|ave|drive|dr|lane|ln|way|court|ct|boulevard|blvd)\b/i.test(value) ? 'address'
                : null;
    if (!key) return branding;
    return { ...branding, businessDetails: { ...branding.businessDetails, [key]: value } };
}

/** Fill empty catalog fields from discovered candidates without overwriting reviewed values. */
export function applyBrandingCandidates(branding: WholesaleBranding, candidates: WholesaleBrandingImportCandidates): WholesaleBranding {
    let next = { ...branding, businessDetails: { ...branding.businessDetails } };
    if (!next.logoUrl && candidates.logoUrls[0]) next.logoUrl = candidates.logoUrls[0];
    if (!next.primaryColor && candidates.colors[0]) next.primaryColor = candidates.colors[0];
    if (!next.accentColor && candidates.colors[1]) next.accentColor = candidates.colors[1];
    if (!next.businessDetails.name && candidates.businessNames[0]) next.businessDetails.name = candidates.businessNames[0];
    for (const hint of candidates.contactHints) {
        const applied = applyBrandingCandidate(next, 'contactHints', hint);
        const key = Object.keys(applied.businessDetails).find(candidateKey => applied.businessDetails[candidateKey] !== next.businessDetails[candidateKey]);
        if (key && !next.businessDetails[key]) next = applied;
    }
    return next;
}

export function applyTaxImportCandidate(defaults: WholesaleDefaults, candidate: WholesaleTaxImportCandidate): WholesaleDefaults {
    return { ...defaults, priceTaxBasis: candidate.priceTaxBasis, gstRate: candidate.gstRate };
}

export function generationValidityMaximum(generation: Pick<WholesaleCatalogGeneration, 'originalGeneratedAt' | 'effectiveDate'>): string {
    const anchor = new Date(generation.originalGeneratedAt || generation.effectiveDate);
    const maximum = new Date(anchor.getFullYear(), anchor.getMonth(), anchor.getDate() + 30);
    const year = maximum.getFullYear();
    const month = String(maximum.getMonth() + 1).padStart(2, '0');
    const day = String(maximum.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
}

export function canExtendGenerationValidity(generation: Pick<WholesaleCatalogGeneration, 'status' | 'staleAt' | 'validityArtifactStatus'>): boolean {
    return generation.status === 'APPROVED' && !generation.staleAt && generation.validityArtifactStatus !== 'UPDATING';
}

export function isValidValidityExtension(generation: Pick<WholesaleCatalogGeneration, 'originalGeneratedAt' | 'effectiveDate'>, value: string, now = new Date()): boolean {
    const today = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
    return /^\d{4}-\d{2}-\d{2}$/.test(value) && value > today && value <= generationValidityMaximum(generation);
}

const DOWNLOADED_WARNING_KEY = 'wholesale-downloaded-artifact-warning-v1';

export function needsDownloadedArtifactWarning(storage: Pick<Storage, 'getItem'>): boolean {
    return storage.getItem(DOWNLOADED_WARNING_KEY) !== 'acknowledged';
}

export function recordDownloadedArtifactWarning(storage: Pick<Storage, 'setItem'>): void {
    storage.setItem(DOWNLOADED_WARNING_KEY, 'acknowledged');
}
