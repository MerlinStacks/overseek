import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
const m = vi.hoisted(() => ({ fetch: vi.fn(), account: { id: 'a' }, canRead: true, canCreate: true }));
vi.mock('../../context/AuthContext', () => ({ useAuth: () => ({ token: 't', user: { id: 'u' } }) }));
vi.mock('../../context/AccountContext', () => ({ useAccount: () => ({ currentAccount: m.account }) }));
vi.mock('../../hooks/usePermissions', () => ({ usePermissions: () => ({ hasPermission: (key: string) => key === 'view_inventory' ? m.canRead : m.canCreate }) }));
import { PurchaseOrderList } from './PurchaseOrderList';

const recordId = 'df6be184-724a-4b94-9dee-5c372a67836b';
const order = (overrides = {}) => ({ id: recordId, orderNumber: null, status: 'ORDERED', totalAmount: '115', supplier: { name: 'Ramo' }, orderDate: '2026-10-22T00:00:00.000Z', expectedDate: null, trackingLink: null, ...overrides });
const response = (value: unknown) => new Response(JSON.stringify(value), { headers: { 'Content-Type': 'application/json' } });
const overview = (overrides = {}) => ({ orders: [order(), order({ id: 'second', orderNumber: 'PO-2026-12', status: 'RECEIVED', totalAmount: '0', supplier: { name: 'Vendor' } })], total: 90, page: 1, limit: 25, ...overrides });
const mount = () => render(<MemoryRouter><PurchaseOrderList /></MemoryRouter>);
beforeEach(() => { vi.clearAllMocks(); m.account = { id: 'a' }; m.canRead = true; m.canCreate = true; vi.stubGlobal('fetch', m.fetch); m.fetch.mockImplementation(async () => response(overview())); });
afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });

it('restores table hierarchy, meaningful status badges and compact unnumbered record references', async () => {
    mount();
    await screen.findByRole('link', { name: 'PO-2026-12' });
    const fallback = screen.getByRole('link', { name: 'Unnumbered PO' });
    expect(fallback).toHaveAttribute('href', `/inventory/purchase-orders/${recordId}`);
    expect(fallback).toHaveAttribute('title', recordId);
    expect(screen.getByText('Record ID: DF6BE184')).toBeInTheDocument();
    expect(screen.queryByText(recordId)).toBeNull();
    expect(screen.getAllByRole('columnheader')).toHaveLength(8);
    expect(screen.getByText('Ordered', { selector: 'span' })).toHaveClass('rounded-full', 'bg-blue-50');
    expect(screen.getByText('Received', { selector: 'span' })).toHaveClass('bg-emerald-50');
    expect(screen.getByRole('link', { name: 'New Purchase Order' })).toHaveClass('bg-indigo-600');
    expect(screen.getByRole('table').parentElement).toHaveClass('overflow-x-auto');
    screen.getAllByRole('button').forEach(button => expect(button).toHaveAttribute('type', 'button'));
});

it('labels page counts honestly and does not invent currency, receipt dates or order numbers', async () => {
    mount();
    await screen.findByText('PO-2026-12');
    expect(screen.getByText('Matching orders').nextElementSibling).toHaveTextContent('90');
    expect(screen.getByText('Ordered on this page').nextElementSibling).toHaveTextContent('1');
    expect(screen.getByText('Received on this page').nextElementSibling).toHaveTextContent('1');
    expect(screen.getByText('Drafts on this page').nextElementSibling).toHaveTextContent('0');
    const row = screen.getByRole('link', { name: 'PO-2026-12' }).closest('tr')!;
    expect(within(row).getByText('0')).toBeInTheDocument();
    expect(within(row).getByText('Unavailable')).toBeInTheDocument();
    expect(screen.queryByText(/Pending Value|Received This Month|AUD|USD|\$115/)).toBeNull();
    expect(screen.getByText('Purchase-order amounts and dates').closest('details')).not.toHaveAttribute('open');
});

it('groups compact summaries with the status filter and create action in a wrapping toolbar', async () => {
    mount();
    await screen.findByText('Matching orders');
    const filter = screen.getByRole('combobox', { name: 'Status' });
    const toolbar = filter.closest('[aria-label="Purchase order filters and summary"]')!;
    expect(toolbar).toHaveClass('flex', 'flex-wrap');
    expect(toolbar).toContainElement(screen.getByText('Matching orders'));
    expect(toolbar).toContainElement(screen.getByRole('link', { name: 'New Purchase Order' }));
    const count = screen.getByText('Matching orders').nextElementSibling!;
    expect(count).toHaveClass('text-base');
    expect(count).not.toHaveClass('text-2xl');
    expect(count.closest('dl')).toHaveClass('grid-cols-2', 'sm:grid-cols-4', 'xl:flex-1');
});

it('requests server pages and resets to the first page when the status changes', async () => {
    m.fetch.mockImplementation(async (url: string) => response(overview({ page: Number(new URL(url, 'https://app.test').searchParams.get('page')) })));
    mount();
    await screen.findByText('Page 1 of 4');
    fireEvent.click(screen.getByRole('button', { name: 'Next Page' }));
    await screen.findByText('Page 2 of 4');
    fireEvent.change(screen.getByRole('combobox', { name: 'Status' }), { target: { value: 'RECEIVED' } });
    await screen.findByText('Page 1 of 4');
    expect(m.fetch.mock.calls.at(-1)?.[0]).toContain('page=1&limit=25&status=RECEIVED');
    expect(m.fetch.mock.calls.at(-1)?.[1].headers['X-Account-ID']).toBe('a');
    expect(m.fetch.mock.calls.every(([, options]) => !options.method || options.method === 'GET')).toBe(true);
});

it('keeps source tracking links deliberate and omits unsafe destinations', async () => {
    m.fetch.mockResolvedValue(response(overview({ orders: [order({ trackingLink: 'javascript:alert(1)' }), order({ id: 'safe', orderNumber: 'Safe order', trackingLink: 'https://carrier.test/track/42' })] })));
    mount();
    const tracking = await screen.findByRole('link', { name: 'Track shipment' });
    expect(screen.getAllByRole('link', { name: 'Track shipment' })).toHaveLength(1);
    expect(tracking).toHaveAttribute('href', 'https://carrier.test/track/42');
    expect(tracking).toHaveAttribute('rel', 'noopener noreferrer');
});

it('keeps read failures distinct from empty orders and offers a retry', async () => {
    m.fetch.mockResolvedValueOnce(new Response('', { status: 503 })).mockResolvedValueOnce(response(overview({ orders: [], total: 0 })));
    mount();
    await screen.findByRole('alert');
    expect(screen.queryByText('Matching orders')).toBeNull();
    expect(screen.queryByText('No orders on this page.')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Retry orders' }));
    await screen.findByText('No orders on this page.');
    expect(screen.getByRole('button', { name: 'Next Page' })).toBeDisabled();
});

it('aborts old-account reads and never displays their late purchase orders', async () => {
    let resolve!: (value: Response) => void;
    m.fetch.mockReturnValueOnce(new Promise(r => { resolve = r; })).mockImplementation(async () => response(overview({ orders: [order({ id: 'new', orderNumber: 'New account PO' })] })));
    const view = mount();
    await waitFor(() => expect(m.fetch).toHaveBeenCalledOnce());
    const signal = m.fetch.mock.calls[0][1].signal;
    m.account = { id: 'b' };
    view.rerender(<MemoryRouter><PurchaseOrderList /></MemoryRouter>);
    await screen.findByText('New account PO');
    await act(async () => resolve(response(overview({ orders: [order({ orderNumber: 'Private old PO' })] }))));
    expect(signal.aborted).toBe(true);
    expect(screen.queryByText('Private old PO')).toBeNull();
});

it('honors separate read and creation permissions', async () => {
    m.canCreate = false;
    const view = mount();
    await screen.findByText('PO-2026-12');
    expect(screen.queryByRole('link', { name: 'New Purchase Order' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Mark received' })).toBeNull();
    m.canRead = false;
    view.rerender(<MemoryRouter><PurchaseOrderList /></MemoryRouter>);
    expect(screen.getByRole('alert')).toHaveTextContent('inventory read access');
    expect(screen.queryByText('PO-2026-12')).toBeNull();
});

it('offers receive only for ordered POs and does not write after declined confirmation', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(false);
    m.fetch.mockResolvedValue(response(overview({ orders: [order(), order({ id: 'draft', status: 'DRAFT' }), order({ id: 'cancel', status: 'CANCELLED' }), order({ id: 'received', status: 'RECEIVED' })] })));
    mount();
    const button = await screen.findByRole('button', { name: 'Mark received' });
    expect(screen.getAllByRole('button', { name: 'Mark received' })).toHaveLength(1);
    fireEvent.click(button);
    expect(window.confirm).toHaveBeenCalledWith(expect.stringContaining('may update inventory'));
    expect(m.fetch.mock.calls.some(([, options]) => options.method === 'PUT')).toBe(false);
    expect(button).toBeEnabled();
});

it('serializes the confirmed stock receipt, sends the scoped status-only request and refreshes the list', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    mount();
    const button = await screen.findByRole('button', { name: 'Mark received' });
    let resolve!: (value: Response) => void;
    m.fetch.mockReturnValueOnce(new Promise(r => { resolve = r; })).mockImplementation(async () => response(overview({ orders: [order({ status: 'RECEIVED' })] })));
    fireEvent.click(button); fireEvent.click(button);
    const writes = m.fetch.mock.calls.filter(([, options]) => options.method === 'PUT');
    expect(writes).toHaveLength(1);
    expect(writes[0][0]).toBe(`/api/inventory/purchase-orders/${recordId}`);
    expect(writes[0][1].headers).toMatchObject({ 'X-Account-ID': 'a', Authorization: 'Bearer t' });
    expect(JSON.parse(writes[0][1].body)).toEqual({ status: 'RECEIVED' });
    expect(button).toBeDisabled();
    await act(async () => resolve(response({ id: recordId, status: 'RECEIVED' })));
    await screen.findByText('Purchase order marked received. Review the purchase order for stock-receipt details.');
    await screen.findByText('Received', { selector: 'span' });
    expect(screen.queryByRole('button', { name: 'Mark received' })).toBeNull();
});

it.each(['conflict', 'outage', 'mismatched acknowledgement'])('retains an uncertain receipt lock after %s across refreshes and offers review rather than blind retry', async failure => {
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    mount();
    const button = await screen.findByRole('button', { name: 'Mark received' });
    m.fetch.mockResolvedValueOnce(failure === 'mismatched acknowledgement' ? response({ id: 'wrong', status: 'RECEIVED' }) : new Response('', { status: failure === 'conflict' ? 409 : 503 }));
    fireEvent.click(button);
    await screen.findByRole('alert');
    expect(screen.getByRole('link', { name: 'Review purchase order' })).toHaveAttribute('href', `/inventory/purchase-orders/${recordId}`);
    expect(screen.getByRole('button', { name: 'Receipt attempted' })).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: 'Refresh orders' }));
    expect(await screen.findByRole('button', { name: 'Receipt attempted' })).toBeDisabled();
    expect(m.fetch.mock.calls.filter(([, options]) => options.method === 'PUT')).toHaveLength(1);
});

it('surfaces receipt warnings without claiming all inventory updates succeeded', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    mount();
    const button = await screen.findByRole('button', { name: 'Mark received' });
    m.fetch.mockResolvedValueOnce(response({ id: recordId, status: 'RECEIVED', _warnings: ['Remote stock acknowledgement unavailable'] }));
    fireEvent.click(button);
    await screen.findByText(/Marked received with warnings: Remote stock acknowledgement unavailable/);
    expect(await screen.findByRole('button', { name: 'Receipt attempted' })).toBeDisabled();
});

it('aborts an old-account receipt and ignores its late acknowledgement', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    const view = mount();
    const button = await screen.findByRole('button', { name: 'Mark received' });
    let resolve!: (value: Response) => void;
    m.fetch.mockReturnValueOnce(new Promise(r => { resolve = r; }));
    fireEvent.click(button);
    const write = m.fetch.mock.calls.find(([, options]) => options.method === 'PUT')!;
    m.account = { id: 'b' };
    view.rerender(<MemoryRouter><PurchaseOrderList /></MemoryRouter>);
    await screen.findByRole('button', { name: 'Mark received' });
    const reads = m.fetch.mock.calls.length;
    await act(async () => resolve(response({ id: recordId, status: 'RECEIVED' })));
    expect(write[1].signal.aborted).toBe(true);
    expect(screen.queryByText(/Purchase order marked received/)).toBeNull();
    expect(m.fetch).toHaveBeenCalledTimes(reads);
});
