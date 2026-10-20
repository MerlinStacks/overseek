import { cleanup, render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ registerCommand: vi.fn(), isComposing: vi.fn(), isEditable: vi.fn(), getRootElement: vi.fn() }));
vi.mock('@lexical/react/LexicalComposerContext', () => ({ useLexicalComposerContext: () => [mocks] }));
import { EnterSubmitPlugin } from './EnterSubmitPlugin';
let root: HTMLDivElement;
let submit: ReturnType<typeof vi.fn>;
beforeEach(() => {
    vi.resetAllMocks(); root = document.createElement('div'); document.body.append(root);
    mocks.getRootElement.mockReturnValue(root); mocks.isEditable.mockReturnValue(true); mocks.isComposing.mockReturnValue(false);
    mocks.registerCommand.mockReturnValue(vi.fn()); submit = vi.fn();
});
afterEach(() => { cleanup(); root.remove(); });
function enter(options: KeyboardEventInit = {}, target: Node = root) {
    const event = new KeyboardEvent('keydown', { key: 'Enter', cancelable: true, ...options });
    Object.defineProperty(event, 'target', { value: target });
    const handled = mocks.registerCommand.mock.calls[0][1](event);
    return { event, handled };
}
describe('Enter submit plugin', () => {
    it('submits Enter from the editor and prevents its default action', () => {
        render(<EnterSubmitPlugin onSubmit={submit} />);
        const { event, handled } = enter();
        expect(handled).toBe(true); expect(event.defaultPrevented).toBe(true); expect(submit).toHaveBeenCalledOnce();
    });
    it.each([{ isComposing: true }, { keyCode: 229 }, { shiftKey: true }])('leaves composition/newline events alone: %j', options => {
        render(<EnterSubmitPlugin onSubmit={submit} />);
        expect(enter(options).handled).toBe(false); expect(submit).not.toHaveBeenCalled();
    });
    it('checks editor composition and editability and ignores toolbar/outside events', () => {
        render(<EnterSubmitPlugin onSubmit={submit} />);
        mocks.isComposing.mockReturnValue(true); expect(enter().handled).toBe(false);
        mocks.isComposing.mockReturnValue(false); mocks.isEditable.mockReturnValue(false); expect(enter().handled).toBe(false);
        mocks.isEditable.mockReturnValue(true); expect(enter({}, document.body).handled).toBe(false);
        expect(submit).not.toHaveBeenCalled();
    });
    it('honors disabled state, prevented events and unregisters on unmount', () => {
        const view = render(<EnterSubmitPlugin onSubmit={submit} disabled />);
        expect(enter().handled).toBe(false);
        const unregister = mocks.registerCommand.mock.results[0].value;
        view.unmount(); expect(unregister).toHaveBeenCalledOnce();
        render(<EnterSubmitPlugin onSubmit={submit} />);
        const event = new KeyboardEvent('keydown', { cancelable: true }); event.preventDefault();
        expect(mocks.registerCommand.mock.calls[1][1](event)).toBe(false);
    });
    it('does not register without a submit handler', () => {
        render(<EnterSubmitPlugin />); expect(mocks.registerCommand).not.toHaveBeenCalled();
    });
});
