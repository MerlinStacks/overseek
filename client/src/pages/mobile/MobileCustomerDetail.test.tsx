import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { MobileCustomerDetail } from './MobileCustomerDetail';

vi.mock('../../context/AuthContext', () => ({
    useAuth: () => ({ token: 'test-token' })
}));

vi.mock('../../context/AccountContext', () => ({
    useAccount: () => ({ currentAccount: { id: 'account-1', currency: 'AUD' } })
}));

vi.mock('../../utils/productCrossTabEvents', () => ({
    subscribeToCrossTabEvents: () => () => undefined
}));

vi.mock('../../utils/logger', () => ({
    Logger: { error: vi.fn() }
}));

const customerResponse = {
    customer: {
        id: 'customer-1',
        firstName: 'Ada',
        lastName: 'Lovelace',
        email: 'ada@example.com',
        totalSpent: 120,
        ordersCount: 2,
        dateCreated: '2026-01-01T00:00:00.000Z',
        billingAddress: {
            phone: '0400 000 000',
            company: 'Fallback Company',
            address_1: '1 Test Street',
            address_2: 'Suite 2',
            city: 'Sydney',
            state: 'NSW',
            postcode: '2000',
            country: 'AU'
        },
        company: 'Analytical Engines Pty Ltd',
        abn: '12 345 678 901'
    },
    orders: [],
    automations: [],
    activity: []
};

function jsonResponse(body: unknown, ok = true, status = 200): Response {
    return {
        ok,
        status,
        json: async () => body
    } as Response;
}

function renderPage() {
    return render(
        <MemoryRouter initialEntries={['/m/customers/customer-1']}>
            <Routes>
                <Route path="/m/customers/:id" element={<MobileCustomerDetail />} />
            </Routes>
        </MemoryRouter>
    );
}

describe('MobileCustomerDetail', () => {
    beforeEach(() => {
        vi.stubGlobal('fetch', vi.fn());
    });

    afterEach(() => {
        vi.restoreAllMocks();
        vi.unstubAllGlobals();
    });

    it('shows normalized billing details and disables an unavailable contact status', async () => {
        vi.mocked(fetch).mockResolvedValueOnce(jsonResponse(customerResponse));

        renderPage();

        const statusSelect = await screen.findByRole('combobox', { name: 'Contact Status' });
        expect(statusSelect).toBeDisabled();
        expect(statusSelect).toHaveValue('');
        expect(screen.getAllByText('Unknown').length).toBeGreaterThan(0);
        expect(screen.getByText('Analytical Engines Pty Ltd')).toBeInTheDocument();
        expect(screen.getByText(/12 345 678 901/)).toHaveTextContent('ABN: 12 345 678 901');
        expect(screen.getByText('1 Test Street')).toBeInTheDocument();
        expect(screen.getByText('Suite 2')).toBeInTheDocument();
        expect(screen.getByText('Sydney NSW 2000')).toBeInTheDocument();
        expect(screen.getByText('AU')).toBeInTheDocument();
    });

    it('aborts an older load and ignores its late response', async () => {
        let resolveFirst: (response: Response) => void = () => undefined;
        const firstRequest = new Promise<Response>((resolve) => {
            resolveFirst = resolve;
        });
        vi.mocked(fetch)
            .mockReturnValueOnce(firstRequest)
            .mockResolvedValueOnce(jsonResponse({
                ...customerResponse,
                customer: { ...customerResponse.customer, firstName: 'Grace', lastName: 'Hopper' }
            }));

        renderPage();
        await waitFor(() => expect(fetch).toHaveBeenCalledTimes(1));
        const firstSignal = vi.mocked(fetch).mock.calls[0][1]?.signal;

        window.dispatchEvent(new Event('mobile-refresh'));

        expect((await screen.findAllByText('Grace Hopper')).length).toBeGreaterThan(0);
        expect(firstSignal?.aborted).toBe(true);

        resolveFirst(jsonResponse({
            ...customerResponse,
            customer: { ...customerResponse.customer, firstName: 'Stale', lastName: 'Customer' }
        }));
        await waitFor(() => expect(screen.queryByText('Stale Customer')).not.toBeInTheDocument());
    });

    it('rolls back an optimistic status change and reports a failed update', async () => {
        vi.mocked(fetch)
            .mockResolvedValueOnce(jsonResponse({
                ...customerResponse,
                customer: { ...customerResponse.customer, contactStatus: 'SUBSCRIBED' }
            }))
            .mockResolvedValueOnce(jsonResponse({ error: 'Update rejected' }, false, 500));

        renderPage();

        const statusSelect = await screen.findByRole('combobox', { name: 'Contact Status' });
        fireEvent.change(statusSelect, { target: { value: 'BOUNCED' } });

        expect(statusSelect).toHaveValue('BOUNCED');
        expect(await screen.findByRole('alert')).toHaveTextContent('previous status was restored');
        await waitFor(() => expect(statusSelect).toHaveValue('SUBSCRIBED'));
    });

    it('shows success feedback after a status update', async () => {
        vi.mocked(fetch)
            .mockResolvedValueOnce(jsonResponse({
                ...customerResponse,
                customer: { ...customerResponse.customer, contactStatus: 'SUBSCRIBED' }
            }))
            .mockResolvedValueOnce(jsonResponse({
                contactStatus: 'UNSUBSCRIBED',
                sendingMethods: { marketing: false, transactional: true }
            }));

        renderPage();

        fireEvent.change(await screen.findByRole('combobox', { name: 'Contact Status' }), {
            target: { value: 'UNSUBSCRIBED' }
        });

        expect(await screen.findByRole('status')).toHaveTextContent('Contact status updated');
        expect(screen.getByRole('combobox', { name: 'Contact Status' })).toHaveValue('UNSUBSCRIBED');
    });
});
