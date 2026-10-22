import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { MemoryRouter } from 'react-router-dom';
const m = vi.hoisted(() => ({ account: { id: 'a' }, manage: false, fetch: vi.fn(), poll: null as null | (() => Promise<void>) }));
vi.mock('../../context/AuthContext', () => ({ useAuth: () => ({ user: { id: 'u' }, token: 't' }) }));
vi.mock('../../context/AccountContext', () => ({ useAccount: () => ({ currentAccount: m.account }) }));
vi.mock('../../hooks/usePermissions', () => ({ usePermissions: () => ({ hasPermission: (key: string) => key === 'view_marketing' || m.manage }) }));
vi.mock('../../hooks/useVisibilityPolling', async () => {
    const { useEffect } = await import('react');
    return { useVisibilityPolling: (callback: () => Promise<void>) => { m.poll = callback; useEffect(() => { void callback(); }, [callback]); } };
});
vi.mock('../marketing/AdContextModal', () => ({ AdContextModal: () => <p>Context editor</p> }));
import { AdSuggestionsWidget } from './AdSuggestionsWidget';
beforeEach(() => { m.account = { id: 'a' }; m.manage = false; m.fetch.mockReset(); vi.stubGlobal('fetch', m.fetch); });
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });
it('ignores old-account reads and serializes manual/poll requests', async () => {
    let resolve!: (value: unknown) => void; m.fetch.mockReturnValueOnce(new Promise(r => { resolve = r; })).mockResolvedValue({ ok: true, json: async () => ({ suggestions: ['New account advice'], action_items: [] }) });
    const view = render(<MemoryRouter><AdSuggestionsWidget /></MemoryRouter>); await act(async () => { await m.poll?.(); }); expect(m.fetch).toHaveBeenCalledOnce();
    m.account = { id: 'b' }; view.rerender(<MemoryRouter><AdSuggestionsWidget /></MemoryRouter>); await screen.findByText('New account advice');
    await act(async () => resolve({ ok: true, json: async () => ({ suggestions: ['Old account advice'], action_items: [] }) })); expect(screen.queryByText('Old account advice')).not.toBeInTheDocument(); expect(screen.queryByRole('button', { name: 'Add business context' })).not.toBeInTheDocument();
});
it('shows a new read error instead of retaining an earlier empty-state message', async () => {
    m.fetch.mockResolvedValueOnce({ ok: true, json: async () => ({ message: 'Earlier message', suggestions: [], action_items: [] }) }).mockResolvedValue({ ok: false });
    render(<MemoryRouter><AdSuggestionsWidget /></MemoryRouter>); await screen.findByText('Earlier message');
    await act(async () => { await m.poll?.(); }); expect(screen.getByRole('alert')).toHaveTextContent('Failed to load suggestions'); expect(screen.queryByText('Earlier message')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Retry suggestions' }));
});
