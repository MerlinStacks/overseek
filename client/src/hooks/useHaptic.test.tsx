import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { useHaptic } from './useHaptic';
import { Haptics } from '../test/capacitorHaptics';
const vibrate = vi.fn();
beforeEach(() => { Object.defineProperty(navigator, 'vibrate', { configurable: true, value: vibrate }); vi.clearAllMocks(); vi.stubGlobal('Capacitor', undefined); });
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });
it('uses bounded browser patterns without requiring a native plugin', async () => {
    const { result } = renderHook(() => useHaptic());
    await act(async () => { await result.current.triggerHaptic('success'); });
    expect(vibrate).toHaveBeenCalledWith([20, 50, 20]);
    for (const value of [NaN, Infinity, -1, 0, 201, 2.5]) await result.current.triggerHaptic(value);
    expect(vibrate).toHaveBeenCalledTimes(1);
});
it('does not report native support merely because a Capacitor web bridge exists', () => {
    vi.stubGlobal('Capacitor', { isNativePlatform: () => false });
    Object.defineProperty(navigator, 'vibrate', { configurable: true, value: undefined });
    const { result } = renderHook(() => useHaptic()); expect(result.current.isHapticSupported).toBe(false);
});
it('honors disabled, reduced-motion, hidden and unmounted guards', async () => {
    const { result, rerender, unmount } = renderHook(p => useHaptic(p), { initialProps: { enabled: false } });
    await result.current.triggerHaptic(); expect(vibrate).not.toHaveBeenCalled();
    rerender({ enabled: true });
    vi.stubGlobal('matchMedia', () => ({ matches: true }));
    await result.current.triggerHaptic(); expect(vibrate).not.toHaveBeenCalled();
    vi.stubGlobal('matchMedia', () => ({ matches: false }));
    unmount(); await result.current.triggerHaptic(); expect(vibrate).not.toHaveBeenCalled();
});
it('uses uppercase native notifications and completes the selection lifecycle', async () => {
    vi.stubGlobal('Capacitor', { isNativePlatform: () => true, isPluginAvailable: () => true });
    const { result } = renderHook(() => useHaptic());
    await result.current.triggerHaptic('success'); expect(Haptics.notification).toHaveBeenCalledWith({ type: 'SUCCESS' });
    await result.current.triggerHaptic('selection'); expect(Haptics.selectionStart).toHaveBeenCalledOnce(); expect(Haptics.selectionChanged).toHaveBeenCalledOnce(); expect(Haptics.selectionEnd).toHaveBeenCalledOnce();
    expect(vibrate).not.toHaveBeenCalled();
});
it('finishes a started native selection but suppresses delayed feedback after disable', async () => {
    vi.stubGlobal('Capacitor', { isNativePlatform: () => true });
    let resolve!: () => void;
    Haptics.selectionStart.mockImplementationOnce(() => new Promise<void>(done => { resolve = done; }));
    const { result, rerender } = renderHook(p => useHaptic(p), { initialProps: { enabled: true } });
    let pending!: Promise<void>;
    await act(async () => { pending = result.current.triggerHaptic('selection'); await Promise.resolve(); await Promise.resolve(); });
    rerender({ enabled: false }); resolve(); await pending;
    expect(Haptics.selectionChanged).not.toHaveBeenCalled(); expect(Haptics.selectionEnd).toHaveBeenCalledOnce();
});
