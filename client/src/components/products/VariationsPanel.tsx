import React, { useState, useEffect, useRef, useImperativeHandle, forwardRef, useCallback } from 'react';
import { Layers, ChevronDown, ChevronRight, Package, DollarSign, Loader2, TrendingUp } from 'lucide-react';
import { BOMPanel, BOMPanelRef } from './BOMPanel';
import { useAccountFeature } from '../../hooks/useAccountFeature';
import { useAuth } from '../../context/AuthContext';
import { useAccount } from '../../context/AccountContext';
import { usePermissions } from '../../hooks/usePermissions';
import { Logger } from '../../utils/logger';
import { calculateTotalBomCost } from '../../utils/bomUtils';

interface ProductVariant {
    id: number;
    sku: string;
    price: string;
    salePrice?: string;
    cogs?: string;
    binLocation?: string;
    stockStatus?: string;
    stockQuantity?: number;
    manageStock?: boolean;
    backorders?: 'no' | 'notify' | 'yes';
    weight?: string;
    dimensions?: {
        length?: string;
        width?: string;
        height?: string;
    };
    image?: { src: string } | null; // Single image for variation
    images?: any[];
    attributes: any[];
    // Gold Price fields
    isGoldPriceApplied?: boolean;
    goldPriceType?: string | null;
}

interface VariationsPanelProps {
    product: {
        id: string;
        type?: string;
        variations?: number[];
        wooId: number;
    };
    variants: ProductVariant[];
    onUpdate?: (updatedVariants: ProductVariant[]) => void;
}

/**
 * Exposes saveAllBOMs method so parent can save all variant BOMs on product save.
 */
export interface VariationsPanelRef {
    saveAllBOMs: () => Promise<boolean>;
}

/**
 * Variations panel with inline editing for SKU, price, and stock.
 * Shows variation image thumbnails and expanded details with BOM configuration.
 */
export const VariationsPanel = forwardRef<VariationsPanelRef, VariationsPanelProps>(function VariationsPanel({ product, variants, onUpdate }, ref) {
    const { token } = useAuth();
    const { currentAccount } = useAccount();
    const [expandedId, setExpandedId] = useState<number | null>(null);
    const [editingVariants, setEditingVariants] = useState<ProductVariant[]>(variants);
    const isGoldPriceEnabled = useAccountFeature('GOLD_PRICE_CALCULATOR');
    const { hasPermission } = usePermissions();
    const canViewCogs = hasPermission('view_cogs');

    // Stock editing state: track edited values and saving status per variant
    const [stockEditValues, setStockEditValues] = useState<Record<number, string>>({});
    const [savingStockId, setSavingStockId] = useState<number | null>(null);

    // Store refs for all BOMPanels to enable batch save
    const bomPanelRefs = useRef<Map<number, BOMPanelRef | null>>(new Map());

    // Track variant IDs for stable dependency in BOM fetch effect
    // This prevents refetching when variants array reference changes but IDs are the same
    const variantIdsRef = useRef<string>('');

    // Track BOM COGS for each variant (keyed by variant ID)
    // When a variant has BOM components, this stores the calculated total cost
    const [bomCogsMap, setBomCogsMap] = useState<Record<number, number | null>>({});
    const [bomCogsLoading, setBomCogsLoading] = useState(true);

    /**
     * Calculate gold price COGS for a variant.
     * Returns null if gold pricing is not applicable or not configured.
     */
    const calculateGoldCogs = useCallback((variant: ProductVariant): number | null => {
        if (!variant.isGoldPriceApplied || !variant.goldPriceType || !currentAccount) {
            return null;
        }
        const weight = parseFloat(variant.weight || '') || 0;
        if (weight <= 0) return null;

        const goldPriceMap: Record<string, number | undefined> = {
            '18ct': currentAccount.goldPrice18ct,
            '9ct': currentAccount.goldPrice9ct,
            '18ctWhite': currentAccount.goldPrice18ctWhite,
            '9ctWhite': currentAccount.goldPrice9ctWhite,
            'legacy': currentAccount.goldPrice
        };
        const goldPricePerGram = Number(goldPriceMap[variant.goldPriceType]) || 0;
        if (goldPricePerGram <= 0) return null;

        return weight * goldPricePerGram;
    }, [currentAccount]);

    /**
     * Save all variant BOMs. Called by parent when saving the product.
     */
    const saveAllBOMs = async (): Promise<boolean> => {
        const refs = Array.from(bomPanelRefs.current.values()).filter(ref => ref !== null);
        if (refs.length === 0) return true;

        const results = await Promise.all(refs.map(ref => ref!.save()));
        return results.every(success => success);
    };

    // Expose saveAllBOMs to parent via ref
    useImperativeHandle(ref, () => ({
        saveAllBOMs
    }), []);

    // Track the variants we received from props to detect user edits vs prop syncs
    const lastSyncedVariantsRef = useRef<ProductVariant[]>(variants);

    useEffect(() => {
        setEditingVariants(variants);
        // Initialize stock edit values from variants
        const stockValues: Record<number, string> = {};
        variants.forEach(v => {
            stockValues[v.id] = v.stockQuantity?.toString() ?? '';
        });
        setStockEditValues(stockValues);
        // Update the ref to track what we synced from props
        lastSyncedVariantsRef.current = variants;
    }, [variants]);

    /**
     * Fetches BOM COGS for all variants on mount.
     * This allows displaying the BOM-calculated cost even before expanding a variant.
     * Uses variantIdsRef to prevent refetching when variants array reference changes
     * but the actual variant IDs remain the same.
     */
    useEffect(() => {
        if (!token || !currentAccount || !canViewCogs || variants.length === 0) {
            setBomCogsLoading(false);
            return;
        }

        // Create a stable string key from variant IDs to detect actual changes
        const currentVariantIds = variants.map(v => v.id).sort().join(',');
        if (currentVariantIds === variantIdsRef.current) {
            // Variant IDs haven't changed, skip refetch
            return;
        }
        variantIdsRef.current = currentVariantIds;

        const fetchAllBomCogs = async () => {
            setBomCogsLoading(true);
            const newBomCogsMap: Record<number, number | null> = {};

            await Promise.all(variants.map(async (v) => {
                try {
                    const res = await fetch(`/api/inventory/products/${product.id}/bom?variationId=${v.id}`, {
                        headers: {
                            'Authorization': `Bearer ${token}`,
                            'x-account-id': currentAccount.id
                        }
                    });

                    if (res.ok) {
                        const data = await res.json();
                        if (data.items && data.items.length > 0) {
                            // Use shared utility for BOM cost calculation
                            const totalCost = calculateTotalBomCost(data.items);
                            newBomCogsMap[v.id] = totalCost;
                        } else {
                            newBomCogsMap[v.id] = null;
                        }
                    }
                } catch (err) {
                    Logger.error('Failed to fetch BOM for variant', { variantId: v.id, error: err });
                    newBomCogsMap[v.id] = null;
                }
            }));

            setBomCogsMap(newBomCogsMap);
            setBomCogsLoading(false);
        };

        fetchAllBomCogs();
    }, [token, currentAccount, product.id, variants, canViewCogs]);

    /**
     * Handle field change for a variant. Wrapped in useCallback for stable reference.
     */
    const handleFieldChange = useCallback((id: number, field: keyof ProductVariant, value: any) => {
        setEditingVariants(prev => prev.map(v =>
            v.id === id ? { ...v, [field]: value } : v
        ));
    }, []);

    // Sync changes with parent when editingVariants changes due to USER edits.
    // Skip when editingVariants exactly matches what we synced from props (prevents initial mount callback).
    useEffect(() => {
        // Only call onUpdate if this is a user edit, not a prop sync
        if (editingVariants !== lastSyncedVariantsRef.current && onUpdate) {
            onUpdate(editingVariants);
        }
    }, [editingVariants, onUpdate]);

    /**
     * Callback for BOMPanel to update BOM COGS when components change.
     * Note: We only update bomCogsMap, not the variant's cogs field.
     * This prevents a render loop since editingVariants changes trigger onUpdate.
     * The BOM COGS is used directly from bomCogsMap in profit margin calculations.
     */
    const handleBomCogsUpdate = useCallback((variantId: number, cogs: number) => {
        setBomCogsMap(prev => ({ ...prev, [variantId]: cogs }));
    }, []);

    // Support ATUM's custom variable types (e.g., 'variable-product-part') and any product with variations
    const hasVariations = product.type?.includes('variable') || (product.variations && product.variations.length > 0);
    if (!hasVariations) return null;

    /**
     * Toggle variant expansion. Auto-saves the current variant's BOM before switching
     * to prevent data loss when the BOMPanel unmounts.
     */
    const toggleExpand = async (id: number) => {
        // If we're switching away from a currently expanded row, auto-save its BOM first
        if (expandedId !== null && expandedId !== id) {
            const currentRef = bomPanelRefs.current.get(expandedId);
            if (currentRef) {
                await currentRef.save();
            }
        }
        // If collapsing the same row, save it too
        if (expandedId === id) {
            const currentRef = bomPanelRefs.current.get(id);
            if (currentRef) {
                await currentRef.save();
            }
        }
        setExpandedId(expandedId === id ? null : id);
    };

    // Update multiple fields at once to avoid stale state issues
    // Note: We don't call onUpdate here because the useEffect at line 174+ handles it
    const handleMultiFieldChange = (id: number, updates: Partial<ProductVariant>) => {
        setEditingVariants(prev => prev.map(v =>
            v.id === id ? { ...v, ...updates } : v
        ));
    };

    // Get variation image from either image object or images array
    const getVariantImage = (v: ProductVariant): string | null => {
        if (v.image?.src) return v.image.src;
        if (v.images && v.images.length > 0) {
            return v.images[0]?.src || v.images[0];
        }
        return null;
    };

    /**
     * Adjust stock quantity by delta (+1 or -1)
     */
    const handleStockAdjust = (variantId: number, delta: number) => {
        const current = parseInt(stockEditValues[variantId] ?? '0', 10) || 0;
        const newValue = Math.max(0, current + delta);
        setStockEditValues(prev => ({ ...prev, [variantId]: newValue.toString() }));
    };

    /**
     * Save stock for a specific variant to the API
     */
    const handleStockSave = async (variantId: number) => {
        if (!token || !currentAccount) return;

        const newStock = parseInt(stockEditValues[variantId] ?? '', 10);
        if (isNaN(newStock) || newStock < 0) return;

        setSavingStockId(variantId);

        try {
            const res = await fetch(`/api/products/${product.wooId}/variants/${variantId}/stock`, {
                method: 'PUT',
                headers: {
                    'Authorization': `Bearer ${token}`,
                    'X-Account-ID': currentAccount.id,
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({ stockQuantity: newStock })
            });

            if (res.ok) {
                // Update local variant state
                const updated = editingVariants.map(v =>
                    v.id === variantId ? { ...v, stockQuantity: newStock } : v
                );
                setEditingVariants(updated);
                if (onUpdate) onUpdate(updated);
            } else {
                const data = await res.json();
                Logger.error('Failed to save variant stock', { error: data.error, variantId });
            }
        } catch (err) {
            Logger.error('Failed to save variant stock', { error: err, variantId });
        } finally {
            setSavingStockId(null);
        }
    };

    return (
        <div className="bg-white/70 backdrop-blur-md rounded-xl shadow-xs border border-white/50 overflow-hidden animate-in fade-in slide-in-from-bottom-4 duration-500">
            <div className="px-6 py-4 border-b border-gray-100/50 bg-white/30 flex justify-between items-center">
                <div className="flex items-center gap-2">
                    <Layers size={16} className="text-blue-600" />
                    <h3 className="font-bold text-gray-900 uppercase tracking-wide text-sm">Variations</h3>
                    <span className="bg-blue-100 text-blue-700 px-2 py-0.5 rounded-full text-xs font-medium">{product.variations?.length || 0}</span>
                </div>
            </div>
            <div className="p-0 overflow-x-auto">
                <table className="w-full text-left text-sm min-w-[850px]">
                    <thead className="bg-gray-50/50 text-gray-500 font-medium border-b border-gray-100/50">
                        <tr>
                            <th className="w-8"></th>
                            <th className="w-16 px-2 py-3">Image</th>
                            <th className="px-4 py-3">Attributes</th>
                            <th className="px-4 py-3">SKU</th>
                            <th className="px-4 py-3 w-28">Price</th>
                            <th className="px-4 py-3 w-28">Sale Price</th>
                            <th className="px-4 py-3 w-20">Weight</th>
                            <th className="px-4 py-3 w-32">Dimensions</th>
                            <th className="px-4 py-3 w-32">Stock</th>
                        </tr>
                    </thead>

                    <tbody className="divide-y divide-gray-100/50">
                        {editingVariants.length === 0 ? (
                            <tr><td colSpan={9} className="px-6 py-12 text-center text-gray-400">
                                No variations loaded. Click <strong>Sync</strong> to fetch from WooCommerce.
                            </td></tr>
                        ) : (
                            editingVariants.map(v => (
                                <React.Fragment key={v.id}>
                                    <tr className={`hover:bg-blue-50/30 transition-colors group ${expandedId === v.id ? 'bg-blue-50/20' : ''}`}>
                                        <td
                                            className="pl-4 text-gray-400 cursor-pointer"
                                            onClick={() => toggleExpand(v.id)}
                                        >
                                            {expandedId === v.id ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
                                        </td>
                                        <td className="px-2 py-2">
                                            {getVariantImage(v) ? (
                                                <img
                                                    src={getVariantImage(v)!}
                                                    alt=""
                                                    className="w-12 h-12 object-cover rounded-lg border border-gray-100"
                                                    loading="lazy"
                                                />
                                            ) : (
                                                <div className="w-12 h-12 bg-gray-100 rounded-lg flex items-center justify-center text-gray-400">
                                                    <Package size={16} />
                                                </div>
                                            )}
                                        </td>
                                        <td className="px-4 py-2">
                                            <div className="flex flex-wrap gap-1">
                                                {v.attributes && v.attributes.length > 0 ? (
                                                    v.attributes.map((attr: any, idx: number) => (
                                                        <span key={idx} className="inline-flex items-center px-2 py-0.5 rounded-full text-xs bg-gray-100 text-gray-700">
                                                            <span className="font-medium text-gray-500">{attr.name}:</span>
                                                            <span className="ml-1">{attr.option}</span>
                                                        </span>
                                                    ))
                                                ) : (
                                                    <span className="text-xs text-gray-400 font-mono">#{v.id}</span>
                                                )}
                                            </div>
                                        </td>

                                        <td className="px-4 py-2">
                                            <input
                                                type="text"
                                                value={v.sku || ''}
                                                onChange={(e) => handleFieldChange(v.id, 'sku', e.target.value)}
                                                className="w-full font-mono text-sm px-2 py-1.5 border border-gray-200 rounded-lg focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 outline-none transition-all"
                                                placeholder="SKU"
                                                onClick={(e) => e.stopPropagation()}
                                            />
                                        </td>
                                        <td className="px-4 py-2">
                                            <div className="relative">
                                                <span className="absolute left-2 top-1/2 -translate-y-1/2 text-gray-400 text-sm">$</span>
                                                <input
                                                    type="number"
                                                    step="0.01"
                                                    value={v.price || ''}
                                                    onChange={(e) => handleFieldChange(v.id, 'price', e.target.value)}
                                                    className="w-full text-sm pl-5 pr-2 py-1.5 border border-gray-200 rounded-lg focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 outline-none transition-all"
                                                    placeholder="0.00"
                                                    onClick={(e) => e.stopPropagation()}
                                                />
                                            </div>
                                        </td>
                                        <td className="px-4 py-2">
                                            <div className="relative">
                                                <span className="absolute left-2 top-1/2 -translate-y-1/2 text-gray-400 text-sm">$</span>
                                                <input
                                                    type="number"
                                                    step="0.01"
                                                    value={v.salePrice || ''}
                                                    onChange={(e) => handleFieldChange(v.id, 'salePrice', e.target.value)}
                                                    className="w-full text-sm pl-5 pr-2 py-1.5 border border-gray-200 rounded-lg focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 outline-none transition-all"
                                                    placeholder="—"
                                                    onClick={(e) => e.stopPropagation()}
                                                />
                                            </div>
                                        </td>
                                        <td className="px-4 py-2">
                                            <input
                                                type="number"
                                                step="0.01"
                                                min="0"
                                                value={v.weight || ''}
                                                onChange={(e) => handleFieldChange(v.id, 'weight', e.target.value)}
                                                className="w-full font-mono text-sm px-2 py-1.5 border border-gray-200 rounded-lg focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 outline-none transition-all"
                                                placeholder="0.00"
                                                onClick={(e) => e.stopPropagation()}
                                            />
                                        </td>
                                        <td className="px-4 py-2">
                                            <div className="flex items-center gap-0.5" onClick={(e) => e.stopPropagation()}>
                                                <input
                                                    type="number"
                                                    step="0.01"
                                                    min="0"
                                                    value={v.dimensions?.length || ''}
                                                    onChange={(e) => handleFieldChange(v.id, 'dimensions', { ...v.dimensions, length: e.target.value })}
                                                    className="w-12 font-mono text-xs px-1 py-1 border border-gray-200 rounded focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 outline-none"
                                                    placeholder="L"
                                                    title="Length"
                                                />
                                                <span className="text-gray-400 text-xs">×</span>
                                                <input
                                                    type="number"
                                                    step="0.01"
                                                    min="0"
                                                    value={v.dimensions?.width || ''}
                                                    onChange={(e) => handleFieldChange(v.id, 'dimensions', { ...v.dimensions, width: e.target.value })}
                                                    className="w-12 font-mono text-xs px-1 py-1 border border-gray-200 rounded focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 outline-none"
                                                    placeholder="W"
                                                    title="Width"
                                                />
                                                <span className="text-gray-400 text-xs">×</span>
                                                <input
                                                    type="number"
                                                    step="0.01"
                                                    min="0"
                                                    value={v.dimensions?.height || ''}
                                                    onChange={(e) => handleFieldChange(v.id, 'dimensions', { ...v.dimensions, height: e.target.value })}
                                                    className="w-12 font-mono text-xs px-1 py-1 border border-gray-200 rounded focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 outline-none"
                                                    placeholder="H"
                                                    title="Height"
                                                />
                                            </div>
                                        </td>
                                        <td className="px-4 py-2">
                                            {v.manageStock ? (
                                                <div className="flex items-center gap-1" onClick={(e) => e.stopPropagation()}>
                                                    <button
                                                        type="button"
                                                        onClick={() => handleStockAdjust(v.id, -1)}
                                                        className="w-6 h-6 flex items-center justify-center bg-gray-100 border border-gray-200 rounded text-gray-600 hover:bg-gray-200 transition-colors text-xs font-bold"
                                                    >
                                                        −
                                                    </button>
                                                    <input
                                                        type="number"
                                                        min="0"
                                                        value={stockEditValues[v.id] ?? ''}
                                                        onChange={(e) => setStockEditValues(prev => ({ ...prev, [v.id]: e.target.value }))}
                                                        className="w-14 px-1 py-1 text-center font-mono text-sm bg-white border border-gray-200 rounded focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 outline-none"
                                                    />
                                                    <button
                                                        type="button"
                                                        onClick={() => handleStockAdjust(v.id, 1)}
                                                        className="w-6 h-6 flex items-center justify-center bg-gray-100 border border-gray-200 rounded text-gray-600 hover:bg-gray-200 transition-colors text-xs font-bold"
                                                    >
                                                        +
                                                    </button>
                                                    <button
                                                        type="button"
                                                        onClick={() => handleStockSave(v.id)}
                                                        disabled={savingStockId === v.id || stockEditValues[v.id] === (v.stockQuantity?.toString() ?? '')}
                                                        className="ml-1 px-2 py-1 bg-blue-600 text-white text-xs font-medium rounded hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                                                    >
                                                        {savingStockId === v.id ? <Loader2 className="animate-spin" size={12} /> : 'Save'}
                                                    </button>
                                                </div>
                                            ) : (
                                                <span className="text-xs text-gray-400 italic">Not tracked</span>
                                            )}
                                        </td>
                                    </tr>
                                    {expandedId === v.id && (
                                        <tr className="bg-gray-50/30">
                                            <td colSpan={9} className="p-4 border-t border-gray-100/50">
                                                <div className="ml-8 space-y-4">
                                                    {/* Inventory Tracking Toggle */}
                                                    <div className="flex items-center justify-between py-2 px-3 bg-gray-50/80 rounded-lg border border-gray-100">
                                                        <div>
                                                            <span className="text-xs font-medium text-gray-700">Enable Inventory Tracking</span>
                                                            <p className="text-[10px] text-gray-500">Track stock for this variant</p>
                                                        </div>
                                                        <button
                                                            type="button"
                                                            onClick={() => handleFieldChange(v.id, 'manageStock', !v.manageStock)}
                                                            className={`px-2 py-1 rounded-full text-xs font-medium transition-colors ${v.manageStock
                                                                ? 'bg-blue-100 text-blue-700 border border-blue-200'
                                                                : 'bg-gray-100 text-gray-500 border border-gray-200'
                                                                }`}
                                                        >
                                                            {v.manageStock ? 'Enabled' : 'Disabled'}
                                                        </button>
                                                    </div>

                                                    {/* Stock controls - only shown when manageStock is enabled */}
                                                    {v.manageStock && (
                                                        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                                                            <div>
                                                                <label className="block text-xs font-medium text-gray-500 mb-1">Stock Status</label>
                                                                <select
                                                                    value={v.stockStatus || 'instock'}
                                                                    onChange={(e) => handleFieldChange(v.id, 'stockStatus', e.target.value)}
                                                                    className="w-full text-sm px-3 py-1.5 border border-gray-200 rounded-lg bg-white"
                                                                >
                                                                    <option value="instock">In Stock</option>
                                                                    <option value="outofstock">Out of Stock</option>
                                                                    <option value="onbackorder">On Backorder</option>
                                                                </select>
                                                            </div>
                                                            <div>
                                                                <label className="block text-xs font-medium text-gray-500 mb-1">Allow Backorders</label>
                                                                <select
                                                                    value={v.backorders || 'no'}
                                                                    onChange={(e) => handleFieldChange(v.id, 'backorders', e.target.value)}
                                                                    className="w-full text-sm px-3 py-1.5 border border-gray-200 rounded-lg bg-white"
                                                                >
                                                                    <option value="no">Do not allow</option>
                                                                    <option value="notify">Allow, but notify</option>
                                                                    <option value="yes">Allow</option>
                                                                </select>
                                                            </div>
                                                        </div>
                                                    )}

                                                    {/* Additional fields */}
                                                    <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-4">
                                                        {canViewCogs && (() => {
                                                            // Determine COGS source: BOM > Gold > Manual
                                                            const bomCogs = bomCogsMap[v.id];
                                                            const goldCogs = calculateGoldCogs(v);
                                                            const hasBom = bomCogs != null && bomCogs > 0;
                                                            const hasGold = goldCogs != null && goldCogs > 0;

                                                            return (
                                                                <div>
                                                                    <label className="block text-xs font-medium text-gray-500 mb-1 flex items-center gap-1">
                                                                        COGS (Cost)
                                                                        {hasBom && (
                                                                            <span className="text-[10px] text-purple-600 bg-purple-50 px-1.5 py-0.5 rounded border border-purple-200">
                                                                                BOM
                                                                            </span>
                                                                        )}
                                                                        {!hasBom && hasGold && (
                                                                            <span className="text-[10px] text-amber-600 bg-amber-50 px-1.5 py-0.5 rounded border border-amber-200">
                                                                                Gold
                                                                            </span>
                                                                        )}
                                                                    </label>
                                                                    {bomCogsLoading ? (
                                                                        // Loading state
                                                                        <div className="w-full h-[34px] bg-gray-100 rounded-lg animate-pulse" />
                                                                    ) : hasBom ? (
                                                                        // BOM COGS - read-only display
                                                                        <div className="w-full text-sm px-3 py-1.5 bg-purple-50/50 border border-purple-200 rounded-lg text-purple-800 font-medium">
                                                                            ${bomCogs!.toFixed(2)}
                                                                        </div>
                                                                    ) : hasGold ? (
                                                                        // Gold Price COGS - read-only display
                                                                        <div className="w-full text-sm px-3 py-1.5 bg-amber-50/50 border border-amber-200 rounded-lg text-amber-800 font-medium">
                                                                            ${goldCogs!.toFixed(2)}
                                                                        </div>
                                                                    ) : (
                                                                        // Manual COGS input
                                                                        <input
                                                                            type="number" step="0.01"
                                                                            value={v.cogs || ''}
                                                                            onChange={(e) => handleFieldChange(v.id, 'cogs', e.target.value)}
                                                                            className="w-full text-sm px-3 py-1.5 border border-gray-200 rounded-lg"
                                                                            placeholder="0.00"
                                                                        />
                                                                    )}
                                                                </div>
                                                            );
                                                        })()}
                                                        <div>
                                                            <label className="block text-xs font-medium text-gray-500 mb-1">Bin Location</label>
                                                            <input
                                                                type="text"
                                                                value={v.binLocation || ''}
                                                                onChange={(e) => handleFieldChange(v.id, 'binLocation', e.target.value)}
                                                                className="w-full text-sm px-3 py-1.5 border border-gray-200 rounded-lg"
                                                                placeholder="e.g. A-01-02"
                                                            />
                                                        </div>
                                                        {isGoldPriceEnabled && (
                                                            <div>
                                                                <label className="block text-xs font-medium text-gray-500 mb-1 flex items-center gap-1">
                                                                    <DollarSign size={12} className="text-amber-500" />
                                                                    Gold Type
                                                                </label>
                                                                <select
                                                                    value={v.goldPriceType || 'none'}
                                                                    onChange={(e) => {
                                                                        const newType = e.target.value;
                                                                        handleMultiFieldChange(v.id, {
                                                                            goldPriceType: newType === 'none' ? null : newType,
                                                                            isGoldPriceApplied: newType !== 'none'
                                                                        });
                                                                    }}
                                                                    className="w-full text-sm px-3 py-1.5 border border-gray-200 rounded-lg bg-white"
                                                                >
                                                                    <option value="none">None</option>
                                                                    <option value="18ct">18ct Gold</option>
                                                                    <option value="9ct">9ct Gold</option>
                                                                    <option value="18ctWhite">18ct White Gold</option>
                                                                    <option value="9ctWhite">9ct White Gold</option>
                                                                </select>
                                                            </div>
                                                        )}
                                                    </div>

                                                    {/* Profit Margin Calculator - Only show when user can view COGS */}
                                                    {canViewCogs && (() => {
                                                        const sellingPrice = parseFloat(v.salePrice || '') || parseFloat(v.price || '') || 0;

                                                        // Calculate effective COGS using priority: BOM > Gold Price > Manual
                                                        const bomCogs = bomCogsMap[v.id];
                                                        const goldCogs = calculateGoldCogs(v);

                                                        let effectiveCogs = 0;
                                                        let cogsSource: 'bom' | 'gold' | 'manual' | 'none' = 'none';

                                                        if (bomCogs != null && bomCogs > 0) {
                                                            effectiveCogs = bomCogs;
                                                            cogsSource = 'bom';
                                                        } else if (goldCogs != null && goldCogs > 0) {
                                                            effectiveCogs = goldCogs;
                                                            cogsSource = 'gold';
                                                        } else {
                                                            effectiveCogs = parseFloat(v.cogs || '') || 0;
                                                            if (effectiveCogs > 0) cogsSource = 'manual';
                                                        }

                                                        const hasCogs = effectiveCogs > 0;
                                                        const hasPrice = sellingPrice > 0;

                                                        if (!hasPrice && !hasCogs) return null;

                                                        const profitDollar = sellingPrice - effectiveCogs;
                                                        const profitPercent = sellingPrice > 0 ? ((profitDollar / sellingPrice) * 100) : 0;

                                                        return (
                                                            <div className="mb-4 p-3 bg-gray-50/80 rounded-lg border border-gray-100">
                                                                <div className="flex items-center justify-between">
                                                                    <span className="text-xs font-medium text-gray-600 flex items-center gap-1">
                                                                        <TrendingUp size={12} />
                                                                        Profit Margin
                                                                    </span>
                                                                    {hasCogs && hasPrice ? (
                                                                        <div className="flex items-center gap-2">
                                                                            <span className={`text-sm font-bold ${profitDollar >= 0 ? 'text-green-600' : 'text-red-600'}`}>
                                                                                ${profitDollar.toFixed(2)}
                                                                            </span>
                                                                            <span className={`px-1.5 py-0.5 rounded-full text-xs font-medium ${profitPercent >= 0
                                                                                ? 'bg-green-50 text-green-700 border border-green-200'
                                                                                : 'bg-red-50 text-red-700 border border-red-200'
                                                                                }`}>
                                                                                {profitPercent >= 0 ? '+' : ''}{profitPercent.toFixed(1)}%
                                                                            </span>
                                                                        </div>
                                                                    ) : (
                                                                        <span className="text-xs text-gray-400 italic">
                                                                            {!hasCogs ? 'Enter COGS to calculate' : 'Enter price to calculate'}
                                                                        </span>
                                                                    )}
                                                                </div>
                                                                {hasCogs && hasPrice && (
                                                                    <p className="text-[10px] text-gray-500 mt-1">
                                                                        Based on {v.salePrice && parseFloat(v.salePrice) > 0 ? 'sale' : 'regular'} price of ${sellingPrice.toFixed(2)}
                                                                        {cogsSource === 'bom' && ' • BOM-calculated COGS'}
                                                                        {cogsSource === 'gold' && ' • Gold price COGS'}
                                                                    </p>
                                                                )}
                                                            </div>
                                                        );
                                                    })()}

                                                    <div className="border-l-2 border-blue-100 pl-4">
                                                        <h4 className="text-sm font-semibold text-gray-800 mb-2">Components (BOM)</h4>
                                                        <BOMPanel
                                                            ref={(panelRef) => {
                                                                if (panelRef) {
                                                                    bomPanelRefs.current.set(v.id, panelRef);
                                                                } else {
                                                                    bomPanelRefs.current.delete(v.id);
                                                                }
                                                            }}
                                                            productId={product.id}
                                                            fixedVariationId={v.id}
                                                            onCOGSUpdate={(cogs) => handleBomCogsUpdate(v.id, cogs)}
                                                        />
                                                    </div>
                                                </div>
                                            </td>
                                        </tr>
                                    )}
                                </React.Fragment>
                            ))
                        )}
                    </tbody>
                </table>
            </div>
        </div>
    );
});
