/**
 * VariationsPanel
 * 
 * Variations panel with inline editing for SKU, price, and stock.
 * Shows variation image thumbnails and expanded details with BOM configuration.
 */
import React, { useState, useEffect, useRef, useImperativeHandle, forwardRef, useCallback } from 'react';
import { Layers } from 'lucide-react';
import { BOMPanelRef } from './BOMPanel';
import { useAccountFeature } from '../../hooks/useAccountFeature';
import { useAuth } from '../../context/AuthContext';
import { useAccount } from '../../context/AccountContext';
import { usePermissions } from '../../hooks/usePermissions';
import { Logger } from '../../utils/logger';
import { calculateTotalBomCost } from '../../utils/bomUtils';
import { ProductVariant } from './variantTypes';
import { VariantTableRow } from './VariantTableRow';
import { VariantExpandedDetails } from './VariantExpandedDetails';

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

export interface VariationsPanelRef {
    saveAllBOMs: () => Promise<boolean>;
}

export const VariationsPanel = forwardRef<VariationsPanelRef, VariationsPanelProps>(function VariationsPanel({ product, variants, onUpdate }, ref) {
    const { token } = useAuth();
    const { currentAccount } = useAccount();
    const [expandedId, setExpandedId] = useState<number | null>(null);
    const [editingVariants, setEditingVariants] = useState<ProductVariant[]>(variants);
    const isGoldPriceEnabled = useAccountFeature('GOLD_PRICE_CALCULATOR');
    const { hasPermission } = usePermissions();
    const canViewCogs = hasPermission('view_cogs');

    const [stockEditValues, setStockEditValues] = useState<Record<number, string>>({});
    const [savingStockId, setSavingStockId] = useState<number | null>(null);
    const bomPanelRefs = useRef<Map<number, BOMPanelRef | null>>(new Map());
    const variantIdsRef = useRef<string>('');
    const [bomCogsMap, setBomCogsMap] = useState<Record<number, number | null>>({});
    const [bomCogsLoading, setBomCogsLoading] = useState(true);
    const lastSyncedVariantsRef = useRef<ProductVariant[]>(variants);

    /**
     * Calculate gold price COGS for a variant.
     */
    const calculateGoldCogs = useCallback((variant: ProductVariant): number | null => {
        if (!variant.isGoldPriceApplied || !variant.goldPriceType || !currentAccount) return null;
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

    const saveAllBOMs = async (): Promise<boolean> => {
        const refs = Array.from(bomPanelRefs.current.values()).filter(ref => ref !== null);
        if (refs.length === 0) return true;
        const results = await Promise.all(refs.map(ref => ref!.save()));
        return results.every(success => success);
    };

    useImperativeHandle(ref, () => ({ saveAllBOMs }), []);

    useEffect(() => {
        setEditingVariants(variants);
        const stockValues: Record<number, string> = {};
        variants.forEach(v => { stockValues[v.id] = v.stockQuantity?.toString() ?? ''; });
        setStockEditValues(stockValues);
        lastSyncedVariantsRef.current = variants;
    }, [variants]);

    // Fetch BOM COGS for all variants
    useEffect(() => {
        if (!token || !currentAccount || !canViewCogs || variants.length === 0) {
            setBomCogsLoading(false);
            return;
        }
        const currentVariantIds = variants.map(v => v.id).sort().join(',');
        if (currentVariantIds === variantIdsRef.current) return;
        variantIdsRef.current = currentVariantIds;

        const fetchAllBomCogs = async () => {
            setBomCogsLoading(true);
            const newBomCogsMap: Record<number, number | null> = {};

            await Promise.all(variants.map(async (v) => {
                try {
                    const res = await fetch(`/api/inventory/products/${product.id}/bom?variationId=${v.id}`, {
                        headers: { 'Authorization': `Bearer ${token}`, 'x-account-id': currentAccount.id }
                    });
                    if (res.ok) {
                        const data = await res.json();
                        if (data.items?.length > 0) {
                            newBomCogsMap[v.id] = calculateTotalBomCost(data.items);
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

    const handleFieldChange = useCallback((id: number, field: keyof ProductVariant, value: any) => {
        setEditingVariants(prev => prev.map(v => v.id === id ? { ...v, [field]: value } : v));
    }, []);

    useEffect(() => {
        if (editingVariants !== lastSyncedVariantsRef.current && onUpdate) {
            onUpdate(editingVariants);
        }
    }, [editingVariants, onUpdate]);

    const handleBomCogsUpdate = useCallback((variantId: number, cogs: number) => {
        setBomCogsMap(prev => ({ ...prev, [variantId]: cogs }));
    }, []);

    const hasVariations = product.type?.includes('variable') || (product.variations && product.variations.length > 0);
    if (!hasVariations) return null;

    const toggleExpand = async (id: number) => {
        if (expandedId !== null && expandedId !== id) {
            const currentRef = bomPanelRefs.current.get(expandedId);
            if (currentRef) await currentRef.save();
        }
        if (expandedId === id) {
            const currentRef = bomPanelRefs.current.get(id);
            if (currentRef) await currentRef.save();
        }
        setExpandedId(expandedId === id ? null : id);
    };

    const handleMultiFieldChange = (id: number, updates: Partial<ProductVariant>) => {
        setEditingVariants(prev => prev.map(v => v.id === id ? { ...v, ...updates } : v));
    };

    const handleStockAdjust = (variantId: number, delta: number) => {
        const current = parseInt(stockEditValues[variantId] ?? '0', 10) || 0;
        setStockEditValues(prev => ({ ...prev, [variantId]: Math.max(0, current + delta).toString() }));
    };

    const handleStockSave = async (variantId: number) => {
        if (!token || !currentAccount) return;
        const newStock = parseInt(stockEditValues[variantId] ?? '', 10);
        if (isNaN(newStock) || newStock < 0) return;

        setSavingStockId(variantId);
        try {
            const res = await fetch(`/api/products/${product.wooId}/variants/${variantId}/stock`, {
                method: 'PUT',
                headers: { 'Authorization': `Bearer ${token}`, 'X-Account-ID': currentAccount.id, 'Content-Type': 'application/json' },
                body: JSON.stringify({ stockQuantity: newStock })
            });

            if (res.ok) {
                const updated = editingVariants.map(v => v.id === variantId ? { ...v, stockQuantity: newStock } : v);
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
        <div className="bg-white/70 backdrop-blur-md rounded-xl shadow-xs border border-white/50 animate-in fade-in slide-in-from-bottom-4 duration-500">
            <div className="px-6 py-4 border-b border-gray-100/50 bg-white/30 flex justify-between items-center">
                <div className="flex items-center gap-2">
                    <Layers size={16} className="text-blue-600" />
                    <h3 className="font-bold text-gray-900 uppercase tracking-wide text-sm">Variations</h3>
                    <span className="bg-blue-100 text-blue-700 px-2 py-0.5 rounded-full text-xs font-medium">{product.variations?.length || 0}</span>
                </div>
            </div>
            <div className="p-0 overflow-x-auto overflow-y-visible">
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
                                    <VariantTableRow
                                        variant={v}
                                        isExpanded={expandedId === v.id}
                                        onToggleExpand={() => toggleExpand(v.id)}
                                        onFieldChange={(field, value) => handleFieldChange(v.id, field, value)}
                                        stockEditValue={stockEditValues[v.id] ?? ''}
                                        onStockEditChange={(val) => setStockEditValues(prev => ({ ...prev, [v.id]: val }))}
                                        onStockAdjust={(delta) => handleStockAdjust(v.id, delta)}
                                        onStockSave={() => handleStockSave(v.id)}
                                        isSavingStock={savingStockId === v.id}
                                    />
                                    {expandedId === v.id && (
                                        <VariantExpandedDetails
                                            variant={v}
                                            productId={product.id}
                                            bomPanelRef={(panelRef) => {
                                                if (panelRef) bomPanelRefs.current.set(v.id, panelRef);
                                                else bomPanelRefs.current.delete(v.id);
                                            }}
                                            onFieldChange={(field, value) => handleFieldChange(v.id, field, value)}
                                            onMultiFieldChange={(updates) => handleMultiFieldChange(v.id, updates)}
                                            onBomCogsUpdate={(cogs) => handleBomCogsUpdate(v.id, cogs)}
                                            canViewCogs={canViewCogs}
                                            isGoldPriceEnabled={isGoldPriceEnabled}
                                            bomCogs={bomCogsMap[v.id] ?? null}
                                            bomCogsLoading={bomCogsLoading}
                                            calculateGoldCogs={calculateGoldCogs}
                                        />
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
