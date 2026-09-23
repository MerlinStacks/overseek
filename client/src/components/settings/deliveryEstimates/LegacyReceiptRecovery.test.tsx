import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { LegacyReceiptRecovery } from './LegacyReceiptRecovery';
import { LaunchApiError, type LegacyAttestation, type LegacyJob } from './launchApi';

const request = vi.fn();
const onChanged = vi.fn();
let retries: Map<string, LegacyAttestation>;
const job: LegacyJob = { id: 'job-a', accountId: 'account-a', purchaseOrderId: 'po-a', state: 'pending',
    sourceType: 'purchase_order', sourceId: null,
    targets: null, originalTargetsAvailable: false, attempts: 0, lastError: null, createdAt: '2026-09-22T00:00:00Z' };
const observation = () => ({ schemaVersion: 1, jobId: 'job-a', sourceIncomplete: true, owners: [{ stockOwnerWooId: 42, stockQuantity: 12 }],
    unobservable: [{ target: { productWooId: 43, variationWooId: null }, reason: 'Custom stock store unsupported' }], observationToken: 'legacy-token', expiresAt: new Date(Date.now() + 300_000).toISOString() });
const mount = (value = job) => render(<LegacyReceiptRecovery job={value} request={request} onChanged={onChanged} retryRequests={retries} />);
const observe = () => screen.getByRole('button', { name: 'Observe legacy inventory' });
const submit = () => screen.getByRole('button', { name: 'Queue legacy reconciliation attestation' });
async function prepare() {
    fireEvent.click(screen.getByLabelText('Inventory receiving is paused for this legacy review.'));
    fireEvent.click(screen.getByLabelText('Legacy process-local work is drained and all pre-upgrade API/worker processes are restarted.'));
    fireEvent.click(observe()); await screen.findByText('Observed stock owner 42: 12');
    fireEvent.change(screen.getByLabelText('Legacy reconciliation reason (5–1000 characters)'), { target: { value: 'Inventory and BOM manually counted' } });
    fireEvent.click(screen.getByLabelText(/I verified the displayed corrected counts/));
}
describe('Legacy receipt resolution contract', () => {
    beforeEach(() => { request.mockReset(); request.mockResolvedValue(observation()); onChanged.mockReset(); retries = new Map(); });

    it('requires pause/restart before observation and manual unobservable/BOM review before reconciliation', async () => {
        mount(); expect(observe()).toBeDisabled();
        await prepare();
        expect(request.mock.calls[0]).toEqual(['receipts/legacy/job-a/observation', { receivingPaused: true, workersRestarted: true }]);
        expect(screen.getByText(/Custom stock store unsupported/)).toBeInTheDocument();
        expect(submit()).toBeDisabled();
        fireEvent.click(screen.getByLabelText(/I manually reviewed unobservable inventory/));
        request.mockImplementationOnce(async (_path, body) => ({ accepted: true, jobId: 'job-a', actionId: body.actionId, state: 'reconciling' }));
        fireEvent.click(submit()); await screen.findByText(/Legacy reconciliation queued, not yet confirmed drained/);
        expect(request.mock.calls[1]).toEqual(['receipts/legacy/job-a/reconcile', {
            receivingPaused: true, workersRestarted: true, actionId: expect.any(String), observationToken: 'legacy-token',
            reason: 'Inventory and BOM manually counted', correctedInventoryIncludesLegacyWork: true, acknowledgeUnobservableTargets: true,
        }]);
        expect(onChanged).toHaveBeenCalledTimes(2);
    });

    it('retains the identical legacy action across a lost ACK and remount', async () => {
        const { unmount } = mount(); await prepare();
        fireEvent.click(screen.getByLabelText(/I manually reviewed unobservable inventory/));
        request.mockRejectedValueOnce(new Error('Lost ACK'));
        fireEvent.click(submit()); await screen.findByText(/Lost ACK/);
        const original = request.mock.calls[1][1];
        expect(observe()).toBeDisabled();
        unmount(); mount({ ...job, state: 'reconciling' });
        request.mockImplementationOnce(async (_path, body) => ({ accepted: true, jobId: 'job-a', actionId: body.actionId, state: 'reconciling' }));
        fireEvent.click(screen.getByRole('button', { name: 'Retry identical legacy attestation' }));
        await screen.findByText(/Legacy reconciliation queued/);
        expect(request.mock.calls[2][1]).toEqual(original);
    });

    it('shows actionable stale observation errors and allows a fresh observation', async () => {
        mount(); await prepare(); fireEvent.click(screen.getByLabelText(/I manually reviewed unobservable inventory/));
        request.mockRejectedValueOnce(new LaunchApiError('Stale legacy stock', 409));
        fireEvent.click(submit()); await screen.findByText(/verify corrected inventory and obtain a fresh observation/);
        expect(observe()).toBeEnabled();
        expect(screen.queryByRole('button', { name: 'Retry identical legacy attestation' })).not.toBeInTheDocument();
    });

    it.each(['drained', 'reconciling', 'future-state'])('fails closed for %s', state => {
        mount({ ...job, state }); expect(screen.queryByRole('button', { name: 'Observe legacy inventory' })).not.toBeInTheDocument();
    });

    it('requires the distinct historical reversal count scope and replays its additional attestation unchanged', async () => {
        const { unmount } = mount({ ...job, sourceType: 'purchase_order_reversal', sourceId: 'po-a' });
        await prepare();
        expect(screen.getByText(/excluding the original legacy receipt effect/)).toHaveTextContent('preserving other completed movements');
        fireEvent.click(screen.getByLabelText(/I manually reviewed unobservable inventory/));
        expect(submit()).toBeDisabled();
        fireEvent.click(screen.getByLabelText(/I confirm inventory excludes the original legacy receipt effect/));
        request.mockRejectedValueOnce(new Error('Lost reversal ACK'));
        fireEvent.click(submit()); await screen.findByText(/Lost reversal ACK/);
        const original = request.mock.calls[1][1];
        expect(original.legacyReceiptReversalConfirmed).toBe(true);
        expect(original.acknowledgeUnobservableTargets).toBe(true);
        unmount(); retries.clear();
        mount({ ...job, sourceType: 'purchase_order_reversal', state: 'reconciliation_failed', lastError: 'ACK unavailable', reconciliation: { ...original, actorId: 'original-actor' } });
        request.mockImplementationOnce(async (_path, body) => ({ accepted: true, jobId: 'job-a', actionId: body.actionId, state: 'reconciling' }));
        fireEvent.click(screen.getByRole('button', { name: 'Retry identical legacy attestation' }));
        await screen.findByText(/Legacy reconciliation queued/);
        expect(request.mock.calls[2][1]).toEqual(original);
        expect(request.mock.calls[2][1]).not.toHaveProperty('actorId');
    });

    it('requires manual scope review when observation returns no owners even without an incomplete flag', async () => {
        request.mockResolvedValueOnce({ ...observation(), owners: [], unobservable: [], sourceIncomplete: false });
        mount();
        fireEvent.click(screen.getByLabelText('Inventory receiving is paused for this legacy review.'));
        fireEvent.click(screen.getByLabelText('Legacy process-local work is drained and all pre-upgrade API/worker processes are restarted.'));
        fireEvent.click(observe());
        await screen.findByLabelText(/I manually reviewed unobservable inventory/);
        expect(submit()).toBeDisabled();
    });
});
