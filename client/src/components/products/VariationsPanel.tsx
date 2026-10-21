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
import { bomNumber, validBOMValues } from './bom/bomValues';
import { ProductVariant, parseVariantStock } from './variantTypes';
import { VariantTableRow } from './VariantTableRow';
import { useScopedMutation } from '../../hooks/useScopedMutation';
import { isRecord } from '../../utils/responseValidation';
import { VariantExpandedDetails } from './VariantExpandedDetails';
import type { VariationProductionEditor } from './ProductionRangeFields';

interface VariationsPanelProps {
    product: {
        id: string;
        type?: string;
        variations?: number[];
        wooId: number;
    };
    variants: ProductVariant[];
    suppliers?: Array<{ id: string; name: string }>;
    parentSupplierId?: string | null;
    onUpdate?: (updatedVariants: ProductVariant[]) => void;
    production?: VariationProductionEditor;
}

export interface VariationsPanelRef {
    saveAllBOMs: () => Promise<boolean>;
}

export const VariationsPanel = forwardRef<VariationsPanelRef, VariationsPanelProps>(function VariationsPanel(props, ref) {
    const { token } = useAuth(); const { currentAccount } = useAccount();
    return <ScopedVariationsPanel key={JSON.stringify([token, currentAccount?.id, props.product.id, props.product.wooId])} {...props} ref={ref} />;
});
const ScopedVariationsPanel = forwardRef<VariationsPanelRef, VariationsPanelProps>(function ScopedVariationsPanel({ product, variants, suppliers = [], parentSupplierId, onUpdate, production }, ref) {
    const { token } = useAuth();
    const { currentAccount } = useAccount();
    const [expandedId, setExpandedId] = useState<number | null>(null);
    const [editingVariants, setEditingVariants] = useState<ProductVariant[]>(variants);
    const isGoldPriceEnabled = useAccountFeature('GOLD_PRICE_CALCULATOR');
    const { hasPermission } = usePermissions();
    const canViewCogs = hasPermission('view_cogs');

    const [stockEditValues, setStockEditValues] = useState<Record<number, string>>({});
    const [savingStockId, setSavingStockId] = useState<number | null>(null);
    const stockMutation = useScopedMutation();
    const expansion = useScopedMutation();
    const bomPanelRefs = useRef<Map<number, BOMPanelRef | null>>(new Map());
    const [bomCogsMap, setBomCogsMap] = useState<Record<number, number | null>>({});
    const [bomCogsLoading, setBomCogsLoading] = useState(true);
    /** Tracks which variants have BOM items, independent of COGS visibility */
    const [bomExistsMap, setBomExistsMap] = useState<Record<number, boolean>>({});
    const lastSyncedVariantsRef = useRef<ProductVariant[]>(variants);
    const accountId = currentAccount?.id;
    const variantIds = variants.map(variant => variant.id).sort((a, b) => a - b).join(',');
    const [bomAttempt, setBomAttempt] = useState(0);

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

    // Why: useCallback so the function identity only changes when bomPanelRefs is reassigned (never)
    const saveAllBOMs = useCallback(async (): Promise<boolean> => {
        if (stockMutation.isPending() || expansion.isPending()) return false;
        const refs = Array.from(bomPanelRefs.current.values()).filter(r => r !== null);
        if (refs.length === 0) return true;
        const results = await Promise.all(refs.map(r => r!.save()));
        return results.every(success => success);
    }, [stockMutation, expansion]);

    useImperativeHandle(ref, () => ({ saveAllBOMs }), [saveAllBOMs]);

    useEffect(() => {
        setEditingVariants(variants);
        const stockValues: Record<number, string> = {};
        variants.forEach(v => { stockValues[v.id] = v.stockQuantity?.toString() ?? ''; });
        setStockEditValues(stockValues);
        lastSyncedVariantsRef.current = variants;
    }, [variants]);

    // Fetch BOM existence (always) and COGS (when permitted) for all variants
    useEffect(() => {
        if (!token || !accountId || !variantIds) {
            setBomCogsLoading(false);
            return;
        }
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 30000);
        let disposed = false;

        const fetchAllBomData = async () => {
            setBomCogsLoading(true);
            const newBomCogsMap: Record<number, number | null> = {};
            const newBomExistsMap: Record<number, boolean> = {};

            await Promise.all(variantIds.split(',').map(Number).map(async (id) => {
                try {
                    const res = await fetch(`/api/inventory/products/${product.id}/bom?variationId=${id}`, {
                        signal: controller.signal,
                        headers: { 'Authorization': `Bearer ${token}`, 'x-account-id': accountId }
                    });
                    if (res.ok) {
                        const data = await res.json();
                        if (!Array.isArray(data.items)) throw new Error('Invalid BOM');
                        const hasItems = data.items?.length > 0;
                        newBomExistsMap[id] = hasItems;
                        if (hasItems && canViewCogs) {
                            const cost = data.items.reduce((sum: number, item: unknown) => {
                                if (!isRecord(item)) return NaN;
                                const source = [item.internalProduct, item.childVariation, item.childProduct, item.supplierItem].find(isRecord);
                                const quantity = bomNumber(item.quantity); const wasteFactor = bomNumber(item.wasteFactor);
                                const unitCost = bomNumber(source === item.supplierItem ? source?.cost : source?.cogs);
                                return sum + (validBOMValues({ quantity, wasteFactor }) ? unitCost * quantity * (1 + wasteFactor) : NaN);
                            }, 0);
                            newBomCogsMap[id] = Number.isFinite(cost) ? cost : null;
                        } else {
                            newBomCogsMap[id] = null;
                        }
                    }
                } catch (err) {
                    if (!controller.signal.aborted) Logger.error('Failed to fetch BOM for variant', { variantId: id, error: err });
                    newBomCogsMap[id] = null;
                }
            }));

            clearTimeout(timeout);
            if (disposed) return;
            setBomCogsMap(newBomCogsMap);
            setBomExistsMap(newBomExistsMap);
            setBomCogsLoading(false);
        };
        fetchAllBomData();
        return () => { disposed = true; controller.abort(); clearTimeout(timeout); };
    }, [token, accountId, product.id, variantIds, canViewCogs, bomAttempt]);

    const handleFieldChange = useCallback((id: number, field: keyof ProductVariant, value: ProductVariant[keyof ProductVariant]) => {
        if (stockMutation.isPending()) return;
        setEditingVariants(prev => prev.map(v => v.id === id ? { ...v, [field]: value } : v));
    }, [stockMutation]);

    // Why: reference comparison always triggered because setEditingVariants creates new arrays.
    // Use JSON comparison to detect actual value changes.
    useEffect(() => {
        if (!onUpdate) return;
        const serialised = JSON.stringify(editingVariants);
        if (serialised !== JSON.stringify(lastSyncedVariantsRef.current)) {
            lastSyncedVariantsRef.current = editingVariants;
            onUpdate(editingVariants);
        }
    }, [editingVariants, onUpdate]);

    const handleBomCogsUpdate = useCallback((variantId: number, cogs: number | null, hasItems: boolean) => {
        setBomCogsMap(prev => ({ ...prev, [variantId]: hasItems ? cogs : null }));
        setBomExistsMap(prev => ({ ...prev, [variantId]: hasItems }));
    }, []);

    /** Update local variant stock after a BOM sync pushes new stock to WooCommerce */
    const handleSyncComplete = useCallback((variantId: number, newStock: number) => {
        setEditingVariants(prev => prev.map(v => v.id === variantId ? { ...v, stockQuantity: newStock } : v));
        setStockEditValues(prev => ({ ...prev, [variantId]: newStock.toString() }));
    }, []);

    const hasVariations = product.type?.includes('variable') || (product.variations && product.variations.length > 0);
    if (!hasVariations) return null;

    const toggleExpand = async (id: number) => {
        if (stockMutation.isPending() || expansion.isPending()) return;
        if (expandedId === null) { setExpandedId(id); return; }
        const result = await expansion.run(async () => {
            const currentRef = expandedId !== null ? bomPanelRefs.current.get(expandedId) : null;
            if (currentRef && !await currentRef.save()) throw new Error('BOM not saved');
        }, 'Could not save the current BOM. Resolve its errors before changing variants.');
        if (result.ok) setExpandedId(expandedId === id ? null : id);
    };

    const handleMultiFieldChange = (id: number, updates: Partial<ProductVariant>) => {
        if (stockMutation.isPending()) return;
        setEditingVariants(prev => prev.map(v => v.id === id ? { ...v, ...updates } : v));
    };

    const handleStockAdjust = (variantId: number, delta: number) => {
        if (stockMutation.isPending()) return;
        setStockEditValues(prev => { const current = parseVariantStock(prev[variantId] ?? ''); return current === null || !Number.isSafeInteger(current + delta) ? prev : { ...prev, [variantId]: Math.max(0, current + delta).toString() }; });
    };

    const handleStockSave = async (variantId: number) => {
        if (!token || !currentAccount || stockMutation.isPending() || expansion.isPending() || bomCogsLoading || bomExistsMap[variantId] !== false) return;
        const newStock = parseVariantStock(stockEditValues[variantId] ?? '');
        if (newStock === null) return;

        setSavingStockId(variantId);
        const result = await stockMutation.run(async signal => {
            const res = await fetch(`/api/products/${product.wooId}/variants/${variantId}/stock`, {
                signal,
                method: 'PUT',
                headers: { 'Authorization': `Bearer ${token}`, 'X-Account-ID': currentAccount.id, 'Content-Type': 'application/json' },
                body: JSON.stringify({ stockQuantity: newStock })
            });

            if (!res.ok) throw new Error('Stock save rejected');
            const data: unknown = await res.json();
            if (!isRecord(data) || data.success !== true || data.variantWooId !== variantId || data.stockQuantity !== newStock) throw new Error('Invalid stock confirmation');
        }, 'Could not confirm stock save. Check the product before retrying.');
        if (result.ok) setEditingVariants(prev => prev.map(v => v.id === variantId ? { ...v, stockQuantity: newStock } : v));
        if (stockMutation.isActive()) {
            setSavingStockId(null);
        }
    };

    return (
        <div className="bg-white/70 backdrop-blur-md rounded-xl shadow-xs border border-white/50 animate-in fade-in slide-in-from-bottom-4 duration-500">
            {stockMutation.error && <p role="alert">{stockMutation.error}</p>}{expansion.error && <p role="alert">{expansion.error}</p>}
            {!bomCogsLoading && !!token && !!accountId && variants.some(variant => bomExistsMap[variant.id] === undefined) && <p role="alert">Some BOM status checks failed; stock editing is locked for those variants. <button type="button" disabled={stockMutation.busy} onClick={() => setBomAttempt(value => value + 1)}>Retry BOM checks</button></p>}
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
                                        onStockEditChange={(val) => { if (!stockMutation.isPending()) setStockEditValues(prev => ({ ...prev, [v.id]: val })); }}
                                        onStockAdjust={(delta) => handleStockAdjust(v.id, delta)}
                                        onStockSave={() => handleStockSave(v.id)}
                                        isSavingStock={savingStockId === v.id}
                                        disabled={stockMutation.busy || expansion.busy}
                                        stockUnavailable={bomCogsLoading || bomExistsMap[v.id] === undefined}
                                        currency={currentAccount?.currency}
                                        hasBOM={!!bomExistsMap[v.id]}
                                    />
                                    {expandedId === v.id && (
                                        <VariantExpandedDetails
                                            variant={v}
                                            suppliers={suppliers}
                                            parentSupplierId={parentSupplierId}
                                            production={production ? {
                                                value: production.values[v.id],
                                                inherited: production.parent,
                                                onChange: range => production.onChange(v.id, range),
                                                disabled: production.disabled,
                                                loading: production.loading,
                                                error: production.error,
                                                onRetry: production.onRetry
                                            } : undefined}
                                            productId={product.id}
                                            productWooId={product.wooId}
                                            bomPanelRef={(panelRef) => {
                                                if (panelRef) bomPanelRefs.current.set(v.id, panelRef);
                                                else bomPanelRefs.current.delete(v.id);
                                            }}
                                            onFieldChange={(field, value) => handleFieldChange(v.id, field, value)}
                                            onMultiFieldChange={(updates) => handleMultiFieldChange(v.id, updates)}
                                            onBomCogsUpdate={(cogs, hasItems) => handleBomCogsUpdate(v.id, cogs, hasItems)}
                                            onSyncComplete={(newStock) => handleSyncComplete(v.id, newStock)}
                                            canViewCogs={canViewCogs}
                                            isGoldPriceEnabled={isGoldPriceEnabled}
                                            bomCogs={bomCogsMap[v.id] ?? null}
                                            hasBOM={bomExistsMap[v.id]}
                                            currency={currentAccount?.currency}
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
