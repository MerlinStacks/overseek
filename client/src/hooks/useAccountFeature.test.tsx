import { renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useAccountFeature } from './useAccountFeature';

let currentAccount: { features?: { featureKey: string; isEnabled: boolean }[] } | null;
vi.mock('../context/AccountContext', () => ({ useAccount: () => ({ currentAccount }) }));

describe('delivery estimate availability', () => {
    beforeEach(() => { currentAccount = { features: [] }; });
    it('defaults on for missing records and missing feature arrays', () => {
        const { result, rerender } = renderHook(() => useAccountFeature('DELIVERY_ESTIMATES'));
        expect(result.current).toBe(true);
        currentAccount = {};
        rerender();
        expect(result.current).toBe(true);
    });
    it('honours explicit false and account absence', () => {
        currentAccount = { features: [{ featureKey: 'DELIVERY_ESTIMATES', isEnabled: false }] };
        const { result, rerender } = renderHook(() => useAccountFeature('DELIVERY_ESTIMATES'));
        expect(result.current).toBe(false);
        currentAccount = null;
        rerender();
        expect(result.current).toBe(false);
    });
    it('preserves unrelated defaults', () => {
        expect(renderHook(() => useAccountFeature('SHIPPING_HUB')).result.current).toBe(false);
        expect(renderHook(() => useAccountFeature('EMAIL')).result.current).toBe(true);
        currentAccount = {};
        expect(renderHook(() => useAccountFeature('EMAIL')).result.current).toBe(false);
    });
});
