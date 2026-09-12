import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useSignaturePreference } from '../useSignaturePreference';

beforeEach(() => localStorage.clear());
afterEach(() => { cleanup(); vi.restoreAllMocks(); });

describe('inbox signature preference', () => {
    it('defaults on, remembers disabling across remounts, and remembers re-enabling', () => {
        const first = renderHook(() => useSignaturePreference('user-1'));
        expect(first.result.current.signatureEnabled).toBe(true);
        act(() => first.result.current.setSignatureEnabled(false));
        expect(first.result.current.signatureEnabled).toBe(false);
        first.unmount();

        const second = renderHook(() => useSignaturePreference('user-1'));
        expect(second.result.current.signatureEnabled).toBe(false);
        act(() => second.result.current.setSignatureEnabled(true));
        second.unmount();
        const third = renderHook(() => useSignaturePreference('user-1'));
        expect(third.result.current.signatureEnabled).toBe(true);
    });

    it('loads after auth hydration and keeps different users isolated', () => {
        localStorage.setItem('inbox:signatureEnabled:user-1', 'false');
        const { result, rerender } = renderHook(({ userId }: { userId?: string }) =>
            useSignaturePreference(userId), { initialProps: { userId: undefined as string | undefined } });
        rerender({ userId: 'user-1' });
        expect(result.current.signatureEnabled).toBe(false);
        rerender({ userId: 'user-2' });
        expect(result.current.signatureEnabled).toBe(true);
        rerender({ userId: 'user-1' });
        expect(result.current.signatureEnabled).toBe(false);
    });

    it('still lets users disable signatures when browser storage is blocked', () => {
        vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new Error('Blocked'); });
        vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('Blocked'); });
        const { result } = renderHook(() => useSignaturePreference('user-1'));
        act(() => result.current.setSignatureEnabled(false));
        expect(result.current.signatureEnabled).toBe(false);
    });
});
