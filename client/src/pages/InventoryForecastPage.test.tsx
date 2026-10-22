import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ request: vi.fn(), account: { id: 'a', timezone: 'UTC' } }));
vi.mock('../context/AuthContext', () => ({ useAuth: () => ({ token: 'token' }) }));
vi.mock('../context/AccountContext', () => ({ useAccount: () => ({ currentAccount: mocks.account }) }));
vi.mock('../services/api', () => ({ api: { request: mocks.request } }));
vi.mock('../components/ForecastChart', () => ({ ForecastChart: () => null }));
import { InventoryForecastPage } from './InventoryForecastPage';

beforeEach(() => { mocks.request.mockReset(); mocks.account = { id: 'a', timezone: 'UTC' }; });
afterEach(cleanup);

it('uses authenticated shared requests and explains why planning is unavailable on retry', async () => {
    mocks.request.mockRejectedValue(new Error('BOM forecast unavailable: nested/cyclic component demand requires multi-level planning'));
    render(<MemoryRouter><InventoryForecastPage /></MemoryRouter>);
    expect(await screen.findByText(/Multi-level demand planning is not supported/)).toBeInTheDocument();
    expect(mocks.request).toHaveBeenCalledWith('/api/analytics/inventory/sku-forecasts?days=30', expect.objectContaining({ token: 'token', accountId: 'a', cache: 'no-store', signal: expect.any(AbortSignal) }));
    fireEvent.click(screen.getByRole('button', { name: /Retry/ }));
    await waitFor(() => expect(mocks.request).toHaveBeenCalledTimes(4));
    expect(await screen.findByText(/Multi-level demand planning is not supported/)).toBeInTheDocument();
});

it('aborts obsolete requests and ignores their errors when switching accounts', async () => {
    let reject!: (error: Error) => void;
    mocks.request.mockImplementationOnce(() => new Promise((_resolve, fail) => { reject = fail; })).mockReturnValueOnce(new Promise(() => {}));
    const view = render(<MemoryRouter><InventoryForecastPage /></MemoryRouter>);
    const signal = mocks.request.mock.calls[0][1].signal as AbortSignal;
    mocks.account = { id: 'b', timezone: 'UTC' };
    mocks.request.mockRejectedValue(new Error('Historical sales coverage unavailable'));
    view.rerender(<MemoryRouter><InventoryForecastPage /></MemoryRouter>);
    expect(signal.aborted).toBe(true);
    expect(await screen.findByText(/sales history could not be read completely/)).toBeInTheDocument();
    await act(async () => reject(new Error('BOM forecast unavailable: nested/cyclic')));
    expect(screen.queryByText(/Multi-level demand planning/)).toBeNull();
});
