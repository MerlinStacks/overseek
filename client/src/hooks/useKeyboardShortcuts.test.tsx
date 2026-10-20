import { cleanup, fireEvent, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useKeyboardShortcuts } from './useKeyboardShortcuts';
afterEach(() => { cleanup(); document.body.replaceChildren(); });
function setup(enabled = true) {
    const select = vi.fn(), close = vi.fn(), help = vi.fn();
    renderHook(() => useKeyboardShortcuts({ conversations: [{ id: 'a' }, { id: 'b' }], selectedId: 'a', onSelect: select, onClose: close, onShowHelp: help, enabled }));
    return { select, close, help };
}
describe('inbox keyboard shortcuts', () => {
    it('preserves navigation and help from the page body', () => {
        const { select, help } = setup(); fireEvent.keyDown(document.body, { key: 'j' }); fireEvent.keyDown(document.body, { key: '?' });
        expect(select).toHaveBeenCalledWith('b'); expect(help).toHaveBeenCalledOnce();
    });
    it.each([{ isComposing: true }, { keyCode: 229 }, { altKey: true }, { ctrlKey: true }, { metaKey: true }, { repeat: true }])('ignores protected events: %j', options => {
        const { close } = setup(); fireEvent.keyDown(document.body, { key: 'e', ...options }); expect(close).not.toHaveBeenCalled();
    });
    it('ignores already handled events', () => {
        const { close } = setup(); const event = new KeyboardEvent('keydown', { key: 'e', bubbles: true, cancelable: true }); event.preventDefault();
        document.body.dispatchEvent(event); expect(close).not.toHaveBeenCalled();
    });
    it.each(['button', 'a', 'select', 'textarea', 'input'])('does not intercept focused %s controls', tag => {
        const { close } = setup(); const control = document.createElement(tag); document.body.append(control);
        fireEvent.keyDown(control, { key: 'e' }); expect(close).not.toHaveBeenCalled();
    });
    it('ignores descendants of contenteditable and dialogs and preserves Escape blur', () => {
        const { close } = setup();
        const editor = document.createElement('div'); editor.setAttribute('contenteditable', 'true'); editor.innerHTML = '<span>Text</span>'; document.body.append(editor);
        fireEvent.keyDown(editor.firstChild!, { key: 'e' });
        const dialog = document.createElement('div'); dialog.setAttribute('role', 'dialog'); document.body.append(dialog); fireEvent.keyDown(dialog, { key: 'e' });
        expect(close).not.toHaveBeenCalled();
        const input = document.createElement('input'); document.body.append(input); input.focus(); fireEvent.keyDown(input, { key: 'Escape' }); expect(input).not.toHaveFocus();
    });
    it('does nothing when disabled', () => { const { close } = setup(false); fireEvent.keyDown(document.body, { key: 'e' }); expect(close).not.toHaveBeenCalled(); });
});
