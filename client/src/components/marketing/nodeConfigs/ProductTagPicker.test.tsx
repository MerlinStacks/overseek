import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ProductTagPicker } from './ProductTagPicker';
import { CONDITION_GROUPS } from './ConditionConfig';

vi.mock('../../../context/AuthContext', () => ({ useAuth: () => ({ token: 'token' }) }));
vi.mock('../../../context/AccountContext', () => ({ useAccount: () => ({ currentAccount: { id: 'a' } }) }));
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });
describe('WooCommerce product tag conditions', () => {
    it('offers both order and purchase history conditions', () => {
        const fields = CONDITION_GROUPS.flatMap(group => group.conditions).map(condition => condition.field);
        expect(fields).toContain('order.productTagId');
        expect(fields).toContain('customer.purchasedProductTagIds');
    });
    it('searches WooCommerce tags server-side, pages and saves the tag ID', async () => {
        const fetch = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ items: [{ id: 94, name: '9ct' }], totalPages: 2 }) });
        vi.stubGlobal('fetch', fetch);
        const change = vi.fn();
        render(<ProductTagPicker value="" onChange={change} />);
        fireEvent.change(screen.getByLabelText('Search WooCommerce product tags'), { target: { value: '9ct' } });
        await waitFor(() => expect(screen.getByRole('option', { name: '9ct' })).toBeInTheDocument(), { timeout: 5000 });
        expect(fetch).toHaveBeenLastCalledWith('/api/products/tags?limit=50&page=1&q=9ct', expect.objectContaining({ headers: { Authorization: 'Bearer token', 'X-Account-ID': 'a' } }));
        fireEvent.change(screen.getByLabelText('WooCommerce product tag'), { target: { value: '94' } });
        expect(change).toHaveBeenCalledWith('94');
        fireEvent.click(screen.getByRole('button', { name: 'Next' }));
        await waitFor(() => expect(fetch).toHaveBeenLastCalledWith('/api/products/tags?limit=50&page=2&q=9ct', expect.anything()), { timeout: 5000 });
    });
    it('shows taxonomy fetch errors rather than silently giving an empty list', async () => {
        vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false }));
        render(<ProductTagPicker value="94" onChange={vi.fn()} />);
        await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('Unable to load WooCommerce tags'), { timeout: 5000 });
        expect(screen.getByRole('option', { name: 'Selected tag #94' })).toBeInTheDocument();
    });
});
