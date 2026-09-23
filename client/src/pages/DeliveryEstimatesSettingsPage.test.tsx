import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
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

    it('shows only the selected panel while keeping every panel mounted', async () => {
        render(<DeliveryEstimatesSettingsPage />);
        await screen.findByLabelText('Daily cutoff');
        const tabs = within(screen.getByRole('tablist', { name: 'Delivery estimate settings' })).getAllByRole('tab');
        expect(tabs.map(tab => tab.textContent)).toEqual(['Timing & calendars', 'Shipping methods', 'Appearance', 'Launch & recovery']);
        const panels = screen.getAllByRole('tabpanel', { hidden: true });
        expect(panels).toHaveLength(4);
        expect(screen.getByRole('tabpanel', { name: 'Timing & calendars' })).toBeVisible();
        for (const tab of tabs) {
            fireEvent.click(tab);
            const panel = screen.getByRole('tabpanel', { name: tab.textContent! });
            expect(screen.getAllByRole('tabpanel')).toEqual([panel]);
            expect(panel).toBeVisible();
            expect(tab).toHaveAttribute('aria-controls', panel.id);
            expect(panel).toHaveAttribute('aria-labelledby', tab.id);
            for (const mountedPanel of panels) {
                expect(mountedPanel).toBeInTheDocument();
                if (mountedPanel !== panel) expect(mountedPanel).not.toBeVisible();
            }
            for (const candidate of tabs) {
                expect(candidate).toHaveAttribute('aria-selected', String(candidate === tab));
                expect(candidate).toHaveAttribute('tabindex', candidate === tab ? '0' : '-1');
            }
        }
        expect(fetchMock).toHaveBeenCalledTimes(1);
        expect(syncFetchMock).toHaveBeenCalledTimes(1);
    });

    it('navigates tabs with arrow wrapping and Home / End, moving focus and selection together', async () => {
        const user = userEvent.setup();
        render(<DeliveryEstimatesSettingsPage />);
        await screen.findByLabelText('Daily cutoff');
        const tabs = screen.getAllByRole('tab');
        await user.click(tabs[0]);
        for (const [key, index] of [
            ['{ArrowRight}', 1], ['{ArrowRight}', 2], ['{ArrowLeft}', 1],
            ['{End}', 3], ['{ArrowRight}', 0], ['{ArrowLeft}', 3], ['{Home}', 0],
        ] as const) {
            await user.keyboard(key);
            expect(tabs[index]).toHaveFocus();
            expect(screen.getAllByRole('tab', { selected: true })).toEqual([tabs[index]]);
            expect(tabs[index]).toHaveAttribute('tabindex', '0');
            tabs.filter((_, i) => i !== index).forEach(tab => expect(tab).toHaveAttribute('tabindex', '-1'));
            expect(screen.getAllByRole('tabpanel')).toEqual([screen.getByRole('tabpanel', { name: tabs[index].textContent! })]);
        }
    });

    it('retains drafts across tabs and saves timezone, shipping and appearance changes through the shared save', async () => {
        const user = userEvent.setup();
        render(<DeliveryEstimatesSettingsPage />);
        fireEvent.change(await screen.findByLabelText('Daily cutoff'), { target: { value: '18:00' } });
        await user.selectOptions(screen.getByRole('combobox', { name: 'Store timezone (IANA)' }), 'Australia/Sydney');
        await user.click(screen.getByRole('tab', { name: 'Shipping methods' }));
        await user.selectOptions(screen.getByRole('combobox', { name: 'Fulfilment' }), 'collection');
        await user.click(screen.getByRole('tab', { name: 'Appearance' }));
        fireEvent.change(screen.getByRole('spinbutton', { name: 'Text size (px)' }), { target: { value: '18' } });
        await user.click(screen.getByRole('tab', { name: 'Timing & calendars' }));
        expect(screen.getByLabelText('Daily cutoff')).toHaveValue('18:00');
        expect(screen.getByRole('combobox', { name: 'Store timezone (IANA)' })).toHaveValue('Australia/Sydney');
        await user.click(screen.getByRole('tab', { name: 'Shipping methods' }));
        expect(screen.getByRole('combobox', { name: 'Fulfilment' })).toHaveValue('collection');
        await user.click(screen.getByRole('tab', { name: 'Appearance' }));
        expect(screen.getByRole('spinbutton', { name: 'Text size (px)' })).toHaveValue(18);
        await user.click(screen.getByRole('tab', { name: 'Launch & recovery' }));
        expect(fetchMock).toHaveBeenCalledTimes(1);
        expect(screen.getByText('Unsaved changes')).toBeVisible();
        expect(screen.getAllByRole('button', { name: 'Save delivery settings' })).toHaveLength(1);
        fetchMock.mockImplementationOnce(async (_url, options) => ok({ ...responseFixture(), settings: JSON.parse(options.body) }));
        await user.click(screen.getByRole('button', { name: 'Save delivery settings' }));
        await screen.findByText(/Settings saved in Overseek/);
        expect(fetchMock).toHaveBeenCalledTimes(2);
        const request = fetchMock.mock.calls[1][1];
        expect(request.method).toBe('PUT');
        expect(JSON.parse(request.body)).toEqual({ ...responseFixture().settings, cutoffTime: '18:00', timezone: 'Australia/Sydney',
            shippingMethods: [{ ...responseFixture().settings.shippingMethods[0], fulfilmentType: 'collection' }],
            branding: { ...responseFixture().settings.branding, fontSize: 18 } });
        expect(screen.getByText('No unsaved changes')).toBeVisible();
        expect(screen.getByRole('button', { name: 'Save delivery settings' })).toBeDisabled();
    });

    it('preserves a saved legacy timezone alias in the dropdown and subsequent saves', async () => {
        const data = responseFixture();
        data.settings.timezone = 'US/Eastern';
        fetchMock.mockResolvedValueOnce(ok(data));
        render(<DeliveryEstimatesSettingsPage />);
        const timezone = await screen.findByRole('combobox', { name: 'Store timezone (IANA)' });
        expect(timezone).toHaveValue('US/Eastern');
        expect(within(timezone).getByRole('option', { name: 'US/Eastern' })).toHaveProperty('selected', true);
        fireEvent.change(screen.getByLabelText('Daily cutoff'), { target: { value: '18:00' } });
        fireEvent.click(screen.getByRole('tab', { name: 'Launch & recovery' }));
        fetchMock.mockImplementationOnce(async (_url, options) => ok({ ...data, settings: JSON.parse(options.body) }));
        fireEvent.click(screen.getByRole('button', { name: 'Save delivery settings' }));
        await screen.findByText(/Settings saved in Overseek/);
        expect(JSON.parse(fetchMock.mock.calls[1][1].body).timezone).toBe('US/Eastern');
        fireEvent.click(screen.getByRole('tab', { name: 'Timing & calendars' }));
        expect(screen.getByRole('combobox', { name: 'Store timezone (IANA)' })).toHaveValue('US/Eastern');
    });

    it('connects dirty and save revision state to launch setup while keeping disable available', async () => {
        launchReadiness = readinessFixture({ ready: true, mode: 'GUARDED', cutoverState: 'guarded', blockers: [] });
        render(<DeliveryEstimatesSettingsPage />);
        const cutoff = await screen.findByLabelText('Daily cutoff');
        fireEvent.click(screen.getByRole('tab', { name: 'Launch & recovery' }));
        const activate = screen.getByRole('button', { name: 'Activate storefront estimates' });
        await waitFor(() => expect(activate).toBeEnabled());
        fireEvent.click(screen.getByRole('tab', { name: 'Timing & calendars' }));
        fireEvent.change(cutoff, { target: { value: '18:00' } });
        fireEvent.click(screen.getByRole('tab', { name: 'Launch & recovery' }));
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
        fireEvent.click(screen.getByRole('tab', { name: 'Shipping methods' }));
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
        fireEvent.click(await screen.findByRole('tab', { name: 'Shipping methods' }));
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
        fireEvent.click(screen.getByRole('tab', { name: 'Shipping methods' }));
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
        fireEvent.click(screen.getByRole('tab', { name: 'Shipping methods' }));
        fireEvent.click(screen.getByRole('button', { name: 'Refresh from WooCommerce' }));
        const signal = fetchMock.mock.calls[1][1].signal;
        accountId = 'account-b'; rerender(<DeliveryEstimatesSettingsPage />);
        await screen.findByLabelText('Daily cutoff');
        expect(signal.aborted).toBe(true);
        await act(async () => finish(discovery()));
        fireEvent.click(screen.getByRole('tab', { name: 'Shipping methods' }));
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
        const production = within(screen.getByRole('region', { name: 'Production closures' }));
        const closureDay = production.getAllByRole('button', { name: /: No closure/ })[0];
        const closureDate = closureDay.getAttribute('data-date');
        fireEvent.click(closureDay);
        fireEvent.click(screen.getByRole('tab', { name: 'Shipping methods' }));
        fireEvent.change(screen.getByLabelText('Fulfilment'), { target: { value: 'collection' } });
        fetchMock.mockImplementationOnce(async (_url, options) => ok({ ...responseFixture(), settings: JSON.parse(options.body) }));
        fireEvent.click(screen.getByRole('button', { name: 'Save delivery settings' }));
        await screen.findByText(/Settings saved in Overseek/);
        const request = fetchMock.mock.calls[1][1];
        expect(request.method).toBe('PUT');
        expect(JSON.parse(request.body)).toEqual({ ...responseFixture().settings, cutoffTime: '15:30', productionWeekdays: [0, 1, 2, 3, 4, 5],
            closures: [{ date: closureDate, scope: 'work' }], shippingMethods: [{ ...responseFixture().settings.shippingMethods[0], fulfilmentType: 'collection' }] });
        fireEvent.click(screen.getByRole('tab', { name: 'Launch & recovery' }));
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
        expect(within(screen.getByRole('region', { name: 'Production closures' })).getAllByRole('button', { name: /: No closure/ })[0]).toBeDisabled();
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
        fireEvent.click(screen.getByRole('tab', { name: 'Launch & recovery' }));
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
        fireEvent.click(screen.getByRole('tab', { name: 'Launch & recovery' }));
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
        fireEvent.click(screen.getByRole('tab', { name: 'Timing & calendars' }));
        fireEvent.change(screen.getByLabelText('Daily cutoff'), { target: { value: '19:00' } });
        fireEvent.click(screen.getByRole('tab', { name: 'Launch & recovery' }));
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
        fireEvent.click(await screen.findByRole('tab', { name: 'Shipping methods' }));
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
