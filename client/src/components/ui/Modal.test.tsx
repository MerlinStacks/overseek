import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Modal } from './Modal';

afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

describe('Modal sheet', () => {
    it('preserves default layout and opts sheets into keyboard-aware, bounded layout', () => {
        const viewport = Object.assign(new EventTarget(), { height: 800, offsetTop: 0, scale: 1 });
        vi.stubGlobal('visualViewport', viewport);
        const { rerender } = render(<Modal isOpen title="Example">Content</Modal>);
        let dialog = screen.getByRole('dialog', { name: 'Example' });
        expect(dialog.parentElement).toHaveClass('z-50', 'items-center', 'inset-0');
        expect(dialog.parentElement?.style.height).toBe('');
        expect(dialog).toHaveClass('max-w-lg', 'max-h-[90vh]');
        rerender(<Modal isOpen title="Example" variant="sheet">Content</Modal>);
        dialog = screen.getByRole('dialog', { name: 'Example' });
        expect(dialog.parentElement).toHaveClass('z-[90]', 'items-end');
        expect(dialog.parentElement).toHaveStyle({ height: '800px', top: '0px' });
        expect(dialog).toHaveClass('max-h-[min(100%,48rem)]', 'bg-slate-900', 'rounded-t-3xl');
        expect(dialog.lastElementChild).toHaveClass('min-h-0', 'overflow-y-auto', 'overscroll-contain', 'pb-[max(1.5rem,env(safe-area-inset-bottom))]');
        act(() => { viewport.height = 320; viewport.offsetTop = 100; viewport.dispatchEvent(new Event('resize')); });
        expect(dialog.parentElement).toHaveStyle({ height: '320px', top: '100px' });
    });

    it('traps contenteditable focus and dismisses only the top sheet, then restores focus and locks', () => {
        const closeBase = vi.fn();
        const closeSheet = vi.fn();
        function View({ sheet = false }) {
            return <>
                <Modal isOpen title="Base" onClose={closeBase}><button>Open sheet</button></Modal>
                <Modal isOpen={sheet} title="Editor" variant="sheet" onClose={closeSheet}>
                    <div contentEditable suppressContentEditableWarning role="textbox" aria-label="Message">Draft</div>
                </Modal>
            </>;
        }
        const { rerender, container } = render(<View />);
        const base = screen.getByRole('dialog', { name: 'Base' });
        const trigger = screen.getByRole('button', { name: 'Open sheet' });
        trigger.focus();
        rerender(<View sheet />);
        const sheet = screen.getByRole('dialog', { name: 'Editor' });
        expect(sheet).toHaveAttribute('aria-modal', 'true');
        expect(base.parentElement).toHaveAttribute('aria-hidden', 'true');
        expect(base.parentElement?.inert).toBe(true);
        expect(container).toHaveAttribute('aria-hidden', 'true');
        expect(document.body.style.overflow).toBe('hidden');
        const close = within(sheet).getByRole('button', { name: 'Close dialog' });
        expect(close).toHaveFocus();
        fireEvent.keyDown(document, { key: 'Tab', shiftKey: true });
        expect(screen.getByRole('textbox', { name: 'Message' })).toHaveFocus();
        fireEvent.keyDown(document, { key: 'Tab' });
        expect(close).toHaveFocus();
        fireEvent.keyDown(document, { key: 'Escape' });
        expect(closeSheet).toHaveBeenCalledOnce();
        expect(closeBase).not.toHaveBeenCalled();
        rerender(<View />);
        expect(trigger).toHaveFocus();
        expect(base.parentElement).not.toHaveAttribute('aria-hidden');
        expect(container).toHaveAttribute('aria-hidden', 'true');
        expect(document.body.style.overflow).toBe('hidden');
    });
});
