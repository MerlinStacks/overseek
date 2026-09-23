import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PurchaseOrderReceiptRecovery } from './PurchaseOrderReceiptRecovery';
import type { ReceiptCycle } from './launchApi';

const fetchMock = vi.fn();
const props = { accountId: 'account-a', token: 'token-a', canInventory: true, visible: true, onChanged: vi.fn() };
const ok = (data: unknown) => ({ ok: true, json: async () => data });
const po = { id: 'po-a', accountId: 'account-a', status: 'RECEIVED', orderNumber: 'PO-101', items: [{ id: 'line-a', name: 'Component', quantity: 5, productId: 'p-a', product: { wooId: 42 }, variationWooId: null }] };
const job = { id: 'legacy_po_restore_po-a', accountId: 'account-a', purchaseOrderId: 'po-a', state: 'pending', sourceType: 'purchase_order_reversal', sourceId: 'po-a', originalTargetsAvailable: false, targets: null, attempts: 0, lastError: null, createdAt: '2026-09-22' };
let cycles: ReceiptCycle[];
async function preview() {
    fireEvent.change(screen.getByLabelText('Purchase order ID'), { target: { value: 'po-a' } });
    fireEvent.click(screen.getByRole('button', { name: 'Preview saved purchase order' }));
    await screen.findByText(/Saved status: RECEIVED/);
}
function confirmPreview() {
    fireEvent.click(screen.getByLabelText('I have paused receiving for this historical PO reversal.'));
    fireEvent.click(screen.getByLabelText('I have drained legacy work and restarted all pre-upgrade API/worker processes.'));
    fireEvent.click(screen.getByLabelText('I reviewed this saved PO and understand its quantities are not proof of historical stock effects.'));
}
const start = () => screen.getByRole('button', { name: 'Start / reopen historical reversal review' });
describe('Historical PO recovery entry point', () => {
    beforeEach(() => {
        cycles = []; fetchMock.mockReset(); props.onChanged.mockReset();
        fetchMock.mockImplementation(async (url: string) => {
            if (url.includes('/inventory/purchase-orders/')) return ok(po);
            if (url.includes('/receipts/cycles')) return ok({ cycles, nextCursor: null });
            if (url.includes('/receipts/legacy-reversals/')) return ok({ accepted: true, jobId: job.id, state: 'pending' });
            if (url.endsWith('/receipts/legacy')) return ok({ jobs: [job], nextCursor: null });
            throw new Error(`Unexpected request: ${url}`);
        });
        vi.stubGlobal('fetch', fetchMock);
    });
    afterEach(() => vi.unstubAllGlobals());

    it('previews saved quantities and requires confirmations before creating/reopening the actual review job', async () => {
        render(<PurchaseOrderReceiptRecovery {...props} />); await preview();
        expect(screen.getByText(/Component · PO quantity: 5/)).toBeInTheDocument();
        expect(start()).toBeDisabled(); confirmPreview(); fireEvent.click(start());
        await screen.findByText(`Legacy job ${job.id}`);
        const post = fetchMock.mock.calls.find(([, init]) => init.method === 'POST')!;
        expect(post[0]).toBe('/api/delivery-estimates/receipts/legacy-reversals/po-a');
        expect(JSON.parse(post[1].body)).toEqual({ receivingPaused: true, workersRestarted: true });
        expect(post[1].headers).toMatchObject({ Authorization: 'Bearer token-a', 'X-Account-ID': 'account-a' });
        expect(screen.getByText(/This does not confirm stock correction or PO reversal/)).toBeInTheDocument();
        expect(screen.getByText(/excluding the original legacy receipt effect/)).toBeInTheDocument();
        fireEvent.click(start()); await waitFor(() => expect(fetchMock.mock.calls.filter(([, init]) => init.method === 'POST')).toHaveLength(2));
        expect(fetchMock.mock.calls.filter(([, init]) => init.method === 'POST')[1]).toEqual(post);
    });

    it('exposes skipped-only immutable provenance and refuses to bypass an active guarded cycle', async () => {
        cycles = [{ id: 'cycle-a', accountId: 'account-a', purchaseOrderId: 'po-a', active: true, createdAt: '2026-09-22', skippedLines: [{ lineId: 'line-a', productId: 'p-a', variationWooId: null, quantity: 5, reason: 'finished_bom' }] }];
        render(<PurchaseOrderReceiptRecovery {...props} />); await preview();
        expect(screen.getByText(/Skipped: finished_bom/)).toHaveTextContent('Quantity 5');
        expect(screen.getByText(/A skipped-only cycle is real provenance/)).toBeInTheDocument();
        expect(screen.queryByRole('button', { name: 'Start / reopen historical reversal review' })).not.toBeInTheDocument();
        expect(screen.getByText(/Use the PO’s normal ledger reversal/)).toBeInTheDocument();
    });

    it('requires all cycle pages before concluding that there is no active guarded provenance', async () => {
        fetchMock.mockImplementation(async (url: string) => url.includes('/inventory/') ? ok(po) : ok({ cycles: [], nextCursor: 'cycle-page-1' }));
        render(<PurchaseOrderReceiptRecovery {...props} />); await preview();
        expect(screen.queryByRole('button', { name: 'Start / reopen historical reversal review' })).not.toBeInTheDocument();
        fetchMock.mockImplementation(async (url: string) => url.includes('/inventory/') ? ok(po) : ok({ cycles: [], nextCursor: null }));
        fireEvent.click(screen.getByRole('button', { name: 'Load more receipt cycles before review' }));
        await screen.findByRole('button', { name: 'Start / reopen historical reversal review' });
        expect(fetchMock.mock.calls.at(-1)![0]).toBe('/api/delivery-estimates/receipts/cycles?purchaseOrderId=po-a&cursor=cycle-page-1');
    });

    it('preserves ordinary PO access denial and does not expose recovery writes', async () => {
        fetchMock.mockResolvedValue({ ok: false, status: 403, json: async () => ({ error: 'PO permission denied' }) });
        render(<PurchaseOrderReceiptRecovery {...props} />);
        fireEvent.change(screen.getByLabelText('Purchase order ID'), { target: { value: 'po-a' } });
        fireEvent.click(screen.getByRole('button', { name: 'Preview saved purchase order' }));
        await screen.findByText('PO permission denied');
        expect(screen.queryByRole('button', { name: 'Start / reopen historical reversal review' })).not.toBeInTheDocument();
    });

    it('is read-only without manage_inventory and makes no recovery calls', () => {
        render(<PurchaseOrderReceiptRecovery {...props} canInventory={false} />);
        expect(screen.getByText(/Viewing receipt provenance and performing recovery requires manage_inventory/)).toBeInTheDocument();
        expect(fetchMock).not.toHaveBeenCalled();
    });

    it('aborts an old-account preview and ignores its delayed PO/cycle result', async () => {
        let finish!: (value: ReturnType<typeof ok>) => void;
        fetchMock.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
        const { rerender } = render(<PurchaseOrderReceiptRecovery {...props} />);
        fireEvent.change(screen.getByLabelText('Purchase order ID'), { target: { value: 'po-a' } });
        fireEvent.click(screen.getByRole('button', { name: 'Preview saved purchase order' }));
        const signal = fetchMock.mock.calls[0][1].signal;
        rerender(<PurchaseOrderReceiptRecovery {...props} accountId="account-b" />);
        expect(signal.aborted).toBe(true);
        await act(async () => finish(ok(po)));
        expect(screen.queryByText(/PO-101/)).not.toBeInTheDocument();
        expect(screen.queryByRole('button', { name: 'Start / reopen historical reversal review' })).not.toBeInTheDocument();
    });
});
