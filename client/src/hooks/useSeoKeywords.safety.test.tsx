import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
const m = vi.hoisted(() => ({ account: 'a', get: vi.fn(), put: vi.fn() }));
vi.mock('../context/AuthContext', () => ({ useAuth: () => ({ user: { id: 'u' }, token: 'token' }) }));
vi.mock('./useApi', () => ({ useApi: () => ({ accountId: m.account, token: 'token', isReady: true, get: (...args: unknown[]) => m.get(...args), put: (...args: unknown[]) => m.put(...args) }) }));
import { useSearchConsoleStatus, useSearchAnalytics, useSetDefaultSite } from './useSeoKeywords';
import { decodeHistory, decodeSearchAnalytics, decodeMovers } from './seoValidation';
function wrapper() { const client = new QueryClient(); return ({ children }: { children: ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>; }
const status = { connected: true, sites: [{ id: 's', siteUrl: 'sc-domain:store.test', createdAt: '' }], defaultSiteUrl: 'sc-domain:store.test' };
beforeEach(() => { m.account = 'a'; m.get.mockReset(); m.put.mockReset(); });
afterEach(cleanup);
it('isolates status cache and ignores obsolete account responses', async () => {
    let resolve!: (value: unknown) => void;
    m.get.mockImplementation(() => m.account === 'a' ? new Promise(done => { resolve = done; }) : Promise.resolve({ connected: false, sites: [] }));
    const { result, rerender } = renderHook(() => useSearchConsoleStatus(), { wrapper: wrapper() });
    await waitFor(() => expect(resolve).toBeTypeOf('function')); m.account = 'b'; rerender(); expect(result.current.data).toBeUndefined();
    await waitFor(() => expect(result.current.data?.connected).toBe(false)); await act(async () => { resolve(status); }); expect(result.current.data?.connected).toBe(false);
    expect(m.get.mock.calls.every(([, options]) => options.signal instanceof AbortSignal)).toBe(true);
});
it('connection-gated reads do not fetch while disabled', async () => {
    const { result } = renderHook(() => useSearchAnalytics(28, undefined, false), { wrapper: wrapper() });
    await act(async () => {}); expect(m.get).not.toHaveBeenCalled(); expect(result.current.data).toBeUndefined();
});
it('serializes mutations and rejects obsolete callbacks', async () => {
    let resolve!: (value: unknown) => void; m.put.mockImplementation(() => new Promise(done => { resolve = done; }));
    const { result, rerender } = renderHook(() => useSetDefaultSite(), { wrapper: wrapper() });
    let first!: Promise<unknown>;
    await act(async () => { first = result.current.mutateAsync('sc-domain:store.test').catch(error => error); await expect(result.current.mutateAsync('other')).rejects.toThrow(/pending/); });
    expect(m.put).toHaveBeenCalledTimes(1); const retained = result.current.mutateAsync;
    m.account = 'b'; rerender(); await expect(retained('late')).rejects.toThrow(/unavailable/);
    await act(async () => { resolve({ success: true }); expect(await first).toBeInstanceOf(Error); });
});
it('validates, orders and deduplicates history and never trusts supplied CTR', () => {
    expect(decodeHistory({ history: [{ date: '2026-10-03', position: 1, clicks: 1, impressions: 10 }, { date: '2026-10-01', position: 10, clicks: 0, impressions: 1 }] }).history[0].date).toBe('2026-10-01');
    expect(() => decodeHistory({ history: [{ date: 'invalid', position: 1, clicks: 0, impressions: 0 }] })).toThrow();
    expect(decodeSearchAnalytics({ queries: [{ query: 'x', clicks: 1, impressions: 10, position: 1, ctr: 999 }] }).queries[0].ctr).toBe(10);
    expect(() => decodeMovers({ movers: [{}] })).toThrow();
});
