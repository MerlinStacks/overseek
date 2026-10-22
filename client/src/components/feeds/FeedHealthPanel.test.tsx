import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { FeedHealthPanel, FeedHealthResults, type FeedHealthReport } from './FeedHealthPanel';

const report: FeedHealthReport = {
    generatedAt: '2026-10-20T12:00:00Z', scannedProducts: 3, included: 2, excluded: 1,
    errors: 1, warnings: 1, exclusions: { 'Out of stock': 1 },
    issues: [{ severity: 'error', rowId: 'v:1-11', name: 'Blue mug', field: 'gtin', message: 'Invalid barcode check digit.' }],
    excludedExamples: [{ rowId: 'p:2', name: 'Red mug', reason: 'Out of stock' }],
    lastProductSyncAt: null, lastAttempt: { at: '2026-10-20T12:00:00Z', status: 'failed', message: 'Feed generation failed.' }, lastSuccess: null, lastFailure: null,
};

describe('feed health UI', () => {
    afterEach(() => vi.unstubAllGlobals());
    it('shows counts, exclusions, actionable context and local-only export history', () => {
        render(<FeedHealthResults report={report} />);
        expect(screen.getByText('Included rows')).toBeInTheDocument();
        expect(screen.getByText('Out of stock: 1')).toBeInTheDocument();
        expect(screen.getByText(/Blue mug \(v:1-11\)/)).toBeInTheDocument();
        expect(screen.getByText('Invalid barcode check digit.')).toBeInTheDocument();
        expect(screen.getByRole('alert')).toHaveTextContent('Feed generation failed.');
        expect(screen.getByText(/does not verify delivery or Google\/Meta acceptance/)).toBeInTheDocument();
        expect(screen.getByText(/Live product pages have not been checked/)).toBeInTheDocument();
    });
    it('scans only on request using account headers and selected variation mode', async () => {
        const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => report });
        vi.stubGlobal('fetch', fetchMock);
        const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
        render(<QueryClientProvider client={queryClient}><FeedHealthPanel accountId="account-2" channel="meta" variationMode="first_variation" headers={{ 'x-account-id': 'account-2', Authorization: 'Bearer test' }} /></QueryClientProvider>);
        expect(fetchMock).not.toHaveBeenCalled();
        fireEvent.click(screen.getByRole('button', { name: 'Check feed health' }));
        await waitFor(() => expect(screen.getByText('Included rows')).toBeInTheDocument());
        expect(fetchMock).toHaveBeenCalledWith('/api/feeds/meta/health?variationMode=first_variation', { headers: { 'x-account-id': 'account-2', Authorization: 'Bearer test' }, signal: expect.any(AbortSignal) });
        queryClient.clear();
    });
    it('reports a failed health request without showing a successful scan', async () => {
        vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false }));
        const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
        render(<QueryClientProvider client={queryClient}><FeedHealthPanel accountId="account-1" channel="google" variationMode="all_variations" headers={{ Authorization: 'Bearer test', 'x-account-id': 'account-1' }} /></QueryClientProvider>);
        fireEvent.click(screen.getByRole('button', { name: 'Check feed health' }));
        expect(await screen.findByRole('alert')).toHaveTextContent('Failed to check feed health');
        expect(screen.queryByText('Included rows')).not.toBeInTheDocument();
        queryClient.clear();
    });
});
