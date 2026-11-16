import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ProductSearchInput } from './ProductSearchInput';

vi.mock('../../context/AuthContext', () => ({ useAuth: () => ({ token: 'token', user: { id: 'user' } }) }));
vi.mock('../../context/AccountContext', () => ({ useAccount: () => ({ currentAccount: { id: 'account' } }) }));
vi.mock('../../hooks/usePermissions', () => ({ usePermissions: () => ({ hasPermission: () => true }) }));

afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

const product = (index: number) => ({ id: `product-${index}`, wooId: index + 1, name: `Hoodie ${index}`, sku: `ZIP-HOODIE-${index}`, type: 'simple', hasBOM: false });
function search(products: unknown[]) {
    const fetch = vi.fn().mockImplementation(async () => new Response(JSON.stringify({ products }), { status: 200 }));
    vi.stubGlobal('fetch', fetch);
    const onSelect = vi.fn();
    render(<ProductSearchInput onSelect={onSelect} />);
    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'hoodie' } });
    return { fetch, onSelect };
}

describe('ProductSearchInput partial SKU results', () => {
    it('accepts a page supplemented with variant matches beyond the requested limit', async () => {
        const { fetch, onSelect } = search(Array.from({ length: 25 }, (_, index) => product(index)));
        const options = await screen.findAllByRole('option');
        expect(options).toHaveLength(25);
        expect(fetch).toHaveBeenCalledWith('/api/products?q=hoodie&limit=20&page=1', expect.objectContaining({ headers: { Authorization: 'Bearer token', 'X-Account-ID': 'account' } }));
        fireEvent.click(options[24]);
        expect(onSelect).toHaveBeenCalledWith(expect.objectContaining({ productId: 'product-24', wooId: 25, sku: 'ZIP-HOODIE-24' }));
    });

    it('shows every variant in the dropdown without a load-more button', async () => {
        const { fetch, onSelect } = search([{ ...product(0), type: 'variable', searchableVariants: Array.from({ length: 120 }, (_, index) => ({ wooId: index + 100, sku: `HOODIE-${index}`, attributeString: `Size ${index}` })) }]);
        expect(await screen.findAllByRole('option')).toHaveLength(120);
        expect(screen.queryByText(/Unable to search products/)).not.toBeInTheDocument();
        const options = screen.getAllByRole('option');
        expect(options).toHaveLength(120);
        expect(fetch).toHaveBeenCalledTimes(1);
        expect(screen.queryByRole('button', { name: 'Load more products' })).not.toBeInTheDocument();
        fireEvent.click(options[119]);
        expect(onSelect).toHaveBeenCalledWith(expect.objectContaining({ variationWooId: 219 }));
    });

    it('loads later product pages, deduplicates supplements, and resets pages for a new query', async () => {
        const { fetch } = search([]);
        fetch.mockImplementation(async (url: string) => {
            const page = Number(new URL(url, 'http://localhost').searchParams.get('page'));
            return new Response(JSON.stringify({ products: page === 1 ? [product(0)] : [product(0), product(1)], totalPages: 2 }));
        });
        expect(await screen.findByText('Hoodie 1')).toBeInTheDocument();
        expect(screen.getAllByRole('option')).toHaveLength(2);
        expect(fetch.mock.calls[1][0]).toContain('page=2');
        expect(screen.queryByRole('button', { name: 'Load more products' })).not.toBeInTheDocument();
        fireEvent.change(screen.getByRole('combobox'), { target: { value: 'shirt' } });
        expect(screen.queryByRole('option')).not.toBeInTheDocument();
        await screen.findByText('Hoodie 0');
        expect(fetch.mock.calls.at(-1)?.[0]).toBe('/api/products?q=shirt&limit=20&page=1');
    });

    it('can advance past an entirely excluded page', async () => {
        const { fetch } = search([]);
        fetch.mockResolvedValueOnce(new Response(JSON.stringify({ products: [{ ...product(0), hasBOM: true }], totalPages: 2 })))
            .mockResolvedValueOnce(new Response(JSON.stringify({ products: [product(1)], totalPages: 2 })));
        expect(await screen.findByRole('option')).toHaveTextContent('ZIP-HOODIE-1');
    });

    it('automatically fetches additional matches when scrolling near the bottom', async () => {
        const { fetch } = search([]);
        // Simulate a full dropdown so the next request waits for scrolling.
        const height = vi.spyOn(HTMLElement.prototype, 'scrollHeight', 'get').mockReturnValue(1000);
        fetch.mockResolvedValueOnce(new Response(JSON.stringify({ products: [product(0)], totalPages: 2 })))
            .mockResolvedValueOnce(new Response(JSON.stringify({ products: [product(1)], totalPages: 2 })));
        try {
            await screen.findByRole('option');
            expect(fetch).toHaveBeenCalledTimes(1);
            const dropdown = screen.getByRole('listbox').parentElement!;
            fireEvent.scroll(dropdown, { target: { scrollTop: 1000 } });
            expect(await screen.findByText('Hoodie 1')).toBeInTheDocument();
            expect(screen.queryByRole('button', { name: 'Load more products' })).not.toBeInTheDocument();
        } finally { height.mockRestore(); }
    });

    it('excludes both simple and variable products with a BOM while leaving base products selectable', async () => {
        search([product(0), { ...product(1), hasBOM: true }, { ...product(2), hasBOM: true, type: 'variable', searchableVariants: [{ wooId: 200, sku: 'FINISHED' }] }]);
        expect(await screen.findAllByRole('option')).toHaveLength(1);
        expect(screen.getByRole('option')).toHaveTextContent('ZIP-HOODIE-0');
    });

    it('preserves earlier matches and retries the failed page without skipping it', async () => {
        const { fetch } = search([]);
        fetch.mockResolvedValueOnce(new Response(JSON.stringify({ products: [product(0)], totalPages: 2 })))
            .mockResolvedValueOnce(new Response('{}', { status: 500 }))
            .mockResolvedValueOnce(new Response(JSON.stringify({ products: [product(1)], totalPages: 2 })));
        await screen.findByRole('option');
        fireEvent.click(await screen.findByRole('button', { name: 'Retry search' }));
        expect(await screen.findByText('Hoodie 1')).toBeInTheDocument();
        expect(screen.getAllByRole('option')).toHaveLength(2);
        expect(fetch.mock.calls.slice(1).map(([url]) => url)).toEqual(Array(2).fill('/api/products?q=hoodie&limit=20&page=2'));
    });

    it('does not let a malformed or duplicate product hide valid matches', async () => {
        search([product(0), { ...product(1), wooId: -1 }, product(0), { ...product(2), hasBOM: true }, { ...product(3), type: 'unknown' }]);
        expect(await screen.findAllByRole('option')).toHaveLength(1);
        expect(screen.getByRole('option')).toHaveTextContent('ZIP-HOODIE-0');
    });

    it('shows an empty successful search separately from an unavailable search', async () => {
        search([]);
        await screen.findByText(/No selectable products found/);
        expect(screen.queryByText(/Unable to search products/)).not.toBeInTheDocument();
    });

    it('reports a failed request without offering any selections', async () => {
        search([]);
        vi.mocked(fetch).mockImplementation(async () => new Response('{}', { status: 500 }));
        await screen.findByText(/Unable to search products/);
        expect(screen.queryByRole('option')).not.toBeInTheDocument();
    });
});
