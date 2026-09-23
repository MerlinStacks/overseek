import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { WooCommerceInfoPanel } from './WooCommerceInfoPanel';

const context = vi.hoisted(() => ({ account: { id: 'account-a' }, token: 'token' }));
vi.mock('../../context/AuthContext', () => ({ useAuth: () => ({ token: context.token }) }));
vi.mock('../../context/AccountContext', () => ({ useAccount: () => ({ currentAccount: context.account }) }));
const fetchMock = vi.fn();
const oldTerm = { id: 900, name: 'Existing missing term' };
const newTerm = { id: 1, name: 'New term' };
const response = (items = [newTerm], totalPages = 1) => ({ ok: true, json: async () => ({ items, totalPages }) }) as Response;

beforeEach(() => {
    context.account = { id: 'account-a' };
    context.token = 'token';
    fetchMock.mockReset().mockResolvedValue(response());
    vi.stubGlobal('fetch', fetchMock);
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

describe('WooCommerceInfoPanel term editing', () => {
    it('preserves read-only badges and empty states without requests', () => {
        const { rerender } = render(<WooCommerceInfoPanel categories={[oldTerm]} tags={[newTerm]} />);
        expect(screen.getByText('WooCommerce Info')).toBeInTheDocument();
        expect(screen.getByText(oldTerm.name)).toBeInTheDocument();
        expect(screen.getByText('#New term')).toBeInTheDocument();
        expect(screen.queryByRole('button')).not.toBeInTheDocument();
        expect(fetchMock).not.toHaveBeenCalled();
        rerender(<WooCommerceInfoPanel categories={[]} tags={[]} />);
        expect(screen.getByText('No categories assigned')).toBeInTheDocument();
        expect(screen.getByText('No tags assigned')).toBeInTheDocument();
    });

    it.each(['categories', 'tags'] as const)('loads, searches, changes, removes and clears controlled %s', async kind => {
        const onChange = vi.fn();
        const props = { categories: [], tags: [], [kind]: [oldTerm], [kind === 'categories' ? 'onCategoriesChange' : 'onTagsChange']: onChange };
        const { rerender } = render(<WooCommerceInfoPanel {...props} />);
        expect(screen.getByRole('status')).toHaveTextContent(`Loading ${kind}`);
        expect(screen.getByRole('checkbox', { name: oldTerm.name })).toBeChecked();
        expect(screen.getByRole('checkbox', { name: oldTerm.name })).toBeDisabled();
        const checkbox = await screen.findByRole('checkbox', { name: newTerm.name });
        expect(fetchMock).toHaveBeenCalledWith(`/api/products/${kind}?page=1&limit=100`, expect.objectContaining({ headers: { Authorization: 'Bearer token', 'X-Account-ID': 'account-a' } }));
        expect(onChange).not.toHaveBeenCalled();
        fireEvent.change(screen.getByRole('searchbox'), { target: { value: ' NEW ' } });
        expect(screen.queryByRole('checkbox', { name: oldTerm.name })).not.toBeInTheDocument();
        fireEvent.click(checkbox);
        expect(onChange).toHaveBeenLastCalledWith([oldTerm, newTerm]);
        expect(checkbox).not.toBeChecked();
        rerender(<WooCommerceInfoPanel {...props} {...{ [kind]: [oldTerm, newTerm] }} />);
        expect(screen.getByRole('checkbox', { name: newTerm.name })).toBeChecked();
        fireEvent.click(screen.getByRole('checkbox', { name: newTerm.name }));
        expect(onChange).toHaveBeenLastCalledWith([oldTerm]);
        fireEvent.click(screen.getByRole('button', { name: `Remove ${kind === 'tags' ? 'tag' : 'category'} ${oldTerm.name}` }));
        expect(onChange).toHaveBeenLastCalledWith([newTerm]);
        fireEvent.click(screen.getByRole('button', { name: `Clear ${kind}` }));
        expect(onChange).toHaveBeenLastCalledWith([]);
    });

    it('preserves selections on later-page errors and retries from page one', async () => {
        fetchMock.mockResolvedValueOnce(response([newTerm], 2)).mockResolvedValueOnce({ ok: false });
        const onChange = vi.fn();
        render(<WooCommerceInfoPanel categories={[oldTerm]} tags={[]} onCategoriesChange={onChange} />);
        expect(await screen.findByRole('alert')).toHaveTextContent('Could not load categories');
        expect(screen.getByRole('checkbox', { name: oldTerm.name })).toBeChecked();
        expect(screen.getByRole('checkbox', { name: oldTerm.name })).toBeDisabled();
        expect(onChange).not.toHaveBeenCalled();
        fireEvent.click(screen.getByRole('button', { name: `Remove category ${oldTerm.name}` }));
        expect(onChange).toHaveBeenLastCalledWith([]);
        fireEvent.click(screen.getByRole('button', { name: 'Retry categories' }));
        expect(await screen.findByRole('checkbox', { name: newTerm.name })).toBeEnabled();
        expect(fetchMock.mock.calls[2][0]).toBe('/api/products/categories?page=1&limit=100');
    });

    it.each([2, 0])('loads all pages with totalPages=%s and deduplicates IDs', async totalPages => {
        const firstPage = Array.from({ length: 100 }, (_, index) => ({ id: index + 1, name: `Term ${index + 1}` }));
        fetchMock.mockResolvedValueOnce(response(firstPage, totalPages)).mockResolvedValueOnce(response([firstPage[0], { id: 101, name: 'Last page' }], totalPages));
        render(<WooCommerceInfoPanel categories={[]} tags={[]} onCategoriesChange={vi.fn()} />);
        expect(await screen.findByRole('checkbox', { name: 'Last page' })).toBeEnabled();
        expect(screen.getAllByRole('checkbox')).toHaveLength(101);
        expect(fetchMock).toHaveBeenCalledTimes(2);
        expect(fetchMock.mock.calls[1][0]).toBe('/api/products/categories?page=2&limit=100');
    });

    it('aborts on account/token changes and unmount, ignoring late responses', async () => {
        let resolveOld!: (value: Response) => void;
        fetchMock.mockImplementationOnce(() => new Promise<Response>(resolve => { resolveOld = resolve; }));
        const onChange = vi.fn();
        const props = { categories: [oldTerm], tags: [], onCategoriesChange: onChange };
        const { rerender, unmount } = render(<WooCommerceInfoPanel {...props} />);
        const oldSignal = fetchMock.mock.calls[0][1].signal as AbortSignal;
        context.account = { id: 'account-b' };
        rerender(<WooCommerceInfoPanel {...props} />);
        expect(oldSignal.aborted).toBe(true);
        await screen.findByRole('checkbox', { name: newTerm.name });
        await act(async () => resolveOld(response([{ id: 50, name: 'Stale term' }], 2)));
        expect(screen.queryByRole('checkbox', { name: 'Stale term' })).not.toBeInTheDocument();
        expect(fetchMock).toHaveBeenCalledTimes(2);
        expect(fetchMock.mock.calls[1][1].headers['X-Account-ID']).toBe('account-b');
        context.token = 'new-token';
        rerender(<WooCommerceInfoPanel {...props} />);
        await waitFor(() => expect(screen.queryByRole('status')).not.toBeInTheDocument());
        expect(fetchMock.mock.calls[1][1].signal.aborted).toBe(true);
        expect(fetchMock.mock.calls[2][1].headers.Authorization).toBe('Bearer new-token');
        expect(onChange).not.toHaveBeenCalled();
        unmount();
        expect(fetchMock.mock.calls[2][1].signal.aborted).toBe(true);
    });
});
