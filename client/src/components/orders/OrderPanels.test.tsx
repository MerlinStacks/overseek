import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
const m = vi.hoisted(() => ({ account: { id: 'a', currency: 'EUR' }, permission: true, fetch: vi.fn() }));
vi.mock('../../context/AccountContext', () => ({ useAccount: () => ({ currentAccount: m.account }) }));
vi.mock('../../context/AuthContext', () => ({ useAuth: () => ({ token: 'token' }) }));
vi.mock('../../hooks/usePermissions', () => ({ usePermissions: () => ({ hasPermission: () => m.permission }) }));
vi.mock('../ui/Modal', () => ({ Modal: ({ children }: { children: React.ReactNode }) => <div role="dialog">{children}</div> }));
import { FraudBadge } from './FraudBadge';
import { FraudIcon } from './FraudIcon';
import { OrderCOGSPanel } from './OrderCOGSPanel';
import { OrderPreviewModal } from './OrderPreviewModal';
const response = (value: unknown) => ({ ok: true, json: async () => value });
const fraud = { score: 0, level: 'low', factors: [], warnings: ['Customer order history unavailable'] };
beforeEach(() => { vi.resetAllMocks(); m.account = { id: 'a', currency: 'EUR' }; m.permission = true; vi.stubGlobal('fetch', m.fetch); });
afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.restoreAllMocks(); vi.useRealTimers(); });
describe('fraud indicators', () => {
    it('renders outside the clipping table and keeps the popup inside the viewport', async () => {
        let anchorTop = window.innerHeight - 40;
        vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
            return (this.getAttribute('role') === 'region'
                ? { width: 256, height: 180, top: 0, bottom: 180, left: 0, right: 256 }
                : { width: 28, height: 28, top: anchorTop, bottom: anchorTop + 28, left: 20, right: 48 }) as DOMRect;
        });
        m.fetch.mockResolvedValue(response(fraud));
        const view = render(<div style={{ overflow: 'hidden' }}><FraudIcon orderId={1} /></div>);
        fireEvent.click(screen.getByRole('button'));
        await screen.findByText('Customer order history unavailable');
        const panel = screen.getByRole('region', { name: 'Fraud risk details' });
        expect(panel.parentElement).toBe(document.body);
        expect(view.container).not.toContainElement(panel);
        expect(panel).toHaveClass('fixed', 'whitespace-normal');
        expect(panel.style.left).toBe('16px');
        expect(panel.style.top).toBe(`${anchorTop - 184}px`);
        anchorTop = 30;
        fireEvent.scroll(window);
        expect(panel.style.top).toBe('62px');
        fireEvent.pointerDown(panel);
        expect(panel).toBeInTheDocument();
        fireEvent.pointerDown(document.body);
        expect(screen.queryByRole('region')).toBeNull();
    });
    it('allows hovering from the trigger into the portalled details', async () => {
        m.fetch.mockResolvedValue(response(fraud)); render(<FraudIcon orderId={1} />);
        const trigger = screen.getByRole('button');
        fireEvent.mouseEnter(trigger);
        await screen.findByText('Customer order history unavailable');
        vi.useFakeTimers();
        const panel = screen.getByRole('region');
        fireEvent.mouseLeave(trigger, { relatedTarget: document.body });
        fireEvent.mouseEnter(panel);
        act(() => { vi.advanceTimersByTime(200); });
        expect(panel).toBeInTheDocument();
        fireEvent.mouseLeave(panel, { relatedTarget: document.body });
        act(() => { vi.advanceTimersByTime(200); });
        expect(screen.queryByRole('region')).toBeNull();
    });
    it('is neutral and lazy before checking, and exposes limitations by keyboard', async () => {
        m.fetch.mockResolvedValue(response(fraud)); render(<FraudIcon orderId={1} />);
        expect(m.fetch).not.toHaveBeenCalled(); const trigger = screen.getByRole('button', { name: 'Check fraud risk' });
        fireEvent.focus(trigger); await screen.findByText('Customer order history unavailable');
        expect(trigger).toHaveAttribute('aria-expanded', 'true'); fireEvent.keyDown(trigger, { key: 'Escape' }); expect(screen.queryByRole('region')).toBeNull();
        fireEvent.click(trigger); expect(screen.getByRole('region', { name: 'Fraud risk details' })).toBeInTheDocument();
    });
    it('resets a checked compact icon when the order changes', async () => {
        m.fetch.mockResolvedValue(response(fraud)); const view = render(<FraudIcon orderId={1} />); fireEvent.click(screen.getByRole('button')); await screen.findByText('Customer order history unavailable');
        view.rerender(<FraudIcon orderId={2} />); expect(screen.getByRole('button')).toHaveAccessibleName('Check fraud risk'); expect(screen.queryByText('Customer order history unavailable')).toBeNull();
    });
    it('aborts old badge reads after an account change', async () => {
        let resolve!: (value: unknown) => void; m.fetch.mockReturnValueOnce(new Promise(r => { resolve = r; })); const view = render(<FraudBadge orderId="order" />);
        await waitFor(() => expect(m.fetch).toHaveBeenCalledOnce()); const signal = m.fetch.mock.calls[0][1].signal;
        m.account = { id: 'b', currency: 'AUD' }; m.fetch.mockResolvedValue(response(fraud)); view.rerender(<FraudBadge orderId="order" />);
        await screen.findByRole('button', { name: 'Low Risk (0)' }); await act(async () => { resolve(response({ score: 50, level: 'high', factors: ['Private'], warnings: [] })); });
        expect(signal.aborted).toBe(true); expect(screen.queryByRole('button', { name: /High Risk/ })).toBeNull();
    });
    it('shows malformed/failed assessments as unavailable, with retry', async () => {
        m.fetch.mockResolvedValueOnce(response({ score: 0, level: 'unknown', factors: [] })).mockResolvedValue(response(fraud));
        render(<FraudBadge orderId="order" />); const trigger = await screen.findByRole('button', { name: 'Risk unavailable' }); fireEvent.click(trigger);
        fireEvent.click(screen.getByRole('button', { name: 'Retry risk check' })); await screen.findByText('Customer order history unavailable');
    });
});
const cogs = { items: [{ name: 'Private item', sku: '', quantity: 1, unitCOGS: 0, lineCOGS: 0 }], totalCOGS: 0, totalRevenue: 20, paymentFees: 1, grossProfit: 19, margin: 95 };
describe('order COGS', () => {
    it('retains explicit zero costs and removes all financial data on permission loss', async () => {
        m.fetch.mockResolvedValue(response(cogs)); const view = render(<OrderCOGSPanel orderId="1" />); await screen.findByText('Private item');
        expect(screen.getAllByText(/EUR/).length).toBeGreaterThan(1); m.permission = false; view.rerender(<OrderCOGSPanel orderId="1" />); expect(screen.queryByText('Private item')).toBeNull();
    });
    it('clears previous order data on a failed new read, then retries', async () => {
        m.fetch.mockResolvedValueOnce(response(cogs)); const view = render(<OrderCOGSPanel orderId="1" />); await screen.findByText('Private item');
        m.fetch.mockResolvedValueOnce({ ok: false }).mockResolvedValue(response({ ...cogs, items: [] })); view.rerender(<OrderCOGSPanel orderId="2" />);
        expect(screen.queryByText('Private item')).toBeNull(); await screen.findByRole('alert'); fireEvent.click(screen.getByRole('button', { name: 'Retry COGS' })); await screen.findByText('No item-level COGS data available.');
    });
});
const order = { status: 'processing', date_created: 'invalid', billing: { first_name: 'Customer', email: 'private@example.test' }, line_items: [{ id: 1, name: 'Item', quantity: 1, price: '20.00', total: '20.00' }], total: '20.00' };
describe('order preview', () => {
    it('uses safe dates and does not invent a currency', async () => {
        m.fetch.mockResolvedValue(response(order)); render(<MemoryRouter><OrderPreviewModal isOpen orderId={1} onClose={vi.fn()} /></MemoryRouter>);
        await screen.findByText('Customer'); expect(screen.getByText('Date unavailable')).toBeInTheDocument(); expect(screen.getAllByText('Unavailable').length).toBeGreaterThan(1); expect(screen.queryByText(/USD/)).toBeNull();
    });
    it('aborts reads when closed and rejects malformed customer data on reopen', async () => {
        m.fetch.mockReturnValueOnce(new Promise(() => {})); const close = vi.fn();
        const view = render(<MemoryRouter><OrderPreviewModal isOpen orderId={1} onClose={close} /></MemoryRouter>);
        await waitFor(() => expect(m.fetch).toHaveBeenCalledOnce()); const signal = m.fetch.mock.calls[0][1].signal;
        view.rerender(<MemoryRouter><OrderPreviewModal isOpen={false} orderId={1} onClose={close} /></MemoryRouter>); expect(signal.aborted).toBe(true);
        m.fetch.mockResolvedValueOnce(response({ ...order, billing: { first_name: {} } })).mockResolvedValue(response({ ...order, currency: 'EUR' }));
        view.rerender(<MemoryRouter><OrderPreviewModal isOpen orderId={2} onClose={close} /></MemoryRouter>); await screen.findByRole('alert');
        fireEvent.click(screen.getByRole('button', { name: 'Retry order preview' })); await screen.findByText('private@example.test');
    });
});
