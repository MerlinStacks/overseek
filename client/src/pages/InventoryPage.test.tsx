import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter, useLocation } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { InventoryPage } from './InventoryPage';

const account = { id: 'account-a' };
vi.mock('../context/AuthContext', () => ({ useAuth: () => ({ token: 'test-token' }) }));
vi.mock('../context/AccountContext', () => ({ useAccount: () => ({ currentAccount: account }) }));
vi.mock('../context/ToastContext', () => ({ useToast: () => ({ error: vi.fn() }) }));
vi.mock('../components/inventory/InternalProductsList', () => ({ InternalProductsList: () => null }));
vi.mock('../components/inventory/ProductSeoModal', () => ({ ProductSeoModal: () => null }));
vi.mock('../components/Seo/SeoScoreBadge', () => ({ SeoScoreBadge: () => null }));
vi.mock('../components/ui/Modal', () => ({ Modal: () => null }));
vi.mock('../utils/productCrossTabEvents', () => ({ subscribeToProductChanges: () => () => {} }));

const fetchMock = vi.fn();
const ok = (data: unknown) => ({ ok: true, json: async () => data });
let paginatedTerms = false;

function LocationProbe() {
    const location = useLocation();
    return <output data-testid="location">{location.search}</output>;
}

function renderInventory(query = '') {
    return render(
        <MemoryRouter initialEntries={[`/inventory${query}`]}>
            <InventoryPage />
            <LocationProbe />
        </MemoryRouter>
    );
}

function productQueries() {
    return fetchMock.mock.calls
        .map(([url]) => new URL(String(url), 'http://localhost'))
        .filter(url => url.pathname === '/api/products')
        .map(url => Object.fromEntries(url.searchParams));
}

function locationQuery() {
    return Object.fromEntries(new URLSearchParams(screen.getByTestId('location').textContent || ''));
}

function lastTagParams() {
    const requests = fetchMock.mock.calls.map(([url]) => new URL(String(url), 'http://localhost'))
        .filter(url => url.pathname === '/api/products');
    const ids = requests.at(-1)?.searchParams.getAll('tag');
    expect(new URLSearchParams(screen.getByTestId('location').textContent || '').getAll('tag')).toEqual(ids);
    return ids;
}

async function ready() {
    await screen.findByRole('link', { name: 'Test product' });
    await waitFor(() => expect(screen.getByRole('combobox', { name: 'Category' })).toBeEnabled());
}

async function nextPage() {
    fireEvent.click(screen.getByTitle('Next Page'));
    await waitFor(() => expect(productQueries().at(-1)).toMatchObject({ page: '2' }));
    await waitFor(() => expect(screen.getByRole('spinbutton', { name: 'Go to' })).toHaveValue(2));
    expect(locationQuery().page).toBe('2');
}

describe('InventoryPage catalog filters', () => {
    beforeEach(() => {
        paginatedTerms = false;
        fetchMock.mockReset();
        fetchMock.mockImplementation(async (input: string) => {
            const url = new URL(input, 'http://localhost');
            if (url.pathname === '/api/products') {
                return ok({ products: [{ id: 'product-1', name: 'Test product', sku: 'TEST', price: '10', stock_status: 'instock' }], totalPages: 3 });
            }
            if (url.pathname === '/api/products/categories' || url.pathname === '/api/products/tags') {
                const category = url.pathname.endsWith('/categories');
                if (paginatedTerms) {
                    const items = url.searchParams.get('page') === '1'
                        ? Array.from({ length: 100 }, (_, index) => ({ id: index + 1, name: `${category ? 'Category' : 'Tag'} ${index + 1}` }))
                        : [{ id: 101, name: category ? 'Second-page category' : 'Second-page tag' }];
                    return ok({ items, totalPages: 2 });
                }
                return ok({ items: category ? [{ id: 12, name: 'Gifts' }] : [{ id: 34, name: 'Summer' }, { id: 56, name: 'Winter' }], totalPages: 1 });
            }
            throw new Error(`Unexpected request: ${input}`);
        });
        vi.stubGlobal('fetch', fetchMock);
    });

    afterEach(() => {
        cleanup();
        vi.unstubAllGlobals();
    });

    it.each([
        ['Status', 'status', 'private'],
        ['Category', 'category', '12'],
        ['Stock status', 'stockStatus', 'instock'],
        ['Stock status', 'stockStatus', 'outofstock'],
        ['Stock status', 'stockStatus', 'onbackorder'],
    ])('changing %s forwards the filter and search query and resets pagination', async (label, key, value) => {
        renderInventory('?q=mug&sortField=price&sortDirection=desc');
        await ready();
        await nextPage();
        const previousRequests = productQueries().length;

        fireEvent.change(screen.getByRole('combobox', { name: label }), { target: { value } });

        const expected = { page: '1', limit: '20', q: 'mug', sortField: 'price', sortDirection: 'desc', [key]: value };
        await waitFor(() => expect(productQueries().at(-1)).toEqual(expected));
        expect(productQueries().slice(previousRequests)).toEqual([expected]);
        await waitFor(() => expect(screen.getByRole('spinbutton', { name: 'Go to' })).toHaveValue(1));
        expect(screen.getByRole('combobox', { name: label })).toHaveValue(value);
        expect(locationQuery()).toEqual({ q: 'mug', sortField: 'price', sortDirection: 'desc', [key]: value });
    });

    it('initializes all filters from the URL and includes them in the first product request', async () => {
        renderInventory('?q=mug&status=draft&category=12&tag=34&stockStatus=onbackorder');
        await ready();

        expect(screen.getByRole('combobox', { name: 'Status' })).toHaveValue('draft');
        expect(screen.getByRole('combobox', { name: 'Category' })).toHaveValue('12');
        expect(screen.getByRole('button', { name: 'Remove tag Summer' })).toBeInTheDocument();
        expect(screen.getByRole('combobox', { name: 'Stock status' })).toHaveValue('onbackorder');
        expect(screen.getByPlaceholderText('Search name, SKU or Woo ID...')).toHaveValue('mug');
        expect(productQueries()[0]).toEqual({ page: '1', limit: '20', q: 'mug', status: 'draft', category: '12', tag: '34', stockStatus: 'onbackorder' });
        expect(locationQuery()).toEqual({ q: 'mug', status: 'draft', category: '12', tag: '34', stockStatus: 'onbackorder' });
    });

    it.each([
        'status=trash&category=-1&tag=not-an-id&stockStatus=unknown',
        'status=unknown&category=1.5&tag=9007199254740992',
    ])('ignores invalid URL filters: %s', async query => {
        renderInventory(`?${query}`);
        await ready();

        for (const name of ['Status', 'Category', 'Stock status']) {
            expect(screen.getByRole('combobox', { name })).toHaveValue('');
        }
        expect(productQueries()[0]).toEqual({ page: '1', limit: '20', q: '' });
        expect(locationQuery()).toEqual({});
        expect(screen.queryByRole('button', { name: 'Clear filters' })).not.toBeInTheDocument();
    });

    it('clears all filters and resets the page while retaining search and sorting', async () => {
        renderInventory('?q=mug&sortField=name&sortDirection=desc&status=publish&category=12&tag=34&tag=56&stockStatus=instock');
        await ready();
        await nextPage();

        fireEvent.click(screen.getByRole('button', { name: 'Clear filters' }));

        await waitFor(() => expect(productQueries().at(-1)).toEqual({ page: '1', limit: '20', q: 'mug', sortField: 'name', sortDirection: 'desc' }));
        for (const name of ['Status', 'Category', 'Stock status']) {
            expect(screen.getByRole('combobox', { name })).toHaveValue('');
        }
        await waitFor(() => expect(screen.getByRole('spinbutton', { name: 'Go to' })).toHaveValue(1));
        expect(locationQuery()).toEqual({ q: 'mug', sortField: 'name', sortDirection: 'desc' });
        expect(screen.getByPlaceholderText('Search name, SKU or Woo ID...')).toHaveValue('mug');
        expect(screen.queryByRole('button', { name: 'Clear filters' })).not.toBeInTheDocument();
        expect(screen.queryByRole('button', { name: /Remove tag/ })).not.toBeInTheDocument();
    });

    it('combines all four filters as they are selected without dropping earlier selections', async () => {
        renderInventory('?q=mug');
        await ready();
        for (const [label, value] of [['Status', 'publish'], ['Category', '12'], ['Stock status', 'outofstock']]) {
            fireEvent.change(screen.getByRole('combobox', { name: label }), { target: { value } });
        }
        fireEvent.click(screen.getByText('Tags (0 selected)'));
        fireEvent.click(screen.getByRole('checkbox', { name: 'Summer' }));
        fireEvent.click(screen.getByRole('checkbox', { name: 'Winter' }));
        await waitFor(() => expect(productQueries().at(-1)).toEqual({
            page: '1', limit: '20', q: 'mug', status: 'publish', category: '12', tag: '56', stockStatus: 'outofstock'
        }));
        expect(locationQuery()).toEqual({ q: 'mug', status: 'publish', category: '12', tag: '56', stockStatus: 'outofstock' });
        expect(lastTagParams()).toEqual(['34', '56']);
    });

    it('selects and deselects multiple tags, retaining search and resetting pagination', async () => {
        renderInventory('?q=mug');
        await ready();
        await nextPage();
        fireEvent.click(screen.getByText('Tags (0 selected)'));
        fireEvent.click(screen.getByRole('checkbox', { name: 'Winter' }));
        fireEvent.click(screen.getByRole('checkbox', { name: 'Summer' }));
        await waitFor(() => expect(lastTagParams()).toEqual(['34', '56']));
        expect(productQueries().at(-1)).toMatchObject({ page: '1', q: 'mug' });
        expect(screen.getByText('Tags (2 selected)')).toBeInTheDocument();
        expect(screen.getByRole('checkbox', { name: 'Summer' })).toBeChecked();
        fireEvent.click(screen.getByRole('checkbox', { name: 'Summer' }));
        await waitFor(() => expect(lastTagParams()).toEqual(['56']));
        fireEvent.click(screen.getByRole('button', { name: 'Remove tag Winter' }));
        await waitFor(() => expect(lastTagParams()).toEqual([]));
    });

    it('keeps filters and product search in one bottom-aligned wrapping toolbar', async () => {
        renderInventory();
        await ready();
        const toolbar = screen.getByRole('group', { name: 'Product filters' });
        expect(toolbar).toHaveClass('flex', 'flex-wrap', 'items-end');
        for (const name of ['Status', 'Stock status', 'Category']) {
            expect(within(toolbar).getByRole('combobox', { name }).parentElement?.parentElement).toBe(toolbar);
        }
        const search = within(toolbar).getByRole('textbox', { name: 'Search products' });
        expect(search.parentElement?.parentElement).toBe(toolbar);
        expect(search.parentElement).toHaveClass('sm:ml-auto');
        expect(within(toolbar).getByText('Tags (0 selected)').parentElement?.parentElement).toBe(toolbar);
        expect(screen.queryByText(/Sorted by/)).not.toBeInTheDocument();
    });

    it('searches tag names case-insensitively and restores options when cleared', async () => {
        renderInventory();
        await ready();
        fireEvent.click(screen.getByText('Tags (0 selected)'));
        const search = screen.getByRole('searchbox', { name: 'Search tags' });
        fireEvent.change(search, { target: { value: 'uMm' } });
        expect(screen.getByRole('checkbox', { name: 'Summer' })).toBeInTheDocument();
        expect(screen.queryByRole('checkbox', { name: 'Winter' })).not.toBeInTheDocument();

        fireEvent.change(search, { target: { value: 'no-such-tag' } });
        expect(within(screen.getByRole('group', { name: 'Filter by tags' })).getByRole('status')).toHaveTextContent('No matching tags');
        expect(screen.queryByRole('checkbox')).not.toBeInTheDocument();
        expect(search).toBeVisible();

        fireEvent.change(search, { target: { value: '' } });
        expect(screen.getAllByRole('checkbox')).toHaveLength(2);
        expect(screen.queryByText('No matching tags')).not.toBeInTheDocument();
    });

    it('preserves tag selections across searches without changing product search', async () => {
        renderInventory('?q=mug');
        await ready();
        fireEvent.click(screen.getByText('Tags (0 selected)'));
        fireEvent.click(screen.getByRole('checkbox', { name: 'Summer' }));
        await waitFor(() => expect(lastTagParams()).toEqual(['34']));
        const search = screen.getByRole('searchbox', { name: 'Search tags' });
        const requests = productQueries().length;
        fireEvent.change(search, { target: { value: 'WIN' } });
        expect(screen.getByRole('button', { name: 'Remove tag Summer' })).toBeInTheDocument();
        expect(productQueries()).toHaveLength(requests);
        expect(lastTagParams()).toEqual(['34']);
        fireEvent.click(screen.getByRole('checkbox', { name: 'Winter' }));
        await waitFor(() => expect(lastTagParams()).toEqual(['34', '56']));
        fireEvent.change(search, { target: { value: 'no-such-tag' } });
        expect(screen.getByText('Tags (2 selected)')).toBeInTheDocument();
        fireEvent.change(search, { target: { value: '' } });
        expect(screen.getByRole('checkbox', { name: 'Summer' })).toBeChecked();
        expect(screen.getByRole('checkbox', { name: 'Winter' })).toBeChecked();
        expect(screen.getByRole('textbox', { name: 'Search products' })).toHaveValue('mug');
        expect(productQueries().at(-1)).toMatchObject({ q: 'mug' });
        expect(lastTagParams()).toEqual(['34', '56']);
    });

    it('restores normalized repeated URL tags and visibly preserves unknown IDs', async () => {
        renderInventory('?tag=56&tag=034&tag=56&tag=999&tag=-1&tag=9007199254740992');
        await ready();
        expect(lastTagParams()).toEqual(['34', '56', '999']);
        expect(screen.getByText('Tags (3 selected)')).toBeInTheDocument();
        fireEvent.click(screen.getByRole('button', { name: 'Remove tag Tag #999' }));
        await waitFor(() => expect(lastTagParams()).toEqual(['34', '56']));
    });

    it('shows loading and errors, disables choices, and allows removing restored tags and retrying', async () => {
        let resolveTags!: (value: unknown) => void;
        const original = fetchMock.getMockImplementation()!;
        fetchMock.mockImplementation((input: string) => input.startsWith('/api/products/tags')
            ? new Promise(resolve => { resolveTags = resolve; }) : original(input));
        renderInventory('?tag=999');
        fireEvent.click(screen.getByText('Tags (1 selected) — Loading…'));
        expect(screen.getByRole('group', { name: 'Filter by tags' })).toBeDisabled();
        resolveTags({ ok: false });
        await screen.findByRole('alert');
        expect(screen.getByRole('group', { name: 'Filter by tags' })).toBeDisabled();
        fireEvent.click(screen.getByRole('button', { name: 'Remove tag Tag #999' }));
        await waitFor(() => expect(lastTagParams()).toEqual([]));
        fetchMock.mockImplementation(original);
        fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
        await waitFor(() => expect(screen.getByRole('checkbox', { name: 'Summer' })).toBeEnabled());
    });

    it('loads and can filter by categories and tags beyond the first 100 terms', async () => {
        paginatedTerms = true;
        renderInventory();
        await ready();
        fireEvent.click(screen.getByText('Tags (0 selected)'));

        for (const [label, kind, option] of [
            ['Category', 'categories', 'Second-page category'],
            ['Tag', 'tags', 'Second-page tag'],
        ]) {
            for (const page of [1, 2]) {
                expect(fetchMock).toHaveBeenCalledWith(`/api/products/${kind}?limit=100&page=${page}`, expect.objectContaining({
                    headers: { Authorization: 'Bearer test-token', 'X-Account-ID': 'account-a' },
                    signal: expect.any(AbortSignal),
                }));
            }
            if (label === 'Tag') {
                expect(screen.getAllByRole('checkbox')).toHaveLength(101);
                fireEvent.click(screen.getByRole('checkbox', { name: option }));
            } else {
                const select = screen.getByRole('combobox', { name: label });
                expect(within(select).getAllByRole('option')).toHaveLength(102);
                fireEvent.change(select, { target: { value: '101' } });
            }
        }

        await waitFor(() => expect(productQueries().at(-1)).toEqual({ page: '1', limit: '20', q: '', category: '101', tag: '101' }));
        expect(locationQuery()).toEqual({ category: '101', tag: '101' });
    });
});
