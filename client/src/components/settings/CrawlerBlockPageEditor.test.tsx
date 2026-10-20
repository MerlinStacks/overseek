import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
const m = vi.hoisted(() => ({ account: { id: 'a', name: '<img src=x>' }, fetch: vi.fn() }));
vi.mock('../../context/AuthContext', () => ({ useAuth: () => ({ token: 'token' }) }));
vi.mock('../../context/AccountContext', () => ({ useAccount: () => ({ currentAccount: m.account }) }));
import { CrawlerBlockPageEditor } from './CrawlerBlockPageEditor';
beforeEach(() => { vi.resetAllMocks(); m.account = { id: 'a', name: '<img src=x>' }; vi.stubGlobal('fetch', m.fetch); m.fetch.mockResolvedValue({ ok: true, json: async () => ({ html: '{{site_name}}' }) }); });
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });
describe('crawler template isolation', () => {
    it('escapes preview placeholders and uses an opaque sandbox', async () => {
        render(<CrawlerBlockPageEditor />); await screen.findByRole('textbox'); fireEvent.click(screen.getByRole('button', { name: 'Preview' }));
        const frame = screen.getByTitle('Block page preview'); expect(frame).toHaveAttribute('sandbox', ''); expect(frame).toHaveAttribute('srcdoc', '&lt;img src=x&gt;');
    });
    it('resets drafts and ignores old-account loads', async () => {
        let resolve!: (value: unknown) => void; m.fetch.mockReturnValueOnce(new Promise(r => { resolve = r; })); const view = render(<CrawlerBlockPageEditor />); await waitFor(() => expect(m.fetch).toHaveBeenCalledOnce()); const signal = m.fetch.mock.calls[0][1].signal;
        m.account = { id: 'b', name: 'New' }; view.rerender(<CrawlerBlockPageEditor />); await screen.findByRole('textbox');
        await act(async () => { resolve({ ok: true, json: async () => ({ html: 'Private old template' }) }); }); expect(signal.aborted).toBe(true); expect(screen.getByRole('textbox')).not.toHaveValue('Private old template');
    });
});
