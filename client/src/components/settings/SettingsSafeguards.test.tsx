import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
const m = vi.hoisted(() => ({ account: { id: 'a', name: 'Account A', currency: 'EUR', goldPriceMargin: 0, goldPrice18ct: null as number | null }, user: { id: 'user-a' }, fetch: vi.fn(), request: vi.fn(), refresh: vi.fn() }));
vi.mock('../../context/AccountContext', () => ({ useAccount: () => ({ currentAccount: m.account, refreshAccounts: m.refresh }) }));
vi.mock('../../context/AuthContext', () => ({ useAuth: () => ({ token: 'token', user: m.user }) }));
vi.mock('../../hooks/useAccountFeature', () => ({ useAccountFeature: () => true }));
vi.mock('../../services/api', () => ({ api: { request: m.request } }));
import { GoldPriceSettings } from './GoldPriceSettings';
import { TeamSettings } from './TeamSettings';
import { TrackingExclusionSettings } from './TrackingExclusionSettings';
import { SessionManager } from './SessionManager';
const response = (value: unknown) => ({ ok: true, json: async () => value });
beforeEach(() => { vi.resetAllMocks(); m.account = { id: 'a', name: 'Account A', currency: 'EUR', goldPriceMargin: 0, goldPrice18ct: null }; m.user = { id: 'user-a' }; m.refresh.mockResolvedValue(undefined); vi.stubGlobal('fetch', m.fetch); vi.stubGlobal('confirm', vi.fn(() => true)); });
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });
describe('gold settings', () => {
    it('distinguishes save actions from provider refresh and labels all controls without making requests', () => {
        render(<GoldPriceSettings />);
        expect(screen.getByRole('button', { name: 'Save All Prices' })).toHaveClass('bg-indigo-600');
        expect(screen.getByRole('button', { name: 'Save Margin' })).toHaveClass('border-slate-200');
        expect(screen.getByRole('button', { name: 'Refresh from Market' })).toHaveClass('border-slate-200');
        expect(screen.getByText(/Refresh from Market requests a provider refresh/)).toBeInTheDocument();
        expect(screen.getByLabelText('18ct Gold Price')).toHaveClass('focus:ring-2');
        screen.getAllByRole('button').forEach(button => expect(button).toHaveAttribute('type', 'button'));
        expect(m.fetch).not.toHaveBeenCalled();
    });
    it('does not refresh account context after an old-account save resolves late', async () => {
        let resolve!: (value: unknown) => void; m.fetch.mockReturnValueOnce(new Promise(r => { resolve = r; }));
        const view = render(<GoldPriceSettings />); fireEvent.click(screen.getByRole('button', { name: 'Save Margin' }));
        m.account = { ...m.account, id: 'b' }; view.rerender(<GoldPriceSettings />);
        await act(async () => { resolve({ ok: true }); }); expect(m.refresh).not.toHaveBeenCalled();
    });
    it('distinguishes missing rates from zero, validates changed values, and sends explicit zero', async () => {
        m.fetch.mockResolvedValue({ ok: true }); render(<GoldPriceSettings />);
        expect(screen.getByLabelText('18ct Gold Price')).toHaveValue(null); expect(screen.getByLabelText('Margin (%)')).toHaveValue(0);
        fireEvent.change(screen.getByLabelText('18ct Gold Price'), { target: { value: '-2' } }); fireEvent.click(screen.getByRole('button', { name: 'Save All Prices' })); expect(screen.getByRole('alert')).toHaveTextContent('nonnegative'); expect(m.fetch).not.toHaveBeenCalled();
        fireEvent.change(screen.getByLabelText('18ct Gold Price'), { target: { value: '0' } }); fireEvent.click(screen.getByRole('button', { name: 'Save All Prices' }));
        await screen.findByText('Gold price settings saved.'); expect(JSON.parse(m.fetch.mock.calls[0][1].body)).toEqual({ goldPrice18ct: '0' });
    });
    it('preserves failed drafts and prevents duplicate/concurrent save and refresh calls', async () => {
        let resolve!: (value: unknown) => void; m.fetch.mockReturnValueOnce(new Promise(r => { resolve = r; })); render(<GoldPriceSettings />);
        fireEvent.change(screen.getByLabelText('18ct Gold Price'), { target: { value: '10' } }); const save = screen.getByRole('button', { name: 'Save All Prices' }); fireEvent.click(save); fireEvent.click(save); fireEvent.click(screen.getByRole('button', { name: 'Refresh from Market' }));
        expect(m.fetch).toHaveBeenCalledOnce(); await act(async () => { resolve({ ok: false }); }); expect(screen.getByRole('alert')).toHaveTextContent('inputs are retained'); expect(screen.getByLabelText('18ct Gold Price')).toHaveValue(10);
    });
    it('aborts stale saves and resets fields when accounts change', async () => {
        m.fetch.mockReturnValue(new Promise(() => {})); const view = render(<GoldPriceSettings />); fireEvent.click(screen.getByRole('button', { name: 'Save Margin' })); const signal = m.fetch.mock.calls[0][1].signal;
        m.account = { ...m.account, id: 'b', goldPrice18ct: 33 }; view.rerender(<GoldPriceSettings />); expect(signal.aborted).toBe(true); expect(screen.getByLabelText('18ct Gold Price')).toHaveValue(33);
    });
    it('does not describe a callback refresh failure as a failed mutation', async () => {
        m.fetch.mockResolvedValue({ ok: true }); m.refresh.mockRejectedValue(new Error('Offline')); render(<GoldPriceSettings />); fireEvent.click(screen.getByRole('button', { name: 'Save Margin' }));
        await screen.findByText(/Update accepted, but account data/); expect(screen.queryByRole('alert')).toBeNull(); expect(JSON.parse(m.fetch.mock.calls[0][1].body)).toEqual({ goldPriceMargin: '0' });
    });
});
const member = { userId: 'staff', role: 'STAFF', roleId: null, maxRole: null, user: { fullName: 'Staff', email: 'staff@example.test' } };
function teamReads(url: string) { return Promise.resolve(response(url === '/api/roles' ? [{ id: 'role', name: 'Support' }] : [member])); }
describe('team changes', () => {
    it('retains members and shows feedback for rejected deletions', async () => {
        m.fetch.mockImplementation((url, options) => options.method === 'DELETE' ? Promise.resolve({ ok: false }) : teamReads(url)); render(<TeamSettings />);
        await screen.findByRole('rowheader', { name: /staff@example/ }); fireEvent.click(screen.getByRole('button', { name: 'Remove staff@example.test' }));
        await screen.findByRole('alert'); expect(screen.getByRole('rowheader', { name: /staff@example/ })).toBeInTheDocument();
    });
    it('serializes invitations and role changes', async () => {
        m.fetch.mockImplementation(teamReads); render(<TeamSettings />); await screen.findByRole('rowheader', { name: /staff@example/ });
        let resolve!: (value: unknown) => void; m.fetch.mockReturnValueOnce(new Promise(r => { resolve = r; })); fireEvent.change(screen.getByLabelText('Member email'), { target: { value: 'new@example.test' } });
        const add = screen.getByRole('button', { name: 'Add User' }); fireEvent.click(add); fireEvent.click(add); expect(screen.getByRole('button', { name: 'Edit role for staff@example.test' })).toBeDisabled();
        expect(m.fetch.mock.calls.filter(([, options]) => options.method === 'POST')).toHaveLength(1); await act(async () => { resolve({ ok: false }); }); expect(screen.getByLabelText('Member email')).toHaveValue('new@example.test');
    });
    it('does not expose old members or drafts in a newly selected account', async () => {
        m.fetch.mockImplementation(teamReads); const view = render(<TeamSettings />); await screen.findByRole('rowheader', { name: /staff@example/ }); fireEvent.change(screen.getByLabelText('Member email'), { target: { value: 'private@example.test' } });
        m.account = { ...m.account, id: 'b' }; m.fetch.mockResolvedValue(response([])); view.rerender(<TeamSettings />); expect(screen.queryByRole('rowheader', { name: /staff@example/ })).toBeNull();
        await screen.findByText('No team members found.'); expect(screen.getByLabelText('Member email')).toHaveValue('');
    });
    it('distinguishes failed member reads from an empty team and allows retry', async () => {
        m.fetch.mockResolvedValue({ ok: false }); render(<TeamSettings />); await screen.findByRole('alert'); expect(screen.queryByRole('button', { name: 'Add User' })).toBeNull();
        m.fetch.mockImplementation(teamReads); fireEvent.click(screen.getByRole('button', { name: 'Retry team' })); await screen.findByRole('rowheader', { name: /staff@example/ });
    });
});
describe('tracking exclusions', () => {
    it('rejects invalid manual addresses, preserves failed drafts, and leaves legacy entries removable', async () => {
        m.fetch.mockResolvedValueOnce(response({ excludedIps: ['999.0.0.1'] })).mockResolvedValue({ ok: false }); render(<TrackingExclusionSettings />);
        await screen.findByText('999.0.0.1'); expect(screen.getByRole('button', { name: 'Remove IP 999.0.0.1' })).toBeInTheDocument();
        fireEvent.change(screen.getByLabelText('IP address or CIDR range'), { target: { value: '10.0.0.1/99' } }); fireEvent.click(screen.getByRole('button', { name: 'Add IP' })); expect(m.fetch).toHaveBeenCalledOnce();
        fireEvent.change(screen.getByLabelText('IP address or CIDR range'), { target: { value: '::1' } }); fireEvent.click(screen.getByRole('button', { name: 'Add IP' })); await screen.findByText(/Could not confirm the exclusion update/); expect(screen.getByLabelText('IP address or CIDR range')).toHaveValue('::1');
    });
    it('never sends account authorization to the IP service and never posts a late detected IP after a scope change', async () => {
        let resolve!: (value: unknown) => void;
        m.fetch.mockImplementation((url: string) => url.startsWith('https:') ? new Promise(r => { resolve = r; }) : Promise.resolve(response({ excludedIps: [] })));
        const view = render(<TrackingExclusionSettings />); await screen.findByText('No excluded IPs.'); fireEvent.click(screen.getByRole('button', { name: 'Add My IP' }));
        const options = m.fetch.mock.calls[1][1]; expect(options.headers).toBeUndefined(); m.account = { ...m.account, id: 'b' }; view.rerender(<TrackingExclusionSettings />);
        await act(async () => { resolve(response({ ip: '127.0.0.1' })); }); expect(options.signal.aborted).toBe(true); expect(m.fetch.mock.calls.some(([, init]) => init.method === 'POST')).toBe(false);
    });
    it('rejects malformed detection output instead of posting it', async () => {
        m.fetch.mockResolvedValueOnce(response({ excludedIps: [] })).mockResolvedValueOnce(response({ ip: {} })); render(<TrackingExclusionSettings />); await screen.findByText('No excluded IPs.');
        fireEvent.click(screen.getByRole('button', { name: 'Add My IP' })); await screen.findByRole('alert'); expect(m.fetch).toHaveBeenCalledTimes(2);
    });
});
const sessions = [{ id: 'current', createdAt: 'bad', expiresAt: 'bad', ipAddress: '1.1.1.1', userAgent: 'Chrome Safari Edg/100', isCurrent: true }, { id: 'other', createdAt: '2026-10-01', expiresAt: '2027-10-01', ipAddress: '2.2.2.2', userAgent: null, isCurrent: false }];
describe('session ownership and revocation', () => {
    it('renders safe dates and serializes bulk/individual revocation without hiding failures', async () => {
        m.request.mockResolvedValueOnce(sessions); render(<SessionManager />); await screen.findByText(/Edge Browser/); expect(screen.getByText('Signed in: Date unavailable')).toBeInTheDocument();
        let reject!: (reason: Error) => void; m.request.mockReturnValueOnce(new Promise((_, r) => { reject = r; })); fireEvent.click(screen.getByRole('button', { name: 'Revoke session 2.2.2.2' }));
        expect(screen.getByRole('button', { name: 'Revoke Other Sessions' })).toBeDisabled(); await act(async () => { reject(new Error('Failed')); }); expect(screen.getByRole('alert')).toHaveTextContent('Could not revoke'); expect(screen.getByText('IP: 2.2.2.2')).toBeInTheDocument();
    });
    it('aborts old user reads and does not show their devices after an auth change', async () => {
        let resolve!: (value: unknown) => void; m.request.mockReturnValueOnce(new Promise(r => { resolve = r; })); const view = render(<SessionManager />);
        await waitFor(() => expect(m.request).toHaveBeenCalledOnce()); const signal = m.request.mock.calls[0][1].signal;
        m.user = { id: 'user-b' }; m.request.mockResolvedValue([]); view.rerender(<SessionManager />); await screen.findByText('No active sessions found.');
        await act(async () => { resolve(sessions); }); expect(signal.aborted).toBe(true); expect(screen.queryByText('IP: 2.2.2.2')).toBeNull();
    });
    it('shows read failures with retry rather than claiming there are no sessions', async () => {
        m.request.mockRejectedValueOnce(new Error('Offline')).mockResolvedValue(sessions); render(<SessionManager />); await screen.findByRole('alert'); expect(screen.queryByText('No active sessions found.')).toBeNull();
        fireEvent.click(screen.getByRole('button', { name: 'Retry sessions' })); await screen.findByText('IP: 2.2.2.2');
    });
});
