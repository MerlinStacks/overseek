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
import { ToastType } from '../components/ui/Toast';
import type { BOMPanelRef } from '../components/products/BOMPanel';
import type { VariationsPanelRef } from '../components/products/VariationsPanel';

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

export function useProductEdit(productId: string | undefined) {
    const { token } = useAuth();
    const { currentAccount } = useAccount();
    const { activeUsers } = useCollaboration(productId || '');

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

    // Toast state
    const [toast, setToast] = useState<{ isVisible: boolean; message: string; type: ToastType }>({
        isVisible: false,
        message: '',
        type: 'success'
    });

    // Refs for child panels
    const bomPanelRef = useRef<BOMPanelRef>(null);
    const variationsPanelRef = useRef<VariationsPanelRef>(null);

    // SEO scoring (derived state)
    const seoResult = calculateSeoScore({
        name: formData.name,
        description: (formData.description || '') + (formData.short_description || ''),
        permalink: product?.permalink || '',
        images: formData.images,
        price: formData.price
    }, formData.focusKeyword);

    const showToast = useCallback((message: string, type: ToastType = 'success') => {
        setToast({ isVisible: true, message, type });
    }, []);

    const hideToast = useCallback(() => {
        setToast(prev => ({ ...prev, isVisible: false }));
    }, []);

    const updateFormData = useCallback((updates: Partial<ProductFormData>) => {
        setFormData(prev => ({ ...prev, ...updates }));
    }, []);

    // Fetch suppliers
    const fetchSuppliers = useCallback(async () => {
        if (!currentAccount || !token) return;
        try {
            const data = await InventoryService.getSuppliers(token, currentAccount.id);
            setSuppliers(data);
        } catch (e) {
            Logger.error('Failed to fetch suppliers', { error: e });
        }
    }, [currentAccount, token]);

    // Fetch product
    const fetchProduct = useCallback(async (background = false) => {
        if (!currentAccount || !token || !productId) return;
        if (!background) setIsLoading(true);

        try {
            const data = await ProductService.getProduct(productId, token, currentAccount.id);
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
        }
    }, [currentAccount, token, productId]);

    // Fetch product views
    const fetchViews = useCallback(async () => {
        if (!currentAccount || !productId || !token) return;
        try {
            const res = await fetch(`/api/analytics/product-views/${productId}`, {
                headers: {
                    Authorization: `Bearer ${token}`,
                    'x-account-id': currentAccount.id
                }
            });
            if (res.ok) setProductViews(await res.json());
        } catch (e) {
            Logger.error('Failed to fetch product views', { error: e });
        }
    }, [currentAccount, productId, token]);

    // Save handler
    const handleSave = useCallback(async () => {
        if (!currentAccount || !productId || !token) return;
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
            }, token, currentAccount.id);

            const bomSaveResult = await bomPanelRef.current?.save();
            const variantBomsSaveResult = await variationsPanelRef.current?.saveAllBOMs();

            if (bomSaveResult === false || variantBomsSaveResult === false) {
                showToast('Product saved, but some BOM configurations failed to save.', 'error');
            } else {
                showToast('Product saved successfully');
            }

            fetchProduct(true);
        } catch (error) {
            Logger.error('An error occurred', { error });
            showToast('Failed to save changes', 'error');
        } finally {
            setIsSaving(false);
        }
    }, [currentAccount, productId, token, formData, variants, showToast, fetchProduct]);

    // Sync handler
    const handleSync = useCallback(async () => {
        if (!currentAccount || !productId || !token) return;
        setIsSyncing(true);

        try {
            const updated = await ProductService.syncProduct(productId, token, currentAccount.id);
            Logger.debug('Product synced', { productId, wooId: updated?.wooId });
            await fetchProduct(true);
            showToast('Product synced successfully from WooCommerce.');
        } catch (error: any) {
            Logger.error('Sync failed:', { error });
            showToast(`Sync failed: ${error.message}`, 'error');
        } finally {
            setIsSyncing(false);
        }
    }, [currentAccount, productId, token, fetchProduct, showToast]);

    // Effects
    useEffect(() => {
        if (currentAccount) fetchSuppliers();
    }, [currentAccount, fetchSuppliers]);

    useEffect(() => {
        if (currentAccount && productId) fetchProduct();
    }, [currentAccount, productId, fetchProduct]);

    useEffect(() => {
        if (currentAccount && productId && token) fetchViews();
    }, [currentAccount, productId, token, fetchViews]);

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
        toast,
        seoResult,
        activeUsers,
        currentAccount,

        // Refs
        bomPanelRef,
        variationsPanelRef,

        // Actions
        updateFormData,
        setVariants,
        setMainImageFailed,
        showToast,
        hideToast,
        handleSave,
        handleSync,
        fetchProduct
    };
}
