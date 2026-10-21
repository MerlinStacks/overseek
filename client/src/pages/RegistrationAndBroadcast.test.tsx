import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
const m = vi.hoisted(() => ({ token: null as string | null, user: null as { id: string; isSuperAdmin: boolean } | null, login: vi.fn(), fetch: vi.fn() }));
vi.mock('../context/AuthContext', () => ({ useAuth: () => ({ token: m.token, user: m.user, login: m.login }) }));
import { RegisterPage } from './RegisterPage';
import { AdminBroadcastPage } from './admin/AdminBroadcastPage';
beforeEach(() => { vi.resetAllMocks(); m.token = null; m.user = null; localStorage.clear(); vi.stubGlobal('fetch', m.fetch); vi.stubGlobal('confirm', vi.fn(() => true)); });
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });
function registration() {
    render(<MemoryRouter><RegisterPage /></MemoryRouter>);
    fireEvent.change(screen.getByLabelText('Full Name'), { target: { value: 'Test Person' } }); fireEvent.change(screen.getByLabelText('Email address'), { target: { value: 'test@example.test' } }); fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'password123' } });
}
function broadcast() {
    m.token = 'token'; m.user = { id: 'admin', isSuperAdmin: true }; const view = render(<AdminBroadcastPage />);
    fireEvent.change(screen.getByLabelText('Title'), { target: { value: 'Notice' } }); fireEvent.change(screen.getByLabelText('Message'), { target: { value: 'Details' } }); return view;
}
describe('registration lifecycle', () => {
    it('guards duplicate submits and refuses malformed auth data', async () => {
        let resolve!: (value: unknown) => void; m.fetch.mockReturnValue(new Promise(r => { resolve = r; })); registration();
        const button = screen.getByRole('button', { name: 'Register' }); fireEvent.click(button); fireEvent.click(button); expect(m.fetch).toHaveBeenCalledOnce();
        await act(async () => { resolve({ ok: true, json: async () => ({ token: 'token', user: {} }) }); }); await screen.findByRole('alert'); expect(m.login).not.toHaveBeenCalled(); expect(screen.getByLabelText('Full Name')).toHaveValue('Test Person');
    });
    it('does not sign in from a late response after unmount', async () => {
        let resolve!: (value: unknown) => void; m.fetch.mockReturnValue(new Promise(r => { resolve = r; })); registration(); fireEvent.click(screen.getByRole('button', { name: 'Register' })); const signal = m.fetch.mock.calls[0][1].signal;
        cleanup(); await act(async () => { resolve({ ok: true, json: async () => ({ token: 'token', refreshToken: 'refresh', user: { id: 'u', email: 'test@example.test', fullName: 'Test Person' } }) }); }); expect(signal.aborted).toBe(true); expect(m.login).not.toHaveBeenCalled();
    });
    it('accepts a complete registration confirmation', async () => {
        const user = { id: 'u', email: 'test@example.test', fullName: 'Test Person' }; m.fetch.mockResolvedValue({ ok: true, json: async () => ({ token: 'new', refreshToken: 'refresh', user }) }); registration(); fireEvent.click(screen.getByRole('button', { name: 'Register' }));
        await act(async () => {}); expect(m.login).toHaveBeenCalledExactlyOnceWith('new', user, 'refresh');
    });
});
describe('global broadcast confirmation', () => {
    it('makes no request when confirmation is declined', () => {
        vi.stubGlobal('confirm', vi.fn(() => false)); broadcast(); fireEvent.click(screen.getByRole('button', { name: 'Send Broadcast' })); expect(m.fetch).not.toHaveBeenCalled();
    });
    it('locks submitted inputs, guards duplicate sends, validates results and retains failed drafts', async () => {
        let resolve!: (value: unknown) => void; m.fetch.mockReturnValue(new Promise(r => { resolve = r; })); broadcast(); const button = screen.getByRole('button', { name: 'Send Broadcast' }); fireEvent.click(button); fireEvent.click(button);
        expect(m.fetch).toHaveBeenCalledOnce(); expect(screen.getByLabelText('Title')).toBeDisabled();
        await act(async () => { resolve({ ok: true, json: async () => ({ success: true, count: 'bad' }) }); }); expect(screen.getByRole('alert')).toHaveTextContent('may have been sent'); expect(screen.getByLabelText('Title')).toHaveValue('Notice');
    });
    it('reports measured account/push counts and clears only confirmed drafts', async () => {
        m.fetch.mockResolvedValue({ ok: true, json: async () => ({ success: true, count: 0, pushSent: 0, pushFailed: 0 }) }); broadcast(); fireEvent.click(screen.getByRole('checkbox')); fireEvent.click(screen.getByRole('button', { name: 'Send Broadcast' }));
        await screen.findByText('Successfully sent to 0 accounts. Push: 0 sent, 0 failed.'); expect(screen.getByLabelText('Title')).toHaveValue('');
    });
    it('aborts a send if admin authentication changes', async () => {
        m.fetch.mockReturnValue(new Promise(() => {})); const view = broadcast(); fireEvent.click(screen.getByRole('button', { name: 'Send Broadcast' })); const signal = m.fetch.mock.calls[0][1].signal;
        m.token = null; m.user = null; view.rerender(<AdminBroadcastPage />); expect(signal.aborted).toBe(true);
    });
});
