import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
const m = vi.hoisted(() => ({ account: { id: 'a' }, fetch: vi.fn() }));
vi.mock('../../context/AuthContext', () => ({ useAuth: () => ({ user: { id: 'u' }, token: 't' }) }));
vi.mock('../../context/AccountContext', () => ({ useAccount: () => ({ currentAccount: m.account }) }));
import { AdCopyModal } from './AdCopyModal';
import { validateGeneratedCopy } from './adCopyValidation';
beforeEach(() => {
    m.account = { id: 'a' }; m.fetch.mockReset(); vi.stubGlobal('fetch', m.fetch);
    Object.defineProperty(HTMLDialogElement.prototype, 'showModal', { configurable: true, value: function (this: HTMLDialogElement) { this.open = true; } });
    Object.defineProperty(HTMLDialogElement.prototype, 'close', { configurable: true, value: function (this: HTMLDialogElement) { this.open = false; } });
    m.fetch.mockImplementation(async (url: string) => ({ ok: true, json: async () => ({ data: url.endsWith('tone-presets') ? [{ id: 'professional', name: 'Professional', description: 'Plain' }] : [{ id: 'google', name: 'Google' }] }) }));
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });
it('ignores late generation after the account/product or open scope changes', async () => {
    let resolve!: (value: unknown) => void; const callback = vi.fn();
    const props = { isOpen: true, onClose: vi.fn(), onCopyGenerated: callback, productId: 'p' };
    const view = render(<AdCopyModal {...props} />); await screen.findByRole('option', { name: 'Professional' });
    m.fetch.mockReturnValueOnce(new Promise(r => { resolve = r; })); fireEvent.click(screen.getByRole('button', { name: 'Generate Ad Copy' }));
    m.account = { id: 'b' }; view.rerender(<AdCopyModal {...props} productId="other" />);
    await act(async () => resolve({ ok: true, json: async () => ({ data: { headlines: ['Old copy'], descriptions: [], source: 'ai' } }) }));
    expect(callback).not.toHaveBeenCalled(); expect(screen.queryByText('Old copy')).not.toBeInTheDocument();
});
it('rejects malformed copy rather than rendering untrusted shapes', () => {
    expect(() => validateGeneratedCopy({ headlines: [4], descriptions: [], source: 'ai' })).toThrow(); expect(() => validateGeneratedCopy({ headlines: ['a'], descriptions: [], source: 'unknown' })).toThrow();
});
