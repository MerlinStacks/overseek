// @vitest-environment jsdom
import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useProductEdit } from './useProductEdit';

const mocks = vi.hoisted(() => ({ get: vi.fn(), patch: vi.fn(), toast: vi.fn() }));
vi.mock('../context/AuthContext', () => ({ useAuth: () => ({ token: 'token' }) }));
vi.mock('../context/AccountContext', () => ({ useAccount: () => ({ currentAccount: { id: 'account' } }) }));
vi.mock('./useAccountFeature', () => ({ useAccountFeature: () => false }));
vi.mock('./usePermissions', () => ({ usePermissions: () => ({ hasPermission: () => true }) }));
vi.mock('./useCollaboration', () => ({ useCollaboration: () => ({ activeUsers: [] }) }));
vi.mock('../context/ToastContext', () => ({ useToast: () => ({ toast: mocks.toast }) }));
vi.mock('../services/ProductService', () => ({ ProductService: { getProduct: mocks.get, updateProduct: mocks.patch } }));
vi.mock('../services/InventoryService', () => ({ InventoryService: { getSuppliers: async () => [] } }));
vi.mock('../utils/seoScoring', () => ({ calculateSeoScore: () => ({ score: 0 }) }));
vi.mock('../utils/productCrossTabEvents', () => ({ emitProductChange: vi.fn() }));

const categories = [{ id: 12, name: 'Gifts', slug: 'gifts' }, { id: 3, name: 'Home', slug: 'home' }];
const tags = [{ id: 24, name: 'Popular', slug: 'popular' }, { id: 5, name: 'New', slug: 'new' }];
const product = { id: 'product', wooId: 10, name: 'Product', categories, tags };
const edits = {
    categories: [{ id: 42, name: 'Occasions' }],
    tags: [{ id: 51, name: 'Seasonal' }]
};
const key = 'product-draft:account:product';
const ready = async (result: { current: ReturnType<typeof useProductEdit> }) => waitFor(() => expect(result.current.isLoading).toBe(false));

function deferred<T>() {
    let resolve!: (value: T) => void;
    const promise = new Promise<T>(done => { resolve = done; });
    return { promise, resolve };
}

beforeEach(() => {
    localStorage.clear(); vi.clearAllMocks();
    mocks.get.mockResolvedValue(product);
    mocks.patch.mockResolvedValue({});
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => ({}) })));
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

describe('product taxonomy drafts and save', () => {
    it('hydrates category and tag terms without marking the form dirty', async () => {
        const { result } = renderHook(() => useProductEdit('product')); await ready(result);
        expect(result.current.formData.categories).toEqual(categories);
        expect(result.current.formData.tags).toEqual(tags);
        expect(result.current.hasUnsavedChanges).toBe(false);
        expect(localStorage.getItem(key)).toBeNull();
    });

    it('hydrates missing taxonomy fields as empty arrays', async () => {
        mocks.get.mockResolvedValue({ id: 'product', wooId: 10, name: 'Product' });
        const { result } = renderHook(() => useProductEdit('product')); await ready(result);
        expect(result.current.formData.categories).toEqual([]);
        expect(result.current.formData.tags).toEqual([]);
        await act(async () => { expect(await result.current.handleSave()).toBe(true); });
        expect(mocks.patch.mock.calls[0][1]).not.toHaveProperty('categories');
        expect(mocks.patch.mock.calls[0][1]).not.toHaveProperty('tags');
    });

    it.each(['categories', 'tags'] as const)('sends only IDs for changed %s and omits the other taxonomy', async field => {
        const { result } = renderHook(() => useProductEdit('product')); await ready(result);
        act(() => result.current.updateFormData({ [field]: edits[field] }));
        expect(result.current.hasUnsavedChanges).toBe(true);
        await act(async () => { expect(await result.current.handleSave()).toBe(true); });
        expect(mocks.patch).toHaveBeenCalledWith('product', expect.objectContaining({ [field]: [{ id: edits[field][0].id }] }), 'token', 'account');
        expect(mocks.patch.mock.calls[0][1]).not.toHaveProperty(field === 'categories' ? 'tags' : 'categories');
    });

    it('sends explicit empty arrays when clearing existing categories and tags', async () => {
        const { result } = renderHook(() => useProductEdit('product')); await ready(result);
        act(() => result.current.updateFormData({ categories: [], tags: [] }));
        await act(async () => { expect(await result.current.handleSave()).toBe(true); });
        expect(mocks.patch).toHaveBeenCalledWith('product', expect.objectContaining({ categories: [], tags: [] }), 'token', 'account');
    });

    it('omits unchanged taxonomy assignments on an unrelated save', async () => {
        const { result } = renderHook(() => useProductEdit('product')); await ready(result);
        act(() => result.current.updateFormData({ name: 'Updated product' }));
        await act(async () => { expect(await result.current.handleSave()).toBe(true); });
        const payload = mocks.patch.mock.calls[0][1];
        expect(payload.name).toBe('Updated product');
        expect(payload).not.toHaveProperty('categories');
        expect(payload).not.toHaveProperty('tags');
    });

    it('omits taxonomy assignments when only order or labels change', async () => {
        const { result } = renderHook(() => useProductEdit('product')); await ready(result);
        act(() => result.current.updateFormData({
            categories: [...categories].reverse().map(term => ({ ...term, name: `${term.name} renamed` })),
            tags: [...tags].reverse().map(term => ({ ...term, name: `${term.name} renamed` }))
        }));
        await act(async () => { expect(await result.current.handleSave()).toBe(true); });
        expect(mocks.patch.mock.calls[0][1]).not.toHaveProperty('categories');
        expect(mocks.patch.mock.calls[0][1]).not.toHaveProperty('tags');
    });

    it('preserves loaded terms when restoring a legacy draft without taxonomy fields', async () => {
        const first = renderHook(() => useProductEdit('product')); await ready(first.result);
        const formData: Partial<typeof first.result.current.formData> = { ...first.result.current.formData, name: 'Draft name' };
        delete formData.categories;
        delete formData.tags;
        first.unmount();
        localStorage.setItem(key, JSON.stringify({ formData, savedAt: Date.now() }));
        const { result } = renderHook(() => useProductEdit('product')); await ready(result);
        expect(result.current.formData.name).toBe('Draft name');
        expect(result.current.formData.categories).toEqual(categories);
        expect(result.current.formData.tags).toEqual(tags);
        expect(result.current.hasDraft).toBe(true);
        await act(async () => { expect(await result.current.handleSave()).toBe(true); });
        expect(mocks.patch.mock.calls[0][1]).not.toHaveProperty('categories');
        expect(mocks.patch.mock.calls[0][1]).not.toHaveProperty('tags');
    });

    it('retains taxonomy edits and persists them for restoration after a failed save', async () => {
        const first = renderHook(() => useProductEdit('product')); await ready(first.result);
        act(() => first.result.current.updateFormData(edits));
        mocks.patch.mockRejectedValue(new Error('Save failed'));
        await act(async () => { expect(await first.result.current.handleSave()).toBe(false); });
        expect(first.result.current.formData).toMatchObject(edits);
        expect(first.result.current.hasUnsavedChanges).toBe(true);
        expect(first.result.current.saveState).toBe('error');
        expect(mocks.get).toHaveBeenCalledTimes(1);
        first.unmount();
        expect(JSON.parse(localStorage.getItem(key)!).formData).toMatchObject(edits);
        const second = renderHook(() => useProductEdit('product')); await ready(second.result);
        expect(second.result.current.formData).toMatchObject(edits);
        expect(second.result.current.hasDraft).toBe(true);
        expect(second.result.current.hasUnsavedChanges).toBe(true);
    });

    it('refreshes Woo default category after clearing terms and uses it as the next save baseline', async () => {
        const { result } = renderHook(() => useProductEdit('product')); await ready(result);
        act(() => result.current.updateFormData({ categories: [], tags: [] }));
        const confirmed = { ...product, categories: [{ id: 1, name: 'Uncategorized', slug: 'uncategorized' }], tags: [] };
        mocks.get.mockResolvedValue(confirmed);
        await act(async () => { expect(await result.current.handleSave()).toBe(true); });
        expect(mocks.patch.mock.calls[0][1]).toMatchObject({ categories: [], tags: [] });
        expect(result.current.formData.categories).toEqual(confirmed.categories);
        expect(result.current.formData.tags).toEqual([]);
        expect(result.current.product).toEqual(confirmed);
        expect(result.current.hasUnsavedChanges).toBe(false);
        expect(result.current.hasDraft).toBe(false);
        expect(localStorage.getItem(key)).toBeNull();
        act(() => result.current.updateFormData({ name: 'Another name' }));
        await act(async () => { expect(await result.current.handleSave()).toBe(true); });
        expect(mocks.patch.mock.calls[1][1]).not.toHaveProperty('categories');
        expect(mocks.patch.mock.calls[1][1]).not.toHaveProperty('tags');
    });

    it.each(['save', 'refresh'] as const)('protects newer taxonomy edits made during the %s request', async stage => {
        const { result, unmount } = renderHook(() => useProductEdit('product')); await ready(result);
        act(() => result.current.updateFormData({ categories: [], tags: [] }));
        const confirmed = { ...product, categories: [{ id: 1, name: 'Uncategorized', slug: 'uncategorized' }], tags: [] };
        const pendingSave = deferred<object>();
        const pendingRefresh = deferred<typeof confirmed>();
        mocks.patch.mockReturnValueOnce(pendingSave.promise);
        mocks.get.mockReturnValueOnce(pendingRefresh.promise);
        let saving!: Promise<boolean>;
        act(() => { saving = result.current.handleSave(); });
        expect(result.current.isSaving).toBe(true);
        expect(mocks.patch.mock.calls[0][1]).toMatchObject({ categories: [], tags: [] });
        if (stage === 'refresh') {
            await act(async () => { pendingSave.resolve({}); });
            await waitFor(() => expect(mocks.get).toHaveBeenCalledTimes(2));
        }
        act(() => result.current.updateFormData(edits));
        await act(async () => {
            pendingSave.resolve({});
            pendingRefresh.resolve(confirmed);
            expect(await saving).toBe(true);
        });
        expect(result.current.product).toEqual(confirmed);
        expect(result.current.formData).toMatchObject(edits);
        expect(result.current.hasUnsavedChanges).toBe(true);
        expect(result.current.saveState).toBe('unsaved');
        expect(result.current.isSaving).toBe(false);
        unmount();
        expect(JSON.parse(localStorage.getItem(key)!).formData).toMatchObject(edits);
    });
});
