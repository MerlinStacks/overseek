import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ReceiptRecovery } from './ReceiptRecovery';
import { receiptFixture } from './launchFixtures.test-support';
import { LaunchApiError, type Attestation } from './launchApi';

const request = vi.fn();
const onQueued = vi.fn();
let retryRequests: Map<string, Attestation>;
const observation = () => ({ schemaVersion: 1, operationId: 'receipt-a', stockQuantity: 17, observationToken: 'bound-token', expiresAt: new Date(Date.now() + 120_000).toISOString() });
const renderReceipt = (state = 'uncertain') => render(<ReceiptRecovery receipt={receiptFixture({ state })} request={request} onQueued={onQueued} retryRequests={retryRequests} />);
async function observeAndFill() {
    fireEvent.click(screen.getByRole('button', { name: 'Obtain fresh stock observation' }));
    await screen.findByText(/Observed Woo stock: 17/);
    fireEvent.change(screen.getByLabelText('Confirm observed corrected quantity'), { target: { value: '17' } });
    fireEvent.change(screen.getByLabelText('Reconciliation reason (5–1000 characters)'), { target: { value: 'Physical stock counted' } });
    fireEvent.click(screen.getByRole('checkbox'));
}
const submit = () => screen.getByRole('button', { name: 'Queue reconciliation attestation' });

describe('Receipt corrected-count attestation', () => {
    beforeEach(() => { request.mockReset(); onQueued.mockReset(); retryRequests = new Map(); request.mockResolvedValue(observation()); });
    afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); });

    it('requires exact observed quantity, a reason and explicit stock-count attestation; never sends a stock override or delta', async () => {
        renderReceipt();
        fireEvent.click(screen.getByRole('button', { name: 'Obtain fresh stock observation' }));
        await screen.findByText(/Observed Woo stock/);
        expect(request).toHaveBeenCalledWith('receipts/receipt-a/observation', {});
        expect(submit()).toBeDisabled();
        fireEvent.change(screen.getByLabelText('Confirm observed corrected quantity'), { target: { value: '18' } });
        fireEvent.change(screen.getByLabelText('Reconciliation reason (5–1000 characters)'), { target: { value: 'Physical stock counted' } });
        fireEvent.click(screen.getByRole('checkbox')); expect(submit()).toBeDisabled();
        fireEvent.change(screen.getByLabelText('Confirm observed corrected quantity'), { target: { value: '17' } });
        expect(submit()).toBeEnabled();
        request.mockImplementationOnce(async (_path, body) => ({ accepted: true, operationId: 'receipt-a', actionId: body.actionId }));
        fireEvent.click(submit());
        await screen.findByText(/Reconciliation queued, not yet applied/);
        expect(request.mock.calls[1][1]).toEqual({ actionId: expect.any(String), observationToken: 'bound-token', observedStockQuantity: 17, reason: 'Physical stock counted', correctedCountIncludesOperation: true });
        expect(onQueued).toHaveBeenCalledTimes(1);
        expect(screen.queryByRole('button', { name: /retry.*delta/i })).not.toBeInTheDocument();
    });

    it('retains identical request/UUID across ambiguous ACK loss, expiry and receipt pagination/remount', async () => {
        const { unmount } = renderReceipt(); await observeAndFill();
        request.mockRejectedValueOnce(new Error('Network lost'));
        fireEvent.click(submit()); await screen.findByText(/Network lost/);
        const original = request.mock.calls[1][1];
        expect(screen.getByRole('button', { name: 'Obtain fresh stock observation' })).toBeDisabled();
        vi.spyOn(Date, 'now').mockReturnValue(Date.now() + 121_000);
        unmount(); renderReceipt('reconciled');
        request.mockImplementationOnce(async (_path, body) => ({ accepted: true, operationId: 'receipt-a', actionId: body.actionId }));
        fireEvent.click(screen.getByRole('button', { name: 'Retry identical attestation' }));
        await screen.findByText(/Reconciliation queued/);
        expect(request.mock.calls[2][1]).toEqual(original);
        expect(retryRequests.size).toBe(0);
    });

    it('makes 409 stale observation actionable and obtains a new observation and action UUID', async () => {
        renderReceipt(); await observeAndFill();
        request.mockRejectedValueOnce(new LaunchApiError('Observation rejected', 409));
        fireEvent.click(submit()); await screen.findByText(/verify the corrected count and obtain a fresh observation/);
        const originalId = request.mock.calls[1][1].actionId;
        expect(screen.queryByRole('button', { name: 'Retry identical attestation' })).not.toBeInTheDocument();
        request.mockResolvedValueOnce({ ...observation(), observationToken: 'fresh-token' });
        await observeAndFill();
        request.mockImplementationOnce(async (_path, body) => ({ accepted: true, operationId: 'receipt-a', actionId: body.actionId }));
        fireEvent.click(submit()); await screen.findByText(/Reconciliation queued/);
        expect(request.mock.calls[3][1].actionId).not.toBe(originalId);
        expect(request.mock.calls[3][1].observationToken).toBe('fresh-token');
    });

    it('rejects expired observations before sending an attestation', async () => {
        renderReceipt(); await observeAndFill();
        vi.useFakeTimers(); vi.setSystemTime(Date.now() + 121_000);
        fireEvent.click(submit());
        expect(screen.getByRole('alert')).toHaveTextContent('Observation expired');
        expect(request).toHaveBeenCalledTimes(1);
    });

    it('replays only the persisted attestation fields for worker ACK exhaustion, while stale worker observations require a new one', async () => {
        const reconciliation = { actionId: 'old-action', observationToken: 'old-token', observedStockQuantity: 17,
            reason: 'Physical stock counted', correctedCountIncludesOperation: true, actorId: 'server-actor', operation: { delta: 3 } };
        const { rerender } = render(<ReceiptRecovery receipt={receiptFixture({ state: 'reconciliation_failed', lastError: 'Reconciliation ACK unavailable', reconciliation })}
            request={request} onQueued={onQueued} retryRequests={retryRequests} />);
        request.mockImplementationOnce(async (_path, body) => ({ accepted: true, operationId: 'receipt-a', actionId: body.actionId }));
        fireEvent.click(screen.getByRole('button', { name: 'Retry identical attestation' })); await screen.findByText(/Reconciliation queued/);
        expect(request.mock.calls[0][1]).toEqual({ actionId: 'old-action', observationToken: 'old-token', observedStockQuantity: 17, reason: 'Physical stock counted', correctedCountIncludesOperation: true });
        rerender(<ReceiptRecovery receipt={receiptFixture({ state: 'reconciliation_failed', lastError: 'Observation rejected; obtain a fresh corrected-stock observation.', reconciliation })}
            request={request} onQueued={onQueued} retryRequests={retryRequests} />);
        expect(screen.queryByRole('button', { name: 'Retry identical attestation' })).not.toBeInTheDocument();
        expect(screen.getByRole('button', { name: 'Obtain fresh stock observation' })).toBeEnabled();
    });

    it.each(['pending', 'prepared', 'applied', 'reconciling', 'reconciled', 'future-state'])('does not expose observation for %s', state => {
        renderReceipt(state);
        expect(screen.queryByRole('button', { name: 'Obtain fresh stock observation' })).not.toBeInTheDocument();
        expect(request).not.toHaveBeenCalled();
    });

    it('shows failed-reconciliation recovery guidance and rejects mismatched observation identities', async () => {
        request.mockResolvedValueOnce({ ...observation(), operationId: 'another-receipt' });
        renderReceipt('reconciliation_failed');
        expect(screen.getByText(/For a rejected or stale observation/)).toBeInTheDocument();
        fireEvent.click(screen.getByRole('button', { name: 'Obtain fresh stock observation' }));
        await screen.findByText(/Invalid or expired observation/);
        expect(screen.queryByLabelText('Confirm observed corrected quantity')).not.toBeInTheDocument();
    });

    it('does not present cancelled observation requests as successful', async () => {
        request.mockRejectedValueOnce(new DOMException('Request cancelled', 'AbortError'));
        renderReceipt(); fireEvent.click(screen.getByRole('button', { name: 'Obtain fresh stock observation' }));
        await act(async () => {});
        await waitFor(() => expect(screen.getByRole('button', { name: 'Obtain fresh stock observation' })).toBeEnabled());
        expect(screen.queryByLabelText('Confirm observed corrected quantity')).not.toBeInTheDocument();
    });
});
