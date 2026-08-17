import type { WholesaleCatalogGeneration, WholesaleGenerationStatus, WholesaleReadiness } from '../../types/wholesaleCatalog';

export function addBusinessDays(date: Date, businessDays: number): Date {
    const result = new Date(date.getFullYear(), date.getMonth(), date.getDate());
    let remaining = businessDays;
    while (remaining > 0) {
        result.setDate(result.getDate() + 1);
        if (result.getDay() !== 0 && result.getDay() !== 6) remaining -= 1;
    }
    return result;
}

export function toLocalIsoDate(date: Date): string {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
}

export function defaultValidUntil(now = new Date()): string {
    return toLocalIsoDate(addBusinessDays(now, 7));
}

export function generationStatusLabel(status: WholesaleGenerationStatus): string {
    return status.split('_').map(word => word.charAt(0) + word.slice(1).toLowerCase()).join(' ');
}

export function isActiveGeneration(generation: Pick<WholesaleCatalogGeneration, 'status'>): boolean {
    return generation.status === 'QUEUED' || generation.status === 'RENDERING';
}

export function canRetryGeneration(generation: Pick<WholesaleCatalogGeneration, 'status'>): boolean {
    return generation.status === 'FAILED' || generation.status === 'CANCELLED';
}

export function staleReasonLabel(code: string): string {
    return code.split('_').map(word => word.charAt(0) + word.slice(1).toLowerCase()).join(' ');
}

export function productReadinessIssues(readiness: WholesaleReadiness): string[] {
    const issues = [
        !readiness.published && 'Not published',
        !readiness.inStock && 'Out of stock',
        !readiness.hasSku && 'Missing SKU',
        !readiness.hasImage && 'Missing image',
        !readiness.hasPriceTiers && 'Missing price tiers',
    ].filter((issue): issue is string => Boolean(issue));

    if (!readiness.eligible && issues.length === 0) issues.push('Eligibility requirements not met');
    return issues;
}
