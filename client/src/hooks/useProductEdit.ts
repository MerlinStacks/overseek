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
import { useProductProduction } from './useProductProduction';

interface ProductFormData {
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
    categories: { id: number; name: string }[];
    tags: { id: number; name: string }[];
}

interface SeoData {
    focusKeyword?: string;
}

export interface ProductVariantData {
    id: number;
    /** Null inherits the parent product supplier. */
    supplierId?: string | null;
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

interface ProductDraft {
    formData: ProductFormData;
    variants: unknown[];
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
    images: [],
    categories: [],
    tags: []
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
    const toastRef = useRef(globalToast.toast);
    toastRef.current = globalToast.toast;
    const scope = `${currentAccount?.id}:${productId}`;
    const scopeRef = useRef({ key: scope });
    if (scopeRef.current.key !== scope) scopeRef.current = { key: scope };
    const savingRef = useRef(false);
    const mountedRef = useRef(true);
    useEffect(() => { mountedRef.current = true; return () => { mountedRef.current = false; }; }, []);
    const normalRevision = useRef(0);

    // Core state
    const [isLoading, setIsLoading] = useState(true);
    const [isSaving, setIsSaving] = useState(false);
    const [isSyncing, setIsSyncing] = useState(false);
    const [product, setProduct] = useState<ProductData | null>(null);
    const loadedProductScope = useRef<typeof scopeRef.current | null>(null);
    const settledLoadScope = useRef<typeof scopeRef.current | null>(null);
    const productRequestSequence = useRef(0);
    const hasLoadedProduct = loadedProductScope.current === scopeRef.current && product !== null;
    // Routes accept Woo IDs as well as local IDs. Production endpoints require the loaded local UUID.
    const production = useProductProduction(loadedProductScope.current === scopeRef.current ? product?.id : undefined);
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
    const [isRefreshingViews, setIsRefreshingViews] = useState(false);
    const viewsRequestSequence = useRef(0);
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
    const variantsRef = useRef(variants);
    variantsRef.current = variants;

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
    const pendingDraftRef = useRef<ProductDraft | null>(null);

    const writeDraftSync = useCallback((acctId: string, pId: string, data: ProductDraft) => {
        try {
            const key = buildProductDraftKey(acctId, pId);
            localStorage.setItem(key, JSON.stringify({ ...data, savedAt: Date.now() }));
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
        setIsRefreshingViews(false);
        setMainImageFailed(false);
        setHasDraft(false);
        setHasUnsavedChanges(false);
        setSaveState('idle');
        setSaveMessage(null);
        setLastSavedAt(null);
        setLastSyncedAt(null);
        setLoadError(null);
        savingRef.current = false;
        setIsSaving(false);
        setIsSyncing(false);
        normalRevision.current = 0;
    }, [productId, currentAccount?.id]);

    // SEO scoring (derived state)
    const seoResult = calculateSeoScore({
        name: formData.name,
        description: (formData.description || '') + (formData.short_description || ''),
        permalink: product?.permalink || '',
        images: formData.images,
        price: formData.price
    }, formData.focusKeyword);
    const formDataSnapshot = useMemo(() => JSON.stringify(formData), [formData]);
    const variantsSnapshot = useMemo(() => JSON.stringify(variants), [variants]);

    const showToast = useCallback((message: string, type: 'success' | 'error' | 'info' = 'success') => {
        globalToast.toast(message, type);
    }, [globalToast]);

    const updateFormData = useCallback((updates: Partial<ProductFormData>) => {
        const next = { ...formDataRef.current, ...updates };
        if (JSON.stringify(next) === JSON.stringify(formDataRef.current)) return;
        formDataRef.current = next;
        normalRevision.current++;
        isDirtyRef.current = true;
        setHasUnsavedChanges(true);
        setSaveState('unsaved');
        setSaveMessage('Unsaved changes');
        setFormData(next);
    }, []);

    // Fetch suppliers
    const fetchSuppliers = useCallback(async () => {
        const requestScope = scopeRef.current;
        const acct = accountRef.current;
        const tkn = tokenRef.current;
        if (!acct || !tkn) return;
        try {
            const data = await InventoryService.getSuppliers(tkn, acct.id);
            if (mountedRef.current && scopeRef.current === requestScope) setSuppliers(data);
        } catch (e) {
            Logger.error('Failed to fetch suppliers', { error: e });
        }
    }, []);

    // Fetch product
    // Why: `skipFormReset` prevents the post-save refetch from clobbering keystrokes
    // the user made during the network round-trip. `product` is still refreshed so
    // server-computed fields (seoScore, etc.) stay current.
    const fetchProduct = useCallback(async (background = false, skipFormReset = false) => {
        const requestScope = scopeRef.current;
        const acct = accountRef.current;
        const tkn = tokenRef.current;
        if (!acct || !tkn || !productId) return;
        if (scopeRef.current.key !== `${acct.id}:${productId}`) return;
        const sequence = ++productRequestSequence.current;
        const revision = normalRevision.current;
        const active = () => mountedRef.current && scopeRef.current === requestScope && productRequestSequence.current === sequence;
        if (!background) setIsLoading(true);
        if (!background) setLoadError(null);

        try {
            const data = await ProductService.getProduct(productId, tkn, acct.id) as ProductData;
            if (!active()) return;
            Logger.debug('Product data loaded', { productId, wooId: data.wooId });
            loadedProductScope.current = requestScope;
            setProduct(data);
            setMainImageFailed(false);
            const loadedUpdatedAt = data.updatedAt;
            if (loadedUpdatedAt) {
                setLastSyncedAt(prev => prev ?? new Date(loadedUpdatedAt));
            }

            // Refresh Woo-confirmed terms (including its default category) without
            // overwriting edits made while the save/refetch was in flight.
            if (skipFormReset && !isDirtyRef.current && normalRevision.current === revision) {
                setFormData(prev => ({ ...prev, categories: data.categories || [], tags: data.tags || [] }));
            }
            if (skipFormReset || savingRef.current || isDirtyRef.current || normalRevision.current !== revision) return;

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
                images: data.images || [],
                categories: data.categories || [],
                tags: data.tags || []
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
            if (!active()) return;
            Logger.error('Failed to load product', { error });
            if (!background) {
                setLoadError(error instanceof Error ? error.message : 'Failed to load product');
            }
        } finally {
            if (active()) {
                settledLoadScope.current = requestScope;
                setIsLoading(false);
                serverLoadedRef.current = true;
            }
        }
    }, [productId]);

    // Fetch product views
    const fetchViews = useCallback(async (notify = false) => {
        const requestScope = scopeRef.current;
        const acct = accountRef.current;
        const tkn = tokenRef.current;
        if (!acct || !productId || !tkn) return;
        if (scopeRef.current.key !== `${acct.id}:${productId}`) return;
        const sequence = ++viewsRequestSequence.current;
        const active = () => mountedRef.current && scopeRef.current === requestScope && viewsRequestSequence.current === sequence;
        setIsRefreshingViews(true);
        try {
            const res = await fetch(`/api/analytics/product-views/${productId}`, {
                headers: {
                    Authorization: `Bearer ${tkn}`,
                    'x-account-id': acct.id
                }
            });
            if (!res.ok) throw new Error(`Product views request failed (${res.status})`);
            const views = await res.json();
            if (!active()) return;
            setProductViews(views);
            if (notify) toastRef.current(`Product views refreshed: ${views.views7d} in 7 days, ${views.views30d} in 30 days.`, 'success');
        } catch (e) {
            Logger.error('Failed to fetch product views', { error: e });
            if (active() && notify) toastRef.current('Could not refresh product views. Please try again.', 'error');
        } finally {
            if (active()) setIsRefreshingViews(false);
        }
    }, [productId]);

    // Save handler
    const handleSave = useCallback(async (participants: Array<{ name: string; save: () => Promise<boolean | void> }> = []) => {
        const acct = accountRef.current;
        const tkn = tokenRef.current;
        if (!acct || !productId || !tkn || savingRef.current || isSyncing) return false;
        if (scopeRef.current.key !== scope || !hasLoadedProduct || loadedProductScope.current !== scopeRef.current) return false;
        const issue = production.validate();
        if (issue) {
            setSaveState('error'); setSaveMessage(issue); showToast(issue, 'error'); return false;
        }
        const requestScope = scopeRef.current;
        const active = () => mountedRef.current && scopeRef.current === requestScope;
        const revision = normalRevision.current;
        const formData = formDataRef.current;
        const variants = variantsRef.current;
        const productionDirty = production.isDirty();
        const writeNormal = isDirtyRef.current || !productionDirty;
        const saveProduction = production.captureSave();
        let completed = false;
        savingRef.current = true;
        setIsSaving(true);
        setSaveState('saving');
        setSaveMessage('Saving changes...');

        try {
            if (writeNormal) await ProductService.updateProduct(productId, {
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
                // Omit unchanged assignments so unrelated saves cannot overwrite
                // taxonomy edits made in WooCommerce since this page was opened.
                ...Object.fromEntries((['categories', 'tags'] as const)
                    .filter(key => JSON.stringify(formData[key].map(term => term.id).sort((a, b) => a - b)) !==
                        JSON.stringify((product?.[key] || []).map(term => term.id).sort((a, b) => a - b)))
                    .map(key => [key, formData[key].map(({ id }) => ({ id }))])),
                variations: variants,
                focusKeyword: formData.focusKeyword
            }, tkn, acct.id);
            if (!active()) return false;
            completed = writeNormal;
            await saveProduction();
            if (!active()) return false;
            completed = completed || productionDirty;
            const failedPanels: string[] = [];
            const stages = [
                { name: 'BOM', save: () => bomPanelRef.current?.save() },
                { name: 'variation BOMs', save: () => variationsPanelRef.current?.saveAllBOMs() },
                { name: 'stock', save: () => stockPanelRef.current?.save() },
                ...participants,
            ];
            for (const stage of stages) {
                if (!active()) return false;
                const result = await stage.save();
                if (!active()) return false;
                if (result === false) { failedPanels.push(stage.name); break; }
                completed = true;
            }

            if (failedPanels.length > 0) {
                showToast('Some changes saved, but the save is incomplete.', 'error');
                setSaveState('partial');
                setSaveMessage(`Some changes saved; ${failedPanels.join(', ')} failed. Remaining changes still need saving.`);
                isDirtyRef.current = true;
                setHasUnsavedChanges(true);
                return false;
            } else {
                showToast('Product saved successfully');
                setSaveState('saved');
                setSaveMessage('Saved successfully');
            }

            // Why: clear the draft after a successful save to avoid stale restoration
            const editedInFlight = normalRevision.current !== revision;
            if (!editedInFlight) {
                const key = buildProductDraftKey(acct.id, productId);
                localStorage.removeItem(key);
                if (draftTimerRef.current) clearTimeout(draftTimerRef.current);
                pendingDraftRef.current = null;
            }
            isDirtyRef.current = editedInFlight;
            setHasDraft(editedInFlight);
            setHasUnsavedChanges(editedInFlight);
            if (editedInFlight || production.isDirty()) { setSaveState('unsaved'); setSaveMessage('Submitted changes saved; newer edits remain unsaved.'); }
            setLastSavedAt(new Date());
            emitProductChange({
                type: 'updated',
                productId,
                accountId: acct.id,
            });

            await Promise.all([
                fetchProduct(true, true),
                fetchViews()
            ]);
            return true;
        } catch (error) {
            if (!active()) return false;
            Logger.error('An error occurred', { error });
            setSaveState(completed ? 'partial' : 'error');
            isDirtyRef.current = isDirtyRef.current || writeNormal;
            setHasUnsavedChanges(true);
            setSaveMessage(error instanceof Error ? error.message : 'Failed to save changes');
            showToast('Failed to save changes', 'error');
            return false;
        } finally {
            if (active()) { savingRef.current = false; setIsSaving(false); }
        }
    }, [productId, showToast, fetchProduct, fetchViews, production, scope, isSyncing, hasLoadedProduct, product]);

    // Sync handler
    const handleSync = useCallback(async () => {
        if (savingRef.current || scopeRef.current.key !== scope || !hasLoadedProduct || loadedProductScope.current !== scopeRef.current) return;
        const requestScope = scopeRef.current;
        const active = () => mountedRef.current && scopeRef.current === requestScope;
        const acct = accountRef.current;
        const tkn = tokenRef.current;
        if (!acct || !productId || !tkn) return;
        setIsSyncing(true);
        setSaveMessage('Syncing from WooCommerce...');

        try {
            const updated = await ProductService.syncProduct(productId, tkn, acct.id) as { wooId?: number };
            if (!active()) return;
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
            if (!active()) return;
            production.refresh();
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
            if (!active()) return;
            Logger.error('Sync failed:', { error });
            const message = error instanceof Error ? error.message : 'Unknown error';
            setSaveState('error');
            setSaveMessage(`Sync failed: ${message}`);
            showToast(`Sync failed: ${message}`, 'error');
        } finally {
            if (active()) setIsSyncing(false);
        }
    }, [productId, fetchProduct, fetchViews, showToast, production, scope, hasLoadedProduct]);

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
        if (!isDirtyRef.current) return;

        // Why: track pending data so flush-on-unmount/unload can write it
        // synchronously if the timer hasn't fired yet.
        pendingDraftRef.current = { formData: formDataRef.current, variants: variantsRef.current };

        if (draftTimerRef.current) clearTimeout(draftTimerRef.current);
        draftTimerRef.current = setTimeout(() => {
            writeDraftSync(acct.id, productId, { formData: formDataRef.current, variants: variantsRef.current });
            pendingDraftRef.current = null;
        }, SAVE_DEBOUNCE_MS);

        return () => { if (draftTimerRef.current) clearTimeout(draftTimerRef.current); };
    }, [currentAccount?.id, productId, formDataSnapshot, variantsSnapshot, writeDraftSync]);

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
        if (!acct || !productId || !product || isLoading || !serverLoadedRef.current) return;
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
            const variantsChanged = Array.isArray(draft.variants) && JSON.stringify(draft.variants) !== JSON.stringify(variantsRef.current);
            const restoredForm = { ...formData, ...draft.formData };
            if (JSON.stringify(restoredForm) !== JSON.stringify(formData) || variantsChanged) {
                setFormData(restoredForm);
                if (Array.isArray(draft.variants)) setVariants(draft.variants);
                normalRevision.current++;
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
        if (savingRef.current) return;
        production.discard();
        const acct = accountRef.current;
        if (!acct || !productId) return;
        const key = buildProductDraftKey(acct.id, productId);
        try { localStorage.removeItem(key); } catch { /* Storage failures must not block discarding in-memory edits. */ }
        isDirtyRef.current = false;
        setHasDraft(false);
        setHasUnsavedChanges(false);
        setSaveState('idle');
        setSaveMessage(null);
        pendingDraftRef.current = null;
        if (draftTimerRef.current) clearTimeout(draftTimerRef.current);
        // Re-fetch server data to reset form
        fetchProduct(false);
    }, [productId, fetchProduct, production]);

    return {
        // State
        isLoading: isLoading || (!hasLoadedProduct && settledLoadScope.current !== scopeRef.current),
        isSaving,
        isSyncing,
        loadError: settledLoadScope.current === scopeRef.current ? loadError : null,
        hasUnsavedChanges: hasUnsavedChanges || production.dirty,
        production,
        saveState: production.dirty && (saveState === 'idle' || saveState === 'saved') ? 'unsaved' as const : saveState,
        saveMessage: production.dirty && (saveState === 'idle' || saveState === 'saved') ? 'Unsaved production changes' : saveMessage,
        lastSavedAt,
        lastSyncedAt,
        product: hasLoadedProduct ? product : null,
        formData,
        variants,
        suppliers,
        productViews,
        isRefreshingViews,
        mainImageFailed,
        hasDraft: hasDraft || production.dirty,
        seoResult,
        activeUsers,
        currentAccount,

        // Refs
        bomPanelRef,
        variationsPanelRef,
        stockPanelRef,

        // Actions
        updateFormData,
        setVariants: (next: unknown[]) => {
            if (JSON.stringify(next) === JSON.stringify(variantsRef.current)) return;
            variantsRef.current = next;
            normalRevision.current++;
            isDirtyRef.current = true;
            setHasUnsavedChanges(true);
            setSaveState('unsaved');
            setVariants(next);
        },
        setMainImageFailed,
        handleSave,
        handleSync,
        fetchProduct,
        fetchViews,
        discardDraft,
    };
}
