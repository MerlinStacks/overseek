import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ account: { id: 'a', currency: 'USD' }, fetch: vi.fn() }));
vi.mock('../context/AuthContext', () => ({ useAuth: () => ({ token: 'token' }) }));
vi.mock('../context/AccountContext', () => ({ useAccount: () => ({ currentAccount: mocks.account }) }));
import { GoldPriceMarginReportPage } from './GoldPriceMarginReportPage';
const report = (name = 'Product') => ({ count: 150, page: 1, limit: 50, totalPages: 3, products: [{ id: name, wooId: 1, name, price: 100, goldCogs: 50, profitMargin: 50, isVariant: false }] });
beforeEach(() => { vi.resetAllMocks(); mocks.account = { id: 'a', currency: 'USD' }; vi.stubGlobal('fetch', mocks.fetch); mocks.fetch.mockResolvedValue({ ok: true, json: async () => report() }); });
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });
function Page() { return <MemoryRouter><GoldPriceMarginReportPage /></MemoryRouter>; }
describe('gold margin report isolation', () => {
    it('discloses current-page filtering and average scope', async () => {
        render(<Page />); await screen.findByRole('link', { name: 'Product' });
        expect(screen.getByRole('textbox', { name: 'Search products on this page' })).toBeInTheDocument();
        expect(screen.getByText(/Avg Margin \(shown rows\)/)).toBeInTheDocument();
    });
    it('resets pagination and hides old data when switching accounts', async () => {
        const view = render(<Page />); await screen.findByRole('link', { name: 'Product' });
        fireEvent.click(screen.getByRole('button', { name: 'Next page' })); await waitFor(() => expect(mocks.fetch.mock.calls.at(-1)?.[0]).toContain('page=2'));
        mocks.account = { id: 'b', currency: 'AUD' }; mocks.fetch.mockResolvedValue({ ok: true, json: async () => report('New account product') });
        view.rerender(<Page />); expect(screen.queryByRole('link', { name: 'Product' })).toBeNull(); await screen.findByText('New account product');
        expect(mocks.fetch.mock.calls.at(-1)?.[0]).toContain('page=1'); expect(mocks.fetch.mock.calls.at(-1)?.[1].headers['X-Account-ID']).toBe('b');
    });
    it('aborts and ignores an older account response', async () => {
        let resolve!: (value: unknown) => void; mocks.fetch.mockReturnValueOnce(new Promise(r => { resolve = r; }));
        const view = render(<Page />); await waitFor(() => expect(mocks.fetch).toHaveBeenCalledOnce()); const signal = mocks.fetch.mock.calls[0][1].signal;
        mocks.account = { id: 'b', currency: 'AUD' }; mocks.fetch.mockResolvedValue({ ok: true, json: async () => report('Current product') }); view.rerender(<Page />);
        await screen.findByText('Current product'); await act(async () => { resolve({ ok: true, json: async () => report('Stale product') }); });
        expect(signal.aborted).toBe(true); expect(screen.queryByText('Stale product')).toBeNull();
    });
});
