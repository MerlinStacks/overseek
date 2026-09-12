import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useVisualViewport } from './useVisualViewport';

function mockViewport() {
    const viewport = Object.assign(new EventTarget(), { height: 800, offsetTop: 0, scale: 1 });
    vi.stubGlobal('visualViewport', viewport);
    return viewport;
}

afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });

describe('useVisualViewport', () => {
    it('falls back to dynamic viewport height when unsupported or disabled', () => {
        vi.stubGlobal('visualViewport', undefined);
        const { result } = renderHook(() => useVisualViewport());
        expect(result.current).toEqual({ height: '100dvh', top: 0 });
        const viewport = mockViewport();
        const listen = vi.spyOn(viewport, 'addEventListener');
        const disabled = renderHook(() => useVisualViewport(false));
        expect(disabled.result.current).toEqual({ height: '100dvh', top: 0 });
        expect(listen).not.toHaveBeenCalled();
    });

    it('tracks keyboard resize, viewport panning and window resize', () => {
        const viewport = mockViewport();
        const { result } = renderHook(() => useVisualViewport());
        expect(result.current).toEqual({ height: 800, top: 0 });
        act(() => { viewport.height = 340; viewport.dispatchEvent(new Event('resize')); });
        expect(result.current).toEqual({ height: 340, top: 0 });
        act(() => { viewport.offsetTop = 120; viewport.dispatchEvent(new Event('scroll')); });
        expect(result.current).toEqual({ height: 340, top: 120 });
        act(() => { viewport.height = 700; viewport.offsetTop = 0; window.dispatchEvent(new Event('resize')); });
        expect(result.current).toEqual({ height: 700, top: 0 });
    });

    it('freezes geometry during pinch zoom and resumes when unzoomed', () => {
        const viewport = mockViewport();
        const { result } = renderHook(() => useVisualViewport());
        act(() => {
            viewport.scale = 2; viewport.height = 400; viewport.offsetTop = 200;
            viewport.dispatchEvent(new Event('resize'));
            viewport.dispatchEvent(new Event('scroll'));
        });
        expect(result.current).toEqual({ height: 800, top: 0 });
        act(() => { viewport.scale = 1; viewport.height = 350; viewport.dispatchEvent(new Event('resize')); });
        expect(result.current).toEqual({ height: 350, top: 200 });
    });

    it('uses the fallback when mounted zoomed and ignores invalid transient geometry', () => {
        const viewport = mockViewport();
        viewport.scale = 2;
        const { result } = renderHook(() => useVisualViewport());
        expect(result.current).toEqual({ height: '100dvh', top: 0 });
        act(() => { viewport.scale = 1; viewport.height = 0; viewport.dispatchEvent(new Event('resize')); });
        expect(result.current).toEqual({ height: '100dvh', top: 0 });
    });

    it('removes all listeners when disabled or unmounted and refreshes on re-enable', () => {
        const viewport = mockViewport();
        const remove = vi.spyOn(viewport, 'removeEventListener');
        const removeWindow = vi.spyOn(window, 'removeEventListener');
        const { result, rerender, unmount } = renderHook(({ enabled }) => useVisualViewport(enabled), { initialProps: { enabled: true } });
        rerender({ enabled: false });
        expect(result.current).toEqual({ height: '100dvh', top: 0 });
        expect(remove).toHaveBeenCalledWith('resize', expect.any(Function));
        expect(remove).toHaveBeenCalledWith('scroll', expect.any(Function));
        expect(removeWindow).toHaveBeenCalledWith('resize', expect.any(Function));
        viewport.height = 300;
        rerender({ enabled: true });
        expect(result.current).toEqual({ height: 300, top: 0 });
        unmount();
        expect(remove).toHaveBeenCalledTimes(4);
        expect(removeWindow).toHaveBeenCalledTimes(2);
    });
});
