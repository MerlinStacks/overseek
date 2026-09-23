import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DeliveryEstimatesSettingsPage } from './DeliveryEstimatesSettingsPage';
import { responseFixture } from '../components/settings/deliveryEstimates/fixtures.test-support';
import { readinessFixture } from '../components/settings/deliveryEstimates/launchFixtures.test-support';

let accountId = 'account-a';
let enabled = true;
let canView = true;
let canEdit = true;
let token = 'test-token';
let launchReadiness = readinessFixture();
vi.mock('../context/AccountContext', () => ({ useAccount: () => ({ currentAccount: { id: accountId } }) }));
vi.mock('../context/AuthContext', () => ({ useAuth: () => ({ token }) }));
vi.mock('../hooks/useAccountFeature', () => ({ useAccountFeature: () => enabled }));
vi.mock('../hooks/usePermissions', () => ({ usePermissions: () => ({ hasPermission: (key: string) => key === 'view_shipping' ? canView : canEdit }) }));
const fetchMock = vi.fn();
const syncFetchMock = vi.fn();
const ok = (data = responseFixture()) => ({ ok: true, json: async () => data });
const discovery = (status = 'available') => ({ ok: true, json: async () => ({ status, timezone: 'Australia/Sydney', warnings: ['Verify checkout rates'], methods: status === 'available' ? [
    { methodId: 'weight_based_shipping', instanceId: 9, zoneId: 1, zoneName: 'Australia', title: 'Standard', enabled: false, provider: 'weight_based', rateIdentityScope: 'method_instance', requiresRateVerification: true },
] : [] }) });

describe('Delivery estimates settings', () => {
    beforeEach(() => {
        accountId = 'account-a'; enabled = true; canView = true; canEdit = true; token = 'test-token';
        launchReadiness = readinessFixture();
        fetchMock.mockReset(); fetchMock.mockResolvedValue(ok());
        syncFetchMock.mockReset();
        syncFetchMock.mockResolvedValue({ ok: true, json: async () => ({ status: { configurationSync: 'not_requested', storefrontActivated: false, pendingCount: 0, syncedCount: 0, lastAcknowledgedAt: null, lastError: null } }) });
        vi.stubGlobal('fetch', (url: string, options: RequestInit) => url === '/api/delivery-estimates/readiness'
            ? Promise.resolve({ ok: true, json: async () => launchReadiness })
            : url === '/api/delivery-estimates/receipts/legacy'
            ? Promise.resolve({ ok: true, json: async () => ({ jobs: [], nextCursor: null }) })
            : url === '/api/delivery-estimates/receipts'
            ? Promise.resolve({ ok: true, json: async () => ({ receipts: [], legacyJobs: [], nextCursor: null }) })
            : url === '/api/delivery-estimates/sync'
            ? syncFetchMock(url, options)
            : fetchMock(url, options));
    });
    afterEach(() => vi.unstubAllGlobals());

    it('connects dirty and save revision state to launch setup while keeping disable available', async () => {
        launchReadiness = readinessFixture({ ready: true, mode: 'GUARDED', cutoverState: 'guarded', blockers: [] });
        render(<DeliveryEstimatesSettingsPage />);
        const cutoff = await screen.findByLabelText('Daily cutoff');
        const activate = screen.getByRole('button', { name: 'Activate storefront estimates' });
        await waitFor(() => expect(activate).toBeEnabled());
        fireEvent.change(cutoff, { target: { value: '18:00' } });
        expect(activate).toBeDisabled();
        expect(screen.getByRole('button', { name: 'Disable storefront estimates' })).toBeEnabled();
        launchReadiness = readinessFixture({ blockers: ['inputs_pending'], revalidationRequested: true, desiredActive: true });
        fireEvent.click(screen.getByRole('button', { name: 'Save delivery settings' }));
        await screen.findByText(/Settings saved in Overseek/);
        await screen.findByText(/Publishing settings \/ revalidating/);
        expect(activate).toBeDisabled();
        expect(screen.getByRole('button', { name: 'Disable storefront estimates' })).toBeEnabled();
    });

    it('discovers explicitly, preserves unsaved fields, imports disabled rows and saves only settings metadata', async () => {
        render(<DeliveryEstimatesSettingsPage />);
        fireEvent.change(await screen.findByLabelText('Daily cutoff'), { target: { value: '18:00' } });
        expect(fetchMock).toHaveBeenCalledTimes(1);
        fetchMock.mockResolvedValueOnce(discovery());
        fireEvent.click(screen.getByRole('button', { name: 'Refresh from WooCommerce' }));
        expect(await screen.findByText(/Timezone mismatch/)).toHaveTextContent('Australia/Sydney');
        expect(screen.getByText(/Rate verification required/)).toBeInTheDocument();
        expect(fetchMock.mock.calls[1][0]).toBe('/api/delivery-estimates/shipping-methods');
        expect(fetchMock.mock.calls[1][1].headers).toEqual({ Authorization: 'Bearer test-token', 'X-Account-ID': 'account-a' });
        fireEvent.click(screen.getByRole('button', { name: 'Import discovered methods into draft' }));
        expect(screen.getByLabelText('Daily cutoff')).toHaveValue('18:00');
        expect(screen.getByLabelText('Enable row 2')).not.toBeChecked();
        expect(screen.getByLabelText('Enable row 2')).toBeDisabled();
        expect(screen.getByText(/Unconfigured: 0 days/)).toBeInTheDocument();
        expect(screen.getByText(/Missing from latest/)).toBeInTheDocument();
        expect(screen.getByText(/Disabled in WooCommerce — review/)).toBeInTheDocument();
        expect(fetchMock).toHaveBeenCalledTimes(2);
        fireEvent.change(screen.getByLabelText('Row 2 maximum transit days'), { target: { value: '5' } });
        fireEvent.click(screen.getByRole('button', { name: 'Confirm transit configuration for row 2' }));
        expect(screen.getByLabelText('Enable row 2')).toBeEnabled();
        fetchMock.mockImplementationOnce(async (_url, options) => ok({ ...responseFixture(), settings: JSON.parse(options.body) }));
        fireEvent.click(screen.getByRole('button', { name: 'Save delivery settings' }));
        await screen.findByText(/Settings saved in Overseek/);
        const saved = JSON.parse(fetchMock.mock.calls[2][1].body);
        expect(saved.timezone).toBe('UTC');
        expect(saved.shippingMethods[1]).not.toHaveProperty('provider');
        expect(saved.shippingMethods[1]).not.toHaveProperty('requiresRateVerification');
        expect(saved.defaultMethod).toEqual(responseFixture().settings.defaultMethod);
    });

    it('allows read-only discovery but prevents import and editing', async () => {
        canEdit = false;
        render(<DeliveryEstimatesSettingsPage />);
        const refresh = await screen.findByRole('button', { name: 'Refresh from WooCommerce' });
        expect(refresh).toBeEnabled();
        fetchMock.mockResolvedValueOnce(discovery()); fireEvent.click(refresh);
        expect(await screen.findByRole('button', { name: 'Import discovered methods into draft' })).toBeDisabled();
        expect(screen.getByLabelText('Daily cutoff')).toBeDisabled();
    });

    it('distinguishes old plugin from real errors and can retry without losing the draft', async () => {
        render(<DeliveryEstimatesSettingsPage />);
        fireEvent.change(await screen.findByLabelText('Daily cutoff'), { target: { value: '18:00' } });
        fetchMock.mockResolvedValueOnce(discovery('plugin_update_required'));
        fireEvent.click(screen.getByRole('button', { name: 'Refresh from WooCommerce' }));
        await screen.findByText(/Shipping discovery requires a newer/);
        for (const status of [502, 503]) {
            fetchMock.mockResolvedValueOnce({ ok: false, status, json: async () => ({ error: `Remote error ${status}` }) });
            fireEvent.click(screen.getByRole('button', { name: 'Refresh from WooCommerce' }));
            expect(await screen.findByRole('alert')).toHaveTextContent(`Remote error ${status}`);
            expect(screen.queryByText(/Shipping discovery requires a newer/)).not.toBeInTheDocument();
            expect(screen.getByLabelText('Daily cutoff')).toHaveValue('18:00');
        }
    });

    it('aborts stale discovery on account switch and ignores its late result', async () => {
        const { rerender } = render(<DeliveryEstimatesSettingsPage />);
        await screen.findByLabelText('Daily cutoff');
        let finish!: (value: ReturnType<typeof discovery>) => void;
        fetchMock.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
        fireEvent.click(screen.getByRole('button', { name: 'Refresh from WooCommerce' }));
        const signal = fetchMock.mock.calls[1][1].signal;
        accountId = 'account-b'; rerender(<DeliveryEstimatesSettingsPage />);
        await screen.findByLabelText('Daily cutoff');
        expect(signal.aborted).toBe(true);
        await act(async () => finish(discovery()));
        expect(screen.queryByText(/Timezone mismatch/)).not.toBeInTheDocument();
        expect(screen.queryByRole('button', { name: 'Import discovered methods into draft' })).not.toBeInTheDocument();
    });

    it('preserves drafts across silent token refresh and saves with current credentials', async () => {
        const { rerender } = render(<DeliveryEstimatesSettingsPage />);
        fireEvent.change(await screen.findByLabelText('Daily cutoff'), { target: { value: '18:00' } });
        token = 'refreshed-token'; rerender(<DeliveryEstimatesSettingsPage />);
        expect(screen.getByLabelText('Daily cutoff')).toHaveValue('18:00');
        expect(fetchMock).toHaveBeenCalledTimes(1);
        fireEvent.click(screen.getByRole('button', { name: 'Save delivery settings' }));
        await screen.findByText(/Settings saved in Overseek/);
        expect(fetchMock.mock.calls[1][1].headers.Authorization).toBe('Bearer refreshed-token');
    });

    it('loads account-scoped settings and PUTs the full document, including calendars and collection mappings', async () => {
        render(<DeliveryEstimatesSettingsPage />);
        const cutoff = await screen.findByLabelText('Daily cutoff');
        expect(fetchMock.mock.calls[0][1].headers['X-Account-ID']).toBe('account-a');
        fireEvent.change(cutoff, { target: { value: '15:30' } });
        const work = screen.getByRole('group', { name: 'Production / work days' });
        fireEvent.click(within(work).getByLabelText('Sunday'));
        fireEvent.click(screen.getByRole('button', { name: 'Add closure' }));
        fireEvent.change(screen.getByLabelText('Closure 1 date'), { target: { value: '2028-02-29' } });
        fireEvent.change(screen.getByLabelText('Closure 1 scope'), { target: { value: 'work' } });
        fireEvent.change(screen.getByLabelText('Fulfilment'), { target: { value: 'collection' } });
        fetchMock.mockImplementationOnce(async (_url, options) => ok({ ...responseFixture(), settings: JSON.parse(options.body) }));
        fireEvent.click(screen.getByRole('button', { name: 'Save delivery settings' }));
        await screen.findByText(/Settings saved in Overseek/);
        const request = fetchMock.mock.calls[1][1];
        expect(request.method).toBe('PUT');
        expect(JSON.parse(request.body)).toEqual({ ...responseFixture().settings, cutoffTime: '15:30', productionWeekdays: [0, 1, 2, 3, 4, 5],
            closures: [{ date: '2028-02-29', scope: 'work' }], shippingMethods: [{ ...responseFixture().settings.shippingMethods[0], fulfilmentType: 'collection' }] });
        expect(screen.getByText('Storefront activation is explicit')).toBeInTheDocument();
    });

    it('allows disabled-state sync but does not load settings when disabled or denied; view-only users cannot edit', async () => {
        enabled = false;
        const { rerender } = render(<DeliveryEstimatesSettingsPage />);
        expect(screen.getByRole('alert')).toHaveTextContent('disabled'); expect(fetchMock).not.toHaveBeenCalled();
        await screen.findByText(/Not requested/);
        fireEvent.click(screen.getByRole('button', { name: 'Sync saved settings and production times' }));
        await screen.findByText(/Sync request queued/);
        expect(syncFetchMock.mock.calls[1][1].method).toBe('POST');
        syncFetchMock.mockClear();
        enabled = true; canView = false; canEdit = false; rerender(<DeliveryEstimatesSettingsPage />);
        expect(screen.getByRole('alert')).toHaveTextContent('permission'); expect(fetchMock).not.toHaveBeenCalled();
        expect(syncFetchMock).not.toHaveBeenCalled();
        canView = true; canEdit = false; rerender(<DeliveryEstimatesSettingsPage />);
        expect(await screen.findByLabelText('Daily cutoff')).toBeDisabled();
        expect(screen.getByRole('button', { name: 'Add closure' })).toBeDisabled();
        expect(screen.queryByRole('button', { name: 'Save delivery settings' })).not.toBeInTheDocument();
        expect(screen.queryByRole('button', { name: 'Sync saved settings and production times' })).not.toBeInTheDocument();
    });

    it('keeps authorized recovery reachable without granting settings-read access', async () => {
        canView = false; enabled = false;
        render(<DeliveryEstimatesSettingsPage />);
        expect(screen.getByRole('button', { name: 'Disable storefront estimates' })).toBeEnabled();
        expect(screen.getByText(/Readiness and settings require view_shipping/)).toBeInTheDocument();
        expect(screen.queryByRole('button', { name: 'Save delivery settings' })).not.toBeInTheDocument();
        await screen.findByText('No receipt operations on this page.');
        expect(fetchMock).not.toHaveBeenCalled();
    });

    it('connects dirty settings to save-first sync messaging and enables sync after saving', async () => {
        render(<DeliveryEstimatesSettingsPage />);
        fireEvent.change(await screen.findByLabelText('Daily cutoff'), { target: { value: '18:00' } });
        await within(screen.getByRole('region', { name: 'Settings and production sync readiness' })).findByText(/save delivery settings first/);
        const sync = screen.getByRole('button', { name: 'Sync saved settings and production times' });
        expect(sync).toBeDisabled();
        fireEvent.click(sync);
        expect(syncFetchMock.mock.calls.every(([, options]) => options.method === 'GET')).toBe(true);
        fetchMock.mockImplementationOnce(async (_url, options) => ok({ ...responseFixture(), settings: JSON.parse(options.body) }));
        fireEvent.click(screen.getByRole('button', { name: 'Save delivery settings' }));
        await screen.findByText(/Settings saved in Overseek/);
        expect(screen.queryByText(/save delivery settings first/)).not.toBeInTheDocument();
        await waitFor(() => expect(sync).toBeEnabled());
    });

    it('discards a late account load and does not expose the old account draft', async () => {
        let resolveOld!: (value: ReturnType<typeof ok>) => void;
        fetchMock.mockImplementationOnce(() => new Promise(resolve => { resolveOld = resolve; }));
        const { rerender } = render(<DeliveryEstimatesSettingsPage />);
        const oldSignal = fetchMock.mock.calls[0][1].signal;
        accountId = 'account-b'; rerender(<DeliveryEstimatesSettingsPage />);
        expect(await screen.findByLabelText('Daily cutoff')).toHaveValue('14:00');
        expect(oldSignal.aborted).toBe(true);
        const oldData = responseFixture(); oldData.settings.cutoffTime = '01:00';
        await act(async () => resolveOld(ok(oldData)));
        expect(screen.getByLabelText('Daily cutoff')).toHaveValue('14:00');
        expect(fetchMock.mock.calls[1][1].headers['X-Account-ID']).toBe('account-b');
    });

    it.each([false, true])('invalidates synced status after saving and reloads once (account switch: %s)', async switchAccount => {
        const syncResponse = (configurationSync: string) => ({ ok: true, json: async () => ({ status: {
            configurationSync, storefrontActivated: false, pendingCount: configurationSync === 'pending' ? 1 : 0,
            syncedCount: 2, lastAcknowledgedAt: '2026-09-21T12:00:00Z', lastError: null,
        } }) });
        syncFetchMock.mockResolvedValueOnce(syncResponse('synced'));
        const { rerender } = render(<DeliveryEstimatesSettingsPage />);
        await screen.findByText(/configuration acknowledged by the plugin/);
        fireEvent.change(screen.getByLabelText('Daily cutoff'), { target: { value: '18:00' } });
        expect(syncFetchMock).toHaveBeenCalledTimes(1);
        let finishRefresh!: (value: ReturnType<typeof syncResponse>) => void;
        syncFetchMock.mockImplementationOnce(() => new Promise(resolve => { finishRefresh = resolve; }));
        fetchMock.mockImplementationOnce(async (_url, options) => ok({ ...responseFixture(), settings: JSON.parse(options.body) }));
        fireEvent.click(screen.getByRole('button', { name: 'Save delivery settings' }));
        await screen.findByText(/Settings saved in Overseek/);
        expect(screen.queryByText(/configuration acknowledged by the plugin/)).not.toBeInTheDocument();
        expect(screen.getByText('Loading sync status…')).toBeInTheDocument();
        expect(syncFetchMock).toHaveBeenCalledTimes(2);
        expect(syncFetchMock.mock.calls[1][1]).toMatchObject({ method: 'GET', headers: { 'X-Account-ID': 'account-a' } });
        const signal = syncFetchMock.mock.calls[1][1].signal;
        // Further edits remain a draft while the status reload is in flight.
        fireEvent.change(screen.getByLabelText('Daily cutoff'), { target: { value: '19:00' } });
        if (switchAccount) {
            accountId = 'account-b'; rerender(<DeliveryEstimatesSettingsPage />);
            await screen.findByText(/Not requested/);
            expect(signal.aborted).toBe(true);
        }
        await act(async () => finishRefresh(syncResponse('pending')));
        if (switchAccount) {
            expect(screen.queryByText(/Pending — saved inputs/)).not.toBeInTheDocument();
            expect(screen.getByLabelText('Daily cutoff')).toHaveValue('14:00');
        } else {
            expect(screen.getByText(/Pending — saved inputs/)).toBeInTheDocument();
            expect(screen.getByText('Pending inputs: 1 · Synced inputs: 2')).toBeInTheDocument();
            expect(screen.getByLabelText('Daily cutoff')).toHaveValue('19:00');
            expect(within(screen.getByRole('region', { name: 'Settings and production sync readiness' })).getByText(/save delivery settings first/)).toBeInTheDocument();
        }
        expect(syncFetchMock).toHaveBeenCalledTimes(switchAccount ? 3 : 2);
    });

    it('ignores a late save after switching accounts and loads the new account', async () => {
        const { rerender } = render(<DeliveryEstimatesSettingsPage />);
        fireEvent.change(await screen.findByLabelText('Daily cutoff'), { target: { value: '18:00' } });
        let finishSave!: (value: ReturnType<typeof ok>) => void;
        fetchMock.mockImplementationOnce(() => new Promise(resolve => { finishSave = resolve; }));
        fireEvent.click(screen.getByRole('button', { name: 'Save delivery settings' }));
        expect(screen.getByLabelText('Daily cutoff')).toBeDisabled();
        accountId = 'account-b'; rerender(<DeliveryEstimatesSettingsPage />);
        expect(await screen.findByLabelText('Daily cutoff')).toHaveValue('14:00');
        await act(async () => finishSave(ok()));
        expect(screen.queryByText(/Settings saved in Overseek/)).not.toBeInTheDocument();
    });

    it('retries failed loads and retains edits on save failure', async () => {
        fetchMock.mockRejectedValueOnce(new Error('Network unavailable'));
        render(<DeliveryEstimatesSettingsPage />);
        expect(await screen.findByRole('alert')).toHaveTextContent('Network unavailable');
        fireEvent.click(screen.getByRole('button', { name: 'Retry loading' }));
        fireEvent.change(await screen.findByLabelText('Daily cutoff'), { target: { value: '16:00' } });
        fetchMock.mockResolvedValueOnce({ ok: false, status: 400, json: async () => ({ error: 'Invalid settings', issues: [{ path: ['timezone'], message: 'Invalid timezone' }] }) });
        fireEvent.click(screen.getByRole('button', { name: 'Save delivery settings' }));
        expect(await screen.findByRole('alert')).toHaveTextContent('timezone: Invalid timezone');
        expect(screen.getByLabelText('Daily cutoff')).toHaveValue('16:00');
        await waitFor(() => expect(screen.getByRole('button', { name: 'Save delivery settings' })).toBeEnabled());
    });

    it('blocks invalid defaults and handles feature disable during save', async () => {
        render(<DeliveryEstimatesSettingsPage />);
        fireEvent.click(await screen.findByLabelText('Enable row 1'));
        fireEvent.click(screen.getByRole('button', { name: 'Save delivery settings' }));
        expect(await screen.findByRole('alert')).toHaveTextContent('Default method is unavailable');
        expect(fetchMock).toHaveBeenCalledTimes(1);
        fireEvent.change(screen.getByLabelText('Default product-page method'), { target: { value: '' } });
        fetchMock.mockResolvedValueOnce({ ok: false, status: 403, json: async () => ({ error: 'Disabled', code: 'FEATURE_DISABLED' }) });
        fireEvent.click(screen.getByRole('button', { name: 'Save delivery settings' }));
        expect(await screen.findByRole('alert')).toHaveTextContent('were disabled');
        expect(screen.getByRole('button', { name: 'Save delivery settings' })).toBeDisabled();
        expect(screen.getByLabelText('Daily cutoff')).toBeDisabled();
    });
});
