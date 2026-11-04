import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';

const m = vi.hoisted(() => ({
    account: { id: 'a', currency: 'AUD', features: [{ featureKey: 'SHIPPING_HUB', isEnabled: true }] },
    fetch: vi.fn(),
    copy: vi.fn(),
}));
vi.mock('../context/AuthContext', () => ({ useAuth: () => ({ token: 'token' }) }));
vi.mock('../context/AccountContext', () => ({ useAccount: () => ({ currentAccount: m.account }) }));
vi.mock('../hooks/usePermissions', () => ({ usePermissions: () => ({ hasPermission: (permission: string) => permission === 'view_orders' }) }));
vi.mock('../context/ToastContext', () => ({ useToast: () => ({ error: vi.fn() }) }));
vi.mock('../components/orders/OrderTagPanel', () => ({ OrderTagPanel: () => null }));
vi.mock('../components/orders/OrderCOGSPanel', () => ({ OrderCOGSPanel: () => null }));
vi.mock('../components/orders/OrderMetaSection', () => ({ OrderMetaSection: () => null }));
vi.mock('../components/shared/HistoryTimeline', () => ({ HistoryTimeline: () => null }));
vi.mock('../utils/productCrossTabEvents', () => ({ emitCrossTabEvent: vi.fn(), subscribeToCrossTabEvents: () => () => {} }));
import { OrderDetailPage } from './OrderDetailPage';

const tracking = { provider: 'Australia Post', trackingNumber: 'TRACK123', trackingUrl: 'https://auspost.com.au/mypost/track/details/TRACK123', dateShipped: '2026-10-01' };
const showOrder = (trackingItems: typeof tracking[]) => {
    m.fetch.mockImplementation(async (url: string) => ({ ok: true, json: async () => {
        if (url === '/api/orders/42') return { id: 42, wooId: 42, status: 'processing', currency: 'AUD', total: '10.00', line_items: [], billing: {}, shipping: {}, tracking_items: trackingItems };
        if (url.endsWith('/attribution')) return { attribution: null };
        if (url.endsWith('/order-statuses')) return { data: [] };
        throw new Error(`Unexpected request: ${url}`);
    } }));
    return render(<MemoryRouter initialEntries={['/orders/42']}><Routes><Route path="/orders/:id" element={<OrderDetailPage />} /></Routes></MemoryRouter>);
};

beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal('localStorage', { getItem: vi.fn().mockReturnValue(null), setItem: vi.fn() });
    vi.stubGlobal('fetch', m.fetch);
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: m.copy } });
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

it('keeps order tracking, carrier links and copy without shipping permissions or hub requests', async () => {
    showOrder([tracking]);
    expect(await screen.findByText('TRACK123')).toBeVisible();
    expect(screen.getByText('Australia Post')).toBeVisible();
    expect(screen.getByTitle('Track shipment')).toHaveAttribute('href', tracking.trackingUrl);
    fireEvent.click(screen.getByTitle('Copy tracking number'));
    expect(m.copy).toHaveBeenCalledExactlyOnceWith('TRACK123');
    expect(m.fetch.mock.calls.some(([url]) => url.startsWith('/api/shipping'))).toBe(false);
});

it('does not show an empty shipment panel or query the hub for orders without tracking', async () => {
    showOrder([]);
    await screen.findByRole('heading', { name: 'Order #42' });
    expect(screen.queryByText('Shipment Tracking')).not.toBeInTheDocument();
    expect(m.fetch.mock.calls.some(([url]) => url.startsWith('/api/shipping'))).toBe(false);
});
