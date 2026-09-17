import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useBOMSync } from './useBOMSync';

let accountId = 'account-1';
let token = 'token';
vi.mock('../context/AuthContext', () => ({ useAuth: () => ({ token }) }));
vi.mock('../context/AccountContext', () => ({ useAccount: () => ({ currentAccount: { id: accountId } }) }));
vi.mock('../utils/logger', () => ({ Logger: { error: vi.fn() } }));

const response = (data: unknown, status = 200) => ({ ok: status < 400, status, json: async () => data }) as Response;
const preview = (name = 'Product') => ({
    products: [1, 2].map(id => ({ productId: String(id), variationId: 0, name })),
    total: 2, needsSync: 2, inSync: 0
});
function deferred<T>() {
    let resolve!: (value: T) => void;
    const promise = new Promise<T>(done => { resolve = done; });
    return { promise, resolve };
}

describe('useBOMSync', () => {
    let fetchMock: ReturnType<typeof vi.fn>;
    let statusReply: () => Promise<Response>;
    let previewReply: () => Promise<Response>;
    let mutationReply: () => Promise<Response>;
    const count = (endpoint: string) => fetchMock.mock.calls.filter(([url]) => String(url).endsWith(endpoint)).length;
    const flush = async () => { await act(async () => {}); };
    const tick = async (ms = 5000) => { await act(async () => { await vi.advanceTimersByTimeAsync(ms); }); };

    beforeEach(() => {
        vi.useFakeTimers();
        accountId = 'account-1';
        token = 'token';
        statusReply = async () => response({ isSyncing: false });
        previewReply = async () => response(preview());
        mutationReply = async () => response({ status: 'queued' });
        fetchMock = vi.fn((url: string) => {
            if (url.endsWith('pending-changes')) return previewReply();
            if (url.endsWith('sync-status')) return statusReply();
            if (url.endsWith('deactivated-items')) return Promise.resolve(response({ items: [] }));
            return mutationReply();
        });
        vi.stubGlobal('fetch', fetchMock);
    });
    afterEach(() => {
        cleanup();
        vi.useRealTimers();
        vi.unstubAllGlobals();
    });

    it('resumes a running job on mount, polls only compact status and refreshes once on completion', async () => {
        statusReply = async () => response({ isSyncing: true, progress: { current: 1, total: 2 } });
        const { result } = renderHook(() => useBOMSync());
        await flush();
        expect(result.current.isSyncing).toBe(true);
        expect(result.current.syncProgress).toEqual({ current: 1, total: 2 });
        expect(result.current.nextSyncIn).toBeNull();
        await tick(15000);
        expect(count('sync-status')).toBe(4);
        expect(count('pending-changes')).toBe(1);
        statusReply = async () => response({ isSyncing: false });
        await tick();
        expect(result.current.isSyncing).toBe(false);
        expect(result.current.syncProgress).toBeNull();
        expect(count('pending-changes')).toBe(2);
        await tick(15000);
        expect(count('sync-status')).toBe(5);
    });

    it.each(['queued', 'started', 'already_running'])('polls after a %s sync-all response', async status => {
        mutationReply = async () => response({ status });
        const { result } = renderHook(() => useBOMSync());
        await flush();
        await act(async () => result.current.handleSyncAll());
        expect(result.current.isSyncing).toBe(true);
        expect(count('pending-changes')).toBe(1);
        await tick();
        expect(count('pending-changes')).toBe(2);
        expect(result.current.isSyncing).toBe(false);
    });

    it('does not overlap slow polls and retries transient status failures', async () => {
        statusReply = async () => response({ isSyncing: true });
        renderHook(() => useBOMSync());
        await flush();
        const slow = deferred<Response>();
        statusReply = () => slow.promise;
        await tick(20000);
        expect(count('sync-status')).toBe(2);
        await act(async () => slow.resolve(response({}, 503)));
        statusReply = async () => { throw new Error('offline'); };
        await tick();
        expect(count('sync-status')).toBe(3);
        statusReply = async () => response({ isSyncing: false });
        await tick();
        expect(count('pending-changes')).toBe(2);
    });

    it('pauses polling and stops it after cancellation', async () => {
        statusReply = async () => response({ isSyncing: true });
        const { result } = renderHook(() => useBOMSync());
        await flush();
        act(() => result.current.handleTogglePause());
        await tick(10000);
        expect(count('sync-status')).toBe(1);
        act(() => result.current.handleTogglePause());
        await tick();
        expect(count('sync-status')).toBe(2);
        await act(async () => result.current.handleCancelSync());
        await tick(10000);
        expect(count('sync-status')).toBe(2);
        expect(result.current.isSyncing).toBe(false);
    });

    it('waits for an older preview before the single completion refresh', async () => {
        statusReply = async () => response({ isSyncing: true });
        const { result } = renderHook(() => useBOMSync());
        await flush();
        const slow = deferred<Response>();
        previewReply = () => slow.promise;
        act(() => { void result.current.fetchPendingChanges(); });
        statusReply = async () => response({ isSyncing: false });
        await tick();
        expect(count('pending-changes')).toBe(2);
        previewReply = async () => response(preview('Completed'));
        await act(async () => slow.resolve(response(preview('Before completion'))));
        expect(count('pending-changes')).toBe(3);
        expect(result.current.pendingChanges[0].name).toBe('Completed');
        await tick(15000);
        expect(count('pending-changes')).toBe(3);
    });

    it('cleans up an in-flight poll on unmount without rescheduling or refreshing', async () => {
        statusReply = async () => response({ isSyncing: true });
        const { unmount } = renderHook(() => useBOMSync());
        await flush();
        const slow = deferred<Response>();
        statusReply = () => slow.promise;
        await tick();
        const signal = fetchMock.mock.calls.filter(([url]) => url.endsWith('sync-status')).pop()![1].signal;
        unmount();
        expect(signal.aborted).toBe(true);
        await act(async () => slow.resolve(response({ isSyncing: false })));
        await tick(15000);
        expect(count('sync-status')).toBe(2);
        expect(count('pending-changes')).toBe(1);
    });

    it.each(['http', 'network', 'json'])('exposes %s preview failures and supports retry', async failure => {
        previewReply = async () => {
            if (failure === 'http') return response({}, 500);
            if (failure === 'network') throw new Error('offline');
            return { ok: true, json: async () => { throw new Error('Invalid JSON'); } } as unknown as Response;
        };
        const { result } = renderHook(() => useBOMSync());
        await flush();
        expect(result.current.loadError).toBeTruthy();
        expect(result.current.isLoadingPending).toBe(false);
        previewReply = async () => response(preview());
        act(() => result.current.handleRefresh());
        await flush();
        expect(result.current.loadError).toBeNull();
        expect(result.current.pendingChanges).toHaveLength(2);
    });

    it('preserves data during refresh and failure, and coalesces simultaneous preview requests', async () => {
        const { result } = renderHook(() => useBOMSync());
        await flush();
        const slow = deferred<Response>();
        previewReply = () => slow.promise;
        act(() => { void result.current.fetchPendingChanges(); void result.current.fetchPendingChanges(); });
        expect(result.current.isLoadingPending).toBe(true);
        expect(result.current.pendingChanges).toHaveLength(2);
        expect(count('pending-changes')).toBe(2);
        await act(async () => slow.resolve(response({}, 500)));
        expect(result.current.pendingChanges).toHaveLength(2);
        expect(result.current.stats.total).toBe(2);
        expect(result.current.loadError).toBeTruthy();
    });

    it.each(['account', 'token', 'unmount'])('aborts requests and ignores late preview/status responses on %s change', async change => {
        const oldPreview = deferred<Response>();
        const oldStatus = deferred<Response>();
        previewReply = () => oldPreview.promise;
        statusReply = () => oldStatus.promise;
        const { result, rerender, unmount } = renderHook(() => useBOMSync());
        const signal = fetchMock.mock.calls[0][1].signal as AbortSignal;
        previewReply = async () => response(preview('New account'));
        statusReply = async () => response({ isSyncing: false });
        if (change === 'unmount') unmount();
        else {
            if (change === 'account') accountId = 'account-2';
            else token = 'new-token';
            rerender();
        }
        await flush();
        expect(signal.aborted).toBe(true);
        await act(async () => {
            oldPreview.resolve(response(preview('Old account')));
            oldStatus.resolve(response({ isSyncing: true }));
        });
        if (change !== 'unmount') {
            expect(result.current.pendingChanges[0].name).toBe('New account');
            expect(result.current.isSyncing).toBe(false);
        }
        const calls = fetchMock.mock.calls.length;
        await tick(15000);
        expect(fetchMock).toHaveBeenCalledTimes(calls);
    });

    it('does not refresh or restart polling from a late previous-account mutation', async () => {
        const { result, rerender } = renderHook(() => useBOMSync());
        await flush();
        const slow = deferred<Response>();
        mutationReply = () => slow.promise;
        let sync!: Promise<void>;
        act(() => { sync = result.current.handleSyncAll(); });
        accountId = 'account-2';
        rerender();
        await flush();
        await act(async () => { slow.resolve(response({ status: 'queued' })); await sync; });
        await tick(15000);
        expect(result.current.isSyncing).toBe(false);
        expect(count('pending-changes')).toBe(2);
        expect(count('sync-status')).toBe(2);
    });

    it('batches failed-item retries into one preview refresh', async () => {
        const { result } = renderHook(() => useBOMSync());
        await flush();
        mutationReply = async () => response({ error: 'Try again' }, 500);
        await act(async () => { await result.current.handleSyncSingle('1', 0); await result.current.handleSyncSingle('2', 0); });
        mutationReply = async () => response({ success: true, localDbUpdated: true });
        await act(async () => result.current.handleRetryFailed());
        expect(count('pending-changes')).toBe(2);
        expect(result.current.syncErrors).toEqual({ '1-0': '', '2-0': '' });
    });
});
