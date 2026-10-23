import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter, useLocation } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MobileInventory } from './MobileInventory';
import { MobileCustomers } from './MobileCustomers';
import { MobileProfile } from './MobileProfile';
import { MobileNotifications } from './MobileNotifications';

const mocks = vi.hoisted(() => ({
    account: { id: 'store-1', currency: 'USD' },
    user: { id: 'user-1', fullName: 'Jane Smith', email: 'jane@example.com' },
    updatePreferences: vi.fn(async () => true),
}));
vi.mock('../../context/AuthContext', () => ({ useAuth: () => ({ token: 'token', user: mocks.user, updateUser: vi.fn(), logout: vi.fn() }) }));
vi.mock('../../context/AccountContext', () => ({ useAccount: () => ({ currentAccount: mocks.account }) }));
vi.mock('../../hooks/useHaptic', () => ({ useHaptic: () => ({ triggerHaptic: vi.fn() }) }));
vi.mock('../../hooks/usePushNotifications', () => ({ usePushNotifications: () => ({ isSupported: true, isSubscribed: true, isLoading: false, permissionState: 'granted', updatePreferences: mocks.updatePreferences }) }));
vi.mock('../../utils/productCrossTabEvents', () => ({ subscribeToProductChanges: () => () => {}, subscribeToCrossTabEvents: () => () => {} }));

beforeEach(() => {
    vi.stubGlobal('matchMedia', vi.fn(() => ({ matches: false })));
    vi.stubGlobal('fetch', vi.fn(async (url: string) => ({
        ok: true,
        json: async () => url.startsWith('/api/products') ? { products: [{ id: 'product-1', name: 'Engraved mug', sku: 'MUG-1', stockQuantity: 20, price: 25 }] }
            : { customers: [{ id: 'customer-1', firstName: 'Jane', lastName: 'Smith', email: 'jane@example.com', ordersCount: 2, totalSpent: 50 }] }
    })));
});
afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
    vi.clearAllMocks();
});

describe('secondary companion screen styling', () => {
    it('uses shared inventory surfaces in both list and grid views', async () => {
        await act(async () => render(<MemoryRouter><MobileInventory /></MemoryRouter>));
        expect(screen.getByRole('heading', { name: 'Inventory' })).toBeInTheDocument();
        expect(screen.getByText('Engraved mug').closest('.mobile-panel')).toBeInTheDocument();
        fireEvent.click(screen.getByRole('button', { name: 'Grid view' }));
        expect(screen.getByRole('button', { name: 'Grid view' })).toHaveAttribute('aria-pressed', 'true');
        expect(screen.getByText('Engraved mug').closest('.mobile-panel')).toBeInTheDocument();
        expect(screen.getByText('SKU: MUG-1')).toBeInTheDocument();
    });

    it('keeps customer cards navigable after the visual refresh', async () => {
        function Location() { return <output data-testid="location">{useLocation().pathname}</output>; }
        await act(async () => render(<MemoryRouter><MobileCustomers /><Location /></MemoryRouter>));
        expect(screen.getByRole('heading', { name: 'Customers' })).toBeInTheDocument();
        const summary = screen.getByLabelText('Customer results summary');
        expect(summary).toHaveClass('metric-strip');
        expect(summary.querySelectorAll('.metric-strip-item')).toHaveLength(2);
        expect(summary).toHaveTextContent('Total Spent');
        expect(summary).toHaveTextContent('$50.00');
        fireEvent.click(screen.getByRole('button', { name: /Jane Smith/ }));
        expect(screen.getByTestId('location')).toHaveTextContent('/m/customers/customer-1');
    });

    it('uses branded profile actions and retains the editable form', () => {
        render(<MemoryRouter><MobileProfile /></MemoryRouter>);
        expect(screen.getByRole('heading', { level: 1, name: 'Profile' })).toBeInTheDocument();
        expect(screen.getByRole('button', { name: 'Save Changes' })).toHaveClass('mobile-brand-solid');
        expect(screen.getByPlaceholderText('Your name')).toHaveValue('Jane Smith');
        fireEvent.change(screen.getByPlaceholderText('Your name'), { target: { value: 'Jane Jones' } });
        expect(screen.getByPlaceholderText('Your name')).toHaveValue('Jane Jones');
    });

    it('retains notification preference updates with branded switches', async () => {
        const { container } = render(<MemoryRouter><MobileNotifications /></MemoryRouter>);
        expect(screen.getByRole('heading', { name: 'Notifications' })).toBeInTheDocument();
        expect(container.querySelectorAll('.mobile-switch-on')).toHaveLength(3);
        await act(async () => fireEvent.click(screen.getByRole('button', { name: /Low Stock Alerts/ })));
        expect(mocks.updatePreferences).toHaveBeenCalledWith({ notifyLowStock: true });
        expect(container.querySelectorAll('.mobile-switch-on')).toHaveLength(4);
    });
});
