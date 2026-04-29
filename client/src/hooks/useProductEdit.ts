/**
 * useProductEdit Hook
 *
 * Manages all state and data fetching for the Product Edit page.
 * Extracted from ProductEditPage.tsx for maintainability.
 */

import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { useAuth } from '../context/AuthContext';
import { useAccount } from '../context/AccountContext';
import { useCollaboration } from './useCollaboration';
import { ProductService } from '../services/ProductService';
import { InventoryService } from '../services/InventoryService';
import { calculateSeoScore } from '../utils/seoScoring';
import { Logger } from '../utils/logger';
import { emitProductChange } from '../utils/productCrossTabEvents';
import { useToast } from '../context/ToastContext';
import type { BOMPanelRef } from '../components/products/BOMPanel';
import type { VariationsPanelRef } from '../components/products/VariationsPanel';
import type { StockManagementPanelRef } from '../components/products/StockManagementPanel';

export interface ProductFormData {
    name: string;
    sku: string;
    price: string;
    salePrice: string;
    stockStatus: string;
    manageStock: boolean;
    backorders: 'no' | 'notify' | 'yes';
    description: string;
    short_description: string;
    focusKeyword: string;
    isGoldPriceApplied: boolean;
    goldPriceType: string | null;
    weight: string;
    length: string;
    width: string;
    height: string;
    cogs: string;
    miscCosts: unknown[];
    supplierId: string;
    binLocation: string;
    images: unknown[];
}

interface SeoData {
    focusKeyword?: string;
}

export interface ProductVariantData {
    id: number;
    sku?: string;
    price?: string | number;
    attributes?: Array<{ name: string; option: string }>;
}

export interface ProductData {
    id: string;
    wooId: number;
    name: string;
    sku: string;
    permalink: string;
    description: string;
    short_description: string;
    price: string;
    regularPrice: string;
    salePrice: string;
    stockStatus: string;
    stockQuantity: number | null;
    manageStock: boolean;
    backorders?: 'no' | 'notify' | 'yes';
    weight: string;
    dimensions: { length: string; width: string; height: string };
    binLocation?: string;
    mainImage?: string;
    seoScore?: number;
    seoData?: SeoData;
    merchantCenterScore?: number;
    merchantCenterIssues?: unknown;
    cogs?: string;
    miscCosts?: unknown[];
    supplierId?: string;
    images?: unknown[];
    isGoldPriceApplied?: boolean;
    goldPriceType?: string | null;
    type?: string;
    variations?: Array<number | ProductVariantData>;
    rawData?: unknown;
    categories?: { id: number; name: string; slug: string }[];
    tags?: { id: number; name: string; slug: string }[];
    updatedAt?: string;
    [key: string]: unknown;
}

type SaveState = 'idle' | 'unsaved' | 'saving' | 'saved' | 'partial' | 'error';

const initialFormData: ProductFormData = {
    name: '',
    sku: '',
    price: '',
    salePrice: '',
    stockStatus: 'instock',
    manageStock: false,
    backorders: 'no',
    description: '',
    short_description: '',
    focusKeyword: '',
    isGoldPriceApplied: false,
    goldPriceType: null,
    weight: '',
    length: '',
    width: '',
    height: '',
    cogs: '',
    miscCosts: [],
    supplierId: '',
    binLocation: '',
    images: []
};

/** 24 hours in ms - drafts older than this are discarded */
const MAX_DRAFT_AGE_MS = 24 * 60 * 60 * 1000;
const SAVE_DEBOUNCE_MS = 500;

/** Build a localStorage key scoped to account + product */
function buildProductDraftKey(accountId: string, productId: string): string {
    return `product-draft:${accountId}:${productId}`;
}

export function useProductEdit(productId: string | undefined) {
    const { token } = useAuth();
    const { currentAccount } = useAccount();
    const { activeUsers } = useCollaboration(productId || '');
    const globalToast = useToast();

    // Core state
    const [isLoading, setIsLoading] = useState(true);
    const [isSaving, setIsSaving] = useState(false);
    const [isSyncing, setIsSyncing] = useState(false);
    const [product, setProduct] = useState<ProductData | null>(null);
    const [loadError, setLoadError] = useState<string | null>(null);
    const [hasUnsavedChanges, setHasUnsavedChanges] = useState(false);
    const [saveState, setSaveState] = useState<SaveState>('idle');
    const [saveMessage, setSaveMessage] = useState<string | null>(null);
    const [lastSavedAt, setLastSavedAt] = useState<Date | null>(null);
    const [lastSyncedAt, setLastSyncedAt] = useState<Date | null>(null);
    const [formData, setFormData] = useState<ProductFormData>(initialFormData);
    const [variants, setVariants] = useState<unknown[]>([]);
    const [suppliers, setSuppliers] = useState<unknown[]>([]);
    const [productViews, setProductViews] = useState<{ views7d: number; views30d: number } | null>(null);
    const [mainImageFailed, setMainImageFailed] = useState(false);
    /** Whether a draft was restored - drives the "Discard Draft" button visibility */
    const [hasDraft, setHasDraft] = useState(false);

    // Refs for child panels
    const bomPanelRef = useRef<BOMPanelRef>(null);
    const variationsPanelRef = useRef<VariationsPanelRef>(null);
    const stockPanelRef = useRef<StockManagementPanelRef>(null);

    // Why: refs for volatile context values so callbacks don't regenerate on
    // silent token refresh, which was causing fetchProduct to re-fire and wipe edits.
    const tokenRef = useRef(token);
    tokenRef.current = token;
    const accountRef = useRef(currentAccount);
    accountRef.current = currentAccount;
    const formDataRef = useRef(formData);
    formDataRef.current = formData;

    // --- Draft persistence state ---
    /** Whether any field has changed since the last save - drives beforeunload guard */
    const isDirtyRef = useRef(false);
    const draftTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    /** Tracks whether `fetchProduct` has populated formData at least once */
    const serverLoadedRef = useRef(false);
    /** Skip the first formData change (the one from fetchProduct) for dirty tracking */
    const initialFormSetRef = useRef(false);
    /** Prevents draft restore from firing more than once per product session */
    const draftRestoredRef = useRef(false);
    /** Unwritten formData waiting on the debounce timer - used to flush synchronously
     *  on unmount, account switch, product switch, and page unload so in-flight
     *  keystrokes survive error boundaries, reloads, and account changes. */
    const pendingDraftRef = useRef<ProductFormData | null>(null);

    const writeDraftSync = useCallback((acctId: string, pId: string, data: ProductFormData) => {
        try {
            const key = buildProductDraftKey(acctId, pId);
            localStorage.setItem(key, JSON.stringify({ formData: data, savedAt: Date.now() }));
        } catch (err) {
            Logger.error('Failed to persist product draft', { error: err });
        }
    }, []);

    // Why: reset draft tracking refs when productId changes (user navigates between products)
    useEffect(() => {
        serverLoadedRef.current = false;
        initialFormSetRef.current = false;
        draftRestoredRef.current = false;
        isDirtyRef.current = false;
        pendingDraftRef.current = null;
        setProduct(null);
        setFormData(initialFormData);
        setVariants([]);
        setProductViews(null);
        setMainImageFailed(false);
        setHasDraft(false);
        setHasUnsavedChanges(false);
        setSaveState('idle');
        setSaveMessage(null);
        setLastSavedAt(null);
        setLastSyncedAt(null);
        setLoadError(null);
    }, [productId]);

    // SEO scoring (derived state)
    const seoResult = calculateSeoScore({
        name: formData.name,
        description: (formData.description || '') + (formData.short_description || ''),
        permalink: product?.permalink || '',
        images: formData.images,
        price: formData.price
    }, formData.focusKeyword);
    const formDataSnapshot = useMemo(() => JSON.stringify(formData), [formData]);

    const showToast = useCallback((message: string, type: 'success' | 'error' | 'info' = 'success') => {
        globalToast.toast(message, type);
    }, [globalToast]);

    const updateFormData = useCallback((updates: Partial<ProductFormData>) => {
        isDirtyRef.current = true;
        setHasUnsavedChanges(true);
        setSaveState('unsaved');
        setSaveMessage('Unsaved changes');
        setFormData(prev => ({ ...prev, ...updates }));
    }, []);

    // Fetch suppliers
    const fetchSuppliers = useCallback(async () => {
        const acct = accountRef.current;
        const tkn = tokenRef.current;
        if (!acct || !tkn) return;
        try {
            const data = await InventoryService.getSuppliers(tkn, acct.id);
            setSuppliers(data);
        } catch (e) {
            Logger.error('Failed to fetch suppliers', { error: e });
        }
    }, []);

    // Fetch product
    // Why: `skipFormReset` prevents the post-save refetch from clobbering keystrokes
    // the user made during the network round-trip. `product` is still refreshed so
    // server-computed fields (seoScore, etc.) stay current.
    const fetchProduct = useCallback(async (background = false, skipFormReset = false) => {
        const acct = accountRef.current;
        const tkn = tokenRef.current;
        if (!acct || !tkn || !productId) return;
        if (!background) setIsLoading(true);
        if (!background) setLoadError(null);

        try {
            const data = await ProductService.getProduct(productId, tkn, acct.id) as ProductData;
            Logger.debug('Product data loaded', { productId, wooId: data.wooId });
            setProduct(data);
            setMainImageFailed(false);
            const loadedUpdatedAt = data.updatedAt;
            if (loadedUpdatedAt) {
                setLastSyncedAt(prev => prev ?? new Date(loadedUpdatedAt));
            }

            if (skipFormReset) return;

            setFormData({
                name: data.name || '',
                sku: data.sku || '',
                price: data.price ? data.price.toString() : '',
                salePrice: data.salePrice ? data.salePrice.toString() : '',
                stockStatus: data.stockStatus || 'instock',
                manageStock: data.manageStock ?? false,
                backorders: data.backorders || 'no',
                binLocation: data.binLocation || '',
                description: data.description || '',
                short_description: data.short_description || '',
                focusKeyword: data.seoData?.focusKeyword || data.name || '',
                isGoldPriceApplied: data.isGoldPriceApplied || false,
                goldPriceType: data.goldPriceType || null,
                weight: data.weight ? data.weight.toString() : '',
                length: data.dimensions?.length?.toString() || '',
                width: data.dimensions?.width?.toString() || '',
                height: data.dimensions?.height?.toString() || '',
                cogs: data.cogs ? data.cogs.toString() : '',
                miscCosts: data.miscCosts || [],
                supplierId: data.supplierId || '',
                images: data.images || []
            });

            // Handle variants
            if (data.variations?.length) {
                if (typeof data.variations[0] === 'object') {
                    setVariants(data.variations);
                } else {
                    setVariants(data.variations.map((id) => ({
                        id: Number(id), sku: '', price: '', attributes: []
                    })));
                }
            } else {
                setVariants([]);
            }
        } catch (error) {
            Logger.error('Failed to load product', { error });
            if (!background) {
                setLoadError(error instanceof Error ? error.message : 'Failed to load product');
            }
        } finally {
            if (!background) setIsLoading(false);
            serverLoadedRef.current = true;
        }
    }, [productId]);

    // Fetch product views
    const fetchViews = useCallback(async () => {
        const acct = accountRef.current;
        const tkn = tokenRef.current;
        if (!acct || !productId || !tkn) return;
        try {
            const res = await fetch(`/api/analytics/product-views/${productId}`, {
                headers: {
                    Authorization: `Bearer ${tkn}`,
                    'x-account-id': acct.id
                }
            });
            if (res.ok) setProductViews(await res.json());
        } catch (e) {
            Logger.error('Failed to fetch product views', { error: e });
        }
    }, [productId]);

    // Save handler
    const handleSave = useCallback(async () => {
        const acct = accountRef.current;
        const tkn = tokenRef.current;
        if (!acct || !productId || !tkn) return;
        setIsSaving(true);
        setSaveState('saving');
        setSaveMessage('Saving changes...');

        try {
            await ProductService.updateProduct(productId, {
                name: formData.name,
                sku: formData.sku,
                binLocation: formData.binLocation,
                stockStatus: formData.stockStatus,
                manageStock: formData.manageStock,
                backorders: formData.backorders,
                isGoldPriceApplied: formData.isGoldPriceApplied,
                goldPriceType: formData.goldPriceType,
                weight: formData.weight,
                length: formData.length,
                width: formData.width,
                height: formData.height,
                price: formData.price,
                salePrice: formData.salePrice,
                description: formData.description,
                short_description: formData.short_description,
                cogs: formData.cogs,
                miscCosts: formData.miscCosts,
                supplierId: formData.supplierId,
                images: formData.images,
                variations: variants,
                focusKeyword: formData.focusKeyword
            }, tkn, acct.id);

            const bomSaveResult = await bomPanelRef.current?.save();
            const variantBomsSaveResult = await variationsPanelRef.current?.saveAllBOMs();
            const stockSaveResult = await stockPanelRef.current?.save();
            const failedPanels = [
                bomSaveResult === false ? 'BOM' : null,
                variantBomsSaveResult === false ? 'variation BOMs' : null,
                stockSaveResult === false ? 'stock' : null,
            ].filter(Boolean) as string[];

            if (failedPanels.length > 0) {
                showToast('Product saved, but some sub-panel saves failed (BOM or stock).', 'error');
                setSaveState('partial');
                setSaveMessage(`Saved product fields, but ${failedPanels.join(', ')} still need attention.`);
            } else {
                showToast('Product saved successfully');
                setSaveState('saved');
                setSaveMessage('Saved successfully');
            }

            // Why: clear the draft after a successful save to avoid stale restoration
            if (acct && productId) {
                const key = buildProductDraftKey(acct.id, productId);
                localStorage.removeItem(key);
            }
            isDirtyRef.current = false;
            setHasDraft(false);
            setHasUnsavedChanges(false);
            setLastSavedAt(new Date());
            pendingDraftRef.current = null;
            emitProductChange({
                type: 'updated',
                productId,
                accountId: acct.id,
            });

            await Promise.all([
                fetchProduct(true, true),
                fetchViews()
            ]);
        } catch (error) {
            Logger.error('An error occurred', { error });
            setSaveState('error');
            setSaveMessage(error instanceof Error ? error.message : 'Failed to save changes');
            showToast('Failed to save changes', 'error');
        } finally {
            setIsSaving(false);
        }
    }, [productId, formData, variants, showToast, fetchProduct, fetchViews]);

    // Sync handler
    const handleSync = useCallback(async () => {
        const acct = accountRef.current;
        const tkn = tokenRef.current;
        if (!acct || !productId || !tkn) return;
        setIsSyncing(true);
        setSaveMessage('Syncing from WooCommerce...');

        try {
            const updated = await ProductService.syncProduct(productId, tkn, acct.id) as { wooId?: number };
            Logger.debug('Product synced', { productId, wooId: updated?.wooId });
            // Why: sync overwrites formData from server, so clear any saved draft
            const key = buildProductDraftKey(acct.id, productId);
            localStorage.removeItem(key);
            isDirtyRef.current = false;
            setHasDraft(false);
            setHasUnsavedChanges(false);
            pendingDraftRef.current = null;
            await Promise.all([
                fetchProduct(true),
                fetchViews()
            ]);
            setLastSyncedAt(new Date());
            setSaveState('idle');
            setSaveMessage('Synced from WooCommerce');
            emitProductChange({
                type: 'synced',
                productId,
                accountId: acct.id,
            });
            showToast('Product synced successfully from WooCommerce.');
        } catch (error: unknown) {
            Logger.error('Sync failed:', { error });
            const message = error instanceof Error ? error.message : 'Unknown error';
            setSaveState('error');
            setSaveMessage(`Sync failed: ${message}`);
            showToast(`Sync failed: ${message}`, 'error');
        } finally {
            setIsSyncing(false);
        }
    }, [productId, fetchProduct, fetchViews, showToast]);

    // Effects - depend on stable primitives (currentAccount?.id) not object references
    useEffect(() => {
        if (currentAccount?.id) fetchSuppliers();
    }, [currentAccount?.id, fetchSuppliers]);

    useEffect(() => {
        if (currentAccount?.id && productId) fetchProduct();
    }, [currentAccount?.id, productId, fetchProduct]);

    useEffect(() => {
        if (currentAccount?.id && productId) fetchViews();
    }, [currentAccount?.id, productId, fetchViews]);

    // --- Draft auto-save: debounced write to localStorage ---
    useEffect(() => {
        const acct = accountRef.current;
        if (!acct || !productId || !serverLoadedRef.current) return;
        // Why: skip persisting the initial server-loaded formData
        if (!initialFormSetRef.current) {
            initialFormSetRef.current = true;
            return;
        }

        // Why: track pending data so flush-on-unmount/unload can write it
        // synchronously if the timer hasn't fired yet.
        pendingDraftRef.current = formDataRef.current;

        if (draftTimerRef.current) clearTimeout(draftTimerRef.current);
        draftTimerRef.current = setTimeout(() => {
            writeDraftSync(acct.id, productId, formDataRef.current);
            pendingDraftRef.current = null;
        }, SAVE_DEBOUNCE_MS);

        return () => { if (draftTimerRef.current) clearTimeout(draftTimerRef.current); };
    }, [currentAccount?.id, productId, formDataSnapshot, writeDraftSync]);

    // --- Flush pending draft on account switch, product switch, or unmount ---
    // Why: closures capture the PREVIOUS productId + accountId, so when deps change
    // the cleanup writes the unflushed keystrokes under the OLD keys before the
    // new product/account takes over. Also covers ErrorBoundary-triggered unmounts
    // and React tree unmounts from route changes.
    useEffect(() => {
        const acctId = currentAccount?.id;
        return () => {
            const pending = pendingDraftRef.current;
            if (pending && acctId && productId) {
                writeDraftSync(acctId, productId, pending);
                pendingDraftRef.current = null;
            }
        };
    }, [currentAccount?.id, productId, writeDraftSync]);

    // --- Draft restore: after server data loads, check for a saved draft ---
    useEffect(() => {
        // Why: guard prevents re-triggering on background fetchProduct or formData changes
        if (draftRestoredRef.current) return;
        const acct = accountRef.current;
        if (!acct || !productId || !product || isLoading) return;
        draftRestoredRef.current = true;

        const key = buildProductDraftKey(acct.id, productId);
        try {
            const raw = localStorage.getItem(key);
            if (!raw) return;
            const draft = JSON.parse(raw);

            // Discard stale drafts
            if (Date.now() - draft.savedAt > MAX_DRAFT_AGE_MS) {
                localStorage.removeItem(key);
                return;
            }

            // Only restore if the draft differs from server data
            if (JSON.stringify(draft.formData) !== JSON.stringify(formData)) {
                setFormData(draft.formData);
                isDirtyRef.current = true;
                setHasDraft(true);
                setHasUnsavedChanges(true);
                setSaveState('unsaved');
                setSaveMessage('Unsaved changes restored');
                showToast('Unsaved changes restored from your last session', 'success');
            }
        } catch {
            localStorage.removeItem(key);
        }
    }, [currentAccount?.id, productId, isLoading, product, formData, showToast]);

    // --- Beforeunload guard: flush + warn when navigating away with unsaved changes ---
    useEffect(() => {
        const handler = (e: BeforeUnloadEvent) => {
            // Why: flush any unwritten keystrokes synchronously before the page dies.
            // Covers user-initiated reloads (including ErrorBoundary's Reload button).
            const pending = pendingDraftRef.current;
            const acct = accountRef.current;
            if (pending && acct && productId) {
                writeDraftSync(acct.id, productId, pending);
                pendingDraftRef.current = null;
            }
            if (!isDirtyRef.current) return;
            e.preventDefault();
        };
        window.addEventListener('beforeunload', handler);
        return () => window.removeEventListener('beforeunload', handler);
    }, [productId, writeDraftSync]);

    /** Discard the saved draft and reset form to server state */
    const discardDraft = useCallback(() => {
        const acct = accountRef.current;
        if (!acct || !productId) return;
        const key = buildProductDraftKey(acct.id, productId);
        localStorage.removeItem(key);
        isDirtyRef.current = false;
        setHasDraft(false);
        setHasUnsavedChanges(false);
        setSaveState('idle');
        setSaveMessage(null);
        pendingDraftRef.current = null;
        // Re-fetch server data to reset form
        fetchProduct(false);
    }, [productId, fetchProduct]);

    return {
        // State
        isLoading,
        isSaving,
        isSyncing,
        loadError,
        hasUnsavedChanges,
        saveState,
        saveMessage,
        lastSavedAt,
        lastSyncedAt,
        product,
        formData,
        variants,
        suppliers,
        productViews,
        mainImageFailed,
        hasDraft,
        seoResult,
        activeUsers,
        currentAccount,

        // Refs
        bomPanelRef,
        variationsPanelRef,
        stockPanelRef,

        // Actions
        updateFormData,
        setVariants,
        setMainImageFailed,
        handleSave,
        handleSync,
        fetchProduct,
        fetchViews,
        discardDraft,
    };
}
