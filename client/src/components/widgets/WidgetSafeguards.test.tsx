import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
const m = vi.hoisted(() => ({ account: { id: 'a' }, fetch: vi.fn(), poll: null as (() => Promise<void>) | null }));
vi.mock('../../context/AccountContext', () => ({ useAccount: () => ({ currentAccount: m.account }) }));
vi.mock('../../context/AuthContext', () => ({ useAuth: () => ({ token: 'token' }) }));
vi.mock('../../hooks/useVisibilityPolling', async () => {
    const { useEffect } = await import('react');
    return { useVisibilityPolling: (callback: () => Promise<void>) => { m.poll = callback; useEffect(() => { void callback(); }, [callback]); } };
});
import { AdSpendWidget } from './AdSpendWidget';
import { CartAbandonmentWidget } from './CartAbandonmentWidget';
import EcommerceLogWidget from './EcommerceLogWidget';
const response = (value: unknown) => ({ ok: true, json: async () => value });
const props = { dateRange: { startDate: '2026-10-01', endDate: '2026-10-20' } };
beforeEach(() => { vi.resetAllMocks(); m.account = { id: 'a' }; m.poll = null; vi.stubGlobal('fetch', m.fetch); });
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });
describe('ad spend availability', () => {
    it('shows true zero ROAS but does not invent a money currency', async () => {
        m.fetch.mockResolvedValue(response({ spend: 0, roas: 0, clicks: 0 })); render(<AdSpendWidget {...props} />);
        await screen.findByText('0.00x'); expect(screen.getByText('Unavailable')).toBeInTheDocument(); expect(screen.queryByText(/USD/)).toBeNull();
    });
    it('keeps absent metrics unavailable and retries malformed reads', async () => {
        m.fetch.mockResolvedValueOnce(response({ roas: 'bad' })).mockResolvedValue(response({})); render(<AdSpendWidget {...props} />); await screen.findByRole('alert');
        fireEvent.click(screen.getByRole('button', { name: 'Retry ad spend' })); await waitFor(() => expect(screen.getAllByText('Unavailable')).toHaveLength(3));
    });
    it('aborts late account responses and encodes reporting dates', async () => {
        let resolve!: (value: unknown) => void; m.fetch.mockReturnValueOnce(new Promise(r => { resolve = r; })); const view = render(<AdSpendWidget {...props} />);
        await waitFor(() => expect(m.fetch).toHaveBeenCalledOnce()); const signal = m.fetch.mock.calls[0][1].signal;
        m.account = { id: 'b' }; m.fetch.mockResolvedValue(response({ hasData: false })); view.rerender(<AdSpendWidget {...props} />); await screen.findByText('No connected advertising accounts.');
        await act(async () => { resolve(response({ spend: 999, roas: 3, currency: 'EUR', clicks: 1 })); }); expect(signal.aborted).toBe(true); expect(screen.queryByText(/999/)).toBeNull();
        expect(new URL(m.fetch.mock.calls[0][0], 'http://test').searchParams.get('startDate')).toBe('2026-10-01');
    });
});
const cart = { totalAddToCarts: 4, totalPurchases: 4, totalRemoves: 0, overallAbandonmentRate: 0, topAbandonedProducts: [], quickRemoveProducts: [] };
describe('cart activity', () => {
    it('distinguishes failed reads from absent events and retains totals when there are no ranked products', async () => {
        m.fetch.mockResolvedValueOnce({ ok: false }).mockResolvedValue(response(cart)); render(<CartAbandonmentWidget {...props} />); await screen.findByRole('alert'); expect(screen.queryByText('No abandonment data yet')).toBeNull();
        fireEvent.click(screen.getByRole('button', { name: 'Retry cart activity' })); await screen.findByText('0% overall rate'); expect(screen.getByText('Purchased')).toBeInTheDocument(); expect(screen.getAllByText('4')).toHaveLength(2);
    });
    it('rejects malformed ranked-product data instead of crashing or showing an empty state', async () => {
        m.fetch.mockResolvedValue(response({ ...cart, quickRemoveProducts: {} })); render(<CartAbandonmentWidget {...props} />); await screen.findByRole('alert');
    });
});
const event = { id: 'event', type: 'add_to_cart', createdAt: 'invalid', session: { email: 'private@example.test' }, payload: { items: [{ name: 'Mug' }], total: 0, currency: 'EUR' } };
describe('ecommerce stream lifecycle', () => {
    it('renders safe dates and zero totals, and exposes refresh failures while retaining last good activity', async () => {
        m.fetch.mockResolvedValueOnce(response({ data: [event] })); render(<EcommerceLogWidget />); await screen.findByText(/private@example.test added Mug/);
        expect(screen.getByText('Date unavailable')).toBeInTheDocument(); expect(screen.getByText(/EUR.*0/)).toBeInTheDocument();
        m.fetch.mockRejectedValueOnce(new Error('Offline')); await act(async () => { await m.poll!(); }); expect(screen.getByRole('alert')).toHaveTextContent('last successful refresh'); expect(screen.getByText(/private@example.test added Mug/)).toBeInTheDocument();
    });
    it('aborts old-account polling and does not retain private activity on account changes', async () => {
        let resolve!: (value: unknown) => void; m.fetch.mockReturnValueOnce(new Promise(r => { resolve = r; })); const view = render(<EcommerceLogWidget />);
        await waitFor(() => expect(m.fetch).toHaveBeenCalledOnce()); const signal = m.fetch.mock.calls[0][1].signal;
        m.account = { id: 'b' }; m.fetch.mockResolvedValue(response({ data: [] })); view.rerender(<EcommerceLogWidget />); await screen.findByText('No recent commerce activity.');
        await act(async () => { resolve(response({ data: [event] })); }); expect(signal.aborted).toBe(true); expect(screen.queryByText(/private@example/)).toBeNull();
    });
    it('treats malformed item arrays as an unavailable stream', async () => {
        m.fetch.mockResolvedValue(response({ data: [{ ...event, payload: { items: {} } }] })); render(<EcommerceLogWidget />); await screen.findByRole('alert'); expect(screen.queryByText('No recent commerce activity.')).toBeNull();
    });
});
