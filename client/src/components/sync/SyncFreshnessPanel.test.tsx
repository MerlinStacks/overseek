import { useEffect } from 'react';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SyncFreshnessPanel } from './SyncFreshnessPanel';

const state = vi.hoisted(() => ({ accountId: 'account-a', fetch: vi.fn() }));
vi.mock('../../context/AccountContext', () => ({ useAccount: () => ({ currentAccount: { id: state.accountId } }) }));
vi.mock('../../context/AuthContext', () => ({ useAuth: () => ({ token: 'token' }) }));
vi.mock('../../hooks/useVisibilityPolling', () => ({ useVisibilityPolling: (callback: () => Promise<void>) => {
    useEffect(() => { void callback(); }, [callback]);
} }));

const report = { signals: 4, imported: 2, pending: 2, failed: 1, overdue: 2, missing: 1, p95LatencyMs: 1200, truncated: false, sampleLimit: 1000,
    recentIssues: [{ orderId: 42, status: 'FAILED', presentLocally: false, ageMs: 180000 }] };
const response = (data: unknown) => ({ ok: true, json: async () => data });

describe('live order freshness panel', () => {
    beforeEach(() => { vi.resetAllMocks(); state.accountId = 'account-a'; vi.stubGlobal('fetch', state.fetch); state.fetch.mockResolvedValue(response(report)); });
    afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

    it('shows measured latency and missing orders with account-scoped authorization', async () => {
        render(<SyncFreshnessPanel />);
        expect(await screen.findByText('1.2s')).toBeVisible();
        expect(screen.getByText(/Woo order #42/)).toHaveTextContent('failed; missing locally');
        expect(state.fetch).toHaveBeenCalledWith('/api/sync/freshness', expect.objectContaining({ headers: { Authorization: 'Bearer token', 'X-Account-ID': 'account-a' } }));
        expect(screen.getByText(/not checkout time or stock-refresh completion/)).toBeVisible();
    });

    it('does not infer healthy tracking from an empty window', async () => {
        state.fetch.mockResolvedValue(response({ ...report, signals: 0, p95LatencyMs: null, recentIssues: [] }));
        render(<SyncFreshnessPanel />);
        expect(await screen.findByText('No samples')).toBeVisible();
        expect(screen.getByText(/does not confirm tracking is healthy/)).toBeVisible();
    });

    it('keeps the last successful result visibly stale after a refresh failure', async () => {
        render(<SyncFreshnessPanel />);
        await screen.findByText('1.2s');
        state.fetch.mockResolvedValueOnce({ ok: false });
        fireEvent.click(screen.getByRole('button', { name: 'Refresh freshness' }));
        expect(await screen.findByRole('alert')).toHaveTextContent('Showing the last successful result');
        expect(screen.getByText('1.2s')).toBeVisible();
    });

    it('clears account data and aborts old requests when switching accounts', async () => {
        const view = render(<SyncFreshnessPanel />);
        await screen.findByText('1.2s');
        const firstSignal = state.fetch.mock.calls[0][1].signal;
        state.accountId = 'account-b';
        state.fetch.mockResolvedValueOnce(response({ ...report, signals: 0, p95LatencyMs: null, recentIssues: [] }));
        view.rerender(<SyncFreshnessPanel />);
        expect(firstSignal.aborted).toBe(true);
        await waitFor(() => expect(screen.queryByText('1.2s')).not.toBeInTheDocument());
        expect(await screen.findByText('No samples')).toBeVisible();
    });
});
