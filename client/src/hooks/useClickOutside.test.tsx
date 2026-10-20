import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useClickOutside } from './useClickOutside';
function Fixture({ handler, enabled = true }: { handler: () => void; enabled?: boolean }) {
    const ref = useClickOutside<HTMLDivElement>(handler, enabled);
    return <div ref={ref}><button>Inside</button></div>;
}
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });
describe('outside pointer handling', () => {
    it('supports touch/pen pointer events and ignores events within the element', () => {
        vi.stubGlobal('PointerEvent', MouseEvent);
        const handler = vi.fn(); const view = render(<Fixture handler={handler} />);
        fireEvent.pointerDown(screen.getByRole('button')); expect(handler).not.toHaveBeenCalled();
        fireEvent.pointerDown(document.body); expect(handler).toHaveBeenCalledOnce();
        view.unmount(); fireEvent.pointerDown(document.body); expect(handler).toHaveBeenCalledOnce();
    });
    it('honors disabling and the latest callback', () => {
        vi.stubGlobal('PointerEvent', MouseEvent);
        const first = vi.fn(); const second = vi.fn(); const view = render(<Fixture handler={first} enabled={false} />);
        fireEvent.pointerDown(document.body); expect(first).not.toHaveBeenCalled(); view.rerender(<Fixture handler={second} />);
        fireEvent.pointerDown(document.body); expect(second).toHaveBeenCalledOnce(); expect(first).not.toHaveBeenCalled();
    });
    it('falls back to mouse events when pointer events are unavailable', () => {
        vi.stubGlobal('PointerEvent', undefined);
        const handler = vi.fn(); render(<Fixture handler={handler} />); fireEvent.mouseDown(document.body); expect(handler).toHaveBeenCalledOnce();
    });
});
