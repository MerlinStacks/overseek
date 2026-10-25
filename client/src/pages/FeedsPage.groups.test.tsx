import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ data: {} as Record<string, any>, fetch: vi.fn(), refetch: vi.fn(), success: vi.fn(), error: vi.fn() }));
vi.mock('../context/AuthContext', () => ({ useAuth: () => ({ token: 'test-token' }) }));
vi.mock('../context/AccountContext', () => ({ useAccount: () => ({ currentAccount: { id: 'account-1' } }) }));
vi.mock('../context/ToastContext', () => ({ useToast: () => ({ success: mocks.success, error: mocks.error }) }));
vi.mock('../components/feeds/FeedHealthPanel', () => ({ FeedHealthPanel: () => null }));
vi.mock('../hooks/useApiQuery', () => ({
    useApiQuery: ({ queryKey }: any) => ({ data: mocks.data[queryKey[0]], isLoading: false, refetch: mocks.refetch }),
    useApiMutation: ({ mutationFn }: any) => ({ mutateAsync: mutationFn, isPending: false }),
}));

import { FeedsPage } from './FeedsPage';

const column = (targetField: string, finalValue: string, overrideValue: string | null = null) => ({
    targetField, finalValue, mappedValue: finalValue, overrideValue, aiSuggestedValue: null, isMissingRequired: false,
});

beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    mocks.data = {
        'feed-rows': {
            total: 1,
            mappings: [{ targetField: 'title' }, { targetField: 'description' }],
            groups: [{ rowId: 'g:1', rowType: 'group', wooId: 1, name: 'Engraved lighter', columns: [column('description', 'Shared copy')] }],
            rows: [11, 12].map((id) => ({ rowId: `v:1-${id}`, rowType: 'variation', wooId: 1, variationWooId: id, sku: `SKU-${id}`,
                name: `Lighter ${id}`, columns: [column('title', `Lighter ${id}`), column('description', `Variant ${id}`, `Variant ${id}`)],
            })),
        },
    };
    mocks.fetch.mockResolvedValue({ ok: true, json: async () => ({ success: true, jobId: 'job-1' }) });
    vi.stubGlobal('fetch', mocks.fetch);
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); localStorage.clear(); });

describe('Automatic feed groups', () => {
    it('edits and saves manual source and fallback mapping values', async () => {
        mocks.data['feed-mappings'] = { mappings: [
            { targetField: 'id', sourceField: 'wooId' },
            { targetField: 'brand', sourceField: 'brand' },
        ] };
        mocks.fetch.mockResolvedValue({ ok: true, json: async () => ({ mappings: [
            { targetField: 'id', sourceField: 'wooId' },
            { targetField: 'brand', sourceField: 'manual', manualValue: 'CustomKings', fallbackSourceField: 'manual', fallbackManualValue: 'Fallback brand' },
        ] }) });
        render(<FeedsPage />);
        fireEvent.click(screen.getByRole('button', { name: 'Feed settings' }));
        expect(screen.getByRole('combobox', { name: 'Source for id' })).toBeDisabled();
        fireEvent.change(screen.getByRole('combobox', { name: 'Source for brand' }), { target: { value: 'manual' } });
        fireEvent.change(screen.getByRole('textbox', { name: 'Manual value for brand' }), { target: { value: 'CustomKings' } });
        fireEvent.change(screen.getByRole('combobox', { name: 'Fallback for brand' }), { target: { value: 'manual' } });
        fireEvent.change(screen.getByRole('textbox', { name: 'Manual fallback value for brand' }), { target: { value: 'Fallback brand' } });
        fireEvent.click(screen.getByRole('button', { name: 'Save mappings' }));
        await waitFor(() => expect(mocks.fetch).toHaveBeenCalledWith('/api/feeds/mappings/google', expect.objectContaining({
            method: 'PUT', body: JSON.stringify({ mappings: [
                { targetField: 'id', sourceField: 'wooId' },
                { targetField: 'brand', sourceField: 'manual', manualValue: 'CustomKings', fallbackSourceField: 'manual', fallbackManualValue: 'Fallback brand' },
            ] }),
        })));
        await waitFor(() => expect(mocks.success).toHaveBeenCalledWith('Feed mappings saved.'));
        expect(screen.getByRole('textbox', { name: 'Manual value for brand' })).toHaveValue('CustomKings');
    });

    it('collapses variants and saves the group description without a variation prefix', async () => {
        render(<FeedsPage />);
        expect(screen.queryByText('SKU-11')).not.toBeInTheDocument();
        expect(screen.getByText(/1 products/)).toBeInTheDocument();
        fireEvent.click(screen.getByRole('button', { name: 'Shared copy' }));
        fireEvent.change(screen.getByRole('textbox', { name: 'Shared description for Engraved lighter' }), { target: { value: 'Updated shared copy' } });
        fireEvent.click(screen.getByRole('button', { name: 'Save Changes' }));
        await waitFor(() => expect(mocks.fetch).toHaveBeenCalledWith('/api/feeds/google/rows/1', expect.objectContaining({
            method: 'PUT', body: JSON.stringify({ fields: { description: 'Updated shared copy' } }),
        })));
    });

    it('expands variants and clears only the selected description override', async () => {
        render(<FeedsPage />);
        const toggle = screen.getByRole('button', { name: /Engraved lighter/ });
        fireEvent.click(toggle);
        expect(toggle).toHaveAttribute('aria-expanded', 'true');
        expect(screen.getByText('SKU-11')).toBeInTheDocument();
        fireEvent.click(screen.getAllByRole('button', { name: 'Use shared description' })[0]);
        await waitFor(() => expect(mocks.fetch).toHaveBeenCalledWith('/api/feeds/google/rows/1', expect.objectContaining({
            body: JSON.stringify({ fields: { '1-11:description': '' } }),
        })));
    });

    it('selects real variants, not the editor row, for shared bulk optimization', async () => {
        render(<FeedsPage />);
        fireEvent.click(screen.getByRole('checkbox', { name: 'Select variants of Engraved lighter' }));
        fireEvent.click(screen.getByRole('button', { name: 'Optimize Selected for All Platforms' }));
        await waitFor(() => expect(mocks.fetch).toHaveBeenCalledWith('/api/feeds/google/rows/optimize-bulk', expect.objectContaining({
            body: JSON.stringify({ fields: ['title', 'description'], rows: [{ wooId: 1, variationWooId: 11 }, { wooId: 1, variationWooId: 12 }], sharedDescriptions: true }),
        })));
    });
});
