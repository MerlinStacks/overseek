import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { CustomerSegmentCard } from './CustomerSegmentCard';

const mocks = vi.hoisted(() => ({ get: vi.fn(), accountId: 'tenant' }));
vi.mock('../../hooks/useApi', () => ({ useApi: () => ({ get: mocks.get, accountId: mocks.accountId, isReady: true }) }));

describe('Customer segment count cards', () => {
    const segment = { id: 'segment', name: 'High Value Customers', description: 'Spend over $500', criteria: { type: 'AND' as const, rules: [{ field: 'totalSpent', operator: 'gt', value: '500' }] }, _count: { campaigns: 0 } };
    beforeEach(() => { vi.resetAllMocks(); mocks.accountId = 'tenant'; });

    function setup() {
        const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
        const actions = { onEdit: vi.fn(), onDelete: vi.fn(), onPreview: vi.fn(), onAdvertising: vi.fn() };
        const renderCard = (refreshVersion = 0) => <QueryClientProvider client={client}><CustomerSegmentCard segment={segment} selected={false} refreshVersion={refreshVersion} {...actions} /></QueryClientProvider>;
        const result = render(renderCard());
        return { ...result, actions, renderCard, client };
    }

    it('shows a formatted customer count prominently and removes noisy zero-campaign metadata', async () => {
        mocks.get.mockResolvedValue({ count: 1234 });
        setup();
        expect(await screen.findByText('1,234')).toBeInTheDocument();
        expect(screen.getByText('matching customers')).toBeInTheDocument();
        expect(screen.getByText('Match all · 1 rule')).toBeInTheDocument();
        expect(screen.queryByText('0 Campaigns')).not.toBeInTheDocument();
        expect(mocks.get).toHaveBeenCalledWith('/api/segments/segment/count');
    });
    it('distinguishes loading and true zero membership', async () => {
        let resolve!: (value: { count: number }) => void;
        mocks.get.mockReturnValue(new Promise(done => { resolve = done; }));
        setup();
        expect(screen.getByText('Counting customers…')).toBeInTheDocument();
        expect(screen.queryByText('0')).not.toBeInTheDocument();
        resolve({ count: 0 });
        expect(await screen.findByText('0')).toBeInTheDocument();
    });
    it('uses singular wording for one matching customer', async () => {
        mocks.get.mockResolvedValue({ count: 1 });
        setup();
        expect(await screen.findByText('matching customer')).toBeInTheDocument();
    });
    it('does not report failed counts as zero, and can retry', async () => {
        mocks.get.mockRejectedValueOnce(new Error('Unavailable')).mockResolvedValue({ count: 42 });
        setup();
        expect(await screen.findByText('Count unavailable.')).toBeInTheDocument();
        expect(screen.queryByText('0')).not.toBeInTheDocument();
        fireEvent.click(screen.getByRole('button', { name: 'Retry count' }));
        expect(await screen.findByText('42')).toBeInTheDocument();
    });
    it('scopes cached counts by account and refreshes on an explicit page refresh', async () => {
        mocks.get.mockResolvedValueOnce({ count: 10 }).mockResolvedValue({ count: 20 });
        const view = setup();
        await screen.findByText('10');
        expect(view.client.getQueryCache().getAll()[0].queryKey).toContain('tenant');
        view.rerender(view.renderCard(1));
        expect(await screen.findByText('20')).toBeInTheDocument();
        await waitFor(() => expect(mocks.get).toHaveBeenCalledTimes(2));
    });
    it('preserves edit, delete, member preview and advertising actions', async () => {
        mocks.get.mockResolvedValue({ count: 12 });
        const { actions } = setup();
        await screen.findByText('12');
        fireEvent.click(screen.getByRole('button', { name: 'Edit High Value Customers' }));
        fireEvent.click(screen.getByRole('button', { name: 'Delete High Value Customers' }));
        fireEvent.click(screen.getByRole('button', { name: 'View Members' }));
        fireEvent.click(screen.getByRole('button', { name: 'Advertising' }));
        for (const action of Object.values(actions)) expect(action).toHaveBeenCalledOnce();
    });
});
