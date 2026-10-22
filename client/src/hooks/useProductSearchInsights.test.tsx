import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
const m = vi.hoisted(() => ({ owner: 'u', account: 'a', token: 'token' as string | null, get: vi.fn() }));
vi.mock('../context/AuthContext', () => ({ useAuth: () => ({ user: { id: m.owner }, token: m.token }) }));
vi.mock('./useApi', () => ({ useApi: () => ({ accountId: m.account, token: m.token, isReady: !!m.token, get: (...args: unknown[]) => m.get(...args) }) }));
import { useProductSearchInsights } from './useProductSearchInsights';
const rows = { queries: [{ query: 'small', clicks: 1, impressions: 1, ctr: 0, position: 1 }, { query: 'large', clicks: 9, impressions: 99, ctr: 99, position: 11 }] };
function setup() {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const wrapper = ({ children }: { children: ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>;
    return renderHook(() => useProductSearchInsights('https://store.test/product'), { wrapper });
}
beforeEach(() => { m.owner = 'u'; m.account = 'a'; m.token = 'token'; m.get.mockReset(); m.get.mockImplementation(async (url: string) => url.includes('/status') ? { connected: true } : rows); });
afterEach(cleanup);
it('computes CTR from counts and impression-weights position; passes cancellation signals', async () => {
    const { result } = setup(); await waitFor(() => expect(result.current.summary).not.toBeNull());
    expect(result.current.summary).toMatchObject({ totalClicks: 10, totalImpressions: 100, avgCtr: 10, avgPosition: 10.9 });
    expect(m.get.mock.calls.every(([, options]) => options.signal instanceof AbortSignal)).toBe(true);
});
it('hides old-scope data immediately and ignores an obsolete callback', async () => {
    let resolve!: (value: unknown) => void;
    m.get.mockImplementation((url: string) => url.includes('/status') ? Promise.resolve({ connected: true }) : m.account === 'a' ? new Promise(done => { resolve = done; }) : Promise.resolve({ queries: [] }));
    const { result, rerender } = setup(); await waitFor(() => expect(resolve).toBeTypeOf('function'));
    m.account = 'b'; rerender(); expect(result.current.queries).toEqual([]);
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    await act(async () => { resolve(rows); }); expect(result.current.queries).toEqual([]);
    m.token = null; rerender(); expect(result.current.summary).toBeNull(); expect(result.current.error).toMatch(/Sign in/);
});
it('reports malformed analytics and status errors rather than showing empty/zero success', async () => {
    m.get.mockImplementation(async (url: string) => url.includes('/status') ? { connected: true } : { queries: [{ query: 'bad', clicks: -1 }] });
    const { result } = setup(); await waitFor(() => expect(result.current.error).toMatch(/valid search analytics/)); expect(result.current.summary).toBeNull();
});
it('does not manufacture averages with zero impressions', async () => {
    m.get.mockImplementation(async (url: string) => url.includes('/status') ? { connected: true } : { queries: [{ query: 'none', clicks: 0, impressions: 0, position: 0 }] });
    const { result } = setup(); await waitFor(() => expect(result.current.summary).toMatchObject({ avgCtr: null, avgPosition: null }));
});
