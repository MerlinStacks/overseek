import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { ReceiptCascadeStatus } from './ReceiptCascadeStatus';
import { ReceiptRecovery } from './ReceiptRecovery';
import { receiptFixture } from './launchFixtures.test-support';
import { pendingReceipt } from './launchApi';

describe('Durable post-stock BOM follow-up', () => {
    it('distinguishes already applied stock from cascade failure and retries only the cascade endpoint', async () => {
        const request = vi.fn().mockResolvedValue({ accepted: true, operationId: 'receipt-a', cascadeState: 'pending' });
        const onQueued = vi.fn();
        const receipt = receiptFixture({ state: 'applied', cascadeState: 'failed', cascadeAttempts: 8, cascadeError: 'BOM cycle detected' });
        render(<ReceiptRecovery receipt={receipt} request={request} onQueued={onQueued} retryRequests={new Map()} />);
        expect(screen.getByText('Native stock: already applied.')).toBeInTheDocument();
        expect(screen.getByText(/BOM follow-up error: BOM cycle detected/)).toBeInTheDocument();
        expect(screen.queryByRole('button', { name: 'Obtain fresh stock observation' })).not.toBeInTheDocument();
        fireEvent.click(screen.getByRole('button', { name: 'Retry BOM follow-up only' }));
        await screen.findByText(/BOM follow-up queued, not yet complete/);
        expect(request).toHaveBeenCalledExactlyOnceWith('receipts/receipt-a/cascade/retry', {});
        expect(onQueued).toHaveBeenCalledTimes(1);
    });

    it.each(['pending', 'waiting_receipt', 'done', 'future-state'])('does not expose retry for %s', cascadeState => {
        render(<ReceiptCascadeStatus receipt={receiptFixture({ state: 'applied', cascadeState })} request={vi.fn()} onQueued={vi.fn()} />);
        expect(screen.queryByRole('button', { name: 'Retry BOM follow-up only' })).not.toBeInTheDocument();
        expect(pendingReceipt(receiptFixture({ state: 'applied', cascadeState }))).toBe(cascadeState === 'pending');
    });

    it('does not retry cascade while native stock is uncertain or for read-only staff', () => {
        const { rerender } = render(<ReceiptCascadeStatus receipt={receiptFixture({ state: 'uncertain', cascadeState: 'failed' })} request={vi.fn()} onQueued={vi.fn()} />);
        expect(screen.getByText('Native stock: not confirmed settled.')).toBeInTheDocument();
        expect(screen.getByRole('button', { name: 'Retry BOM follow-up only' })).toBeDisabled();
        rerender(<ReceiptCascadeStatus receipt={receiptFixture({ state: 'applied', cascadeState: 'failed' })} request={vi.fn()} onQueued={vi.fn()} canInventory={false} />);
        expect(screen.queryByRole('button', { name: 'Retry BOM follow-up only' })).not.toBeInTheDocument();
    });

    it('allows an idempotent cascade retry after acknowledgement loss without changing stock', async () => {
        const request = vi.fn().mockRejectedValueOnce(new Error('Network lost')).mockResolvedValueOnce({ accepted: true, operationId: 'receipt-a', cascadeState: 'done' });
        render(<ReceiptCascadeStatus receipt={receiptFixture({ state: 'reconciled', cascadeState: 'failed' })} request={request} onQueued={vi.fn()} />);
        fireEvent.click(screen.getByRole('button', { name: 'Retry BOM follow-up only' })); await screen.findByText(/Network lost/);
        fireEvent.click(screen.getByRole('button', { name: 'Retry BOM follow-up only' })); await screen.findByText(/already complete/);
        expect(request.mock.calls[1]).toEqual(request.mock.calls[0]);
    });

    it.each([
        ['purchase_order', 3, 'Purchase order receipt'], ['purchase_order', -3, 'Purchase order reversal'],
        ['bom_consumption', -3, 'BOM consumption'], ['bom_reversal', 3, 'BOM cancellation / restock'],
    ])('labels %s with delta %s using actual provenance', (sourceType, delta, label) => {
        render(<ReceiptRecovery receipt={receiptFixture({ sourceType: String(sourceType), delta: Number(delta), purchaseOrderId: String(sourceType).startsWith('bom') ? 'bom-order:123' : 'po-a' })}
            request={vi.fn()} onQueued={vi.fn()} retryRequests={new Map()} />);
        expect(screen.getByText(`Source: ${label} · Source reference: not supplied`)).toBeInTheDocument();
        if (String(sourceType).startsWith('bom')) expect(screen.queryByRole('link', { name: /Open purchase order/ })).not.toBeInTheDocument();
        else expect(screen.getByRole('link', { name: 'Open purchase order po-a' })).toHaveAttribute('href', '/inventory/purchase-orders/po-a');
    });
});
