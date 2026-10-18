import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NativeAudienceForm } from './NativeAudienceForm';

const mocks = vi.hoisted(() => ({ get: vi.fn(), post: vi.fn(), success: vi.fn(), error: vi.fn() }));
vi.mock('../../hooks/useApi', () => ({ useApi: () => ({ get: mocks.get, post: mocks.post, accountId: 'tenant', isReady: true }) }));
vi.mock('../../context/ToastContext', () => ({ useToast: () => ({ success: mocks.success, error: mocks.error }) }));

describe('Native advertising audience setup', () => {
    const destinations = [
        { id: 'meta', platform: 'META', name: 'Meta store', externalId: '123' },
        { id: 'google', platform: 'GOOGLE', name: 'Google store', externalId: '456' }
    ];
    beforeEach(() => {
        vi.resetAllMocks();
        mocks.get.mockResolvedValue({ pixels: [{ id: '123', name: 'Store pixel' }], lookalikeSources: [{ id: 'local-seed', type: 'CUSTOMER_LIST', name: 'High-value customers', autoSyncEnabled: true }] });
        mocks.post.mockResolvedValue({ status: 'PENDING' });
    });
    function setup() {
        const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
        const onCreated = vi.fn();
        render(<QueryClientProvider client={client}><NativeAudienceForm destinations={destinations} onCreated={onCreated} onCancel={vi.fn()} /></QueryClientProvider>);
        return { onCreated };
    }

    it('creates a Meta event audience with purchaser exclusion and explicit consent', async () => {
        const { onCreated } = setup();
        fireEvent.change(screen.getByLabelText('Advertising account'), { target: { value: 'meta' } });
        await screen.findByRole('option', { name: 'Store pixel · 123' });
        fireEvent.change(screen.getByLabelText('Meta pixel / dataset'), { target: { value: '123' } });
        fireEvent.click(screen.getByRole('button', { name: 'Cart additions' }));
        expect(screen.getByRole('button', { name: 'Create audience' })).toBeDisabled();
        fireEvent.click(screen.getByRole('checkbox', { name: /I confirm we have/ }));
        fireEvent.click(screen.getByRole('button', { name: 'Create audience' }));
        await waitFor(() => expect(onCreated).toHaveBeenCalled());
        expect(mocks.post).toHaveBeenCalledWith('/api/segments/native-audiences', expect.objectContaining({ adAccountId: 'meta', kind: 'WEBSITE', consentConfirmed: true, definition: { pixelId: '123', event: 'AddToCart', urlContains: '', retentionDays: 14, exclusionDays: 30, excludePurchasers: true } }));
    });

    it('creates Meta lookalikes only from a managed source with an explicit country and size', async () => {
        setup();
        fireEvent.change(screen.getByLabelText('Advertising account'), { target: { value: 'meta' } });
        await screen.findByRole('option', { name: 'Store pixel · 123' });
        fireEvent.change(screen.getByLabelText('Audience type'), { target: { value: 'LOOKALIKE' } });
        fireEvent.change(screen.getByLabelText('Audience name'), { target: { value: 'Best customer lookalike' } });
        fireEvent.change(screen.getByLabelText('Source audience'), { target: { value: 'CUSTOMER_LIST:local-seed' } });
        fireEvent.change(screen.getByLabelText('Target country'), { target: { value: 'GB' } });
        fireEvent.change(screen.getByLabelText('Lookalike size'), { target: { value: '3' } });
        fireEvent.click(screen.getByRole('checkbox', { name: /I confirm we have/ }));
        fireEvent.click(screen.getByRole('button', { name: 'Create audience' }));
        await waitFor(() => expect(mocks.post).toHaveBeenCalledWith('/api/segments/native-audiences', expect.objectContaining({ kind: 'LOOKALIKE', definition: { sourceType: 'CUSTOMER_LIST', sourceId: 'local-seed', country: 'GB', percent: 3 } })));
    });

    it('requires a verified Google remarketing tag, and calls cart visitors what they actually are', async () => {
        setup();
        fireEvent.change(screen.getByLabelText('Advertising account'), { target: { value: 'google' } });
        await waitFor(() => expect(mocks.get).toHaveBeenCalledWith('/api/segments/native-audiences/sources/google'));
        fireEvent.click(screen.getByRole('button', { name: 'Cart-page visitors' }));
        expect(screen.queryByRole('option', { name: 'Meta lookalike' })).not.toBeInTheDocument();
        expect(screen.getByText(/Cart-page visits are not proof/)).toBeInTheDocument();
        fireEvent.click(screen.getByRole('checkbox', { name: /I confirm we have/ }));
        expect(screen.getByRole('button', { name: 'Create audience' })).toBeDisabled();
        fireEvent.click(screen.getByRole('checkbox', { name: /I have verified the Google remarketing tag/ }));
        fireEvent.click(screen.getByRole('button', { name: 'Create audience' }));
        await waitFor(() => expect(mocks.post).toHaveBeenCalledWith('/api/segments/native-audiences', expect.objectContaining({ adAccountId: 'google', definition: expect.objectContaining({ tagConfirmed: true, urlContains: '/cart/', purchaseUrlContains: '/order-received/' }) })));
    });

    it('does not allow invalid retention windows or carry consent across destination changes', async () => {
        setup();
        fireEvent.change(screen.getByLabelText('Advertising account'), { target: { value: 'meta' } });
        await screen.findByRole('option', { name: 'Store pixel · 123' });
        fireEvent.change(screen.getByLabelText('Meta pixel / dataset'), { target: { value: '123' } });
        fireEvent.click(screen.getByRole('button', { name: 'All visitors' }));
        fireEvent.click(screen.getByRole('checkbox', { name: /I confirm we have/ }));
        fireEvent.change(screen.getByLabelText('Membership window (days)'), { target: { value: '181' } });
        expect(screen.getByRole('button', { name: 'Create audience' })).toBeDisabled();
        fireEvent.change(screen.getByLabelText('Advertising account'), { target: { value: 'google' } });
        expect(screen.getByRole('checkbox', { name: /I confirm we have/ })).not.toBeChecked();
    });
});
