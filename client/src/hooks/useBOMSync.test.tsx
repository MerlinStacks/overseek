import { act, cleanup, fireEvent, render, renderHook, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useBOMSync } from './useBOMSync';
import { BOMSyncPage } from '../pages/BOMSyncPage';

let accountId = 'account-1';
let token = 'token';
let canManageInventory = true;
vi.mock('../context/AuthContext', () => ({ useAuth: () => ({ token }) }));
vi.mock('../context/AccountContext', () => ({ useAccount: () => ({ currentAccount: { id: accountId }, activePermissions: { manage_inventory: canManageInventory } }) }));
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
    let recoveryReply: () => Promise<Response>;
    const recoveryPlan = { fingerprint: 'a'.repeat(64), sourceJobIds: ['failed-job'], eligibleProducts: 5, uncertainProducts: 1, excludedProducts: 2 };
    const count = (endpoint: string) => fetchMock.mock.calls.filter(([url]) => String(url).endsWith(endpoint)).length;
    const flush = async () => { await act(async () => {}); };
    const tick = async (ms = 5000) => { await act(async () => { await vi.advanceTimersByTimeAsync(ms); }); };

    beforeEach(() => {
        vi.useFakeTimers();
        accountId = 'account-1';
        token = 'token';
        canManageInventory = true;
        statusReply = async () => response({ isSyncing: false });
        previewReply = async () => response(preview());
        mutationReply = async () => response({ status: 'queued' });
        recoveryReply = async () => response(recoveryPlan);
        fetchMock = vi.fn((url: string, options?: RequestInit) => {
            if (url.endsWith('pending-changes')) return previewReply();
            if (url.endsWith('sync-status')) return statusReply();
            if (url.endsWith('sync-diagnostics')) return Promise.resolve(response({ fingerprint: 'b'.repeat(64), canReconcile: true, runs: [], repair: { canStart: true, requiresStoppedConfirmation: true } }));
            if (url.endsWith('deactivated-items')) return Promise.resolve(response({ items: [] }));
            if (url.endsWith('sync-recovery') && options?.method !== 'POST') return recoveryReply();
            return mutationReply();
        });
        vi.stubGlobal('fetch', fetchMock);
    });
    afterEach(() => {
        cleanup();
        vi.useRealTimers();
        vi.unstubAllGlobals();
    });

    it('serializes same-tick single writes and blocks bulk overlap until completion', async () => {
        const delayed = deferred<Response>(); mutationReply = () => delayed.promise;
        const { result } = renderHook(() => useBOMSync()); await flush();
        let first!: Promise<void>;
        await act(async () => {
            first = result.current.handleSyncSingle('1', 0, false);
            await result.current.handleSyncSingle('2', 0, false);
            await result.current.handleSyncAll();
        });
        expect(fetchMock.mock.calls.filter(([url]) => String(url).includes('/bom/sync?'))).toHaveLength(1);
        expect(count('sync-all')).toBe(0);
        await act(async () => { delayed.resolve(response({ success: true })); await first; });
    });

    it('requires explicit successful sync acknowledgement', async () => {
        mutationReply = async () => response({ previousStock: 1, newStock: 2 });
        const { result } = renderHook(() => useBOMSync()); await flush();
        await act(async () => { await result.current.handleSyncSingle('1', 0, false); });
        expect(result.current.syncErrors['1-0']).toBeTruthy();
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

    it('shows the reconciliation reason after a 409 and prevents repeat bulk requests', async () => {
        mutationReply = async () => response({ error: 'Previous run needs review', code: 'BOM_SYNC_RECONCILIATION_REQUIRED' }, 409);
        const { result } = renderHook(() => useBOMSync()); await flush();
        await act(async () => result.current.handleSyncAll());
        expect(result.current.syncError).toMatchObject({ code: 'BOM_SYNC_RECONCILIATION_REQUIRED', message: expect.stringContaining('inventory operator') });
        expect(result.current.isSyncing).toBe(false);
        expect(result.current.syncProgress).toBeNull();
        expect(result.current.syncResult).toBeNull();
        await act(async () => result.current.handleSyncAll());
        await tick(15000);
        expect(count('sync-all')).toBe(1);
        expect(count('sync-status')).toBe(1);
    });

    it('renders the blocked state on mount and rechecks it on refresh', async () => {
        statusReply = async () => response({ isSyncing: false, requiresReconciliation: true, code: 'BOM_SYNC_RECONCILIATION_REQUIRED' });
        render(<BOMSyncPage />); await flush();
        expect(screen.getByRole('alert').textContent).toContain('BOM sync needs reconciliation');
        expect(screen.getByRole('alert').textContent).toContain('Repair & resume');
        expect(screen.getByRole('button', { name: /Sync All/ }).hasAttribute('disabled')).toBe(true);
        statusReply = async () => response({ isSyncing: false });
        await act(async () => screen.getByTitle('Refresh').click());
        expect(screen.queryByRole('alert')).toBeNull();
        expect(screen.getByRole('button', { name: /Sync All/ }).hasAttribute('disabled')).toBe(false);
    });

    it('surfaces a job failure discovered during polling instead of treating it as completion', async () => {
        const { result } = renderHook(() => useBOMSync()); await flush();
        await act(async () => result.current.handleSyncAll());
        statusReply = async () => response({ isSyncing: false, requiresReconciliation: true });
        await tick();
        expect(result.current.syncError?.code).toBe('BOM_SYNC_RECONCILIATION_REQUIRED');
        expect(result.current.syncResult).toBeNull();
        expect(result.current.isSyncing).toBe(false);
    });

    it.each(['http', 'non-json', 'network'])('exposes %s bulk failures without leaving progress running', async failure => {
        mutationReply = async () => {
            if (failure === 'network') throw new Error('offline');
            if (failure === 'non-json') return { ok: false, status: 502, json: async () => { throw new Error('Invalid JSON'); } } as unknown as Response;
            return response({ error: 'Queue admission deferred', code: 'QUEUE_BACKPRESSURE' }, 503);
        };
        const { result } = renderHook(() => useBOMSync()); await flush();
        await act(async () => result.current.handleSyncAll());
        expect(result.current.syncError?.message).toBe(failure === 'network' ? 'offline' : failure === 'non-json' ? 'Failed to start BOM sync (HTTP 502).' : 'Queue admission deferred');
        expect(result.current.isSyncing).toBe(false);
        expect(result.current.syncProgress).toBeNull();
    });

    it('does not carry reconciliation errors into another account', async () => {
        statusReply = async () => response({ isSyncing: false, requiresReconciliation: true });
        const { result, rerender } = renderHook(() => useBOMSync()); await flush();
        expect(result.current.syncError).not.toBeNull();
        statusReply = async () => response({ isSyncing: false });
        accountId = 'account-2'; rerender(); await flush();
        expect(result.current.syncError).toBeNull();
    });

    it('repairs a legacy run without inventory notes and unlocks after verified worker completion', async () => {
        statusReply = async () => response({ isSyncing: false, requiresReconciliation: true });
        render(<BOMSyncPage />); await flush();
        const button = screen.getByRole('button', { name: 'Repair & resume' });
        expect(button.hasAttribute('disabled')).toBe(true);
        await act(async () => screen.getByRole('checkbox', { name: /The older run cannot prove/ }).click());
        await act(async () => button.click());
        const request = fetchMock.mock.calls.find(([url]) => url.endsWith('sync-repair'))!;
        expect(JSON.parse(request[1].body as string)).toEqual({ fingerprint: 'b'.repeat(64), confirmedStoppedAndSettled: true });
        expect(screen.getByText('Repairing and verifying BOM inventory from fresh stock…')).toBeTruthy();
        statusReply = async () => response({ isSyncing: false, repairSummary: { total: 2, checked: 2, repaired: 1, unchanged: 1, failed: 0, verified: true } });
        await tick();
        expect(screen.getByText(/Automatic repair complete/)).toBeTruthy();
        expect(screen.getByRole('button', { name: /Sync All/ }).hasAttribute('disabled')).toBe(false);
        expect(count('sync-all')).toBe(0);
    });

    it('keeps polling and blocks duplicate writes after an ambiguous repair admission', async () => {
        const { result } = renderHook(() => useBOMSync()); await flush();
        mutationReply = async () => { throw new Error('response lost'); };
        statusReply = async () => response({}, 503);
        await act(async () => {
            await expect(result.current.handleRepair('a'.repeat(64), true)).rejects.toThrow('response lost');
        });
        expect(result.current.isSyncing).toBe(true);
        await act(async () => result.current.handleSyncSingle('1', 0));
        expect(fetchMock.mock.calls.filter(([url]) => url.includes('/bom/sync?'))).toHaveLength(0);
        statusReply = async () => response({ isSyncing: true, isRepair: true, progress: { current: 1, total: 2 } });
        await tick();
        expect(result.current.isRepairing).toBe(true);
        expect(result.current.syncProgress).toEqual({ current: 1, total: 2 });
    });

    it('refreshes authoritative status after inventory review and re-enables Sync All without starting a run', async () => {
        let blocked = true;
        statusReply = async () => response({ isSyncing: false, requiresReconciliation: blocked });
        const originalFetch = fetchMock.getMockImplementation()!;
        fetchMock.mockImplementation((url, options) => {
            if (String(url).endsWith('sync-reconcile')) {
                blocked = false;
                return Promise.resolve(response({ success: true, auditId: 'audit' }));
            }
            return originalFetch(url, options);
        });
        render(<BOMSyncPage />); await flush();
        expect(screen.getByRole('button', { name: /Sync All/ }).hasAttribute('disabled')).toBe(true);
        fireEvent.change(screen.getByLabelText('Inventory review notes (required)'), { target: { value: 'Checked live and physical inventory and retired the old worker.' } });
        screen.getAllByRole('checkbox').forEach(box => fireEvent.click(box));
        await act(async () => screen.getByRole('button', { name: 'Complete inventory review & unlock' }).click());
        await flush();
        expect(screen.queryByText('BOM sync needs reconciliation')).toBeNull();
        expect(screen.getByRole('button', { name: /Sync All/ }).hasAttribute('disabled')).toBe(false);
        expect(count('sync-all')).toBe(0);
        expect(count('sync-reconcile')).toBe(1);
    });

    it('requires explicit worker confirmation before continuing and sends only the reviewed fingerprint', async () => {
        statusReply = async () => response({ isSyncing: false, requiresReconciliation: true });
        render(<BOMSyncPage />); await flush();
        await act(async () => screen.getByText('Advanced: continue untouched products only').click());
        await act(async () => screen.getByRole('button', { name: 'Review continuation' }).click());
        const button = screen.getByRole('button', { name: 'Continue unaffected products (5)' });
        expect(button.hasAttribute('disabled')).toBe(true);
        expect(screen.getByText(/uncertain products require review/).textContent).toContain('1');
        await act(async () => screen.getByRole('checkbox', { name: /I have verified the previous worker/ }).click());
        expect(button.hasAttribute('disabled')).toBe(false);
        await act(async () => button.click());
        const request = fetchMock.mock.calls.find(([url, options]) => url.endsWith('sync-recovery') && options?.method === 'POST')!;
        expect(JSON.parse(request[1].body as string)).toEqual({ fingerprint: recoveryPlan.fingerprint, confirmedStoppedAndSettled: true });
        expect(screen.getByText(/Continuing unaffected products/)).toBeTruthy();
        statusReply = async () => response({ isSyncing: false, requiresReconciliation: true });
        await tick();
        expect(screen.getByRole('alert').textContent).toContain('BOM sync needs reconciliation');
        expect(screen.getByRole('button', { name: /Sync All/ }).hasAttribute('disabled')).toBe(true);
    });

    it('explains legacy checkpoints without offering an unsafe continue action', async () => {
        statusReply = async () => response({ isSyncing: false, requiresReconciliation: true });
        recoveryReply = async () => response({ error: 'This older run has no reliable per-product checkpoint.', code: 'BOM_RECOVERY_LEGACY_CHECKPOINT' }, 409);
        render(<BOMSyncPage />); await flush();
        await act(async () => screen.getByText('Advanced: continue untouched products only').click());
        await act(async () => screen.getByRole('button', { name: 'Review continuation' }).click());
        expect(screen.getByRole('status').textContent).toContain('no reliable per-product checkpoint');
        expect(screen.queryByRole('checkbox', { name: /I have verified the previous worker/ })).toBeNull();
        expect(fetchMock.mock.calls.filter(([, options]) => options?.method === 'POST')).toHaveLength(0);
    });

    it('does not expose recovery controls without inventory management permission', async () => {
        canManageInventory = false;
        statusReply = async () => response({ isSyncing: false, requiresReconciliation: true });
        render(<BOMSyncPage />); await flush();
        expect(screen.queryByRole('button', { name: 'Review continuation' })).toBeNull();
        expect(count('sync-recovery')).toBe(0);
    });

    it('serializes continuation clicks and preserves the plan after an unacknowledged request', async () => {
        const { result } = renderHook(() => useBOMSync()); await flush();
        await act(async () => result.current.handleReviewRecovery());
        const delayed = deferred<Response>(); mutationReply = () => delayed.promise;
        let first!: Promise<void>;
        act(() => { first = result.current.handleContinueRecovery(); void result.current.handleContinueRecovery(); });
        expect(fetchMock.mock.calls.filter(([url, options]) => url.endsWith('sync-recovery') && options?.method === 'POST')).toHaveLength(1);
        await act(async () => { delayed.resolve(response({ error: 'Refresh status before retrying' }, 503)); await first; });
        expect(result.current.recoveryError).toContain('Refresh status');
        expect(result.current.recoveryPlan?.fingerprint).toBe(recoveryPlan.fingerprint);
        expect(result.current.isSyncing).toBe(false);
    });

    it('ignores late recovery plans after switching account', async () => {
        const slow = deferred<Response>(); recoveryReply = () => slow.promise;
        const { result, rerender } = renderHook(() => useBOMSync()); await flush();
        let review!: Promise<void>;
        act(() => { review = result.current.handleReviewRecovery(); });
        accountId = 'account-2'; rerender(); await flush();
        await act(async () => { slow.resolve(response(recoveryPlan)); await review; });
        expect(result.current.recoveryPlan).toBeNull();
        expect(result.current.isLoadingRecovery).toBe(false);
    });

    it('keeps writes blocked after an ambiguous continuation until status can be established', async () => {
        const { result } = renderHook(() => useBOMSync()); await flush();
        await act(async () => result.current.handleReviewRecovery());
        mutationReply = async () => { throw new Error('Connection lost after submission'); };
        statusReply = async () => response({}, 503);
        await act(async () => result.current.handleContinueRecovery());
        expect(result.current.isSyncing).toBe(true);
        await act(async () => { await result.current.handleContinueRecovery(); await result.current.handleSyncSingle('1', 0); });
        expect(fetchMock.mock.calls.filter(([, options]) => options?.method === 'POST')).toHaveLength(1);
        statusReply = async () => response({ isSyncing: true, isRecovery: true });
        await tick();
        expect(result.current.isRecovering).toBe(true);
        statusReply = async () => response({ isSyncing: false, requiresReconciliation: true });
        await tick();
        expect(result.current.isSyncing).toBe(false);
        expect(result.current.syncError?.code).toBe('BOM_SYNC_RECONCILIATION_REQUIRED');
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
