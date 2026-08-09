import { describe, expect, it } from 'vitest';
import { areShareNotificationsEnabled, formatHistorySnapshot, isLowResolutionImage } from './productUxHelpers';

describe('wholesale product UX helpers', () => {
    it('warns when either image dimension is below 800 pixels', () => {
        expect(isLowResolutionImage(799, 1200)).toBe(true);
        expect(isLowResolutionImage(1200, 799)).toBe(true);
        expect(isLowResolutionImage(800, 800)).toBe(false);
    });

    it('formats history without exposing notes', () => {
        expect(formatHistorySnapshot({
            priceTaxBasis: 'EXCLUSIVE', personalisationTypes: ['ENGRAVE', 'UV'],
            priceTiers: [{ minimumQuantity: 10, unitPrice: '8.50', isPoa: false }, { minimumQuantity: 100, unitPrice: null, isPoa: true }],
        })).toEqual({ tiers: '10+: $8.50, 100+: POA', tax: 'Tax exclusive', badges: 'ENGRAVE, UV', turnaround: 'No base turnaround' });
    });

    it('defaults share notifications on and reflects mute state', () => {
        expect(areShareNotificationsEnabled()).toBe(true);
        expect(areShareNotificationsEnabled(false)).toBe(true);
        expect(areShareNotificationsEnabled(true)).toBe(false);
    });
});
