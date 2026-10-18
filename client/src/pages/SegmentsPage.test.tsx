import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SegmentsPage } from './SegmentsPage';

const mocks = vi.hoisted(() => ({ account: { id: 'tenant' }, retry: vi.fn(), reconcile: vi.fn(), refetch: vi.fn(), success: vi.fn(), error: vi.fn(), form: vi.fn() }));
const platformSegment = {
    id: 'website', name: 'Website visitors · 30 days', kind: 'WEBSITE', platform: 'META', status: 'FAILED', externalId: null,
    lastError: 'Meta rejected the rule', definition: { event: 'PageView', retentionDays: 30 }, adAccount: { name: 'Meta shop' }
};
vi.mock('../context/AuthContext', () => ({ useAuth: () => ({ token: 'token' }) }));
vi.mock('../context/AccountContext', () => ({ useAccount: () => ({ currentAccount: mocks.account }) }));
vi.mock('../context/ToastContext', () => ({ useToast: () => ({ success: mocks.success, error: mocks.error }) }));
vi.mock('../components/segments/usePlatformSegments', () => ({ usePlatformSegments: () => ({
    data: { segments: [platformSegment], destinations: [{ id: 'meta', platform: 'META', name: 'Meta shop' }, { id: 'google', platform: 'GOOGLE', name: 'Google shop' }] },
    isLoading: false, error: null, busy: false, retry: mocks.retry, reconcile: mocks.reconcile, refetch: mocks.refetch
}) }));
vi.mock('../components/segments/SegmentAdvertising', () => ({ SegmentAdvertising: () => <p>Existing segment destinations</p> }));
vi.mock('../components/segments/NativeAudienceForm', () => ({ NativeAudienceForm: (props: { onCreated: () => void }) => {
    mocks.form(props);
    return <button onClick={props.onCreated}>Save platform segment</button>;
} }));

describe('Unified Segments workspace', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        vi.stubGlobal('fetch', vi.fn().mockImplementation(async (url: string) => ({ ok: true, json: async () => url.endsWith('/count') ? { count: 1234 } : [{ id: 'customer', name: 'Recent customers', description: 'Purchased recently', criteria: { type: 'AND', rules: [] } }] })));
    });
    afterEach(() => vi.unstubAllGlobals());
    function setup() {
        const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
        render(<QueryClientProvider client={queryClient}><MemoryRouter><SegmentsPage embedded /></MemoryRouter></QueryClientProvider>);
    }

    it('shows existing customer and platform segments together, preserving failures and retry controls', async () => {
        setup();
        await screen.findByText('Recent customers');
        expect(screen.getByText('Website visitors · 30 days')).toBeInTheDocument();
        expect(screen.getByText('Meta rejected the rule')).toBeInTheDocument();
        fireEvent.click(screen.getByRole('button', { name: 'Retry creation' }));
        expect(mocks.retry).toHaveBeenCalledWith('website');
        expect(screen.getAllByRole('button', { name: 'View Members' })).toHaveLength(1);
        expect(screen.queryByText('Website audiences & lookalikes')).not.toBeInTheDocument();
    });
    it('uses the same search for both segment types without showing an incorrect empty state', async () => {
        setup();
        await screen.findByText('Recent customers');
        fireEvent.change(screen.getByPlaceholderText('Search segments...'), { target: { value: 'Website visitors' } });
        expect(screen.getByText('Website visitors · 30 days')).toBeInTheDocument();
        expect(screen.queryByText('Recent customers')).not.toBeInTheDocument();
        expect(screen.queryByText('No segments yet')).not.toBeInTheDocument();
        fireEvent.change(screen.getByPlaceholderText('Search segments...'), { target: { value: 'not a segment' } });
        expect(screen.getByText('No segments match “not a segment”.')).toBeInTheDocument();
    });
    it('uses one Create segment entry point for customer rules and platform types', async () => {
        setup();
        await screen.findByText('Recent customers');
        fireEvent.click(screen.getByRole('button', { name: 'Create segment' }));
        expect(screen.getByRole('dialog', { name: 'Create segment' })).toBeInTheDocument();
        fireEvent.click(screen.getByRole('button', { name: /Customer segment Rules based/ }));
        expect(screen.getByRole('heading', { name: 'Create New Segment' })).toBeInTheDocument();
        expect(screen.getByText('Segment Rules')).toBeInTheDocument();
    });
    it('creates website segments from Segments and refreshes the same list on success', async () => {
        setup();
        await screen.findByText('Recent customers');
        fireEvent.click(screen.getByRole('button', { name: 'Create segment' }));
        fireEvent.click(screen.getByRole('button', { name: /Website segment Consented/ }));
        expect(mocks.form).toHaveBeenLastCalledWith(expect.objectContaining({ asSegment: true, initialKind: 'WEBSITE' }));
        fireEvent.click(screen.getByRole('button', { name: 'Save platform segment' }));
        await waitFor(() => expect(mocks.refetch).toHaveBeenCalled());
        expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    });
    it('offers lookalikes using only Meta destinations', async () => {
        setup();
        await screen.findByText('Recent customers');
        fireEvent.click(screen.getByRole('button', { name: 'Create segment' }));
        fireEvent.click(screen.getByRole('button', { name: /Lookalike segment Find similar/ }));
        expect(mocks.form).toHaveBeenLastCalledWith(expect.objectContaining({ asSegment: true, initialKind: 'LOOKALIKE', destinations: [{ id: 'meta', platform: 'META', name: 'Meta shop' }] }));
    });
});
