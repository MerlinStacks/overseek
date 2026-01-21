import React, { useState, useEffect, useRef, useImperativeHandle, forwardRef } from 'react';
import { Layers, ChevronDown, ChevronRight, Package, DollarSign, Loader2 } from 'lucide-react';
import { BOMPanel, BOMPanelRef } from './BOMPanel';
import { useAccountFeature } from '../../hooks/useAccountFeature';
import { useAuth } from '../../context/AuthContext';
import { useAccount } from '../../context/AccountContext';
import { usePermissions } from '../../hooks/usePermissions';
import { Logger } from '../../utils/logger';

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

    useEffect(() => {
        setEditingVariants(variants);
        // Initialize stock edit values from variants
        const stockValues: Record<number, string> = {};
        variants.forEach(v => {
            stockValues[v.id] = v.stockQuantity?.toString() ?? '';
        });
        setStockEditValues(stockValues);
    }, [variants]);

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

    const handleFieldChange = (id: number, field: keyof ProductVariant, value: any) => {
        const updated = editingVariants.map(v =>
            v.id === id ? { ...v, [field]: value } : v
        );
        setEditingVariants(updated);
        if (onUpdate) onUpdate(updated);
    };

    // Update multiple fields at once to avoid stale state issues
    const handleMultiFieldChange = (id: number, updates: Partial<ProductVariant>) => {
        const updated = editingVariants.map(v =>
            v.id === id ? { ...v, ...updates } : v
        );
        setEditingVariants(updated);
        if (onUpdate) onUpdate(updated);
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
                                                        {canViewCogs && (
                                                            <div>
                                                                <label className="block text-xs font-medium text-gray-500 mb-1">COGS (Cost)</label>
                                                                <input
                                                                    type="number" step="0.01"
                                                                    value={v.cogs || ''}
                                                                    onChange={(e) => handleFieldChange(v.id, 'cogs', e.target.value)}
                                                                    className="w-full text-sm px-3 py-1.5 border border-gray-200 rounded-lg"
                                                                    placeholder="0.00"
                                                                />
                                                            </div>
                                                        )}
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
