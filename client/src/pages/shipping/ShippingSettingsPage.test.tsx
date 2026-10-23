import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, expect, it, vi } from 'vitest';
const m = vi.hoisted(() => ({ accountId: 'a' }));
vi.mock('../../context/AuthContext', () => ({ useAuth: () => ({ token: 't', user: { id: 'u' } }) }));
vi.mock('../../context/AccountContext', () => ({ useAccount: () => ({ currentAccount: { id: m.accountId } }) }));
vi.mock('../../hooks/usePermissions', () => ({ usePermissions: () => ({ hasPermission: () => true }) }));
import { ShippingSettingsPage } from './ShippingSettingsPage';
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); m.accountId = 'a'; });
it('opens only passive reads, resets secrets on scope changes and never defaults tracking opt-in', async () => {
    const fetch = vi.fn().mockImplementation(async (url: string) => new Response(JSON.stringify(url.includes('stations') ? { accountId: m.accountId, printStations: [], partial: false } : url.includes('policy') ? { accountId: m.accountId, carrierAccount: null } : { accountId: m.accountId, carrierAccount: null, credentialsConfigured: false }), { headers: { 'content-type': 'application/json' } }));
    vi.stubGlobal('fetch', fetch);
    const view = render(<MemoryRouter><ShippingSettingsPage /></MemoryRouter>);
    const key = await screen.findByLabelText('New API key');
    fireEvent.change(key, { target: { value: 'do-not-carry' } });
    expect(screen.getByLabelText(/trackingSyncEnabled/)).not.toBeChecked();
    expect(fetch.mock.calls.every(([, options]) => !options?.method || options.method === 'GET')).toBe(true);
    expect(fetch.mock.calls.some(([url]) => url.includes('auspost-service-catalog'))).toBe(false);
    m.accountId = 'b'; view.rerender(<MemoryRouter><ShippingSettingsPage /></MemoryRouter>);
    expect(await screen.findByLabelText('New API key')).toHaveValue('');
});

it('groups settings without omitting advanced fields or enabling carrier actions on an unsaved draft', async () => {
    const fetch = vi.fn().mockImplementation(async (url: string) => new Response(JSON.stringify(url.includes('stations') ? { accountId: 'a', printStations: [], partial: false } : url.includes('policy') ? { accountId: 'a', carrierAccount: null } : { accountId: 'a', carrierAccount: null, credentialsConfigured: false }), { headers: { 'content-type': 'application/json' } }));
    vi.stubGlobal('fetch', fetch);
    render(<MemoryRouter><ShippingSettingsPage /></MemoryRouter>);
    await screen.findByLabelText('New API key');
    for (const name of ['Carrier connection', 'Dispatch and services', 'Labels and fulfillment', 'Tracking', 'Sender']) {
        expect(screen.getByRole('heading', { name })).toBeInTheDocument();
    }
    const advanced = screen.getByText('Advanced endpoints and automation').closest('details')!;
    expect(advanced).not.toHaveAttribute('open');
    fireEvent.click(screen.getByText('Advanced endpoints and automation'));
    expect(screen.getByLabelText('apiBaseUrl')).toBeVisible();
    expect(screen.getByLabelText('trackingEndpointPath')).toBeVisible();
    expect(screen.getByLabelText('wooFulfillmentBehavior')).toHaveValue('keep_in_dispatch');
    expect(screen.getByLabelText('trackingSyncEnabled')).not.toBeChecked();
    fireEvent.change(screen.getByLabelText('Display name'), { target: { value: 'Unsaved draft' } });
    expect(screen.getByRole('button', { name: 'Save reviewed settings' })).toHaveClass('bg-indigo-600');
    expect(screen.getByRole('button', { name: 'Review saved-credential test' })).toBeDisabled();
    expect(fetch.mock.calls.every(([, options]) => !options?.method || options.method === 'GET')).toBe(true);
});
