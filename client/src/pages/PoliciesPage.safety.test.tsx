import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
const m = vi.hoisted(() => ({ account: { id: 'a' }, manage: true, fetch: vi.fn() }));
vi.mock('../context/AuthContext', () => ({ useAuth: () => ({ user: { id: 'u' }, token: 't' }) }));
vi.mock('../context/AccountContext', () => ({ useAccount: () => ({ currentAccount: m.account }) }));
vi.mock('../hooks/usePermissions', () => ({ usePermissions: () => ({ hasPermission: (key: string) => key === 'view_policies' || m.manage }) }));
import { PoliciesPage } from './PoliciesPage';
const row = { id: 'p', title: 'Document A', content: 'Content', type: 'POLICY', category: null, isPublished: true, updatedAt: '2026-10-01T00:00:00.000Z' };
beforeEach(() => { m.account = { id: 'a' }; m.manage = true; m.fetch.mockReset(); vi.stubGlobal('fetch', m.fetch); vi.spyOn(window, 'confirm').mockReturnValue(true); m.fetch.mockImplementation(async (url: string) => ({ ok: true, json: async () => url.includes('ai-prompts') ? [] : { items: [row], nextCursor: null } })); });
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });
it('serializes versioned writes and retains local edits after ambiguous acknowledgement', async () => {
    render(<PoliciesPage />); fireEvent.click(await screen.findByText('Document A')); fireEvent.change(screen.getByLabelText('Title'), { target: { value: 'Edited' } });
    let resolve!: (value: unknown) => void; m.fetch.mockReturnValueOnce(new Promise(r => { resolve = r; })); fireEvent.click(screen.getByRole('button', { name: 'Save' })); fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    const writes = m.fetch.mock.calls.filter(([, options]) => options.method === 'PUT'); expect(writes).toHaveLength(1); expect(JSON.parse(writes[0][1].body).version).toBe(row.updatedAt);
    await act(async () => resolve({ ok: false, json: async () => ({ error: 'conflict' }) })); expect(screen.getByRole('alert')).toHaveTextContent('Local edits remain'); expect(screen.getByLabelText('Title')).toHaveValue('Edited'); expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled();
});
it('clears selection/drafts on account change and ignores late mutation callbacks', async () => {
    const view = render(<PoliciesPage />); fireEvent.click(await screen.findByText('Document A')); fireEvent.change(screen.getByLabelText('Title'), { target: { value: 'Old account edit' } });
    let resolve!: (value: unknown) => void; m.fetch.mockReturnValueOnce(new Promise(r => { resolve = r; })); fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    m.account = { id: 'b' }; view.rerender(<PoliciesPage />); await act(async () => resolve({ ok: true, json: async () => row })); expect(screen.queryByDisplayValue('Old account edit')).not.toBeInTheDocument(); expect(screen.getByText('Select a document or prompt.')).toBeInTheDocument();
});
it('does not offer mutation controls without management permission', async () => { m.manage = false; render(<PoliciesPage />); fireEvent.click(await screen.findByText('Document A')); expect(screen.queryByRole('button', { name: 'Save' })).not.toBeInTheDocument(); expect(screen.getByLabelText('Title')).toBeDisabled(); });
