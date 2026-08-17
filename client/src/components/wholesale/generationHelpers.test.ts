import { describe, expect, it } from 'vitest';
import { addBusinessDays, canRetryGeneration, defaultValidUntil, generationStatusLabel, isActiveGeneration, productReadinessIssues } from './generationHelpers';

describe('wholesale generation helpers', () => {
    it('defaults to seven business days across two weekends', () => {
        expect(defaultValidUntil(new Date(2026, 7, 7, 9))).toBe('2026-08-18');
    });

    it('does not count weekends as business days', () => {
        expect(addBusinessDays(new Date(2026, 7, 8), 1).getDay()).toBe(1);
    });

    it('identifies active and exact-snapshot retry statuses', () => {
        expect(isActiveGeneration({ status: 'RENDERING' })).toBe(true);
        expect(isActiveGeneration({ status: 'AWAITING_APPROVAL' })).toBe(false);
        expect(canRetryGeneration({ status: 'FAILED' })).toBe(true);
        expect(canRetryGeneration({ status: 'APPROVED' })).toBe(false);
    });

    it('formats status labels', () => {
        expect(generationStatusLabel('AWAITING_APPROVAL')).toBe('Awaiting Approval');
    });

    it('describes why a product is not ready', () => {
        expect(productReadinessIssues({
            eligible: false,
            published: true,
            inStock: false,
            hasSku: false,
            hasImage: true,
            hasPriceTiers: false,
        })).toEqual(['Out of stock', 'Missing SKU', 'Missing price tiers']);
    });

    it('provides a fallback when eligibility fails without a known issue', () => {
        expect(productReadinessIssues({
            eligible: false,
            published: true,
            inStock: true,
            hasSku: true,
            hasImage: true,
            hasPriceTiers: true,
        })).toEqual(['Eligibility requirements not met']);
    });
});
