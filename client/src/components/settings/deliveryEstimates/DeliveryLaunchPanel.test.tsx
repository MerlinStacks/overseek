import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DeliveryLaunchPanel } from './DeliveryLaunchPanel';
import { readinessFixture, receiptFixture } from './launchFixtures.test-support';
import { LAUNCH_POLL_LIMIT, LAUNCH_POLL_MS } from '../../../hooks/useDeliveryLaunch';
import type { ReceiptPage } from './launchApi';

const props = { accountId: 'account-a', token: 'token-a', canEdit: true, canInventory: true };
const fetchMock = vi.fn();
let readiness = readinessFixture();
let receipts: ReceiptPage;
const ok = (data: unknown) => ({ ok: true, status: 200, json: async () => data });
const fail = (status: number, error: string) => ({ ok: false, status, json: async () => ({ error }) });
const activate = () => screen.getByRole('button', { name: 'Activate storefront estimates' });
const disable = () => screen.getByRole('button', { name: 'Disable storefront estimates' });
const refresh = () => screen.getByRole('button', { name: 'Refresh readiness and receipts' });
const posts = () => fetchMock.mock.calls.filter(([, options]) => options.method === 'POST');
const ready = () => readinessFixture({ ready: true, mode: 'GUARDED', cutoverState: 'guarded', blockers: [] });
const loaded = async () => { await screen.findByText(/Control revision:/); await waitFor(() => expect(refresh()).toBeEnabled()); };
const confirmCutover = () => screen.getAllByRole('checkbox').forEach(input => fireEvent.click(input));

describe('Delivery launch contract', () => {
    beforeEach(() => {
        readiness = readinessFixture(); receipts = { receipts: [], legacyJobs: [], nextCursor: null };
        fetchMock.mockReset(); fetchMock.mockImplementation(async (url: string) => {
            if (url.endsWith('/readiness')) return ok(readiness);
            if (url.includes('/receipts/legacy')) return ok({ jobs: [], nextCursor: null });
            if (url.includes('/receipts')) return ok(receipts);
            return ok({ accepted: true, revision: '1' });
        });
        vi.stubGlobal('fetch', fetchMock);
    });
    afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });

    it('loads actual scoped diagnostics; HTTP 200 is not activation readiness', async () => {
        readiness = readinessFixture({ blockers: ['plugin_control_unavailable_or_upgrade_required', 'deactivate_old_delivery_plugin:old/plugin.php', 'blocks_pickup_requires_verified_presentation', 'no_supported_enabled_shipping_mapping'],
            warnings: ['configured_products_excluded_unsupported_or_BOM', 'unsupported_shipping_mappings_excluded'] });
        render(<DeliveryLaunchPanel {...props} />); await loaded();
        expect(activate()).toBeDisabled();
        expect(screen.getByText(/Update the Overseek Woo companion/)).toBeInTheDocument();
        expect(screen.getByText(/Deactivate the old delivery plugin/)).toHaveTextContent('old/plugin.php');
        expect(screen.getByText(/Verify supported Blocks pickup/)).toBeInTheDocument();
        expect(screen.getByText(/Unsupported products and BOM/)).toBeInTheDocument();
        expect(fetchMock.mock.calls[0][1]).toMatchObject({ headers: { Authorization: 'Bearer token-a', 'X-Account-ID': 'account-a' }, cache: 'no-store' });
        expect(fetchMock).toHaveBeenCalledTimes(3);
    });

    it('requires all three real-world confirmations and treats accepted cutover as queued', async () => {
        render(<DeliveryLaunchPanel {...props} />); await loaded();
        const button = screen.getByRole('button', { name: 'Queue / resume cutover' });
        const checks = screen.getAllByRole('checkbox');
        fireEvent.click(checks[0]); fireEvent.click(checks[1]);
        expect(button).toBeDisabled(); expect(posts()).toHaveLength(0);
        fireEvent.click(checks[2]); fireEvent.click(button);
        expect(await screen.findByText(/Cutover queued \(revision 1\), not yet acknowledged/)).toBeInTheDocument();
        expect(posts()[0][0]).toBe('/api/delivery-estimates/cutover');
        expect(JSON.parse(posts()[0][1].body)).toEqual({ receivingPaused: true, legacyJobsDrained: true, preupgradeWorkersRestarted: true });
        expect(activate()).toBeDisabled();
        await waitFor(() => expect(checks[0]).not.toBeChecked());
    });

    it('uses certification for guarded accounts and activates only a fresh server-ready state', async () => {
        readiness = ready();
        const { rerender } = render(<DeliveryLaunchPanel {...props} />); await loaded();
        expect(activate()).toBeEnabled();
        confirmCutover(); fireEvent.click(screen.getByRole('button', { name: 'Queue stock-owner certification' }));
        await screen.findByText(/Certification queued/);
        expect(posts()[0][0]).toBe('/api/delivery-estimates/certification');
        await loaded(); fireEvent.click(activate());
        await screen.findByText(/Activation queued/);
        expect(JSON.parse(posts()[1][1].body)).toEqual({ active: true });
        readiness = readinessFixture({ blockers: ['inputs_pending'] });
        rerender(<DeliveryLaunchPanel {...props} saveRevision={1} />);
        expect(activate()).toBeDisabled(); await loaded(); expect(activate()).toBeDisabled();
    });

    it.each(['ready-false', 'unknown-mode', 'unknown-work', 'frozen', 'blockers'])('fails closed for %s despite a successful diagnostic response', async condition => {
        readiness = ready();
        if (condition === 'ready-false') readiness.ready = false;
        if (condition === 'unknown-mode') Object.assign(readiness, { mode: 'FUTURE' });
        if (condition === 'unknown-work') Object.assign(readiness.work, { action: 'future-action' });
        if (condition === 'frozen') readiness.receivingFrozen = true;
        if (condition === 'blockers') readiness.blockers = ['future_blocker'];
        render(<DeliveryLaunchPanel {...props} />);
        await waitFor(() => expect(refresh()).toBeEnabled());
        expect(activate()).toBeDisabled(); fireEvent.click(activate()); expect(posts()).toHaveLength(0);
        expect(disable()).toBeEnabled();
    });

    it('keeps disable operational with dirty/saving/unavailable settings and feature off', async () => {
        readiness = readinessFixture({ active: true, blockers: ['feature_disabled'] });
        render(<DeliveryLaunchPanel {...props} featureEnabled={false} dirty saving setupUnavailable />); await loaded();
        expect(activate()).toBeDisabled(); expect(screen.getByRole('button', { name: 'Queue / resume cutover' })).toBeDisabled();
        fireEvent.click(disable()); await screen.findByText(/Disable queued/);
        expect(posts()[0][0]).toBe('/api/delivery-estimates/activation');
        expect(JSON.parse(posts()[0][1].body)).toEqual({ active: false });
        expect(screen.getByText(/Verified storefront state: active/)).toBeInTheDocument();
    });

    it.each(['legacy', 'legacy_review', 'baseline'] as const)('allows private feature-off recovery for frozen %s without saved setup fields', async cutoverState => {
        readiness = readinessFixture({ cutoverState, receivingFrozen: true, blockers: ['feature_disabled', 'receiving_frozen', 'cutover_required'] });
        render(<DeliveryLaunchPanel {...props} featureEnabled={false} dirty saving setupUnavailable />); await loaded();
        confirmCutover();
        const button = screen.getByRole('button', { name: 'Queue / resume cutover' });
        expect(button).toBeEnabled(); expect(activate()).toBeDisabled(); expect(disable()).toBeEnabled();
        fireEvent.click(button); await screen.findByText(/Cutover queued/);
        expect(posts()[0][0]).toBe('/api/delivery-estimates/cutover');
        expect(JSON.parse(posts()[0][1].body)).toEqual({ receivingPaused: true, legacyJobsDrained: true, preupgradeWorkersRestarted: true });
    });

    it('does not start initial preparation with the feature off even with healthy diagnostics', async () => {
        readiness = readinessFixture({ blockers: ['feature_disabled', 'cutover_required'] });
        render(<DeliveryLaunchPanel {...props} featureEnabled={false} />); await loaded(); confirmCutover();
        expect(screen.getByRole('button', { name: 'Queue / resume cutover' })).toBeDisabled();
        expect(posts()).toHaveLength(0); fireEvent.click(disable()); await screen.findByText(/Disable queued/);
        expect(JSON.parse(posts()[0][1].body)).toEqual({ active: false });
    });

    it.each(['missing-plugin', 'invalid-plugin', 'upgrade-required', 'missing-sql', 'invalid-sql', 'inventory', 'woo', 'presentation', 'plugin-stock-store'])('cannot freeze a store with %s diagnostics, but can disable', async problem => {
        if (problem === 'missing-plugin') readiness.plugin = null;
        if (problem === 'invalid-plugin') Object.assign(readiness.plugin!, { protocolVersion: 2 });
        if (problem === 'upgrade-required') readiness.blockers.push('plugin_control_unavailable_or_upgrade_required');
        if (problem === 'missing-sql') readiness.freshnessPrerequisite = undefined;
        if (problem === 'invalid-sql') readiness.freshnessPrerequisite!.ready = false;
        if (problem === 'inventory') readiness.inventoryCompatibility!.ready = false;
        if (problem === 'woo') readiness.plugin!.blockers = ['classic_woocommerce_9_7_required'];
        if (problem === 'presentation') readiness.plugin!.blockers = ['blocks_pickup_requires_verified_presentation'];
        if (problem === 'plugin-stock-store') readiness.plugin!.blockers = ['guarded_receipts_native_stock_store_required'];
        render(<DeliveryLaunchPanel {...props} />); await loaded(); confirmCutover();
        const button = screen.getByRole('button', { name: 'Queue / resume cutover' });
        expect(button).toBeDisabled(); fireEvent.click(button); expect(posts()).toHaveLength(0);
        fireEvent.click(disable()); await screen.findByText(/Disable queued/);
        expect(JSON.parse(posts()[0][1].body)).toEqual({ active: false });
    });

    it('allows private preparation while the old Pi plugin alone blocks storefront activation', async () => {
        const pi = 'deactivate_old_delivery_plugin:pi-delivery/pi.php';
        readiness.plugin!.blockers = [pi]; readiness.blockers = ['cutover_required', pi];
        render(<DeliveryLaunchPanel {...props} />); await loaded(); confirmCutover();
        expect(activate()).toBeDisabled();
        fireEvent.click(screen.getByRole('button', { name: 'Queue / resume cutover' }));
        await screen.findByText(/Cutover queued/); expect(posts()[0][0]).toBe('/api/delivery-estimates/cutover');
    });

    it.each(['cutover', 'activate', 'disable'] as const)('does not supersede pending %s work without the authoritative resume action', async action => {
        readiness = readinessFixture({ cutoverState: 'baseline', receivingFrozen: true,
            work: { action, attempts: 8, lastError: 'Transport unavailable', nextAttemptAt: null } });
        render(<DeliveryLaunchPanel {...props} featureEnabled={false} />); await loaded();
        expect(screen.getByRole('button', { name: 'Queue / resume cutover' })).toBeDisabled();
        expect(screen.getByText(/Wait and refresh; resume is available only/)).toBeInTheDocument();
        expect(disable()).toBeEnabled();
        readiness = { ...readiness, actions: { ...readiness.actions, resumeCutover: '/api/delivery-estimates/cutover' } };
        fireEvent.click(refresh()); await loaded(); confirmCutover();
        fireEvent.click(screen.getByRole('button', { name: 'Queue / resume cutover' })); await screen.findByText(/Cutover queued/);
        expect(posts()[0][0]).toBe('/api/delivery-estimates/cutover');
    });

    it('keeps legacy inventory review available before preparation is permitted', async () => {
        readiness = readinessFixture({ plugin: null, unresolvedLegacyJobs: 1, blockers: ['legacy_jobs_not_drained', 'plugin_control_unavailable_or_upgrade_required'] });
        fetchMock.mockImplementation(async (url: string) => url.endsWith('/readiness') ? ok(readiness)
            : url.endsWith('/receipts/legacy') ? ok({ jobs: [{ id: 'legacy-a', accountId: 'account-a', purchaseOrderId: 'po-a', state: 'pending', sourceType: 'purchase_order', targets: null, originalTargetsAvailable: false, attempts: 0, lastError: null, createdAt: '2026-09-22' }], nextCursor: null }) : ok(receipts));
        render(<DeliveryLaunchPanel {...props} featureEnabled={false} />); await loaded();
        expect(screen.getByRole('button', { name: 'Queue / resume cutover' })).toBeDisabled();
        fireEvent.click(screen.getByLabelText('Inventory receiving is paused for this legacy review.'));
        fireEvent.click(screen.getByLabelText('Legacy process-local work is drained and all pre-upgrade API/worker processes are restarted.'));
        expect(screen.getByRole('button', { name: 'Observe legacy inventory' })).toBeEnabled(); expect(disable()).toBeEnabled();
    });

    it.each([null, {}, { ...ready(), ready: undefined }])('blocks setup when readiness is missing or incomplete: %j', async response => {
        fetchMock.mockImplementation(async (url: string) => url.endsWith('/readiness') ? ok(response)
            : url.includes('/receipts/legacy') ? ok({ jobs: [], nextCursor: null }) : ok(receipts));
        render(<DeliveryLaunchPanel {...props} />);
        await screen.findByText(/Unknown launch response/);
        expect(activate()).toBeDisabled();
        expect(screen.getByRole('button', { name: 'Queue / resume cutover' })).toBeDisabled();
        expect(screen.queryByRole('button', { name: /force|drain/i })).not.toBeInTheDocument();
        expect(screen.queryByText(/Verified storefront state:/)).not.toBeInTheDocument();
        fireEvent.click(activate()); expect(posts()).toHaveLength(0);
        expect(disable()).toBeEnabled();
    });

    it('does not offer activation or force controls while activation work is pending', async () => {
        readiness = ready(); readiness.work = { action: 'activate', attempts: 1, lastError: null, nextAttemptAt: null };
        render(<DeliveryLaunchPanel {...props} />); await loaded();
        expect(activate()).toBeDisabled();
        expect(screen.queryByRole('button', { name: /force|drain/i })).not.toBeInTheDocument();
        fireEvent.click(activate()); expect(posts()).toHaveLength(0);
    });

    it('allows disable even when readiness cannot be loaded and supports explicit safe retries', async () => {
        fetchMock.mockImplementation(async (url: string) => url.endsWith('readiness') ? fail(503, 'Store unavailable') : ok(receipts));
        render(<DeliveryLaunchPanel {...props} />);
        await screen.findByText(/Store unavailable/);
        expect(disable()).toBeEnabled(); expect(activate()).toBeDisabled();
        fetchMock.mockResolvedValueOnce(fail(403, 'Permission denied'));
        fireEvent.click(disable()); await screen.findByText(/Permission denied/);
        expect(screen.queryByText(/Disable queued/)).not.toBeInTheDocument();
        fetchMock.mockResolvedValueOnce(ok({ accepted: true, revision: '2' }));
        fireEvent.click(disable()); await screen.findByText(/Disable queued \(revision 2\)/);
    });

    it.each([[false, false], [true, false], [false, true]])('enforces shipping=%s and inventory=%s independently', async (canEdit, canInventory) => {
        receipts.receipts = [receiptFixture()];
        render(<DeliveryLaunchPanel {...props} canEdit={canEdit} canInventory={canInventory} />); await loaded();
        expect(screen.queryByRole('button', { name: 'Queue / resume cutover' })).not.toBeInTheDocument();
        expect(screen.queryByRole('button', { name: 'Disable storefront estimates' }) !== null).toBe(canEdit);
        expect(screen.queryByRole('button', { name: 'Obtain fresh stock observation' }) !== null).toBe(canInventory);
        expect(fetchMock.mock.calls.some(([url]) => url.includes('/receipts'))).toBe(canInventory);
    });

    it('aborts stale account reads and resets confirmations and errors on account switch', async () => {
        let finish!: (value: ReturnType<typeof ok>) => void;
        fetchMock.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
        const { rerender } = render(<DeliveryLaunchPanel {...props} />);
        const signal = fetchMock.mock.calls[0][1].signal;
        rerender(<DeliveryLaunchPanel {...props} accountId="account-b" token="token-b" />); await loaded();
        expect(signal.aborted).toBe(true);
        await act(async () => finish(ok(ready())));
        expect(activate()).toBeDisabled();
        expect(fetchMock.mock.calls.at(-1)![1].headers).toMatchObject({ Authorization: 'Bearer token-b', 'X-Account-ID': 'account-b' });
        confirmCutover(); rerender(<DeliveryLaunchPanel {...props} accountId="account-c" />); await loaded();
        screen.getAllByRole('checkbox').forEach(input => expect(input).not.toBeChecked());
    });

    it('does not require view_shipping to use independently authorized disable or inventory recovery', async () => {
        receipts.receipts = [receiptFixture()];
        render(<DeliveryLaunchPanel {...props} canRead={false} featureEnabled={false} />);
        await screen.findByRole('button', { name: 'Obtain fresh stock observation' });
        expect(fetchMock.mock.calls.some(([url]) => url.endsWith('/readiness'))).toBe(false);
        expect(activate()).toBeDisabled(); expect(disable()).toBeEnabled();
        fireEvent.click(disable()); await screen.findByText(/Disable queued/);
        expect(JSON.parse(posts()[0][1].body)).toEqual({ active: false });
    });

    it('aborts stale mutation acknowledgements on permission/account change', async () => {
        const { rerender } = render(<DeliveryLaunchPanel {...props} />); await loaded();
        let finish!: (value: ReturnType<typeof ok>) => void;
        fetchMock.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
        fireEvent.click(disable()); const signal = posts()[0][1].signal;
        rerender(<DeliveryLaunchPanel {...props} canEdit={false} />); await loaded();
        expect(signal.aborted).toBe(true);
        await act(async () => finish(ok({ accepted: true, revision: '999' })));
        expect(screen.queryByText(/revision 999/)).not.toBeInTheDocument();
    });

    it('paginates receipts exclusively without inventing force-drain actions', async () => {
        receipts = { receipts: [receiptFixture()], nextCursor: 'receipt-a', legacyJobs: [{ id: 'old-job', accountId: 'account-a', purchaseOrderId: 'po-old', state: 'failed', createdAt: '2026-09-22T00:00:00Z' }] };
        render(<DeliveryLaunchPanel {...props} />); await loaded();
        expect(screen.queryByRole('button', { name: /drain/i })).not.toBeInTheDocument();
        receipts = { receipts: [], nextCursor: null, legacyJobs: [] };
        fireEvent.click(screen.getByRole('button', { name: 'Next receipt page' }));
        await screen.findByText('No receipt operations on this page.');
        expect(fetchMock.mock.calls.at(-2)![0]).toBe('/api/delivery-estimates/receipts?cursor=receipt-a');
        fireEvent.click(screen.getByRole('button', { name: 'First receipt page' }));
        await waitFor(() => expect(fetchMock.mock.calls.at(-2)![0]).toBe('/api/delivery-estimates/receipts'));
    });

    it('refreshes a legacy-review conflict so the durable receiving freeze is visible', async () => {
        render(<DeliveryLaunchPanel {...props} />); await loaded(); confirmCutover();
        readiness = readinessFixture({ cutoverState: 'legacy_review', receivingFrozen: true, blockers: ['legacy_jobs_not_drained', 'receiving_frozen'], unresolvedLegacyJobs: 1 });
        fetchMock.mockResolvedValueOnce(fail(409, 'Legacy review required'));
        fireEvent.click(screen.getByRole('button', { name: 'Queue / resume cutover' }));
        await screen.findByText(/Cutover: legacy_review/);
        expect(screen.getByText(/Transport:/)).toHaveTextContent('Receiving: frozen');
        expect(activate()).toBeDisabled(); expect(disable()).toBeEnabled();
    });

    it('shows automatic publishing/revalidation without claiming that a save activated output', async () => {
        readiness = readinessFixture({ mode: 'GUARDED', cutoverState: 'guarded', desiredActive: true, revalidationRequested: true, blockers: ['inputs_pending'] });
        render(<DeliveryLaunchPanel {...props} />); await loaded();
        expect(screen.getByText(/Publishing settings \/ revalidating/)).toBeInTheDocument();
        expect(activate()).toBeDisabled();
        expect(screen.getByText(/Verified storefront state: inactive/)).toBeInTheDocument();
    });

    it('permits a readiness-checked retry after activation exhausts server attempts', async () => {
        readiness = ready(); readiness.work = { action: 'activate', attempts: 8, lastError: 'Control ACK unavailable', nextAttemptAt: null };
        render(<DeliveryLaunchPanel {...props} />); await loaded(); expect(activate()).toBeEnabled();
        fireEvent.click(activate()); await screen.findByText(/Activation queued/);
        expect(JSON.parse(posts()[0][1].body)).toEqual({ active: true });
    });

    it('aborts receipt observations on account switch and does not leak their tokens or forms', async () => {
        receipts.receipts = [receiptFixture()];
        const { rerender } = render(<DeliveryLaunchPanel {...props} />); await loaded();
        let finish!: (value: ReturnType<typeof ok>) => void;
        fetchMock.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
        fireEvent.click(screen.getByRole('button', { name: 'Obtain fresh stock observation' }));
        const signal = posts()[0][1].signal;
        receipts.receipts = [];
        rerender(<DeliveryLaunchPanel {...props} accountId="account-b" />); await loaded();
        const count = fetchMock.mock.calls.length;
        expect(signal.aborted).toBe(true);
        await act(async () => finish(ok({ schemaVersion: 1, operationId: 'receipt-a', observationToken: 'old-secret', stockQuantity: 17, expiresAt: new Date(Date.now() + 120000).toISOString() })));
        expect(screen.queryByText(/Observed Woo stock/)).not.toBeInTheDocument();
        expect(fetchMock).toHaveBeenCalledTimes(count);
    });

    it('stops pending polling in a background tab and aborts the current read', async () => {
        vi.useFakeTimers();
        readiness.work = { action: 'cutover', attempts: 1, lastError: null, nextAttemptAt: null };
        const visibility = vi.spyOn(document, 'visibilityState', 'get'); visibility.mockReturnValue('visible');
        render(<DeliveryLaunchPanel {...props} />); await act(async () => {});
        const count = fetchMock.mock.calls.length;
        visibility.mockReturnValue('hidden'); fireEvent(document, new Event('visibilitychange'));
        await act(async () => vi.advanceTimersByTimeAsync(LAUNCH_POLL_MS * 20));
        expect(fetchMock).toHaveBeenCalledTimes(count);
        visibility.mockReturnValue('visible'); fireEvent(document, new Event('visibilitychange')); await act(async () => {});
        expect(fetchMock).toHaveBeenCalledTimes(count + 3);
        visibility.mockRestore();
    });

    it('polls only pending visible work, stops at a bound, and resumes on manual refresh', async () => {
        vi.useFakeTimers();
        readiness = readinessFixture({ work: { action: 'cutover', attempts: 1, lastError: null, nextAttemptAt: null } });
        render(<DeliveryLaunchPanel {...props} />);
        await act(async () => {});
        const initial = fetchMock.mock.calls.length;
        fireEvent.click(screen.getByRole('button', { name: 'Hide launch details' }));
        await act(async () => vi.advanceTimersByTimeAsync(LAUNCH_POLL_MS * 3));
        expect(fetchMock).toHaveBeenCalledTimes(initial);
        fireEvent.click(screen.getByRole('button', { name: 'Show launch details' }));
        await act(async () => {});
        const reopened = fetchMock.mock.calls.length;
        for (let i = 0; i < LAUNCH_POLL_LIMIT + 2; i++) await act(async () => vi.advanceTimersByTimeAsync(LAUNCH_POLL_MS));
        expect(fetchMock).toHaveBeenCalledTimes(reopened + LAUNCH_POLL_LIMIT * 3);
        expect(screen.getByText(/Automatic checks paused/)).toBeInTheDocument();
        fireEvent.click(refresh()); await act(async () => {});
        expect(screen.queryByText(/Automatic checks paused/)).not.toBeInTheDocument();
        const manual = fetchMock.mock.calls.length;
        readiness = readinessFixture();
        await act(async () => vi.advanceTimersByTimeAsync(LAUNCH_POLL_MS));
        await act(async () => vi.advanceTimersByTimeAsync(LAUNCH_POLL_MS * 3));
        expect(fetchMock).toHaveBeenCalledTimes(manual + 3);
    });
});
