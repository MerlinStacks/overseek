import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter, Route, Routes, useNavigate } from 'react-router-dom';
import { useState } from 'react';
import { CustomerDetailsPage } from './CustomerDetailsPage';

const context = vi.hoisted(() => ({
    currentAccount: { id: 'account-1', currency: 'AUD' },
    subscribe: vi.fn(() => vi.fn()),
}));

vi.mock('../context/AuthContext', () => ({
    useAuth: () => ({ token: 'test-token' }),
}));

vi.mock('../context/AccountContext', () => ({
    useAccount: () => ({ currentAccount: context.currentAccount }),
}));

vi.mock('../utils/productCrossTabEvents', () => ({
    subscribeToCrossTabEvents: context.subscribe,
}));

vi.mock('../utils/logger', () => ({
    Logger: { error: vi.fn() },
}));

vi.mock('../components/customers/MergeCustomerModal', () => ({
    MergeCustomerModal: () => null,
}));

const customerResponse = {
    customer: {
        id: 'customer-1',
        firstName: 'Ada',
        lastName: 'Lovelace',
        email: 'ada@example.com',
        totalSpent: 120,
        ordersCount: 1,
        dateCreated: '2026-01-01T00:00:00.000Z',
        billingAddress: {
            phone: '0400 000 000',
            address_1: '1 Test Street',
            city: 'Sydney',
            state: 'NSW',
            postcode: '2000',
            country: 'AU',
        },
    },
    orders: [{
        id: 'order-9',
        number: '1009',
        dateCreated: '2026-02-01T00:00:00.000Z',
        status: 'completed',
        total: '120',
        currency: 'AUD',
    }],
    automations: [],
    activity: [],
    inboxConversations: [{
        id: 'conversation-4',
        title: 'Delivery question',
        status: 'OPEN',
        updatedAt: '2026-02-02T00:00:00.000Z',
        lastInboundMessage: {
            id: 'message-1',
            content: 'Subject: Re: Delivery\n\n<p>Hello <strong>&amp; welcome</strong></p>',
            createdAt: '2026-02-02T00:00:00.000Z',
        },
    }],
};

function jsonResponse(body: unknown, ok = true, status = 200): Response {
    return {
        ok,
        status,
        json: async () => body,
    } as Response;
}

function renderPage(initialEntry = '/contacts/customer-1') {
    return render(
        <MemoryRouter initialEntries={[initialEntry]}>
            <Routes>
                <Route path="/contacts/:id" element={<CustomerDetailsPage />} />
                <Route path="/contacts" element={<div>Contacts list</div>} />
            </Routes>
        </MemoryRouter>,
    );
}

function RaceHarness() {
    const navigate = useNavigate();
    const [, forceAccountRender] = useState(0);

    return (
        <>
            <button
                type="button"
                onClick={() => {
                    context.currentAccount = { id: 'account-2', currency: 'USD' };
                    forceAccountRender(value => value + 1);
                    navigate('/contacts/customer-2');
                }}
            >
                Switch customer and account
            </button>
            <CustomerDetailsPage />
        </>
    );
}

describe('CustomerDetailsPage', () => {
    beforeEach(() => {
        context.currentAccount = { id: 'account-1', currency: 'AUD' };
        context.subscribe.mockClear();
        vi.stubGlobal('fetch', vi.fn());
    });

    afterEach(() => {
        vi.restoreAllMocks();
        vi.unstubAllGlobals();
    });

    it('shows Retry and Back controls for a non-OK load and retries successfully', async () => {
        vi.mocked(fetch)
            .mockResolvedValueOnce(jsonResponse({}, false, 500))
            .mockResolvedValueOnce(jsonResponse(customerResponse));

        renderPage();

        expect(await screen.findByRole('heading', { name: 'Unable to load contact' })).toBeInTheDocument();
        expect(screen.getByText('Could not load this contact.')).toBeInTheDocument();
        expect(screen.getByRole('link', { name: 'Back to contacts' })).toHaveAttribute('href', '/contacts');

        fireEvent.click(screen.getByRole('button', { name: 'Retry' }));

        expect(await screen.findByRole('heading', { name: 'Ada Lovelace' })).toBeInTheDocument();
        expect(fetch).toHaveBeenCalledTimes(2);
    });

    it('does not let an out-of-order customer request overwrite the current ID and account', async () => {
        let resolveStaleRequest: (response: Response) => void = () => undefined;
        const staleRequest = new Promise<Response>((resolve) => {
            resolveStaleRequest = resolve;
        });
        vi.mocked(fetch)
            .mockReturnValueOnce(staleRequest)
            .mockResolvedValue(jsonResponse({
                ...customerResponse,
                customer: {
                    ...customerResponse.customer,
                    id: 'customer-2',
                    firstName: 'Grace',
                    lastName: 'Hopper',
                    email: 'grace@example.com',
                },
            }));

        render(
            <MemoryRouter initialEntries={['/contacts/customer-1']}>
                <Routes>
                    <Route path="/contacts/:id" element={<RaceHarness />} />
                </Routes>
            </MemoryRouter>,
        );
        await waitFor(() => expect(fetch).toHaveBeenCalledTimes(1));
        const firstRequest = vi.mocked(fetch).mock.calls[0];

        fireEvent.click(screen.getByRole('button', { name: 'Switch customer and account' }));

        expect(await screen.findByRole('heading', { name: 'Grace Hopper' })).toBeInTheDocument();
        expect(firstRequest[0]).toBe('/api/customers/customer-1');
        expect(firstRequest[1]?.headers).toMatchObject({ 'X-Account-ID': 'account-1' });
        expect(firstRequest[1]?.signal?.aborted).toBe(true);
        expect(vi.mocked(fetch).mock.calls.some(([url, options]) => (
            url === '/api/customers/customer-2'
            && (options?.headers as Record<string, string>)['X-Account-ID'] === 'account-2'
        ))).toBe(true);

        await act(async () => {
            resolveStaleRequest(jsonResponse({
                ...customerResponse,
                customer: { ...customerResponse.customer, firstName: 'Stale', lastName: 'Customer' },
            }));
            await staleRequest;
        });

        expect(screen.getByRole('heading', { name: 'Grace Hopper' })).toBeInTheDocument();
        expect(screen.queryByText('Stale Customer')).not.toBeInTheDocument();
    });

    it('renders a missing contact status as Unverified rather than Subscribed', async () => {
        vi.mocked(fetch).mockResolvedValueOnce(jsonResponse(customerResponse));

        renderPage();

        const status = await screen.findByRole('combobox', { name: 'Contact Status' });
        expect(status).toHaveValue('UNVERIFIED');
        expect(status.querySelector('option:checked')).toHaveTextContent('Unverified');
        expect(screen.getAllByText('Unverified').length).toBeGreaterThan(1);
    });

    it('renders orders as links and converts HTML inbox previews to plain text', async () => {
        vi.mocked(fetch).mockResolvedValueOnce(jsonResponse(customerResponse));
        renderPage();

        fireEvent.click(await screen.findByRole('tab', { name: 'orders' }));
        expect(screen.getByRole('link', { name: '#1009' })).toHaveAttribute('href', '/orders/order-9');

        fireEvent.click(screen.getByRole('tab', { name: 'inbox' }));
        const conversation = screen.getByRole('button', { name: /Delivery question/ });
        expect(conversation).toHaveTextContent('Hello & welcome');
        expect(conversation.querySelector('strong')).not.toBeInTheDocument();
        expect(conversation).not.toHaveTextContent('<p>');
    });

    it('opens the customer profile modal with the loaded profile values', async () => {
        vi.mocked(fetch).mockResolvedValueOnce(jsonResponse(customerResponse));
        renderPage();

        fireEvent.click(await screen.findByRole('button', { name: 'Edit Profile' }));

        const dialog = screen.getByRole('dialog', { name: 'Edit Contact Profile' });
        expect(dialog).toBeInTheDocument();
        expect(screen.getByRole('textbox', { name: 'First name' })).toHaveValue('Ada');
        expect(screen.getByRole('textbox', { name: 'Email' })).toHaveValue('ada@example.com');
    });
});
