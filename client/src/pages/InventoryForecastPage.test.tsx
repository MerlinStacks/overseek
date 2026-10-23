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

it('presents forecasts in one slim summary while retaining risk filter controls', async () => {
    mocks.request.mockImplementation(async (url: string) => url.includes('sku-forecasts') ? [] : { critical: [], high: [], medium: [], summary: { totalAtRisk: 0, criticalCount: 0, highCount: 0, mediumCount: 0 } });
    render(<MemoryRouter><InventoryForecastPage /></MemoryRouter>);
    const summary = await screen.findByLabelText('Inventory forecast summary');
    expect(summary.tagName).toBe('DL');
    expect(summary).toHaveClass('metric-strip');
    expect(screen.getByText('Avg Confidence').nextElementSibling).toHaveTextContent('0%');
    const critical = screen.getByText('Critical Risk').nextElementSibling!;
    expect(critical.querySelector('span')).toHaveClass('text-red-700', 'dark:text-red-300', 'text-xl');
    expect(critical.parentElement).not.toHaveClass('rounded-xl', 'p-4');
    fireEvent.click(screen.getByRole('button', { name: 'HIGH', exact: true }));
    expect(screen.getByRole('button', { name: 'HIGH', exact: true })).toHaveClass('bg-[var(--primary-color)]');
    expect(summary).not.toContainElement(screen.getByRole('button', { name: 'HIGH', exact: true }));
});

it('uses authenticated shared requests and explains why planning is unavailable on retry', async () => {
    mocks.request.mockRejectedValue(new Error('BOM forecast unavailable: cyclic component references detected'));
    render(<MemoryRouter><InventoryForecastPage /></MemoryRouter>);
    expect(await screen.findByText(/contains a component cycle/)).toBeInTheDocument();
    expect(mocks.request).toHaveBeenCalledWith('/api/analytics/inventory/sku-forecasts?days=30', expect.objectContaining({ token: 'token', accountId: 'a', cache: 'no-store', signal: expect.any(AbortSignal) }));
    fireEvent.click(screen.getByRole('button', { name: /Retry/ }));
    await waitFor(() => expect(mocks.request).toHaveBeenCalledTimes(4));
    expect(await screen.findByText(/contains a component cycle/)).toBeInTheDocument();
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
    await act(async () => reject(new Error('BOM forecast unavailable: cyclic component references detected')));
    expect(screen.queryByText(/component cycle/)).toBeNull();
});
