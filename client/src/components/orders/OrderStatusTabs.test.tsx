import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
vi.mock('../../context/AuthContext', () => ({ useAuth: () => ({ token: 'token', user: { id: 'u' } }) }));
const m = vi.hoisted(() => ({ account: 'a' }));
vi.mock('../../context/AccountContext', () => ({ useAccount: () => ({ currentAccount: { id: m.account } }) }));
import { OrderStatusTabs } from './OrderStatusTabs';
import { decodeStatusCounts } from './statusCountObservation';
afterEach(() => { cleanup(); vi.unstubAllGlobals(); m.account = 'a'; });
it('normalizes identity once and rejects invalid or incomplete count totals', () => {
    expect(decodeStatusCounts({ total: 3, counts: { 'wc-processing': 1, PROCESSING: 2 } }).counts.processing).toBe(3);
    expect(() => decodeStatusCounts({ total: 5, counts: { processing: 2 } })).toThrow('coverage');
    expect(() => decodeStatusCounts({ total: -1, counts: {} })).toThrow();
});
it('keeps selected zero/custom filters and masks old counts immediately on scope change', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({ total: 3, counts: { processing: 3, custom: 0 } }))));
    const select = vi.fn(), view = render(<OrderStatusTabs selectedStatus="CUSTOM" onStatusChange={select} />);
    const selected = await screen.findByRole('button', { name: /custom/i });
    expect(selected).toHaveAttribute('aria-pressed', 'true');
    fireEvent.click(selected); expect(select).toHaveBeenCalledWith('custom');
    await screen.findAllByText('3');
    m.account = 'b'; vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('offline')));
    view.rerender(<OrderStatusTabs selectedStatus="custom" onStatusChange={select} />);
    expect(screen.queryByText('3')).not.toBeInTheDocument();
    expect(await screen.findByRole('status')).toBeInTheDocument();
});
