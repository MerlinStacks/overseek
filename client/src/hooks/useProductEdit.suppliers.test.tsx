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
vi.mock('../services/InventoryService', () => ({ InventoryService: { getSuppliers: async () => [{ id: 'parent', name: 'Parent' }, { id: 'override', name: 'Override' }] } }));
vi.mock('../utils/seoScoring', () => ({ calculateSeoScore: () => ({ score: 0 }) }));
vi.mock('../utils/productCrossTabEvents', () => ({ emitProductChange: vi.fn() }));

const variant = { id: 101, sku: 'SKU', price: '10', attributes: [], supplierId: 'override' };
const key = 'product-draft:account:product';
beforeEach(() => {
    localStorage.clear(); vi.clearAllMocks();
    mocks.get.mockResolvedValue({ id: 'product', wooId: 10, name: 'Product', supplierId: 'parent', variations: [variant] });
    mocks.patch.mockResolvedValue({});
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => ({}) })));
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });
const ready = async (result: { current: ReturnType<typeof useProductEdit> }) => waitFor(() => expect(result.current.isLoading).toBe(false));

describe('variant supplier drafts and save', () => {
    it.each(['other-supplier', null])('persists and restores supplier %s from variant-only edits, then saves it', async supplierId => {
        const first = renderHook(() => useProductEdit('product'));
        await ready(first.result);
        expect(first.result.current.variants).toEqual([variant]);
        act(() => first.result.current.setVariants([{ ...variant, supplierId }]));
        expect(first.result.current.hasUnsavedChanges).toBe(true);
        first.unmount(); // Flush before the debounce, just like navigation.
        expect(JSON.parse(localStorage.getItem(key)!).variants).toEqual([{ ...variant, supplierId }]);
        const second = renderHook(() => useProductEdit('product'));
        await ready(second.result);
        expect(second.result.current.variants).toEqual([{ ...variant, supplierId }]);
        expect(second.result.current.hasDraft).toBe(true);
        await act(async () => { expect(await second.result.current.handleSave()).toBe(true); });
        expect(mocks.patch).toHaveBeenCalledWith('product', expect.objectContaining({ supplierId: 'parent', variations: [{ ...variant, supplierId }] }), 'token', 'account');
        expect(localStorage.getItem(key)).toBeNull();
        expect(second.result.current.hasUnsavedChanges).toBe(false);
    });

    it('keeps loaded overrides when restoring an older parent-only draft', async () => {
        const first = renderHook(() => useProductEdit('product')); await ready(first.result);
        const formData = { ...first.result.current.formData, name: 'Draft name' };
        first.unmount();
        localStorage.setItem(key, JSON.stringify({ formData, savedAt: Date.now() }));
        const second = renderHook(() => useProductEdit('product')); await ready(second.result);
        expect(second.result.current.formData.name).toBe('Draft name');
        expect(second.result.current.variants).toEqual([variant]);
    });

    it('retains supplier edits on failed save and resets them when the draft is discarded', async () => {
        const { result } = renderHook(() => useProductEdit('product')); await ready(result);
        act(() => result.current.setVariants([{ ...variant, supplierId: null }]));
        mocks.patch.mockRejectedValue(new Error('Save failed'));
        await act(async () => { expect(await result.current.handleSave()).toBe(false); });
        expect(result.current.variants).toEqual([{ ...variant, supplierId: null }]);
        expect(result.current.hasUnsavedChanges).toBe(true);
        await act(async () => { result.current.discardDraft(); });
        await waitFor(() => expect(result.current.variants).toEqual([variant]));
        expect(result.current.hasUnsavedChanges).toBe(false);
        expect(localStorage.getItem(key)).toBeNull();
    });
});
