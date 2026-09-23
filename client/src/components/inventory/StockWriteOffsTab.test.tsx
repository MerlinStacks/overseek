import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { StockWriteOffsTab } from './StockWriteOffsTab';
import { csvCell, writeOffCsv, type WriteOffRequest } from './stockWriteOffs';

const context = vi.hoisted(() => ({ account: { id: 'a', currency: 'AUD' }, permissions: { '*': true } as Record<string, boolean> }));
vi.mock('../../context/AccountContext', () => ({ useAccount: () => ({ currentAccount: context.account, activePermissions: context.permissions }) }));
vi.mock('../../context/AuthContext', () => ({ useAuth: () => ({ token: 'token', user: { id: 'user' } }) }));
const fetchMock = vi.fn();
const ok = (data: unknown) => ({ ok: true, json: async () => data });
const component = { internalProductId: 'component', name: 'Blank', sku: 'B', type: 'INTERNAL', unitCost: null, stockQuantity: 10 };
const variant = { productId: 'product', variationId: 42, name: 'Shirt blue', sku: 'BLUE', type: 'VARIATION', unitCost: 7.5, stockQuantity: 9 };
const draft = { id: 'draft', reference: 'WO-1', status: 'DRAFT', reason: 'MISSING', notes: '', createdAt: '2026-09-23T00:00:00Z', finalizedAt: null, totalCost: 0, syncStatus: 'NOT_REQUIRED', items: [{ ...component, id: 'line', quantity: 1, unitCost: 0, unitCostOverride: 0, totalCost: 0 }] };
const list = (items: unknown[] = [], total = items.length) => ({ items, total, page: 1, pageSize: 25, summary: { totalCost: 12, count: 1, quantity: 2 } });
function writes() { return fetchMock.mock.calls.filter(([, init]) => init.method !== 'GET'); }

beforeEach(() => {
    context.account = { id: 'a', currency: 'AUD' }; context.permissions = { '*': true };
    fetchMock.mockReset().mockImplementation(async (url: string, init: RequestInit) => {
        if (url.includes('/products?')) return ok({ items: [component, variant] });
        if (url.endsWith('/finalize')) return ok({ ...draft, status: 'FINALIZED', syncStatus: 'PENDING', finalizedAt: '2026-09-23T01:00:00Z' });
        if (init.method === 'DELETE') return ok({ deleted: true });
        if (init.method === 'POST' || init.method === 'PUT' || url.endsWith('/draft')) return ok(draft);
        return ok(list([draft]));
    });
    vi.stubGlobal('fetch', fetchMock);
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });

describe('stock write-off workflow', () => {
    it('requires both permissions and accepts the existing wildcard hook', async () => {
        context.permissions = { manage_inventory: true };
        const view = render(<StockWriteOffsTab />);
        expect(screen.queryByText('New write-off')).not.toBeInTheDocument(); expect(fetchMock).not.toHaveBeenCalled();
        context.permissions = { view_cogs: true }; view.rerender(<StockWriteOffsTab />);
        expect(fetchMock).not.toHaveBeenCalled();
        context.permissions = { '*': true }; view.rerender(<StockWriteOffsTab />);
        expect(await screen.findByText('WO-1')).toBeInTheDocument();
    });

    it('saves explicit zero cost and variant identities, then requires a separate finalize confirmation', async () => {
        render(<StockWriteOffsTab />);
        fireEvent.click(screen.getByText('New write-off'));
        fireEvent.click(await screen.findByRole('button', { name: /Blank · B/ }, { timeout: 3000 }));
        expect(screen.getByText('Save draft')).toBeDisabled();
        fireEvent.change(screen.getByLabelText('Total unit cost override for Blank'), { target: { value: '0' } });
        fireEvent.click(screen.getByRole('button', { name: /Shirt blue · BLUE/ }));
        fireEvent.change(screen.getByLabelText('Quantity for Shirt blue'), { target: { value: '2' } });
        fireEvent.change(screen.getByLabelText('Reason'), { target: { value: 'DAMAGED' } });
        fireEvent.change(screen.getByLabelText('Notes'), { target: { value: 'Broken in storage' } });
        fireEvent.click(screen.getByText('Save draft'));
        await screen.findByText('Finalize write-off');
        expect(JSON.parse(writes()[0][1].body)).toEqual({ reason: 'DAMAGED', notes: 'Broken in storage', items: [{ internalProductId: 'component', quantity: 1, unitCostOverride: 0 }, { productId: 'product', variationId: 42, quantity: 2 }] });
        expect(writes()).toHaveLength(1);
        fireEvent.click(screen.getByText('Finalize write-off'));
        expect(writes()).toHaveLength(1);
        fireEvent.click(screen.getByText('Confirm finalize'));
        expect(await screen.findByText('Finalized · Read-only')).toBeInTheDocument();
        const dialog = within(screen.getByRole('dialog'));
        expect(dialog.getByText('Stock sync pending')).toBeInTheDocument();
        expect(dialog.queryByText('Save draft')).not.toBeInTheDocument();
        expect(dialog.getByLabelText('Quantity for Blank')).toBeDisabled();
    });

    it('edits an existing draft, displays server conflicts and deletes only after confirmation', async () => {
        render(<StockWriteOffsTab />);
        fireEvent.click(await screen.findByRole('button', { name: 'Edit WO-1' }));
        await screen.findByRole('dialog');
        fireEvent.change(screen.getByLabelText('Notes'), { target: { value: 'Count corrected' } });
        expect(screen.getByText('Finalize write-off')).toBeDisabled();
        fireEvent.click(screen.getByText('Save draft'));
        await waitFor(() => expect(screen.getByText('Finalize write-off')).toBeEnabled());
        expect(writes()[0][1].method).toBe('PUT');
        fetchMock.mockImplementationOnce(async () => ({ ok: false, json: async () => ({ error: 'Insufficient stock. Reduce the quantity.' }) }));
        fireEvent.click(screen.getByText('Finalize write-off')); fireEvent.click(screen.getByText('Confirm finalize'));
        expect(await screen.findByText('Insufficient stock. Reduce the quantity.')).toBeInTheDocument();
        fireEvent.click(screen.getByText('Delete draft'));
        expect(writes().some(([, init]) => init.method === 'DELETE')).toBe(false);
        fireEvent.click(screen.getByText('Confirm delete'));
        await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
        expect(writes().at(-1)?.[1].method).toBe('DELETE');
    });

    it('clears the previous account editor immediately and ignores late detail responses', async () => {
        let resolve!: (value: unknown) => void;
        const view = render(<StockWriteOffsTab />);
        await screen.findByText('WO-1');
        fetchMock.mockImplementationOnce(() => new Promise(r => { resolve = r; }));
        fireEvent.click(screen.getByRole('button', { name: 'Edit WO-1' }));
        context.account = { id: 'b', currency: 'USD' };
        fetchMock.mockImplementation(async () => ok(list()));
        view.rerender(<StockWriteOffsTab />);
        expect(screen.queryByText('WO-1')).not.toBeInTheDocument();
        await act(async () => resolve(ok(draft)));
        expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
        fireEvent.click(screen.getByText('New write-off'));
        context.account = { id: 'c', currency: 'AUD' }; view.rerender(<StockWriteOffsTab />);
        expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
        expect(writes()).toHaveLength(0);
    });

    it('filters finalization dates/reasons/status and paginates while ignoring stale list results', async () => {
        fetchMock.mockResolvedValue(ok(list([draft], 26)));
        render(<StockWriteOffsTab />);
        await screen.findByText('WO-1');
        fireEvent.click(screen.getByText('Next'));
        await waitFor(() => expect(fetchMock.mock.calls.at(-1)?.[0]).toContain('page=2'));
        await screen.findByText('WO-1');
        let resolve!: (value: unknown) => void;
        fetchMock.mockImplementationOnce(() => new Promise(r => { resolve = r; }));
        fireEvent.change(screen.getByLabelText('Filter reason'), { target: { value: 'EXPIRED' } });
        fireEvent.change(screen.getByLabelText('Status'), { target: { value: 'FINALIZED' } });
        fireEvent.change(screen.getByLabelText('Finalized from (UTC)'), { target: { value: '2026-09-01' } });
        fireEvent.change(screen.getByLabelText('Finalized to (UTC)'), { target: { value: '2026-09-23' } });
        await screen.findByText('WO-1');
        const url = new URL(fetchMock.mock.calls.at(-1)![0], 'http://localhost');
        expect(Object.fromEntries(url.searchParams)).toEqual({ page: '1', reason: 'EXPIRED', status: 'FINALIZED', from: '2026-09-01', to: '2026-09-23' });
        await act(async () => resolve(ok(list([{ ...draft, reference: 'STALE' }]))));
        expect(screen.queryByText('STALE')).not.toBeInTheDocument();
    });

    it('shows finalized sync failures read-only and refreshes recovery status', async () => {
        const finalized = { ...draft, status: 'FINALIZED', syncStatus: 'NEEDS_ATTENTION', syncOperations: [{ operationId: 'op', lastError: 'Plugin capability blocked' }] };
        fetchMock.mockImplementation(async (url: string) => ok(url.endsWith('/draft') ? finalized : list([finalized])));
        render(<StockWriteOffsTab />);
        fireEvent.click(await screen.findByRole('button', { name: 'View WO-1' }));
        expect(await screen.findByText('Plugin capability blocked')).toBeInTheDocument();
        expect(screen.queryByText('Delete draft')).not.toBeInTheDocument();
        fetchMock.mockImplementationOnce(async () => ok({ ...finalized, syncStatus: 'SYNCED', syncOperations: [] }));
        fireEvent.click(screen.getByText('Refresh sync status'));
        expect(await screen.findByText('Stock synced')).toBeInTheDocument();
        expect(screen.queryByText('Plugin capability blocked')).not.toBeInTheDocument();
        expect(writes()).toHaveLength(0);
    });

    it('downloads the filtered report from the export button and cancels stale tenant exports', async () => {
        const create = vi.fn(() => 'blob:report');
        vi.stubGlobal('URL', class extends URL { static createObjectURL = create; static revokeObjectURL = vi.fn(); });
        const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
        const report = { items: [], total: 0, pageSize: 500, asOf: '2026-09-23T01:00:00Z' };
        fetchMock.mockImplementation(async (url: string) => ok(url.includes('/report?') ? report : list()));
        const view = render(<StockWriteOffsTab />);
        fireEvent.change(screen.getByLabelText('Filter reason'), { target: { value: 'DAMAGED' } });
        fireEvent.click(screen.getByText('Export finalized CSV'));
        await waitFor(() => expect(click).toHaveBeenCalledTimes(1));
        expect(fetchMock.mock.calls.some(([url]) => url.includes('/report?page=1&reason=DAMAGED'))).toBe(true);
        let resolve!: (value: unknown) => void;
        fetchMock.mockImplementationOnce(() => new Promise(r => { resolve = r; }));
        fireEvent.click(screen.getByText('Export finalized CSV'));
        context.account = { id: 'b', currency: 'AUD' }; view.rerender(<StockWriteOffsTab />);
        await act(async () => resolve(ok(report)));
        expect(click).toHaveBeenCalledTimes(1);
    });
});

describe('CSV report', () => {
    it('exports every 500-row page with the first cutoff and reason/date filters, preserving four-decimal costs', async () => {
        const row = { id: 'wo', itemId: 'line', reference: 'WO-1', reason: 'OTHER', finalizedAt: '2026-09-23T00:00:00Z', name: '=HYPERLINK("bad")', sku: 'A,\nB', type: 'PRODUCT', quantity: 1, unitCost: 1.2345, totalCost: 1.2345 };
        const request = vi.fn().mockResolvedValueOnce({ items: Array.from({ length: 500 }, () => row), total: 501, pageSize: 500, asOf: '2026-09-23T01:00:00Z' }).mockResolvedValueOnce({ items: [{ ...row, itemId: 'last' }], total: 501, pageSize: 500, asOf: '2026-09-23T01:00:00Z' });
        const csv = await writeOffCsv(request as WriteOffRequest, { reason: 'OTHER', from: '2026-09-01', to: '2026-09-23' }, 'AUD');
        expect(request).toHaveBeenCalledTimes(2);
        const query = new URL(request.mock.calls[1][0], 'http://localhost').searchParams;
        expect(Object.fromEntries(query)).toEqual({ page: '2', reason: 'OTHER', from: '2026-09-01', to: '2026-09-23', asOf: '2026-09-23T01:00:00Z' });
        expect(csv).toContain('"\'=HYPERLINK(""bad"")"'); expect(csv).toContain('"A,\nB"'); expect(csv).toContain('"1.2345"'); expect(csv).toContain('"last"');
        for (const text of ['=1', '+1', '-1', '@SUM(A1)', '  =1', '\t=1', '\rtext']) expect(csvCell(text)).toBe(`"'${text}"`);
    });
});
