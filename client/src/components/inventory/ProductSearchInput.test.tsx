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
        expect(fetch).toHaveBeenCalledWith('/api/products?q=hoodie&limit=20', expect.objectContaining({ headers: { Authorization: 'Bearer token', 'X-Account-ID': 'account' } }));
        fireEvent.click(options[24]);
        expect(onSelect).toHaveBeenCalledWith(expect.objectContaining({ productId: 'product-24', wooId: 25, sku: 'ZIP-HOODIE-24' }));
    });

    it('accepts more than 100 variants and still limits visible rows to 50', async () => {
        search([{ ...product(0), type: 'variable', searchableVariants: Array.from({ length: 120 }, (_, index) => ({ wooId: index + 100, sku: `HOODIE-${index}`, attributeString: `Size ${index}` })) }]);
        expect(await screen.findAllByRole('option')).toHaveLength(50);
        expect(screen.queryByText(/Unable to search products/)).not.toBeInTheDocument();
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
