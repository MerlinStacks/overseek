import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, useLocation } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MobileCustomerSheet, type MobileCustomerConversation } from './MobileCustomerSheet';

const context = vi.hoisted(() => ({ token: 'token' as string | null, currentAccount: { id: 'account-1', currency: 'AUD' } as { id: string; currency?: string } | null }));
vi.mock('../../context/AuthContext', () => ({ useAuth: () => ({ token: context.token }) }));
vi.mock('../../context/AccountContext', () => ({ useAccount: () => ({ currentAccount: context.currentAccount }) }));

const conversation: MobileCustomerConversation = {
    id: 'conversation-1', customerName: 'Ada Example', customerEmail: 'ada@example.com',
    customer: { id: 'local-customer', wooId: 42, firstName: 'Ada', lastName: 'Example', totalSpent: '123.50', ordersCount: 9 },
};
const order = { id: 'local-order', number: '101', total: '12.50', currency: 'AUD', status: 'processing', dateCreated: '2026-09-01T12:00:00Z' };
const response = (orders: unknown[] = []) => new Response(JSON.stringify({ orders }), { status: 200 });
function Location() { return <output data-testid="location">{useLocation().pathname}</output>; }
function view(props: Partial<React.ComponentProps<typeof MobileCustomerSheet>> = {}) {
    return <MemoryRouter><Location /><MobileCustomerSheet open onClose={vi.fn()} conversation={conversation} {...props} /></MemoryRouter>;
}

describe('MobileCustomerSheet', () => {
    beforeEach(() => {
        context.token = 'token';
        context.currentAccount = { id: 'account-1', currency: 'AUD' };
        vi.stubGlobal('fetch', vi.fn().mockResolvedValue(response()));
    });
    afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

    it('fetches lazily with Woo ID and context headers, and displays at most five orders', async () => {
        vi.mocked(fetch).mockResolvedValue(response(Array.from({ length: 6 }, (_, i) => ({ ...order, id: `order-${i}`, number: String(101 + i) }))));
        const { rerender } = render(view({ open: false }));
        expect(fetch).not.toHaveBeenCalled();
        expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
        rerender(view());
        expect(screen.getByRole('status')).toHaveTextContent('Loading orders');
        await screen.findByText('Order #101');
        expect(fetch).toHaveBeenCalledWith('/api/orders?customerId=42&limit=5', expect.objectContaining({ headers: { Authorization: 'Bearer token', 'X-Account-ID': 'account-1' }, signal: expect.any(AbortSignal) }));
        expect(screen.getAllByRole('listitem')).toHaveLength(5);
        expect(screen.queryByText('Order #106')).not.toBeInTheDocument();
        expect(screen.getByText('$123.50')).toBeInTheDocument();
        expect(screen.getByRole('link', { name: 'View customer profile' })).toHaveAttribute('href', '/m/customers/local-customer');
    });

    it.each([0, -1, 'local-uuid', '12oops', 1.5, null])('uses encoded billing email when Woo ID %s is invalid', async wooId => {
        render(view({ conversation: { ...conversation, customerEmail: ' guest+tag@example.com ', customer: { wooId } } }));
        await screen.findByText('No orders found for this customer.');
        expect(fetch).toHaveBeenCalledWith('/api/orders?billingEmail=guest%2Btag%40example.com&limit=5', expect.anything());
    });

    it('accepts numeric Woo ID strings and prefers the linked customer email for fallback', async () => {
        const { rerender } = render(view({ conversation: { ...conversation, customer: { wooId: '0042' } } }));
        await screen.findByText('No orders found for this customer.');
        expect(fetch).toHaveBeenLastCalledWith('/api/orders?customerId=42&limit=5', expect.anything());
        vi.mocked(fetch).mockResolvedValue(response());
        rerender(view({ conversation: { ...conversation, customer: { email: 'linked@example.com' } } }));
        await screen.findByText('No orders found for this customer.');
        expect(fetch).toHaveBeenLastCalledWith('/api/orders?billingEmail=linked%40example.com&limit=5', expect.anything());
    });

    it.each(['identity', 'account', 'token', 'conversation'])('never fetches an unfiltered or unauthenticated list when missing %s', missing => {
        if (missing === 'account') context.currentAccount = null;
        if (missing === 'token') context.token = null;
        render(view({ conversation: missing === 'conversation' ? null : missing === 'identity' ? { id: 'guest', customerName: 'Guest' } : conversation }));
        expect(fetch).not.toHaveBeenCalled();
        expect(screen.getByRole('status')).toHaveTextContent('Order history unavailable');
    });

    it.each(['http', 'network', 'malformed'])('shows retry after a %s error and recovers to empty', async kind => {
        if (kind === 'network') vi.mocked(fetch).mockRejectedValueOnce(new Error('Offline'));
        else vi.mocked(fetch).mockResolvedValueOnce(kind === 'http' ? new Response('', { status: 500 }) : new Response('{}'));
        render(view());
        expect(await screen.findByRole('alert')).toHaveTextContent('Could not load recent orders.');
        fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
        expect(await screen.findByRole('status')).toHaveTextContent('No orders found for this customer.');
        expect(fetch).toHaveBeenCalledTimes(2);
    });

    it.each(['account', 'conversation', 'close', 'unmount'])('aborts and ignores late responses after %s changes', async change => {
        let resolve!: (value: Response) => void;
        vi.mocked(fetch).mockImplementationOnce(() => new Promise(res => { resolve = res; }));
        const { rerender, unmount } = render(view());
        const signal = vi.mocked(fetch).mock.calls[0][1]?.signal;
        if (change === 'account') { context.currentAccount = { id: 'account-2' }; rerender(view()); }
        if (change === 'conversation') rerender(view({ conversation: { ...conversation, id: 'conversation-2', customer: { wooId: 55 } } }));
        if (change === 'close') rerender(view({ open: false }));
        if (change === 'unmount') unmount();
        expect(signal?.aborted).toBe(true);
        await act(async () => { resolve(response([order])); });
        expect(screen.queryByText('Order #101')).not.toBeInTheDocument();
        if (change === 'account' || change === 'conversation') expect(await screen.findByRole('status')).toHaveTextContent('No orders found');
    });

    it('clears already loaded account data while the next request is pending', async () => {
        vi.mocked(fetch).mockResolvedValueOnce(response([order])).mockImplementationOnce(() => new Promise(() => {}));
        const { rerender } = render(view());
        await screen.findByText('Order #101');
        context.currentAccount = { id: 'account-2', currency: 'USD' };
        rerender(view());
        expect(screen.queryByText('Order #101')).not.toBeInTheDocument();
        expect(screen.getByRole('status')).toHaveTextContent('Loading orders');
    });

    it.each(['order', 'customer'])('uses SPA navigation for the %s link and closes the sheet', async target => {
        vi.mocked(fetch).mockResolvedValue(response([order]));
        const onClose = vi.fn();
        render(view({ onClose }));
        await screen.findByText('Order #101');
        fireEvent.click(screen.getByRole('link', { name: target === 'order' ? /Order #101/ : 'View customer profile' }));
        expect(screen.getByTestId('location')).toHaveTextContent(target === 'order' ? '/m/orders/local-order' : '/m/customers/local-customer');
        expect(onClose).toHaveBeenCalledOnce();
    });

    it('inherits accessible naming, focus trap, dismissal, background locking and focus restoration from Modal', async () => {
        const onClose = vi.fn();
        const trigger = document.createElement('button');
        document.body.appendChild(trigger);
        trigger.focus();
        const { rerender, container } = render(view({ onClose }));
        const dialog = screen.getByRole('dialog', { name: 'Customer details' });
        expect(dialog).toHaveAttribute('aria-modal', 'true');
        expect(dialog).toHaveClass('bg-slate-900', 'rounded-t-3xl');
        expect(dialog.parentElement).toHaveClass('z-[90]', 'items-end');
        expect(dialog.querySelector('style')).toBeNull();
        expect(container).toHaveAttribute('aria-hidden', 'true');
        expect(document.body.style.overflow).toBe('hidden');
        const close = screen.getByRole('button', { name: 'Close dialog' });
        expect(close).toHaveFocus();
        fireEvent.keyDown(document, { key: 'Tab', shiftKey: true });
        expect(screen.getByRole('link', { name: 'View customer profile' })).toHaveFocus();
        fireEvent.keyDown(document, { key: 'Tab' });
        expect(close).toHaveFocus();
        fireEvent.keyDown(document, { key: 'Escape' });
        fireEvent.click(close);
        fireEvent.click(dialog.previousElementSibling!);
        expect(onClose).toHaveBeenCalledTimes(3);
        await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('No orders found'));
        rerender(view({ open: false, onClose }));
        expect(trigger).toHaveFocus();
        expect(container).not.toHaveAttribute('aria-hidden');
        expect(document.body.style.overflow).toBe('');
        trigger.remove();
    });
});
