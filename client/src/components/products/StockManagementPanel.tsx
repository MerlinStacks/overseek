/**
 * Stock Management Panel - View and edit stock on hand
 * Shows calculated stock for BOM products, editable for simple products
 * For variable products, shows stock per variant
 */

import { useState, useEffect, useCallback } from 'react';
import { Package, Loader2, AlertTriangle, Layers, ChevronDown, ChevronUp } from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import { useAccount } from '../../context/AccountContext';
import { Logger } from '../../utils/logger';

interface StockManagementPanelProps {
    productWooId: number;
    variants?: Array<{
        id: number;
        sku?: string;
        attributes?: Array<{ name: string; option: string }>;
        stock_quantity?: number | null;
        stock_status?: string;
    }>;
    onStockChange?: (newStock: number, variantId?: number) => void;
}

interface StockInfo {
    stockQuantity: number | null;
    isBOMBased: boolean;
    manageStock: boolean;
    isVariable?: boolean;
    variants?: Array<{
        wooId: number;
        sku?: string;
        stockQuantity: number | null;
        stockStatus?: string;
        manageStock: boolean;
        attributes?: string;
    }>;
}

export function StockManagementPanel({ productWooId, variants, onStockChange }: StockManagementPanelProps) {
    const { token } = useAuth();
    const { currentAccount } = useAccount();

    const [stockInfo, setStockInfo] = useState<StockInfo | null>(null);
    const [isLoading, setIsLoading] = useState(true);
    const [savingVariantId, setSavingVariantId] = useState<number | null>(null);
    const [editValues, setEditValues] = useState<Record<number, string>>({});
    const [error, setError] = useState<string | null>(null);
    const [isExpanded, setIsExpanded] = useState(true);

    const fetchStock = useCallback(async () => {
        if (!token || !currentAccount) return;

        try {
            const res = await fetch(`/api/products/${productWooId}/stock`, {
                headers: {
                    'Authorization': `Bearer ${token}`,
                    'X-Account-ID': currentAccount.id
                }
            });

            if (res.ok) {
                const data: StockInfo = await res.json();
                setStockInfo(data);

                // Initialize edit values
                if (data.variants) {
                    const values: Record<number, string> = {};
                    data.variants.forEach(v => {
                        values[v.wooId] = v.stockQuantity?.toString() ?? '';
                    });
                    setEditValues(values);
                } else {
                    setEditValues({ 0: data.stockQuantity?.toString() ?? '' });
                }
            } else {
                setError('Failed to load stock info');
            }
        } catch (err) {
            Logger.error('Failed to fetch stock', { error: err });
            setError('Failed to load stock info');
        } finally {
            setIsLoading(false);
        }
    }, [token, currentAccount, productWooId]);

    useEffect(() => {
        fetchStock();
    }, [fetchStock]);

    /**
     * Save stock for a variant or main product
     */
    const handleSave = async (variantWooId?: number) => {
        if (!token || !currentAccount) return;

        const targetId = variantWooId ?? 0;
        const newStock = parseInt(editValues[targetId] ?? '', 10);
        if (isNaN(newStock) || newStock < 0) {
            setError('Please enter a valid stock quantity');
            return;
        }

        setSavingVariantId(targetId);
        setError(null);

        try {
            const url = variantWooId
                ? `/api/products/${productWooId}/variants/${variantWooId}/stock`
                : `/api/products/${productWooId}/stock`;

            const res = await fetch(url, {
                method: 'PUT',
                headers: {
                    'Authorization': `Bearer ${token}`,
                    'X-Account-ID': currentAccount.id,
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({ stockQuantity: newStock })
            });

            if (res.ok) {
                // Update local state
                if (variantWooId && stockInfo?.variants) {
                    setStockInfo(prev => prev ? {
                        ...prev,
                        variants: prev.variants?.map(v =>
                            v.wooId === variantWooId
                                ? { ...v, stockQuantity: newStock, manageStock: true }
                                : v
                        )
                    } : prev);
                } else {
                    setStockInfo(prev => prev ? { ...prev, stockQuantity: newStock, manageStock: true } : prev);
                }
                onStockChange?.(newStock, variantWooId);
            } else {
                const data = await res.json();
                setError(data.error || 'Failed to update stock');
            }
        } catch (err) {
            Logger.error('Failed to save stock', { error: err });
            setError('Failed to save stock');
        } finally {
            setSavingVariantId(null);
        }
    };

    const handleAdjust = (delta: number, variantWooId?: number) => {
        const targetId = variantWooId ?? 0;
        const current = parseInt(editValues[targetId] ?? '0', 10) || 0;
        const newValue = Math.max(0, current + delta);
        setEditValues(prev => ({ ...prev, [targetId]: newValue.toString() }));
    };

    if (isLoading) {
        return (
            <div className="bg-gradient-to-br from-blue-50/50 to-indigo-50/50 rounded-xl border border-blue-100/50 p-6">
                <div className="flex items-center justify-center gap-2 text-gray-500">
                    <Loader2 className="animate-spin" size={18} />
                    <span className="text-sm">Loading stock...</span>
                </div>
            </div>
        );
    }

    // Variable product with variants
    const isVariable = stockInfo?.isVariable || (variants && variants.length > 0);

    return (
        <div className="bg-gradient-to-br from-blue-50/50 to-indigo-50/50 rounded-xl border border-blue-100/50 p-6">
            <button
                type="button"
                onClick={() => setIsExpanded(!isExpanded)}
                className="w-full flex items-center justify-between text-xs font-semibold text-gray-500 uppercase tracking-wider mb-4"
            >
                <span className="flex items-center gap-2">
                    <Package size={14} className="text-blue-600" />
                    Stock On Hand
                    {stockInfo?.isBOMBased && (
                        <span className="ml-2 px-2 py-0.5 bg-purple-100 text-purple-700 text-[10px] font-medium rounded-full flex items-center gap-1">
                            <Layers size={10} />
                            BOM Calculated
                        </span>
                    )}
                    {isVariable && (
                        <span className="ml-2 px-2 py-0.5 bg-indigo-100 text-indigo-700 text-[10px] font-medium rounded-full">
                            {stockInfo?.variants?.length ?? variants?.length ?? 0} Variants
                        </span>
                    )}
                </span>
                {isExpanded ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
            </button>

            {error && (
                <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded-lg flex items-center gap-2 text-red-700 text-sm">
                    <AlertTriangle size={16} />
                    {error}
                </div>
            )}

            {isExpanded && (
                <>
                    {stockInfo?.isBOMBased ? (
                        // BOM-based: Read-only display
                        <div className="space-y-3">
                            <div className="flex items-center gap-4">
                                <div className="text-4xl font-bold text-gray-900">
                                    {stockInfo.stockQuantity ?? '-'}
                                </div>
                                <div className="text-sm text-gray-500">
                                    units available
                                </div>
                            </div>
                            <p className="text-xs text-gray-500 bg-white/50 rounded-lg p-3 border border-gray-100">
                                This product has a Bill of Materials (BOM). Stock is automatically calculated
                                based on the available quantity of component items.
                            </p>
                        </div>
                    ) : isVariable ? (
                        // Variable product: Show variant stock table
                        <div className="space-y-3">
                            <div className="bg-white rounded-lg border border-gray-200 overflow-hidden">
                                <table className="w-full text-sm">
                                    <thead className="bg-gray-50 border-b border-gray-200">
                                        <tr>
                                            <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase">Variant</th>
                                            <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase">SKU</th>
                                            <th className="px-4 py-2 text-center text-xs font-medium text-gray-500 uppercase">Stock</th>
                                            <th className="px-4 py-2 text-center text-xs font-medium text-gray-500 uppercase">Actions</th>
                                        </tr>
                                    </thead>
                                    <tbody className="divide-y divide-gray-100">
                                        {(stockInfo?.variants ?? variants?.map(v => ({
                                            wooId: v.id,
                                            sku: v.sku,
                                            stockQuantity: v.stock_quantity,
                                            stockStatus: v.stock_status,
                                            manageStock: false,
                                            attributes: v.attributes?.map(a => a.option).join(' / ')
                                        })) ?? []).map((variant) => (
                                            <tr key={variant.wooId} className="hover:bg-gray-50">
                                                <td className="px-4 py-3 font-medium text-gray-900">
                                                    {variant.attributes || `Variation #${variant.wooId}`}
                                                </td>
                                                <td className="px-4 py-3 text-gray-500 font-mono text-xs">
                                                    {variant.sku || '-'}
                                                </td>
                                                <td className="px-4 py-3">
                                                    <div className="flex items-center justify-center gap-2">
                                                        <button
                                                            type="button"
                                                            onClick={() => handleAdjust(-1, variant.wooId)}
                                                            className="w-7 h-7 flex items-center justify-center bg-gray-100 border border-gray-200 rounded text-gray-600 hover:bg-gray-200 transition-colors text-sm font-bold"
                                                        >
                                                            −
                                                        </button>
                                                        <input
                                                            type="number"
                                                            min="0"
                                                            value={editValues[variant.wooId] ?? ''}
                                                            onChange={(e) => setEditValues(prev => ({ ...prev, [variant.wooId]: e.target.value }))}
                                                            className="w-16 px-2 py-1 text-center font-bold bg-white border border-gray-200 rounded focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 outline-none"
                                                        />
                                                        <button
                                                            type="button"
                                                            onClick={() => handleAdjust(1, variant.wooId)}
                                                            className="w-7 h-7 flex items-center justify-center bg-gray-100 border border-gray-200 rounded text-gray-600 hover:bg-gray-200 transition-colors text-sm font-bold"
                                                        >
                                                            +
                                                        </button>
                                                    </div>
                                                </td>
                                                <td className="px-4 py-3 text-center">
                                                    <button
                                                        type="button"
                                                        onClick={() => handleSave(variant.wooId)}
                                                        disabled={savingVariantId === variant.wooId || editValues[variant.wooId] === (variant.stockQuantity?.toString() ?? '')}
                                                        className="px-3 py-1 bg-blue-600 text-white text-xs font-medium rounded hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                                                    >
                                                        {savingVariantId === variant.wooId ? <Loader2 className="animate-spin" size={12} /> : 'Save'}
                                                    </button>
                                                </td>
                                            </tr>
                                        ))}
                                    </tbody>
                                </table>
                            </div>
                            <p className="text-xs text-gray-500">
                                Stock is managed per variant for variable products.
                            </p>
                        </div>
                    ) : (
                        // Simple product: Editable single stock
                        <div className="space-y-4">
                            <div className="flex items-center gap-3">
                                <button
                                    type="button"
                                    onClick={() => handleAdjust(-1)}
                                    className="w-10 h-10 flex items-center justify-center bg-white border border-gray-200 rounded-lg text-gray-600 hover:bg-gray-50 transition-colors text-lg font-bold"
                                >
                                    −
                                </button>
                                <input
                                    type="number"
                                    min="0"
                                    value={editValues[0] ?? ''}
                                    onChange={(e) => setEditValues(prev => ({ ...prev, 0: e.target.value }))}
                                    className="w-24 px-4 py-2 text-center text-xl font-bold bg-white border border-gray-200 rounded-lg focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 outline-none transition-all"
                                />
                                <button
                                    type="button"
                                    onClick={() => handleAdjust(1)}
                                    className="w-10 h-10 flex items-center justify-center bg-white border border-gray-200 rounded-lg text-gray-600 hover:bg-gray-50 transition-colors text-lg font-bold"
                                >
                                    +
                                </button>
                                <button
                                    type="button"
                                    onClick={() => handleSave()}
                                    disabled={savingVariantId === 0 || editValues[0] === (stockInfo?.stockQuantity?.toString() ?? '')}
                                    className="ml-4 px-4 py-2 bg-blue-600 text-white text-sm font-medium rounded-lg hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors flex items-center gap-2"
                                >
                                    {savingVariantId === 0 ? <Loader2 className="animate-spin" size={14} /> : null}
                                    Update Stock
                                </button>
                            </div>
                            {!stockInfo?.manageStock && (
                                <p className="text-xs text-amber-600 bg-amber-50 rounded-lg p-3 border border-amber-100">
                                    Stock management is currently disabled for this product.
                                    Setting a stock quantity will enable local stock tracking.
                                </p>
                            )}
                        </div>
                    )}
                </>
            )}
        </div>
    );
}
