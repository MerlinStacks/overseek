/**
 * useProductEdit Hook
 *
 * Manages all state and data fetching for the Product Edit page.
 * Extracted from ProductEditPage.tsx for maintainability.
 */

import { useState, useEffect, useRef, useCallback } from 'react';
import { useAuth } from '../context/AuthContext';
import { useAccount } from '../context/AccountContext';
import { useCollaboration } from './useCollaboration';
import { ProductService } from '../services/ProductService';
import { InventoryService } from '../services/InventoryService';
import { calculateSeoScore } from '../utils/seoScoring';
import { Logger } from '../utils/logger';
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
    miscCosts: any[];
    supplierId: string;
    binLocation: string;
    images: any[];
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
    weight: string;
    dimensions: { length: string; width: string; height: string };
    binLocation?: string;
    mainImage?: string;
    seoScore?: number;
    seoData?: any;
    merchantCenterScore?: number;
    merchantCenterIssues?: any;
    cogs?: string;
    miscCosts?: any[];
    supplierId?: string;
    images?: any[];
    isGoldPriceApplied?: boolean;
    type?: string;
    variations?: number[];
    rawData?: any;
    categories?: { id: number; name: string; slug: string }[];
    tags?: { id: number; name: string; slug: string }[];
    [key: string]: any;
}

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

/** 24 hours in ms — drafts older than this are discarded */
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
    const [formData, setFormData] = useState<ProductFormData>(initialFormData);
    const [variants, setVariants] = useState<any[]>([]);
    const [suppliers, setSuppliers] = useState<any[]>([]);
    const [productViews, setProductViews] = useState<{ views7d: number; views30d: number } | null>(null);
    const [mainImageFailed, setMainImageFailed] = useState(false);
    /** Whether a draft was restored — drives the "Discard Draft" button visibility */
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

    // --- Draft persistence state ---
    /** Whether any field has changed since the last save — drives beforeunload guard */
    const isDirtyRef = useRef(false);
    const draftTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    /** Tracks whether `fetchProduct` has populated formData at least once */
    const serverLoadedRef = useRef(false);
    /** Skip the first formData change (the one from fetchProduct) for dirty tracking */
    const initialFormSetRef = useRef(false);
    /** Prevents draft restore from firing more than once per product session */
    const draftRestoredRef = useRef(false);

    // Why: reset draft tracking refs when productId changes (user navigates between products)
    useEffect(() => {
        serverLoadedRef.current = false;
        initialFormSetRef.current = false;
        draftRestoredRef.current = false;
        isDirtyRef.current = false;
    }, [productId]);

    // SEO scoring (derived state)
    const seoResult = calculateSeoScore({
        name: formData.name,
        description: (formData.description || '') + (formData.short_description || ''),
        permalink: product?.permalink || '',
        images: formData.images,
        price: formData.price
    }, formData.focusKeyword);

    const showToast = useCallback((message: string, type: 'success' | 'error' | 'info' = 'success') => {
        globalToast.toast(message, type);
    }, [globalToast]);

    const updateFormData = useCallback((updates: Partial<ProductFormData>) => {
        isDirtyRef.current = true;
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
    const fetchProduct = useCallback(async (background = false) => {
        const acct = accountRef.current;
        const tkn = tokenRef.current;
        if (!acct || !tkn || !productId) return;
        if (!background) setIsLoading(true);

        try {
            const data = await ProductService.getProduct(productId, tkn, acct.id);
            Logger.debug('Product data loaded', { productId, wooId: data.wooId });
            setProduct(data);
            setMainImageFailed(false);

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
                    setVariants(data.variations.map((id: number) => ({
                        id, sku: '', price: '', attributes: []
                    })));
                }
            }
        } catch (error) {
            Logger.error('Failed to load product', { error });
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

            if (bomSaveResult === false || variantBomsSaveResult === false || stockSaveResult === false) {
                showToast('Product saved, but some sub-panel saves failed (BOM or stock).', 'error');
            } else {
                showToast('Product saved successfully');
            }

            // Why: clear the draft after a successful save to avoid stale restoration
            if (acct && productId) {
                const key = buildProductDraftKey(acct.id, productId);
                localStorage.removeItem(key);
            }
            isDirtyRef.current = false;
            setHasDraft(false);

            fetchProduct(true);
        } catch (error) {
            Logger.error('An error occurred', { error });
            showToast('Failed to save changes', 'error');
        } finally {
            setIsSaving(false);
        }
    }, [productId, formData, variants, showToast, fetchProduct]);

    // Sync handler
    const handleSync = useCallback(async () => {
        const acct = accountRef.current;
        const tkn = tokenRef.current;
        if (!acct || !productId || !tkn) return;
        setIsSyncing(true);

        try {
            const updated = await ProductService.syncProduct(productId, tkn, acct.id);
            Logger.debug('Product synced', { productId, wooId: updated?.wooId });
            // Why: sync overwrites formData from server, so clear any saved draft
            const key = buildProductDraftKey(acct.id, productId);
            localStorage.removeItem(key);
            isDirtyRef.current = false;
            setHasDraft(false);
            await fetchProduct(true);
            showToast('Product synced successfully from WooCommerce.');
        } catch (error: any) {
            Logger.error('Sync failed:', { error });
            showToast(`Sync failed: ${error.message}`, 'error');
        } finally {
            setIsSyncing(false);
        }
    }, [productId, fetchProduct, showToast]);

    // Effects — depend on stable primitives (currentAccount?.id) not object references
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

        if (draftTimerRef.current) clearTimeout(draftTimerRef.current);
        draftTimerRef.current = setTimeout(() => {
            try {
                const key = buildProductDraftKey(acct.id, productId);
                localStorage.setItem(key, JSON.stringify({
                    formData,
                    savedAt: Date.now(),
                }));
            } catch (err) {
                Logger.error('Failed to persist product draft', { error: err });
            }
        }, SAVE_DEBOUNCE_MS);

        return () => { if (draftTimerRef.current) clearTimeout(draftTimerRef.current); };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [currentAccount?.id, productId, JSON.stringify(formData)]);

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
                showToast('Unsaved changes restored from your last session', 'success');
            }
        } catch {
            localStorage.removeItem(key);
        }
        // Why: only run once after the initial product load, not on every formData change
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [currentAccount?.id, productId, isLoading, product]);

    // --- Beforeunload guard: warn when navigating away with unsaved changes ---
    useEffect(() => {
        const handler = (e: BeforeUnloadEvent) => {
            if (!isDirtyRef.current) return;
            e.preventDefault();
        };
        window.addEventListener('beforeunload', handler);
        return () => window.removeEventListener('beforeunload', handler);
    }, []);

    /** Discard the saved draft and reset form to server state */
    const discardDraft = useCallback(() => {
        const acct = accountRef.current;
        if (!acct || !productId) return;
        const key = buildProductDraftKey(acct.id, productId);
        localStorage.removeItem(key);
        isDirtyRef.current = false;
        setHasDraft(false);
        // Re-fetch server data to reset form
        fetchProduct(false);
    }, [productId, fetchProduct]);

    return {
        // State
        isLoading,
        isSaving,
        isSyncing,
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
        discardDraft,
    };
}
