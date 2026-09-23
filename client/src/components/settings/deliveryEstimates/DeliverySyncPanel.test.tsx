import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DeliverySyncPanel } from './DeliverySyncPanel';
import type { DeliverySyncStatus } from '../../../hooks/useDeliveryEstimateSync';

const fetchMock = vi.fn();
const props = { accountId: 'account-a', token: 'token-a', canEdit: true };
const status = (configurationSync: DeliverySyncStatus['configurationSync'] = 'not_requested'): DeliverySyncStatus => ({ configurationSync, storefrontActivated: false, pendingCount: 0, syncedCount: 0, lastAcknowledgedAt: null, lastError: null });
const ok = (value = status()) => ({ ok: true, json: async () => ({ status: value }) });
const syncButton = () => screen.getByRole('button', { name: 'Sync saved settings and production times' });
const progress = (overrides: Partial<NonNullable<DeliverySyncStatus['progress']>> = {}): NonNullable<DeliverySyncStatus['progress']> => ({
    totalInputs: 1489, acknowledgedInputs: 1453, pendingInputs: 853, blockedInputs: 0, failedInputs: 0,
    pluginUpdateRequiredInputs: 0, dirtyProducts: 829, rebuildingProducts: true, rebuildingInbound: false,
    scopes: [{ scope: 'product', total: 1489, synced: 636, acknowledged: 1453, pending: 853, blocked: 0, failed: 0, pluginUpdateRequired: 0 }],
    ...overrides,
});
const expectCount = (label: string, count: number) => expect(within(screen.getByText(label, { selector: 'dt' }).parentElement!).getByRole('definition')).toHaveTextContent(String(count));

describe('Delivery sync readiness', () => {
    beforeEach(() => { fetchMock.mockReset(); fetchMock.mockResolvedValue(ok()); vi.stubGlobal('fetch', fetchMock); });
    afterEach(() => vi.unstubAllGlobals());

    it('loads scoped status, displays counts and acknowledgement without claiming complete readiness', async () => {
        let finish!: (response: ReturnType<typeof ok>) => void;
        fetchMock.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
        render(<DeliverySyncPanel {...props} />);
        expect(screen.getByText('Loading sync status…')).toBeInTheDocument();
        expect(syncButton()).toBeDisabled();
        await act(async () => finish(ok({ ...status('synced'), syncedCount: 4, lastAcknowledgedAt: '2026-09-21T12:00:00Z' })));
        expect(screen.getByText(/configuration acknowledged/)).toBeInTheDocument();
        expect(screen.getByText('Pending inputs: 0 · Synced inputs: 4')).toBeInTheDocument();
        expect(document.querySelector('time')).toHaveAttribute('datetime', '2026-09-21T12:00:00Z');
        expect(screen.getByText(/does not establish complete delivery readiness/)).toHaveTextContent('Check the launch panel');
        expect(fetchMock).toHaveBeenCalledWith('/api/delivery-estimates/sync', expect.objectContaining({ method: 'GET', headers: { Authorization: 'Bearer token-a', 'X-Account-ID': 'account-a' } }));
        expect(fetchMock).toHaveBeenCalledTimes(1);
    });

    it('queues saved inputs without a draft body, uses the returned status and refreshes explicitly', async () => {
        const { rerender } = render(<DeliverySyncPanel {...props} />);
        await screen.findByText(/Not requested/);
        rerender(<DeliverySyncPanel {...props} token="new-token" />);
        fetchMock.mockResolvedValueOnce(ok({ ...status('pending'), pendingCount: 3 }));
        fireEvent.click(syncButton());
        await screen.findByText(/Sync request queued for background processing/);
        expect(screen.getByText('Pending inputs: 3 · Synced inputs: 0')).toBeInTheDocument();
        expect(fetchMock.mock.calls[1][1]).toMatchObject({ method: 'POST', headers: { Authorization: 'Bearer new-token' } });
        expect(fetchMock.mock.calls[1][1]).not.toHaveProperty('body');
        expect(fetchMock).toHaveBeenCalledTimes(2);
        fetchMock.mockResolvedValueOnce(ok(status('synced')));
        fireEvent.click(screen.getByRole('button', { name: 'Refresh sync status' }));
        await screen.findByText(/configuration acknowledged/);
        expect(screen.queryByText(/Sync request queued/)).not.toBeInTheDocument();
        expect(fetchMock).toHaveBeenCalledTimes(3);
    });

    it('distinguishes acknowledged inputs from receipt safety and inbound capability', async () => {
        fetchMock.mockResolvedValueOnce(ok({ ...status('synced'), receiptSafety: 'unverified', inboundCapability: 'plugin_update_required' }));
        render(<DeliverySyncPanel {...props} />);
        await screen.findByText(/configuration acknowledged/);
        expect(screen.getByText(/Receipt safety is not yet verified/)).toHaveTextContent('Managed-stock estimates remain unavailable');
        expect(screen.getByText(/Supplier input sync needs a newer companion plugin/)).toHaveTextContent('independently');
    });

    it('allows read-only refresh without a write control', async () => {
        render(<DeliverySyncPanel {...props} canEdit={false} />);
        await screen.findByText(/Not requested/);
        expect(screen.queryByRole('button', { name: 'Sync saved settings and production times' })).not.toBeInTheDocument();
        fireEvent.click(screen.getByRole('button', { name: 'Refresh sync status' }));
        await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
        expect(fetchMock.mock.calls.every(([, options]) => options.method === 'GET')).toBe(true);
    });

    it('requires saving dirty drafts first and prevents sync during a save', async () => {
        const { rerender } = render(<DeliverySyncPanel {...props} dirty />);
        await screen.findByText(/Not requested/);
        expect(screen.getByText(/save delivery settings first/)).toHaveTextContent('unsaved drafts are not sent');
        fireEvent.click(syncButton());
        expect(fetchMock).toHaveBeenCalledTimes(1);
        rerender(<DeliverySyncPanel {...props} saving />);
        expect(syncButton()).toBeDisabled();
        rerender(<DeliverySyncPanel {...props} />);
        expect(syncButton()).toBeEnabled();
    });

    it('shows requeued current-version counts without resetting acknowledgement or implying data loss', async () => {
        fetchMock.mockResolvedValueOnce(ok({ ...status('pending'), pendingCount: 24, syncedCount: 1453, progress: progress({ pendingInputs: 24, dirtyProducts: 0, rebuildingProducts: false, scopes: [] }) }));
        render(<DeliverySyncPanel {...props} />);
        await screen.findByText('Acknowledged at least once', { selector: 'dt' });
        expectCount('Acknowledged at least once', 1453);
        expectCount('Current-version synced', 1453);
        expectCount('Queued / pending', 24);
        fetchMock.mockResolvedValueOnce(ok({ ...status('pending'), pendingCount: 853, syncedCount: 636, progress: progress() }));
        fireEvent.click(screen.getByRole('button', { name: 'Refresh sync status' }));
        await screen.findByText(/Dirty products awaiting rebuild: 829/);
        expectCount('Acknowledged at least once', 1453);
        expectCount('Current-version synced', 636);
        expectCount('Queued / pending', 853);
        expect(screen.getByText(/Saved data rebuild requested before sync/)).toBeInTheDocument();
        expect(screen.getByText(/This does not mean previously acknowledged data was lost/)).toBeInTheDocument();
        fireEvent.click(screen.getByText('Sync counts by scope'));
        expect(screen.getByText('Products').closest('li')).toHaveTextContent('Current-version synced 636 · Acknowledged at least once 1453 · Queued / pending 853');
        expect(screen.queryByRole('progressbar')).not.toBeInTheDocument();
        expect(syncButton()).toBeDisabled();
        expect(screen.getByRole('button', { name: 'Refresh sync status' })).toBeEnabled();
        expect(fetchMock.mock.calls.every(([, options]) => options.method === 'GET')).toBe(true);
    });

    it('disallows repeated clicks during the request and healthy background processing', async () => {
        render(<DeliverySyncPanel {...props} />);
        await screen.findByText(/Not requested/);
        let finish!: (response: ReturnType<typeof ok>) => void;
        fetchMock.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
        fireEvent.click(syncButton());
        fireEvent.click(syncButton());
        expect(fetchMock).toHaveBeenCalledTimes(2);
        await act(async () => finish(ok({ ...status('pending'), progress: progress() })));
        fireEvent.click(syncButton());
        expect(syncButton()).toBeDisabled();
        expect(fetchMock).toHaveBeenCalledTimes(2);
    });

    it.each(['blockedInputs', 'failedInputs', 'pluginUpdateRequiredInputs'] as const)('permits retry with mixed pending and %s progress', async field => {
        fetchMock.mockResolvedValueOnce(ok({ ...status('pending'), progress: progress({ [field]: 2 }) }));
        render(<DeliverySyncPanel {...props} />);
        await screen.findByText('Acknowledged at least once', { selector: 'dt' });
        expect(syncButton()).toBeEnabled();
        fetchMock.mockResolvedValueOnce({ ok: true, json: async () => ({ status: status('pending'), requestDisposition: 'retrying' }) });
        fireEvent.click(syncButton());
        await screen.findByText(/Sync retry requested for inputs needing attention/);
        expect(screen.queryByText(/Sync request queued/)).not.toBeInTheDocument();
        expect(fetchMock.mock.calls[1][1].method).toBe('POST');
    });

    it('reports an already-running request as not restarted', async () => {
        render(<DeliverySyncPanel {...props} />);
        await screen.findByText(/Not requested/);
        fetchMock.mockResolvedValueOnce({ ok: true, json: async () => ({ status: { ...status('pending'), progress: progress() }, requestDisposition: 'already_running' }) });
        fireEvent.click(syncButton());
        await screen.findByText(/already running and was not restarted/);
        expect(screen.queryByText(/Sync request queued/)).not.toBeInTheDocument();
        expect(syncButton()).toBeDisabled();
    });

    it.each(['dirtyProducts', 'rebuildingProducts', 'rebuildingInbound'] as const)('disables full sync while only %s preparation remains', async field => {
        fetchMock.mockResolvedValueOnce(ok({ ...status('synced'), progress: progress({ pendingInputs: 0, dirtyProducts: 0, rebuildingProducts: false, rebuildingInbound: false, [field]: field === 'dirtyProducts' ? 2 : true }) }));
        render(<DeliverySyncPanel {...props} />);
        await screen.findByText('Acknowledged at least once', { selector: 'dt' });
        expect(syncButton()).toBeDisabled();
        expect(screen.getByRole('button', { name: 'Refresh sync status' })).toBeEnabled();
        expect(fetchMock).toHaveBeenCalledTimes(1);
    });

    it('keeps refresh GET-only with dirty settings and legacy pending status', async () => {
        fetchMock.mockResolvedValue(ok({ ...status('pending'), pendingCount: 24, syncedCount: 1453 }));
        const { rerender } = render(<DeliverySyncPanel {...props} dirty />);
        await screen.findByText('Pending inputs: 24 · Synced inputs: 1453');
        expect(screen.getByText(/counts are unavailable from this server/)).toBeInTheDocument();
        expect(screen.queryByText('Acknowledged at least once', { selector: 'dt' })).not.toBeInTheDocument();
        fireEvent.click(screen.getByRole('button', { name: 'Refresh sync status' }));
        await waitFor(() => expect(screen.getByRole('button', { name: 'Refresh sync status' })).toBeEnabled());
        rerender(<DeliverySyncPanel {...props} />);
        expect(syncButton()).toBeDisabled();
        expect(fetchMock).toHaveBeenCalledTimes(2);
        expect(fetchMock.mock.calls.every(([, options]) => options.method === 'GET')).toBe(true);
    });

    it('hides pre-save progress and drops an old revision response', async () => {
        fetchMock.mockResolvedValueOnce(ok({ ...status('synced'), syncedCount: 636, progress: progress() }));
        const { rerender } = render(<DeliverySyncPanel {...props} />);
        await screen.findByText('Acknowledged at least once', { selector: 'dt' });
        let finish!: (response: ReturnType<typeof ok>) => void;
        fetchMock.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
        fireEvent.click(screen.getByRole('button', { name: 'Refresh sync status' }));
        const signal = fetchMock.mock.calls.at(-1)![1].signal;
        rerender(<DeliverySyncPanel {...props} saveRevision={1} />);
        await screen.findByText(/Not requested/);
        expect(signal.aborted).toBe(true);
        await act(async () => finish(ok({ ...status('synced'), progress: progress() })));
        expect(screen.queryByText('Acknowledged at least once', { selector: 'dt' })).not.toBeInTheDocument();
    });

    it.each(['plugin_update_required', 'blocked', 'failed'] as const)('shows %s recovery details and permits explicit retry', async state => {
        fetchMock.mockResolvedValueOnce(ok({ ...status(state), lastError: 'Remote issue' }));
        render(<DeliverySyncPanel {...props} />);
        await screen.findByText('Last sync error: Remote issue');
        if (state === 'plugin_update_required') expect(screen.getByText(/Plugin update required — sync is parked/)).toBeInTheDocument();
        expect(syncButton()).toBeEnabled();
        fetchMock.mockResolvedValueOnce(ok(status('pending')));
        fireEvent.click(syncButton());
        await screen.findByText(/Pending — saved inputs/);
    });

    it('recovers from load and queue errors without reporting success', async () => {
        fetchMock.mockRejectedValueOnce(new Error('Network unavailable'));
        render(<DeliverySyncPanel {...props} />);
        expect(await screen.findByRole('alert')).toHaveTextContent('Network unavailable');
        fireEvent.click(screen.getByRole('button', { name: 'Refresh sync status' }));
        await screen.findByText(/Not requested/);
        fetchMock.mockResolvedValueOnce({ ok: false, json: async () => ({ error: 'Permission denied' }) });
        fireEvent.click(syncButton());
        expect(await screen.findByRole('alert')).toHaveTextContent('Permission denied');
        expect(screen.queryByText(/Sync request queued/)).not.toBeInTheDocument();
        expect(syncButton()).toBeEnabled();
    });

    it.each(['GET', 'POST'])('aborts and ignores stale %s responses on account change', async method => {
        let finish!: (response: ReturnType<typeof ok>) => void;
        if (method === 'GET') fetchMock.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
        const { rerender } = render(<DeliverySyncPanel {...props} />);
        if (method === 'POST') {
            await screen.findByText(/Not requested/);
            fetchMock.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
            fireEvent.click(syncButton());
        }
        const signal = fetchMock.mock.calls.at(-1)![1].signal;
        rerender(<DeliverySyncPanel {...props} accountId="account-b" />);
        await screen.findByText(/Not requested/);
        expect(signal.aborted).toBe(true);
        expect(fetchMock.mock.calls.at(-1)![1].headers['X-Account-ID']).toBe('account-b');
        await act(async () => finish(ok({ ...status('failed'), lastError: 'Old account error' })));
        expect(screen.queryByText(/Old account error/)).not.toBeInTheDocument();
        expect(screen.queryByText(/Sync request queued/)).not.toBeInTheDocument();
    });
});
