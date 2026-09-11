import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ToastProvider } from '../../context/ToastContext';
import { MobileOrders } from './MobileOrders';

vi.mock('../../context/AuthContext', () => ({ useAuth: () => ({ token: 'token' }) }));
// Deliberately return a fresh account object to catch object-identity dependencies.
vi.mock('../../context/AccountContext', () => ({ useAccount: () => ({ currentAccount: { id: 'account-1', currency: 'USD' } }) }));
vi.mock('../../hooks/useHaptic', () => ({ useHaptic: () => ({ triggerHaptic: vi.fn() }) }));
vi.mock('../../utils/logger', () => ({ Logger: { error: vi.fn(), warn: vi.fn() } }));
const { subscribe } = vi.hoisted(() => ({ subscribe: vi.fn(() => () => undefined) }));
vi.mock('../../utils/productCrossTabEvents', () => ({ subscribeToCrossTabEvents: subscribe }));

const response = (data: unknown, ok = true) => ({ ok, json: async () => data }) as Response;
const orderCalls = () => vi.mocked(fetch).mock.calls.filter(([url]) => String(url).includes('/search?'));
const countCalls = () => vi.mocked(fetch).mock.calls.filter(([url]) => String(url).endsWith('/status-counts'));
async function renderOrders() {
    await act(async () => {
        render(<MemoryRouter><ToastProvider><MobileOrders /></ToastProvider></MemoryRouter>);
    });
}

describe('MobileOrders request lifecycle', () => {
    beforeEach(() => {
        vi.useFakeTimers();
        vi.stubGlobal('fetch', vi.fn(async (url: string) => response(
            url.endsWith('/status-counts') ? { total: 0, counts: {} } : { orders: [], total: 0 }
        )));
    });
    afterEach(() => {
        cleanup();
        vi.useRealTimers();
        vi.unstubAllGlobals();
        vi.clearAllMocks();
    });

    it('shows one error without a toast-driven fetch loop and allows explicit retry', async () => {
        vi.mocked(fetch).mockImplementation(async url => response({}, String(url).endsWith('/status-counts')));
        await renderOrders();
        expect(screen.getByRole('button', { name: 'Retry' })).toBeInTheDocument();
        expect(screen.getAllByRole('alert')).toHaveLength(1);
        await act(async () => vi.advanceTimersByTimeAsync(5000));
        expect(orderCalls()).toHaveLength(1);
        expect(countCalls()).toHaveLength(1);
        await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Retry' })));
        expect(orderCalls()).toHaveLength(2);
        expect(countCalls()).toHaveLength(1);
    });

    it('debounces search and keeps global counts independent of search and status', async () => {
        await renderOrders();
        const input = screen.getByRole('searchbox');
        fireEvent.change(input, { target: { value: 'a' } });
        await act(async () => vi.advanceTimersByTimeAsync(200));
        fireEvent.change(input, { target: { value: 'ada' } });
        await act(async () => vi.advanceTimersByTimeAsync(299));
        expect(orderCalls()).toHaveLength(1);
        await act(async () => vi.advanceTimersByTimeAsync(1));
        expect(orderCalls()).toHaveLength(2);
        expect(String(orderCalls()[1][0])).toContain('q=ada');
        await act(async () => fireEvent.click(screen.getByRole('button', { name: /To Pack/ })));
        expect(orderCalls()).toHaveLength(3);
        expect(String(orderCalls()[2][0])).toContain('status=processing');
        expect(countCalls()).toHaveLength(1);
        await act(async () => window.dispatchEvent(new Event('mobile-refresh')));
        expect(orderCalls()).toHaveLength(4);
        expect(countCalls()).toHaveLength(2);
    });

    it('submits the latest search immediately without a duplicate debounce request', async () => {
        await renderOrders();
        const input = screen.getByRole('searchbox');
        fireEvent.change(input, { target: { value: ' latest ' } });
        await act(async () => fireEvent.submit(input.closest('form')!));
        expect(String(orderCalls()[1][0])).toContain('q=latest');
        await act(async () => vi.advanceTimersByTimeAsync(500));
        expect(orderCalls()).toHaveLength(2);
    });

    it('ignores an obsolete request failure after the filter changes', async () => {
        await renderOrders();
        let rejectRequest!: (error: Error) => void;
        vi.mocked(fetch).mockImplementationOnce(() => new Promise((_resolve, reject) => { rejectRequest = reject; }));
        await act(async () => fireEvent.click(screen.getByRole('button', { name: /To Pack/ })));
        // The empty-list skeleton hides filters while the request is pending; refresh supersedes it.
        await act(async () => window.dispatchEvent(new Event('mobile-refresh')));
        await act(async () => rejectRequest(new Error('Late network error')));
        expect(screen.queryByRole('alert')).not.toBeInTheDocument();
        expect(screen.queryByRole('button', { name: 'Retry' })).not.toBeInTheDocument();
    });
});
