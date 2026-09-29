import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DeliveryEstimatesSettingsPage } from './DeliveryEstimatesSettingsPage';
import { responseFixture } from '../components/settings/deliveryEstimates/fixtures.test-support';
import { readinessFixture } from '../components/settings/deliveryEstimates/launchFixtures.test-support';

let accountId = 'account-a';
let enabled = true;
let canView = true;
let canEdit = true;
let token = 'test-token';
let readiness = readinessFixture();
let data = responseFixture();
const fetchMock = vi.fn();
const settingsRequest = vi.fn();
const discoveryRequest = vi.fn();
const ok = (body: unknown) => ({ ok: true, json: async () => body });
vi.mock('../context/AccountContext', () => ({ useAccount: () => ({ currentAccount: { id: accountId } }) }));
vi.mock('../context/AuthContext', () => ({ useAuth: () => ({ token }) }));
vi.mock('../hooks/useAccountFeature', () => ({ useAccountFeature: () => enabled }));
vi.mock('../hooks/usePermissions', () => ({ usePermissions: () => ({ hasPermission: (key: string) => key === 'view_shipping' ? canView : key === 'manage_shipping_settings' && canEdit }) }));

describe('simple delivery settings', () => {
    beforeEach(() => {
        vi.resetAllMocks();
        accountId = 'account-a'; enabled = true; canView = true; canEdit = true; token = 'test-token';
        data = responseFixture(); readiness = readinessFixture({ estimateMode: 'production' });
        settingsRequest.mockImplementation(async (_url, options) => ok(options.body ? { ...data, settings: JSON.parse(options.body) } : data));
        discoveryRequest.mockResolvedValue(ok({ status: 'available', methods: [], warnings: [] }));
        fetchMock.mockImplementation(async (url: string, options: RequestInit) => {
            if (url.endsWith('/readiness')) return ok(readiness);
            if (url.endsWith('/shipping-methods')) return discoveryRequest(url, options);
            if (url.endsWith('/activation')) {
                readiness = readinessFixture({ desiredActive: false, active: true, work: { action: 'disable', attempts: 0, lastError: null, nextAttemptAt: null } });
                return ok({ accepted: true, revision: '2' });
            }
            if (url.endsWith('/enable')) readiness = readinessFixture({ desiredActive: true, revalidationRequested: true, work: { action: 'activate', attempts: 0, lastError: null, nextAttemptAt: null } });
            return settingsRequest(url, options);
        });
        vi.stubGlobal('fetch', fetchMock);
    });
    afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); });
    const toggle = () => screen.getByRole('switch', { name: 'Delivery estimates' });
    const loaded = async () => { await screen.findByLabelText('Daily cutoff'); await waitFor(() => expect(screen.queryByText('Loading shipping methods…')).not.toBeInTheDocument()); };

    it('shows one page with an on/off control and only everyday settings', async () => {
        render(<DeliveryEstimatesSettingsPage />); await loaded();
        expect(toggle()).toHaveAttribute('aria-checked', 'false');
        expect(screen.queryByRole('tablist')).not.toBeInTheDocument();
        expect(screen.queryByText(/Advanced|Receipt recovery|Technical diagnostics|Troubleshooting/)).not.toBeInTheDocument();
        expect(screen.queryByLabelText('How should estimates work?')).not.toBeInTheDocument();
        expect(screen.queryByText(/Mapping policy|Actual rate ID/)).not.toBeInTheDocument();
        expect(fetchMock.mock.calls.map(([url]) => url).every(url => !/receipts|sync|cutover/.test(url))).toBe(true);
        expect(screen.getByText('[overseek_delivery_estimate]')).not.toBeVisible();
        fireEvent.click(screen.getByText('Show estimates on product pages'));
        expect(screen.getByText('[overseek_delivery_estimate]')).toBeVisible();
    });

    it('saves current edits and enables in one request, without a manual save or sync', async () => {
        data.settings.fallbackSupplierLeadTimeDays = 17;
        data.settings.closures = [{ date: '2026-12-25', scope: 'both' }];
        render(<DeliveryEstimatesSettingsPage />); await loaded();
        fireEvent.change(screen.getByLabelText('Daily cutoff'), { target: { value: '16:00' } });
        fireEvent.click(toggle());
        await screen.findByText('Turning on…');
        const enables = fetchMock.mock.calls.filter(([url]) => url.endsWith('/enable'));
        expect(enables).toHaveLength(1);
        expect(enables[0][1]).toMatchObject({ method: 'POST', headers: expect.objectContaining({ 'X-Account-ID': 'account-a' }) });
        expect(JSON.parse(enables[0][1].body)).toEqual({ ...data.settings, cutoffTime: '16:00', estimateMode: 'production' });
        expect(toggle()).toHaveAttribute('aria-checked', 'true');
        expect(fetchMock.mock.calls.some(([url]) => url.endsWith('/sync'))).toBe(false);
    });

    it('turns off with invalid unsaved settings, without saving or validating the draft', async () => {
        readiness = readinessFixture({ active: true, desiredActive: true });
        render(<DeliveryEstimatesSettingsPage />); await loaded();
        fireEvent.change(screen.getByLabelText('Daily cutoff'), { target: { value: '' } });
        fireEvent.click(toggle());
        await screen.findByText('Turning off…');
        const mutations = fetchMock.mock.calls.filter(([, options]) => options.method === 'POST' || options.method === 'PUT');
        expect(mutations).toHaveLength(1);
        expect(mutations[0][0]).toBe('/api/delivery-estimates/activation');
        expect(JSON.parse(mutations[0][1].body)).toEqual({ active: false });
        expect(screen.getByLabelText('Daily cutoff')).toHaveValue('');
        expect(toggle()).toHaveAttribute('aria-checked', 'false');
    });

    it('follows a slow enable automatically until the store confirms it is on', async () => {
        render(<DeliveryEstimatesSettingsPage />); await loaded();
        vi.useFakeTimers();
        await act(async () => fireEvent.click(toggle()));
        for (let i = 0; i < 13; i++) await act(async () => vi.advanceTimersByTimeAsync(5000));
        expect(screen.getByText('Turning on…')).toBeVisible();
        expect(screen.queryByText('Check again')).not.toBeInTheDocument();
        readiness = readinessFixture({ active: true, desiredActive: true, ready: true });
        await act(async () => vi.advanceTimersByTimeAsync(30_000));
        expect(screen.getByText('On')).toBeVisible();
        expect(toggle()).toHaveAttribute('aria-checked', 'true');
        const count = fetchMock.mock.calls.length;
        await act(async () => vi.advanceTimersByTimeAsync(60_000));
        expect(fetchMock).toHaveBeenCalledTimes(count);
    });

    it('automatically adds store methods without inventing shipping durations', async () => {
        discoveryRequest.mockResolvedValue(ok({ status: 'available', warnings: [], methods: [
            { methodId: 'wbs', instanceId: 8, zoneId: 2, zoneName: 'Australia', title: 'Express', enabled: true, provider: 'weight_based' },
        ] }));
        render(<DeliveryEstimatesSettingsPage />); await loaded();
        const min = screen.getByLabelText('Express minimum days');
        const max = screen.getByLabelText('Express maximum days');
        expect(min).toHaveValue(null); expect(max).toHaveValue(null);
        expect(screen.getByLabelText('Show estimates for Express')).not.toBeChecked();
        fireEvent.change(min, { target: { value: '2' } });
        fireEvent.change(max, { target: { value: '4' } });
        expect(screen.getByLabelText('Show estimates for Express')).toBeChecked();
        fireEvent.click(screen.getByRole('button', { name: 'Save changes' }));
        await screen.findByText('Saved. Your store updates automatically.');
        const saved = JSON.parse(settingsRequest.mock.calls.at(-1)![1].body);
        expect(saved.shippingMethods[0]).toEqual(data.settings.shippingMethods[0]);
        expect(saved.shippingMethods[1]).toMatchObject({ methodId: 'wbs', instanceId: 8, minTransitDays: 2, maxTransitDays: 4, enabled: true, mappingKind: 'all_provider_rates', allRatesConfirmed: true });
    });

    it('does not enable empty or invalid shipping timings', async () => {
        data.settings.shippingMethods = []; data.settings.defaultMethod = null;
        render(<DeliveryEstimatesSettingsPage />); await loaded();
        fireEvent.click(toggle());
        expect(await screen.findByRole('alert')).toHaveTextContent('Enter shipping times');
        expect(fetchMock.mock.calls.some(([, options]) => options.method === 'POST')).toBe(false);
    });

    it('allows view-only users to see timings but not edit, discover or activate', async () => {
        canEdit = false;
        render(<DeliveryEstimatesSettingsPage />); await loaded();
        expect(screen.queryByRole('switch')).not.toBeInTheDocument();
        expect(screen.getByLabelText('Daily cutoff')).toBeDisabled();
        expect(discoveryRequest).not.toHaveBeenCalled();
        expect(screen.queryByRole('button', { name: 'Save changes' })).not.toBeInTheDocument();
    });

    it('retains turn-off access when the feature is disabled', async () => {
        enabled = false; readiness = readinessFixture({ active: true, desiredActive: true });
        render(<DeliveryEstimatesSettingsPage />);
        await waitFor(() => expect(toggle()).toHaveAttribute('aria-checked', 'true'));
        fireEvent.click(toggle()); await screen.findByText('Turning off…');
        expect(settingsRequest).not.toHaveBeenCalled();
        expect(discoveryRequest).not.toHaveBeenCalled();
    });

    it('can turn off without view access and never loads settings or readiness', async () => {
        canView = false;
        render(<DeliveryEstimatesSettingsPage />);
        fireEvent.click(screen.getByRole('button', { name: 'Turn off estimates' }));
        await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
        expect(fetchMock.mock.calls[0][0]).toBe('/api/delivery-estimates/activation');
        expect(settingsRequest).not.toHaveBeenCalled();
    });

    it('preserves edits across token refresh and saves using the new token', async () => {
        const view = render(<DeliveryEstimatesSettingsPage />); await loaded();
        fireEvent.change(screen.getByLabelText('Daily cutoff'), { target: { value: '16:00' } });
        token = 'new-token'; view.rerender(<DeliveryEstimatesSettingsPage />);
        fireEvent.click(screen.getByRole('button', { name: 'Save changes' }));
        await screen.findByText('Saved. Your store updates automatically.');
        expect(settingsRequest.mock.calls.at(-1)![1].headers.Authorization).toBe('Bearer new-token');
        expect(screen.getByLabelText('Daily cutoff')).toHaveValue('16:00');
    });

    it('aborts late enable responses when switching accounts', async () => {
        const view = render(<DeliveryEstimatesSettingsPage />); await loaded();
        let finish!: (value: ReturnType<typeof ok>) => void;
        settingsRequest.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
        fireEvent.click(toggle());
        const signal = settingsRequest.mock.calls.at(-1)![1].signal;
        accountId = 'account-b'; readiness = readinessFixture();
        view.rerender(<DeliveryEstimatesSettingsPage />); await loaded();
        expect(signal.aborted).toBe(true);
        await act(async () => finish(ok(data)));
        expect(toggle()).toHaveAttribute('aria-checked', 'false');
        expect(screen.queryByText('Turning on…')).not.toBeInTheDocument();
    });

    it('keeps a failed enable off and retains the draft for retry', async () => {
        render(<DeliveryEstimatesSettingsPage />); await loaded();
        settingsRequest.mockResolvedValueOnce({ ok: false, status: 500, json: async () => ({ error: 'Store unavailable' }) });
        fireEvent.change(screen.getByLabelText('Daily cutoff'), { target: { value: '16:00' } });
        fireEvent.click(toggle());
        await screen.findByText('Store unavailable');
        expect(toggle()).toHaveAttribute('aria-checked', 'false');
        expect(screen.getByLabelText('Daily cutoff')).toHaveValue('16:00');
    });
});
