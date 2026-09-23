import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DeliveryProductionEditor } from './DeliveryProductionEditor';

let accountId = 'account-a';
let token = 'token-a';
let enabled = true;
let canView = true;
let canEdit = true;
vi.mock('../../context/AccountContext', () => ({ useAccount: () => ({ currentAccount: { id: accountId } }) }));
vi.mock('../../context/AuthContext', () => ({ useAuth: () => ({ token }) }));
vi.mock('../../hooks/useAccountFeature', () => ({ useAccountFeature: (key: string) => key === 'DELIVERY_ESTIMATES' && enabled }));
vi.mock('../../hooks/usePermissions', () => ({ usePermissions: () => ({ hasPermission: (key: string) => key === 'view_products' ? canView : canEdit }) }));
const fetchMock = vi.fn();
const fixture = () => ({
    product: { id: 'product-uuid', wooId: 100, productionMinDays: null as number | null, productionMaxDays: null as number | null,
        variations: [{ id: 'variation-uuid', wooId: 101, productionMinDays: null as number | null, productionMaxDays: null as number | null }] },
    status: { syncStatus: 'plugin_update_required', storefrontActivated: false },
});
const ok = (data = fixture()) => ({ ok: true, json: async () => data });
const change = (label: string, value: string) => fireEvent.change(screen.getByLabelText(label), { target: { value } });
const save = () => fireEvent.click(screen.getByRole('button', { name: 'Save production settings' }));

describe('DeliveryProductionEditor', () => {
    beforeEach(() => {
        accountId = 'account-a'; token = 'token-a'; enabled = true; canView = true; canEdit = true;
        fetchMock.mockReset(); fetchMock.mockResolvedValue(ok()); vi.stubGlobal('fetch', fetchMock);
    });
    afterEach(() => vi.unstubAllGlobals());

    it('shows unset/cart semantics, resolves parent drafts, and saves zero and null with internal IDs only', async () => {
        render(<DeliveryProductionEditor productId="product-uuid" variationNames={{ 101: 'Blue / Large' }} />);
        await screen.findByLabelText('Product minimum days');
        expect(screen.getByText(/Product unset → no estimate/)).toBeInTheDocument();
        expect(screen.getByText(/Inherits parent: unset/)).toBeInTheDocument();
        expect(screen.getByText(/0–1 range means production today\/tomorrow/)).toHaveTextContent('configured cutoff');
        expect(fetchMock.mock.calls[0][0]).toBe('/api/delivery-estimates/products/product-uuid');
        expect(fetchMock.mock.calls[0][1].headers['X-Account-ID']).toBe('account-a');
        change('Product minimum days', '0'); change('Product maximum days', '1');
        expect(screen.getByText('Inherits parent: 0–1 production days')).toBeInTheDocument();
        change('Blue / Large (Woo variation #101) minimum days', '0');
        change('Blue / Large (Woo variation #101) maximum days', '0');
        expect(screen.getByText('Override: 0–0 production days')).toBeInTheDocument();
        fetchMock.mockImplementationOnce(async (_url, options) => {
            const body = JSON.parse(options.body);
            return ok({ ...fixture(), product: { ...fixture().product, ...body, variations: [{ wooId: 101, ...body.variations[0] }] } });
        });
        save(); await screen.findByText('Production settings saved in Overseek.');
        expect(JSON.parse(fetchMock.mock.calls[1][1].body)).toEqual({ productionMinDays: 0, productionMaxDays: 1, variations: [{ id: 'variation-uuid', productionMinDays: 0, productionMaxDays: 0 }] });
        change('Blue / Large (Woo variation #101) minimum days', '');
        change('Blue / Large (Woo variation #101) maximum days', '');
        save(); await screen.findByText('Production settings saved in Overseek.');
        expect(JSON.parse(fetchMock.mock.calls[2][1].body).variations[0]).toEqual({ id: 'variation-uuid', productionMinDays: null, productionMaxDays: null });
        expect(fetchMock.mock.calls.every(([url]) => url === '/api/delivery-estimates/products/product-uuid')).toBe(true);
        expect(screen.getByText(/Check settings and production sync readiness/)).toBeInTheDocument();
    });

    it.each([false, true])('describes acknowledged activation %s without claiming current storefront availability', async storefrontActivated => {
        fetchMock.mockResolvedValue(ok({ ...fixture(), status: { ...fixture().status, storefrontActivated } }));
        render(<DeliveryProductionEditor productId="product-uuid" />);
        const note = await screen.findByRole('note');
        expect(note).toHaveTextContent(`Last acknowledged activation: ${storefrontActivated ? 'active' : 'inactive'}`);
        expect(note).toHaveTextContent('launch panel');
        expect(note).toHaveTextContent('individual estimates depend on synchronized inputs and fresh stock proofs');
        expect(note).not.toHaveTextContent('Not live on your storefront');
    });

    it.each([
        ['1', '', 'Enter both'], ['', '1', 'Enter both'], ['2', '1', 'Minimum must'],
        ['-1', '1', 'whole days'], ['0.5', '1', 'whole days'], ['0', '3651', 'whole days'],
    ])('blocks invalid product range %s / %s', async (min, max, message) => {
        render(<DeliveryProductionEditor productId="product-uuid" />);
        await screen.findByLabelText('Product minimum days');
        change('Product minimum days', min); change('Product maximum days', max); save();
        expect(screen.getByRole('alert')).toHaveTextContent(message);
        expect(fetchMock).toHaveBeenCalledTimes(1);
    });

    it('validates individual variations and accepts the upper bound with an unset product', async () => {
        render(<DeliveryProductionEditor productId="product-uuid" />);
        await screen.findByLabelText('Woo variation #101 minimum days');
        change('Woo variation #101 minimum days', '3650'); save();
        expect(screen.getByRole('alert')).toHaveTextContent('Variation #101: Enter both');
        expect(fetchMock).toHaveBeenCalledTimes(1);
        change('Woo variation #101 maximum days', '3650'); save();
        await screen.findByText('Production settings saved in Overseek.');
        expect(JSON.parse(fetchMock.mock.calls[1][1].body)).toEqual({ productionMinDays: null, productionMaxDays: null, variations: [{ id: 'variation-uuid', productionMinDays: 3650, productionMaxDays: 3650 }] });
    });

    it('does not request when feature/view permission is denied and makes view-only fields read-only', async () => {
        enabled = false;
        const { rerender } = render(<DeliveryProductionEditor productId="product-uuid" />);
        expect(fetchMock).not.toHaveBeenCalled();
        enabled = true; canView = false; rerender(<DeliveryProductionEditor productId="product-uuid" />);
        expect(fetchMock).not.toHaveBeenCalled();
        canView = true; canEdit = false; rerender(<DeliveryProductionEditor productId="product-uuid" />);
        expect(await screen.findByLabelText('Product minimum days')).toBeDisabled();
        expect(screen.getByLabelText('Woo variation #101 maximum days')).toBeDisabled();
        expect(screen.queryByRole('button', { name: 'Save production settings' })).not.toBeInTheDocument();
    });

    it('preserves edits across auth refresh and unrelated product rerenders', async () => {
        const { rerender } = render(<DeliveryProductionEditor productId="product-uuid" />);
        await screen.findByLabelText('Product minimum days');
        change('Product minimum days', '0'); change('Product maximum days', '1');
        token = 'new-token'; rerender(<DeliveryProductionEditor productId="product-uuid" variationNames={{ 101: 'Blue' }} />);
        expect(screen.getByLabelText('Product maximum days')).toHaveValue('1');
        expect(fetchMock).toHaveBeenCalledTimes(1);
        save(); await screen.findByText('Production settings saved in Overseek.');
        expect(fetchMock.mock.calls[1][1].headers.Authorization).toBe('Bearer new-token');
    });

    it.each(['account', 'product'])('cancels stale %s loads', async scope => {
        let finish!: (value: ReturnType<typeof ok>) => void;
        fetchMock.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
        const { rerender } = render(<DeliveryProductionEditor productId="product-uuid" />);
        expect(screen.getByRole('status')).toHaveTextContent('Loading production');
        const signal = fetchMock.mock.calls[0][1].signal;
        if (scope === 'account') accountId = 'account-b';
        rerender(<DeliveryProductionEditor productId={scope === 'product' ? 'next-product' : 'product-uuid'} />);
        await screen.findByLabelText('Product minimum days');
        expect(signal.aborted).toBe(true);
        const old = fixture(); old.product.productionMinDays = 99; old.product.productionMaxDays = 99;
        await act(async () => finish(ok(old)));
        expect(screen.getByLabelText('Product minimum days')).toHaveValue('');
        expect(fetchMock.mock.calls[1][0]).toBe(`/api/delivery-estimates/products/${scope === 'product' ? 'next-product' : 'product-uuid'}`);
        expect(fetchMock.mock.calls[1][1].headers['X-Account-ID']).toBe(accountId);
    });

    it.each(['account', 'product'])('cancels stale saves on %s change', async scope => {
        const { rerender } = render(<DeliveryProductionEditor productId="product-uuid" />);
        await screen.findByLabelText('Product minimum days');
        change('Product minimum days', '0'); change('Product maximum days', '1');
        let finish!: (value: ReturnType<typeof ok>) => void;
        fetchMock.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
        save();
        expect(screen.getByLabelText('Product minimum days')).toBeDisabled();
        const signal = fetchMock.mock.calls[1][1].signal;
        if (scope === 'account') accountId = 'account-b';
        rerender(<DeliveryProductionEditor productId={scope === 'product' ? 'next-product' : 'product-uuid'} />);
        await screen.findByLabelText('Product minimum days');
        expect(signal.aborted).toBe(true);
        await act(async () => finish(ok()));
        expect(screen.queryByText('Production settings saved in Overseek.')).not.toBeInTheDocument();
        expect(screen.getByLabelText('Product maximum days')).toHaveValue('');
    });

    it('retries failed loads, retains drafts on save errors and handles feature disable', async () => {
        fetchMock.mockRejectedValueOnce(new Error('Network unavailable'));
        render(<DeliveryProductionEditor productId="product-uuid" />);
        expect(await screen.findByRole('alert')).toHaveTextContent('Network unavailable');
        fireEvent.click(screen.getByRole('button', { name: 'Retry loading production settings' }));
        await screen.findByLabelText('Product minimum days');
        change('Product minimum days', '2'); change('Product maximum days', '3');
        fetchMock.mockResolvedValueOnce({ ok: false, status: 500, json: async () => ({ error: 'Save failed' }) });
        save();
        expect(await screen.findByRole('alert')).toHaveTextContent('Save failed');
        expect(screen.getByLabelText('Product minimum days')).toHaveValue('2');
        await waitFor(() => expect(screen.getByRole('button', { name: 'Save production settings' })).toBeEnabled());
        fetchMock.mockResolvedValueOnce({ ok: false, status: 403, json: async () => ({ code: 'FEATURE_DISABLED' }) });
        save();
        expect(await screen.findByRole('alert')).toHaveTextContent('were disabled');
        expect(screen.getByLabelText('Product minimum days')).toBeDisabled();
        expect(screen.getByRole('button', { name: 'Save production settings' })).toBeDisabled();
    });
});
