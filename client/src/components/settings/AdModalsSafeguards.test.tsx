import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
const m = vi.hoisted(() => ({ account: { id: 'a' }, navigate: vi.fn(() => true) }));
vi.mock('../../context/AuthContext', () => ({ useAuth: () => ({ token: 'token' }) }));
vi.mock('../../context/AccountContext', () => ({ useAccount: () => ({ currentAccount: m.account }) }));
vi.mock('../../hooks/useAccountFeature', () => ({ useAccountFeature: () => true }));
vi.mock('../../utils/url', () => ({ navigateToSafeUrl: m.navigate }));
import { EditAdAccountModal, PendingSetupModal } from './AdAccountModals';
import { AdAccountSettings } from './AdAccountSettings';
const account = { id: 'ad', name: 'Private connection', platform: 'GOOGLE', externalId: '1234567890' };
const response = (data: unknown, ok = true) => ({ ok, json: async () => data });
beforeEach(() => { m.account = { id: 'a' }; vi.resetAllMocks(); });
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });
describe('ad-account modal validation', () => {
    it('locks fields and cancellation during edits', () => {
        render(<EditAdAccountModal account={account} form={{ name: 'Name', externalId: '1234567890', accessToken: '', refreshToken: '' }} onFormChange={vi.fn()} onClose={vi.fn()} onSave={vi.fn()} isSaving />);
        expect(screen.getByLabelText('Account Name')).toBeDisabled(); expect(screen.getByRole('button', { name: 'Cancel' })).toBeDisabled();
    });
    it('rejects nonblank invalid customer IDs and requires the pending account identity', () => {
        const view = render(<PendingSetupModal isOpen pendingId="pending" customerId="123" isSubmitting={false} onCustomerIdChange={vi.fn()} onClose={vi.fn()} onComplete={vi.fn()} onCancel={vi.fn()} />); expect(screen.getByRole('button', { name: 'Complete Setup' })).toBeDisabled();
        view.rerender(<PendingSetupModal isOpen pendingId="" customerId="123-456-7890" isSubmitting={false} onCustomerIdChange={vi.fn()} onClose={vi.fn()} onComplete={vi.fn()} onCancel={vi.fn()} />); expect(screen.getByRole('button', { name: 'Complete Setup' })).toBeDisabled();
    });
});
describe('ad-account scope isolation', () => {
    it('aborts old reads and ignores late account lists', async () => {
        let resolve!: (value: unknown) => void; const fetch = vi.fn().mockReturnValueOnce(new Promise(r => { resolve = r; })).mockResolvedValue(response([])); vi.stubGlobal('fetch', fetch);
        const view = render(<AdAccountSettings />); await waitFor(() => expect(fetch).toHaveBeenCalledOnce()); const signal = fetch.mock.calls[0][1].signal;
        m.account = { id: 'b' }; view.rerender(<AdAccountSettings />); await act(async () => { resolve(response([account])); }); await screen.findByText('No ad accounts connected.'); expect(signal.aborted).toBe(true); expect(screen.queryByText('Private connection')).toBeNull();
    });
    it('aborts OAuth and never follows its late URL after switching accounts', async () => {
        let resolve!: (value: unknown) => void; const fetch = vi.fn((url: string) => url.startsWith('/api/oauth') ? new Promise(r => { resolve = r; }) : Promise.resolve(response(url === '/api/ads' ? [account] : { spend: 1, impressions: 1, clicks: 1, roas: 1, currency: 'EUR' }))); vi.stubGlobal('fetch', fetch);
        const view = render(<AdAccountSettings />); fireEvent.click(await screen.findByRole('button', { name: 'Reconnect Google Ads account' })); const signal = fetch.mock.calls.find(([url]) => url.startsWith('/api/oauth'))![1].signal;
        m.account = { id: 'b' }; view.rerender(<AdAccountSettings />); await act(async () => { resolve(response({ authUrl: 'https://accounts.google.com/auth' })); }); expect(signal.aborted).toBe(true); expect(m.navigate).not.toHaveBeenCalled();
    });
    it('shows retryable invalid-response errors rather than empty accounts', async () => {
        vi.stubGlobal('fetch', vi.fn().mockResolvedValue(response({ error: 'Invalid' }))); render(<AdAccountSettings />); await screen.findByRole('alert'); expect(screen.getByRole('button', { name: 'Retry accounts' })).toBeInTheDocument(); expect(screen.queryByText('No ad accounts connected.')).toBeNull();
    });
    it('serializes edits, locks dismissal, and retains credentials after failure', async () => {
        let resolve!: (value: unknown) => void;
        const fetch = vi.fn((url: string, options?: RequestInit) => options?.method === 'PATCH' ? new Promise(r => { resolve = r; }) : Promise.resolve(response(url === '/api/ads' ? [account] : { spend: 1, impressions: 1, clicks: 1, roas: 1, currency: 'EUR' }))); vi.stubGlobal('fetch', fetch);
        render(<AdAccountSettings />); fireEvent.click(await screen.findByRole('button', { name: 'Edit credentials' })); fireEvent.change(screen.getByLabelText('New Access Token (leave blank to keep current)'), { target: { value: 'private-token' } });
        const button = screen.getByRole('button', { name: 'Save Changes' }); fireEvent.click(button); fireEvent.click(button); expect(fetch.mock.calls.filter(([, options]) => options?.method === 'PATCH')).toHaveLength(1); expect(screen.getByRole('button', { name: 'Cancel' })).toBeDisabled();
        await act(async () => { resolve(response({ error: 'Rejected' }, false)); }); expect(within(screen.getByRole('dialog')).getByRole('alert')).toHaveTextContent('Input retained'); expect(screen.getByLabelText('New Access Token (leave blank to keep current)')).toHaveValue('private-token');
    });
    it('accepts the real complete-setup confirmation shape', async () => {
        const pending = { ...account, externalId: 'PENDING_SETUP' }; const fetch = vi.fn((_url: string, options?: RequestInit) => Promise.resolve(response(options?.method === 'PATCH' ? { success: true, message: 'Configured' } : [pending]))); vi.stubGlobal('fetch', fetch);
        render(<AdAccountSettings />); fireEvent.click(await screen.findByRole('button', { name: 'Complete Setup' })); fireEvent.change(screen.getByLabelText('Google Ads Customer ID'), { target: { value: '123-456-7890' } }); fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Complete Setup' }));
        await screen.findByText('Google Ads setup confirmed.'); expect(screen.queryByRole('dialog')).toBeNull();
    });
});
