export type CatalogViewStep = 'loading' | 'password' | 'identity' | 'consent' | 'viewer' | 'unavailable';

export const CONFIDENTIALITY_AGREEMENT = 'I agree to keep this confidential';

export function isValidViewerEmail(value: string) {
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim());
}

export function nextCatalogViewStep(step: CatalogViewStep): CatalogViewStep {
    if (step === 'password') return 'identity';
    if (step === 'identity') return 'consent';
    if (step === 'consent') return 'viewer';
    return step;
}

export function clampCatalogPage(page: number, pageCount: number) {
    return Math.max(1, Math.min(Math.max(1, pageCount), Math.round(page) || 1));
}

export function shouldLoadProtectedImageImmediately(thumbnail: boolean, intersectionObserverAvailable: boolean) {
    return !thumbnail || !intersectionObserverAvailable;
}
