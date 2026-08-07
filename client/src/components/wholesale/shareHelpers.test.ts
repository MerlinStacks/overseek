import { describe, expect, it } from 'vitest';
import { absoluteShareExpiry, canActivateShare, isPreparingShare, isValidShareExpiry, shareStatusLabel, shareableGenerations } from './shareHelpers';

describe('wholesale share helpers', () => {
    it('only offers approved, current, non-stale generations', () => {
        const base = { catalogId: 'catalog', validUntil: '2026-09-01T00:00:00.000Z', staleAt: null };
        const generations = [
            { ...base, id: 'ready', status: 'APPROVED' },
            { ...base, id: 'stale', status: 'APPROVED', staleAt: '2026-08-01T00:00:00.000Z' },
            { ...base, id: 'draft', status: 'AWAITING_APPROVAL' },
        ];
        expect(shareableGenerations(generations as never, 'catalog', new Date('2026-08-07T00:00:00.000Z')).map(item => item.id)).toEqual(['ready']);
    });

    it('enforces the absolute 90 day cap', () => {
        const created = new Date('2026-08-07T00:00:00.000Z');
        expect(absoluteShareExpiry(created).toISOString()).toBe('2026-11-05T00:00:00.000Z');
        expect(isValidShareExpiry('2026-11-06T00:00:00.000Z', created, created)).toBe(false);
    });

    it('classifies actionable statuses', () => {
        expect(isPreparingShare({ status: 'PREPARING' })).toBe(true);
        expect(canActivateShare({ status: 'LOCKED' })).toBe(true);
        expect(shareStatusLabel('REVOKED')).toBe('Revoked');
    });
});
