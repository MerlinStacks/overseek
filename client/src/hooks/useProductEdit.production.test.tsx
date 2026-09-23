// @vitest-environment jsdom
import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import { useLayoutEffect } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useProductEdit } from './useProductEdit';
import { productionDraft, productionPayload } from './useProductProduction';

const mocks = vi.hoisted(() => ({
    account: { id: 'account-a' }, token: 'token-a', enabled: true, edit: true,
    get: vi.fn(), patch: vi.fn(), sync: vi.fn(), toast: vi.fn(),
}));
vi.mock('../context/AuthContext', () => ({ useAuth: () => ({ token: mocks.token }) }));
vi.mock('../context/AccountContext', () => ({ useAccount: () => ({ currentAccount: mocks.account }) }));
vi.mock('./useAccountFeature', () => ({ useAccountFeature: () => mocks.enabled }));
vi.mock('./usePermissions', () => ({ usePermissions: () => ({ hasPermission: (name: string) => name !== 'edit_products' || mocks.edit }) }));
vi.mock('./useCollaboration', () => ({ useCollaboration: () => ({ activeUsers: [] }) }));
vi.mock('../context/ToastContext', () => ({ useToast: () => ({ toast: mocks.toast }) }));
vi.mock('../services/ProductService', () => ({ ProductService: { getProduct: mocks.get, updateProduct: mocks.patch, syncProduct: mocks.sync } }));
vi.mock('../services/InventoryService', () => ({ InventoryService: { getSuppliers: async () => [] } }));
vi.mock('../utils/seoScoring', () => ({ calculateSeoScore: () => ({ score: 0 }) }));
vi.mock('../utils/productCrossTabEvents', () => ({ emitProductChange: vi.fn() }));

const product = (id = 'local-product') => ({ id, wooId: 10, name: 'Product', variations: [], dimensions: {} });
const production = (id = 'local-product') => ({ id, wooId: 10, productionMinDays: 0, productionMaxDays: 2, variations: [{ id: 'local-variation', wooId: 101, productionMinDays: null, productionMaxDays: null }] });
const response = (data: unknown, ok = true) => ({ ok, json: async () => data }) as Response;
const deferred = <T,>() => { let resolve!: (value: T) => void; const promise = new Promise<T>(done => { resolve = done; }); return { promise, resolve }; };
let fetchMock: ReturnType<typeof vi.fn>;
beforeEach(() => {
    localStorage.clear(); vi.clearAllMocks();
    mocks.account = { id: 'account-a' }; mocks.token = 'token-a'; mocks.enabled = true; mocks.edit = true;
    mocks.get.mockImplementation(async (id: string) => product(id)); mocks.patch.mockResolvedValue({}); mocks.sync.mockResolvedValue({ wooId: 10 });
    fetchMock = vi.fn(async (url: string) => response(url.includes('delivery-estimates') ? { product: production(decodeURIComponent(url.split('/').pop()!)) } : { views7d: 0, views30d: 0 }));
    vi.stubGlobal('fetch', fetchMock);
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });
const ready = async (result: { current: ReturnType<typeof useProductEdit> }) => waitFor(() => {
    expect(result.current.isLoading).toBe(false);
    expect(result.current.production.general?.value).toEqual({ min: '0', max: '2' });
});
const puts = () => fetchMock.mock.calls.filter(call => (call[1] as RequestInit | undefined)?.method === 'PUT');

describe('product view refresh', () => {
    it('shows loading and confirms even unchanged counts without notifying on initial load', async () => {
        const { result } = renderHook(() => useProductEdit('local-product'));
        await ready(result);
        expect(mocks.toast).not.toHaveBeenCalled();
        const pending = deferred<Response>();
        fetchMock.mockReturnValueOnce(pending.promise);
        let refresh!: Promise<void>;
        act(() => { refresh = result.current.fetchViews(true); });
        expect(result.current.isRefreshingViews).toBe(true);
        await act(async () => {
            pending.resolve(response({ views7d: 0, views30d: 0 }));
            await refresh;
        });
        expect(result.current.isRefreshingViews).toBe(false);
        expect(mocks.toast).toHaveBeenCalledWith('Product views refreshed: 0 in 7 days, 0 in 30 days.', 'success');
    });

    it.each(['http', 'network'])('reports %s failures while retaining existing counts', async (failure) => {
        const { result } = renderHook(() => useProductEdit('local-product'));
        await ready(result);
        if (failure === 'http') fetchMock.mockResolvedValueOnce(response({}, false));
        else fetchMock.mockRejectedValueOnce(new Error('Offline'));
        await act(async () => { await result.current.fetchViews(true); });
        expect(result.current.productViews).toEqual({ views7d: 0, views30d: 0 });
        expect(result.current.isRefreshingViews).toBe(false);
        expect(mocks.toast).toHaveBeenCalledWith('Could not refresh product views. Please try again.', 'error');
    });

    it('ignores a refresh completed after switching products', async () => {
        const { result, rerender } = renderHook(({ id }) => useProductEdit(id), { initialProps: { id: 'first' } });
        await ready(result);
        const pending = deferred<Response>();
        fetchMock.mockReturnValueOnce(pending.promise);
        let refresh!: Promise<void>;
        act(() => { refresh = result.current.fetchViews(true); });
        rerender({ id: 'second' });
        await ready(result);
        await act(async () => {
            pending.resolve(response({ views7d: 99, views30d: 100 }));
            await refresh;
        });
        expect(result.current.productViews).toEqual({ views7d: 0, views30d: 0 });
        expect(mocks.toast).not.toHaveBeenCalled();
        expect(result.current.isRefreshingViews).toBe(false);
    });
});

describe('main product production save', () => {
    it('clears an already-acknowledged persisted draft so later external changes are accepted', async () => {
        const key = 'product-production-draft:account-a:local-product';
        const baseline = productionDraft(production());
        const acknowledged = { ...production(), productionMinDays: 1, productionMaxDays: 1 };
        localStorage.setItem(key, JSON.stringify({ savedAt: Date.now(), saved: baseline, draft: productionDraft(acknowledged) }));
        fetchMock.mockImplementation(async (url: string) => response(url.includes('delivery-estimates') ? { product: acknowledged } : {}));
        const first = renderHook(() => useProductEdit('local-product'));
        await waitFor(() => expect(first.result.current.production.general?.value).toEqual({ min: '1', max: '1' }));
        expect(first.result.current.production.dirty).toBe(false);
        expect(localStorage.getItem(key)).toBeNull();
        first.unmount();
        fetchMock.mockImplementation(async (url: string) => response(url.includes('delivery-estimates') ? { product: { ...acknowledged, productionMinDays: 5, productionMaxDays: 5 } } : {}));
        const second = renderHook(() => useProductEdit('local-product'));
        await waitFor(() => expect(second.result.current.production.general?.value).toEqual({ min: '5', max: '5' }));
        expect(second.result.current.production.dirty).toBe(false); expect(puts()).toHaveLength(0);
    });
    it('persists the rebased baseline while retaining unsaved and orphan variation drafts', async () => {
        const key = 'product-production-draft:account-a:local-product';
        const baseline = productionDraft(production());
        const draft = { ...baseline, values: { ...baseline.values, 101: { min: '3', max: '4' }, 999: { min: '1', max: '1' } } };
        localStorage.setItem(key, JSON.stringify({ savedAt: Date.now(), saved: baseline, draft }));
        const server = { ...production(), productionMaxDays: 5 };
        fetchMock.mockImplementation(async (url: string) => response(url.includes('delivery-estimates') ? { product: server } : {}));
        const { result } = renderHook(() => useProductEdit('local-product'));
        await waitFor(() => expect(result.current.production.warning).toContain('#999'));
        const stored = JSON.parse(localStorage.getItem(key)!);
        expect(stored.saved).toEqual(productionDraft(server));
        expect(stored.draft.parent).toEqual({ min: '0', max: '5' });
        expect(stored.draft.values[101]).toEqual({ min: '3', max: '4' });
        expect(stored.draft.values[999]).toEqual({ min: '1', max: '1' });
    });
    it('rejects orphan or missing variation mappings at the payload boundary', () => {
        const server = production(); const draft = productionDraft(server);
        expect(() => productionPayload({ ...draft, values: { ...draft.values, 999: { min: '0', max: '0' } } }, server)).toThrow(/removed variations #999/);
        expect(() => productionPayload({ ...draft, values: {} }, server)).toThrow(/missing for variations #101/);
    });
    it('snapshots same-act normal/variant/production edits at invocation and retains later in-flight edits', async () => {
        const { result } = renderHook(() => useProductEdit('local-product')); await ready(result);
        const pending = deferred<unknown>(); mocks.patch.mockReturnValue(pending.promise);
        let save!: Promise<boolean>;
        act(() => {
            result.current.updateFormData({ name: 'Latest name' });
            result.current.setVariants([{ id: 101, price: '7' }]);
            result.current.production.general!.onChange({ min: '1', max: '2' });
            result.current.production.variations!.onChange(101, { min: '0', max: '0' });
            save = result.current.handleSave();
        });
        expect(mocks.patch.mock.calls[0][1]).toMatchObject({ name: 'Latest name', variations: [{ id: 101, price: '7' }] });
        act(() => {
            result.current.updateFormData({ name: 'Later name' });
            result.current.setVariants([{ id: 101, price: '8' }]);
            result.current.production.general!.onChange({ min: '3', max: '4' });
        });
        await act(async () => { pending.resolve({}); expect(await save).toBe(true); });
        expect(JSON.parse((puts()[0][1] as RequestInit).body as string)).toEqual({ productionMinDays: 1, productionMaxDays: 2, variations: [{ id: 'local-variation', productionMinDays: 0, productionMaxDays: 0 }] });
        expect(result.current.formData.name).toBe('Later name');
        expect(result.current.variants).toEqual([{ id: 101, price: '8' }]);
        expect(result.current.production.general?.value).toEqual({ min: '3', max: '4' });
        expect(result.current.hasUnsavedChanges).toBe(true);
    });
    it('recognizes production-only dirty edits and validates new invalid ranges before the next render', async () => {
        const { result } = renderHook(() => useProductEdit('local-product')); await ready(result);
        await act(async () => {
            result.current.production.general!.onChange({ min: '1', max: '1' });
            expect(await result.current.handleSave()).toBe(true);
        });
        expect(mocks.patch).not.toHaveBeenCalled(); expect(puts()).toHaveLength(1);
        const later = vi.fn();
        await act(async () => {
            result.current.production.variations!.onChange(101, { min: '4', max: '' });
            expect(await result.current.handleSave([{ name: 'feed', save: later }])).toBe(false);
        });
        expect(puts()).toHaveLength(1); expect(later).not.toHaveBeenCalled();
        expect(result.current.production.variations?.values[101]).toEqual({ min: '4', max: '' });
    });
    it('hides old account identity before reset effects and blocks old/current Save and Sync on the same Woo URL', async () => {
        // Feature-off ensures the ordinary save guard itself prevents cross-account writes.
        mocks.enabled = false;
        const pending = deferred<unknown>();
        mocks.get.mockImplementation((_id: string, _token: string, accountId: string) => accountId === 'account-a'
            ? Promise.resolve({ ...product('local-a'), name: 'Account A fields' }) : pending.promise);
        const transitions: Array<{ productId: string | null; loading: boolean }> = [];
        const attempts: Array<Promise<unknown>> = [];
        const { result, rerender } = renderHook(() => {
            const editor = useProductEdit('42');
            useLayoutEffect(() => {
                if (mocks.account.id !== 'account-b') return;
                transitions.push({ productId: editor.product?.id ?? null, loading: editor.isLoading });
                attempts.push(editor.handleSave(), editor.handleSync(), oldSave(), oldSync());
            }, [mocks.account.id]);
            return editor;
        });
        await waitFor(() => expect(result.current.product?.id).toBe('local-a'));
        act(() => result.current.updateFormData({ name: 'Unsaved A fields' }));
        const oldSave = result.current.handleSave;
        const oldSync = result.current.handleSync;
        mocks.account = { id: 'account-b' }; rerender();
        await act(async () => { await Promise.all(attempts); });
        expect(transitions).toEqual([{ productId: null, loading: true }]);
        expect(result.current.product).toBeNull(); expect(result.current.isLoading).toBe(true);
        expect(mocks.patch).not.toHaveBeenCalled(); expect(mocks.sync).not.toHaveBeenCalled();
        await act(async () => pending.resolve({ ...product('local-b'), name: 'Account B fields' }));
        expect(result.current.product?.id).toBe('local-b'); expect(result.current.formData.name).toBe('Account B fields');
        expect(result.current.isLoading).toBe(false);
        await act(async () => { expect(await result.current.handleSave()).toBe(true); });
        expect(mocks.patch).toHaveBeenCalledWith('42', expect.objectContaining({ name: 'Account B fields' }), 'token-a', 'account-b');
    });
    it('settles a failed new-account load into error UI without exposing the old product or a permanent skeleton', async () => {
        mocks.get.mockResolvedValue({ ...product('local-a'), name: 'Account A fields' });
        const { result, rerender } = renderHook(() => useProductEdit('42'));
        await waitFor(() => expect(result.current.product?.id).toBe('local-a'));
        mocks.get.mockRejectedValue(new Error('Account B product unavailable'));
        mocks.account = { id: 'account-b' }; rerender();
        await waitFor(() => expect(result.current.loadError).toBe('Account B product unavailable'));
        expect(result.current.product).toBeNull(); expect(result.current.isLoading).toBe(false);
        await act(async () => { expect(await result.current.handleSave()).toBe(false); await result.current.handleSync(); });
        expect(mocks.patch).not.toHaveBeenCalled(); expect(mocks.sync).not.toHaveBeenCalled();
        mocks.get.mockResolvedValue(product('local-b'));
        await act(async () => { await result.current.fetchProduct(); });
        expect(result.current.product?.id).toBe('local-b'); expect(result.current.loadError).toBeNull();
        expect(result.current.isLoading).toBe(false);
    });
    it('foreground same-scope reloads preserve existing and in-flight edits and ignore superseded responses', async () => {
        const { result } = renderHook(() => useProductEdit('local-product')); await ready(result);
        const older = deferred<unknown>(); const newer = deferred<unknown>();
        mocks.get.mockReturnValueOnce(older.promise).mockReturnValueOnce(newer.promise);
        let first!: Promise<void>; let second!: Promise<void>;
        act(() => { first = result.current.fetchProduct(); });
        act(() => result.current.updateFormData({ name: 'Typed during reload' }));
        act(() => { second = result.current.fetchProduct(); });
        await act(async () => { newer.resolve({ ...product(), name: 'New server snapshot' }); await second; });
        expect(result.current.formData.name).toBe('Typed during reload');
        expect(result.current.product?.name).toBe('New server snapshot');
        await act(async () => { older.resolve({ ...product(), name: 'Stale server snapshot' }); await first; });
        expect(result.current.formData.name).toBe('Typed during reload');
        expect(result.current.product?.name).toBe('New server snapshot');
        expect(result.current.hasUnsavedChanges).toBe(true); expect(result.current.isLoading).toBe(false);
    });
    it.each(['role revoked', 'feature disabled'])('retains captured drafts and stops later stages when %s during PATCH', async reason => {
        const { result, rerender } = renderHook(() => useProductEdit('local-product')); await ready(result);
        act(() => { result.current.updateFormData({ name: 'Changed' }); result.current.production.general!.onChange({ min: '3', max: '4' }); });
        const stored = localStorage.getItem('product-production-draft:account-a:local-product');
        const pending = deferred<unknown>(); mocks.patch.mockReturnValue(pending.promise);
        const later = vi.fn(); let save!: Promise<boolean>;
        await act(async () => { save = result.current.handleSave([{ name: 'feed', save: later }]); });
        if (reason === 'role revoked') mocks.edit = false; else mocks.enabled = false;
        rerender();
        await act(async () => { pending.resolve({}); expect(await save).toBe(false); });
        expect(puts()).toHaveLength(0); expect(later).not.toHaveBeenCalled();
        expect(result.current.saveState).toBe('partial');
        expect(result.current.saveMessage).toMatch(/permission|disabled/);
        expect(localStorage.getItem('product-production-draft:account-a:local-product')).toBe(stored);
    });
    it('blocks Save after production load failure and preserves pending persisted drafts', async () => {
        const stored = JSON.stringify({ savedAt: Date.now(), draft: { parent: { min: '8', max: '' }, values: {} } });
        localStorage.setItem('product-production-draft:account-a:local-product', stored);
        fetchMock.mockResolvedValue(response({ error: 'Unavailable' }, false));
        const { result } = renderHook(() => useProductEdit('local-product'));
        await waitFor(() => expect(result.current.production.general?.error).toBe('Unavailable'));
        const later = vi.fn();
        await act(async () => { expect(await result.current.handleSave([{ name: 'feed', save: later }])).toBe(false); });
        expect(mocks.patch).not.toHaveBeenCalled(); expect(puts()).toHaveLength(0); expect(later).not.toHaveBeenCalled();
        expect(localStorage.getItem('product-production-draft:account-a:local-product')).toBe(stored);
    });
    it('refreshes production after Sync, preserving changed Woo ranges and resolving current local UUIDs', async () => {
        const { result } = renderHook(() => useProductEdit('local-product')); await ready(result);
        act(() => result.current.production.variations!.onChange(101, { min: '0', max: '1' }));
        const refreshed = { ...production(), productionMaxDays: 9, variations: [
            { ...production().variations[0], id: 'replacement-local' },
            { id: 'new-local', wooId: 202, productionMinDays: null, productionMaxDays: null },
        ] };
        fetchMock.mockImplementation(async (url: string) => response(url.includes('delivery-estimates') ? { product: refreshed } : {}));
        await act(async () => { await result.current.handleSync(); });
        await waitFor(() => expect(result.current.production.variations?.values[202]).toEqual({ min: '', max: '' }));
        expect(result.current.production.general?.value).toEqual({ min: '0', max: '9' });
        expect(result.current.production.variations?.values[101]).toEqual({ min: '0', max: '1' });
        act(() => result.current.production.variations!.onChange(202, { min: '2', max: '3' }));
        await act(async () => { expect(await result.current.handleSave()).toBe(true); });
        expect(mocks.patch).not.toHaveBeenCalled();
        expect(JSON.parse((puts()[0][1] as RequestInit).body as string).variations).toEqual([
            { id: 'replacement-local', productionMinDays: 0, productionMaxDays: 1 },
            { id: 'new-local', productionMinDays: 2, productionMaxDays: 3 },
        ]);
    });
    it('warns about removed changed variations and retains them through refresh, failed validation and reload', async () => {
        const first = renderHook(() => useProductEdit('local-product')); await ready(first.result);
        act(() => first.result.current.production.variations!.onChange(101, { min: '4', max: '' }));
        fetchMock.mockImplementation(async (url: string) => response(url.includes('delivery-estimates') ? { product: { ...production(), variations: [] } } : {}));
        await act(async () => { await first.result.current.handleSync(); });
        await waitFor(() => expect(first.result.current.production.warning).toContain('#101'));
        const stored = localStorage.getItem('product-production-draft:account-a:local-product');
        await act(async () => { expect(await first.result.current.handleSave()).toBe(false); });
        expect(first.result.current.production.variations?.values[101]).toEqual({ min: '4', max: '' });
        expect(localStorage.getItem('product-production-draft:account-a:local-product')).toBe(stored);
        expect(mocks.patch).not.toHaveBeenCalled(); expect(puts()).toHaveLength(0);
        first.unmount();
        const second = renderHook(() => useProductEdit('local-product')); await ready(second.result);
        expect(second.result.current.production.warning).toContain('#101');
    });
    it('does not warn for removed variations whose production ranges were unchanged', async () => {
        const { result } = renderHook(() => useProductEdit('local-product')); await ready(result);
        act(() => result.current.production.general!.onChange({ min: '1', max: '2' }));
        fetchMock.mockImplementation(async (url: string) => response(url.includes('delivery-estimates') ? { product: { ...production(), variations: [] } } : {}));
        await act(async () => { await result.current.handleSync(); });
        await waitFor(() => expect(result.current.production.general?.loading).toBe(false));
        expect(result.current.production.warning).toBeUndefined();
        expect(result.current.production.variations?.values[101]).toBeUndefined();
        expect(result.current.production.general?.value).toEqual({ min: '1', max: '2' });
    });
    it('ignores no-op BOM/COGS and variant callbacks during save without losing real edits', async () => {
        const { result } = renderHook(() => useProductEdit('local-product')); await ready(result);
        act(() => { result.current.updateFormData({ cogs: '1.00', miscCosts: [] }); result.current.setVariants([{ id: 101, price: '5' }]); });
        Object.assign(result.current.bomPanelRef, { current: { save: async () => {
            result.current.updateFormData({ cogs: '1.00', miscCosts: [] });
            result.current.setVariants([{ id: 101, price: '5' }]);
            return true;
        } } });
        await act(async () => { expect(await result.current.handleSave()).toBe(true); });
        expect(result.current.hasUnsavedChanges).toBe(false); expect(result.current.saveState).toBe('saved');
        act(() => { result.current.updateFormData({ cogs: '1.00' }); result.current.setVariants([{ id: 101, price: '5' }]); });
        expect(result.current.hasUnsavedChanges).toBe(false);
        act(() => { result.current.updateFormData({ cogs: '2.00' }); result.current.updateFormData({ cogs: '3.00' }); });
        expect(result.current.formData.cogs).toBe('3.00'); expect(result.current.hasUnsavedChanges).toBe(true);
    });
    it('discards normal and production drafts even when storage removal throws', async () => {
        const { result } = renderHook(() => useProductEdit('local-product')); await ready(result);
        act(() => { result.current.updateFormData({ name: 'Changed' }); result.current.production.general!.onChange({ min: '4', max: '' }); });
        vi.spyOn(Storage.prototype, 'removeItem').mockImplementation(() => { throw new Error('Storage unavailable'); });
        act(() => expect(() => result.current.discardDraft()).not.toThrow());
        await ready(result);
        expect(result.current.formData.name).toBe('Product'); expect(result.current.hasUnsavedChanges).toBe(false);
    });
    it('uses the loaded local UUID when the route is a Woo ID', async () => {
        mocks.get.mockResolvedValue(product());
        const { result } = renderHook(() => useProductEdit('10')); await ready(result);
        expect(fetchMock.mock.calls.some(call => call[0] === '/api/delivery-estimates/products/local-product')).toBe(true);
        expect(fetchMock.mock.calls.some(call => call[0] === '/api/delivery-estimates/products/10')).toBe(false);
    });
    it('blocks all writes while visible production is unloaded rather than treating it as blank', async () => {
        const pending = deferred<Response>();
        fetchMock.mockImplementation((url: string) => url.includes('delivery-estimates') ? pending.promise : Promise.resolve(response({})));
        const { result } = renderHook(() => useProductEdit('local-product'));
        await waitFor(() => expect(result.current.isLoading).toBe(false));
        expect(result.current.production.general?.value).toBeUndefined();
        expect(result.current.production.general?.disabled).toBe(true);
        act(() => result.current.updateFormData({ name: 'Normal only' }));
        await act(async () => { expect(await result.current.handleSave()).toBe(false); });
        expect(mocks.patch).not.toHaveBeenCalled();
        expect(result.current.saveMessage).toContain('not ready');
        expect(puts()).toHaveLength(0);
        await act(async () => pending.resolve(response({ product: production() })));
        expect(result.current.production.general?.value).toEqual({ min: '0', max: '2' });
    });
    it('does not let late account product/production loads replace the current editor', async () => {
        const oldProduct = deferred<unknown>();
        mocks.get.mockImplementation((_id: string, _token: string, accountId: string) => accountId === 'account-a' ? oldProduct.promise : Promise.resolve(product('new-local')));
        const { result, rerender } = renderHook(() => useProductEdit('10'));
        mocks.account = { id: 'account-b' }; rerender(); await ready(result);
        await act(async () => oldProduct.resolve(product('old-local')));
        expect(result.current.product?.id).toBe('new-local');
        expect(fetchMock.mock.calls.some(call => call[0] === '/api/delivery-estimates/products/old-local')).toBe(false);
    });
    it('restores only current Woo IDs and sends their current local variation UUIDs', async () => {
        localStorage.setItem('product-production-draft:account-a:local-product', JSON.stringify({ savedAt: Date.now(), draft: { parent: { min: '', max: '' }, values: { 101: { min: '0', max: '0' } } } }));
        fetchMock.mockImplementation(async () => response({ product: { ...production(), variations: [{ ...production().variations[0], id: 'replacement-local' }] } }));
        const { result } = renderHook(() => useProductEdit('local-product'));
        await waitFor(() => expect(result.current.production.general?.value).toEqual({ min: '', max: '' }));
        expect(result.current.production.variations?.values[999]).toBeUndefined();
        await act(async () => { expect(await result.current.handleSave()).toBe(true); });
        const payload = JSON.parse((puts()[0][1] as RequestInit).body as string);
        expect(payload).toEqual({ productionMinDays: null, productionMaxDays: null, variations: [{ id: 'replacement-local', productionMinDays: 0, productionMaxDays: 0 }] });
    });
    it('stops before production on ordinary PATCH failure, retaining unsent drafts', async () => {
        const { result } = renderHook(() => useProductEdit('local-product')); await ready(result);
        act(() => { result.current.updateFormData({ name: 'Unsent' }); result.current.production.general!.onChange({ min: '1', max: '1' }); });
        mocks.patch.mockRejectedValue(new Error('Woo failed'));
        await act(async () => { expect(await result.current.handleSave()).toBe(false); });
        expect(puts()).toHaveLength(0); expect(result.current.production.dirty).toBe(true); expect(result.current.hasUnsavedChanges).toBe(true);
        expect(result.current.saveState).toBe('error');
    });
    it('preserves zero, null/inheritance and maps Woo IDs to current local UUIDs', () => {
        const server = production();
        const draft = productionDraft(server);
        expect(draft.values[101]).toEqual({ min: '', max: '' });
        expect(productionPayload(draft, server)).toEqual({ productionMinDays: 0, productionMaxDays: 2, variations: [{ id: 'local-variation', productionMinDays: null, productionMaxDays: null }] });
    });
    it('validates collapsed variations before every write participant', async () => {
        const { result } = renderHook(() => useProductEdit('local-product'));
        await ready(result);
        act(() => { result.current.updateFormData({ name: 'Changed' }); result.current.production.variations!.onChange(101, { min: '4', max: '1' }); });
        const participant = vi.fn(); const bom = vi.fn();
        Object.assign(result.current.bomPanelRef, { current: { save: bom } });
        await act(async () => { expect(await result.current.handleSave([{ name: 'feed', save: participant }])).toBe(false); });
        expect(mocks.patch).not.toHaveBeenCalled(); expect(puts()).toHaveLength(0); expect(bom).not.toHaveBeenCalled(); expect(participant).not.toHaveBeenCalled();
        expect(result.current.saveMessage).toContain('101');
        // Validation never disables the loaded controls needed to fix the draft.
        expect(result.current.production.general?.error).toBeUndefined();
    });
    it('saves production-only without Woo PATCH but still awaits BOM/stock/external participants', async () => {
        const { result } = renderHook(() => useProductEdit('local-product')); await ready(result);
        act(() => result.current.production.general!.onChange({ min: '0', max: '0' }));
        const bom = vi.fn(async () => true); const stock = vi.fn(async () => true); const external = vi.fn(async () => true);
        Object.assign(result.current.bomPanelRef, { current: { save: bom } });
        Object.assign(result.current.stockPanelRef, { current: { save: stock } });
        await act(async () => { expect(await result.current.handleSave([{ name: 'wholesale', save: external }])).toBe(true); });
        expect(mocks.patch).not.toHaveBeenCalled(); expect(puts()).toHaveLength(1);
        expect(JSON.parse((puts()[0][1] as RequestInit).body as string).productionMinDays).toBe(0);
        expect(bom).toHaveBeenCalledOnce(); expect(stock).toHaveBeenCalledOnce(); expect(external).toHaveBeenCalledOnce();
        expect(result.current.hasUnsavedChanges).toBe(false); expect(result.current.saveState).toBe('saved');
    });
    it('retains production and normal drafts on production failure after PATCH, stopping later stages', async () => {
        const { result } = renderHook(() => useProductEdit('local-product')); await ready(result);
        act(() => { result.current.updateFormData({ name: 'Changed' }); result.current.production.general!.onChange({ min: '3', max: '4' }); });
        fetchMock.mockImplementation(async (url: string, options?: RequestInit) => options?.method === 'PUT' ? response({ error: 'Production failed' }, false) : response({}));
        const next = vi.fn();
        await act(async () => { expect(await result.current.handleSave([{ name: 'feed', save: next }])).toBe(false); });
        expect(mocks.patch).toHaveBeenCalledOnce(); expect(mocks.patch.mock.calls[0][1]).not.toHaveProperty('productionMinDays');
        expect(next).not.toHaveBeenCalled(); expect(result.current.saveState).toBe('partial');
        expect(result.current.production.dirty).toBe(true); expect(result.current.formData.name).toBe('Changed');
        expect(localStorage.getItem('product-production-draft:account-a:local-product')).toContain('3');
    });
    it('reports external failure honestly and retains newer edits during the global lock', async () => {
        const { result } = renderHook(() => useProductEdit('local-product')); await ready(result);
        act(() => result.current.updateFormData({ name: 'Submitted' }));
        const pending = deferred<boolean>();
        let save!: Promise<boolean>;
        await act(async () => { save = result.current.handleSave([{ name: 'wholesale', save: () => pending.promise }]); });
        expect(result.current.isSaving).toBe(true); expect(result.current.saveState).toBe('saving');
        act(() => result.current.updateFormData({ name: 'Newer' }));
        await act(async () => { expect(await result.current.handleSave()).toBe(false); pending.resolve(false); await save; });
        expect(mocks.patch).toHaveBeenCalledOnce(); expect(result.current.formData.name).toBe('Newer');
        expect(result.current.hasUnsavedChanges).toBe(true); expect(result.current.saveState).toBe('partial');
    });
    it('does not clear edits typed during successful production and normal saves', async () => {
        const { result } = renderHook(() => useProductEdit('local-product')); await ready(result);
        act(() => { result.current.updateFormData({ name: 'Submitted' }); result.current.production.general!.onChange({ min: '3', max: '4' }); });
        const pending = deferred<Response>();
        fetchMock.mockImplementation((url: string, options?: RequestInit) => options?.method === 'PUT' ? pending.promise : Promise.resolve(response({})));
        let save!: Promise<boolean>;
        await act(async () => { save = result.current.handleSave(); });
        act(() => { result.current.updateFormData({ name: 'Newer' }); result.current.production.general!.onChange({ min: '5', max: '6' }); });
        await act(async () => { pending.resolve(response({ product: production() })); await save; });
        expect(result.current.formData.name).toBe('Newer'); expect(result.current.production.general?.value).toEqual({ min: '5', max: '6' });
        expect(result.current.production.dirty).toBe(true); expect(result.current.hasUnsavedChanges).toBe(true);
        expect(result.current.saveState).toBe('unsaved');
    });
    it('snapshots production at Save click, preserving edits made while ordinary PATCH is in flight', async () => {
        const { result } = renderHook(() => useProductEdit('local-product')); await ready(result);
        act(() => { result.current.updateFormData({ name: 'Submitted' }); result.current.production.general!.onChange({ min: '3', max: '4' }); });
        const pending = deferred<unknown>(); mocks.patch.mockReturnValue(pending.promise);
        let save!: Promise<boolean>;
        await act(async () => { save = result.current.handleSave(); });
        act(() => result.current.production.general!.onChange({ min: '5', max: '' }));
        await act(async () => { pending.resolve({}); expect(await save).toBe(true); });
        const payload = JSON.parse((puts()[0][1] as RequestInit).body as string);
        expect(payload.productionMinDays).toBe(3); expect(payload.productionMaxDays).toBe(4);
        expect(result.current.production.general?.value).toEqual({ min: '5', max: '' });
        expect(result.current.hasUnsavedChanges).toBe(true);
    });
    it('stops later stages and ignores late production PUT responses on account switch', async () => {
        const { result, rerender } = renderHook(() => useProductEdit('local-product')); await ready(result);
        act(() => result.current.production.general!.onChange({ min: '3', max: '4' }));
        const pending = deferred<Response>();
        fetchMock.mockImplementation((url: string, options?: RequestInit) => options?.method === 'PUT' ? pending.promise : Promise.resolve(response(url.includes('delivery-estimates') ? { product: production() } : {})));
        const next = vi.fn(); let save!: Promise<boolean>;
        await act(async () => { save = result.current.handleSave([{ name: 'feed', save: next }]); });
        mocks.account = { id: 'account-b' }; rerender(); await ready(result);
        await act(async () => { pending.resolve(response({ product: production() })); expect(await save).toBe(false); });
        expect(next).not.toHaveBeenCalled(); expect(result.current.production.dirty).toBe(false);
        expect(localStorage.getItem('product-production-draft:account-a:local-product')).toContain('3');
    });
    it('refreshes tokens without resetting drafts and scopes/restores production by account/product and Woo ID', async () => {
        const { result, rerender } = renderHook(({ id }) => useProductEdit(id), { initialProps: { id: 'local-product' } }); await ready(result);
        act(() => result.current.production.variations!.onChange(101, { min: '0', max: '0' }));
        const gets = () => fetchMock.mock.calls.filter(call => (call[0] as string).includes('delivery-estimates') && !(call[1] as RequestInit)?.method).length;
        const count = gets(); mocks.token = 'refreshed'; rerender({ id: 'local-product' });
        expect(gets()).toBe(count); expect(result.current.production.dirty).toBe(true);
        mocks.account = { id: 'account-b' }; rerender({ id: 'local-product' }); await ready(result);
        expect(result.current.production.dirty).toBe(false);
        mocks.account = { id: 'account-a' }; rerender({ id: 'other-product' }); await ready(result);
        expect(result.current.production.dirty).toBe(false);
        rerender({ id: 'local-product' }); await ready(result);
        expect(result.current.production.variations?.values[101]).toEqual({ min: '0', max: '0' });
        await act(async () => { await result.current.handleSave(); });
        expect((puts()[0][1] as RequestInit).headers).toMatchObject({ Authorization: 'Bearer refreshed' });
    });
    it('ignores late normal responses and stops later save stages after a scope switch', async () => {
        const { result, rerender } = renderHook(({ id }) => useProductEdit(id), { initialProps: { id: 'local-product' } }); await ready(result);
        act(() => { result.current.updateFormData({ name: 'Old' }); result.current.production.general!.onChange({ min: '3', max: '4' }); });
        const pending = deferred<unknown>(); mocks.patch.mockReturnValue(pending.promise);
        const next = vi.fn(); let save!: Promise<boolean>;
        await act(async () => { save = result.current.handleSave([{ name: 'feed', save: next }]); });
        mocks.account = { id: 'account-b' }; rerender({ id: 'other-product' }); await ready(result);
        await act(async () => { pending.resolve({}); expect(await save).toBe(false); });
        expect(puts()).toHaveLength(0); expect(next).not.toHaveBeenCalled(); expect(result.current.formData.name).toBe('Product');
        expect(result.current.saveState).toBe('idle');
    });
    it('feature-off does no production fetch/PUT and view-only cannot edit', async () => {
        mocks.enabled = false;
        const { result, rerender } = renderHook(() => useProductEdit('local-product'));
        await waitFor(() => expect(result.current.isLoading).toBe(false));
        await act(async () => { await result.current.handleSave(); });
        expect(fetchMock.mock.calls.some(call => (call[0] as string).includes('delivery-estimates'))).toBe(false);
        mocks.enabled = true; mocks.edit = false; rerender(); await ready(result);
        expect(result.current.production.general?.disabled).toBe(true);
        act(() => result.current.production.general!.onChange({ min: '9', max: '9' }));
        expect(result.current.production.dirty).toBe(false);
    });
});
