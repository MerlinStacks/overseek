/**
 * Stock Management Panel - View and edit stock on hand
 * Shows calculated stock for BOM products, editable for simple products
 */

import { useState, useEffect, useCallback } from 'react';
import { Package, Loader2, AlertTriangle, Layers } from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import { useAccount } from '../../context/AccountContext';
import { Logger } from '../../utils/logger';

interface StockManagementPanelProps {
    productWooId: number;
    onStockChange?: (newStock: number) => void;
}

interface StockInfo {
    stockQuantity: number | null;
    isBOMBased: boolean;
    manageStock: boolean;
}

export function StockManagementPanel({ productWooId, onStockChange }: StockManagementPanelProps) {
    const { token } = useAuth();
    const { currentAccount } = useAccount();

    const [stockInfo, setStockInfo] = useState<StockInfo | null>(null);
    const [isLoading, setIsLoading] = useState(true);
    const [isSaving, setIsSaving] = useState(false);
    const [editValue, setEditValue] = useState<string>('');
    const [error, setError] = useState<string | null>(null);

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
                setEditValue(data.stockQuantity?.toString() ?? '');
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

    const handleSave = async () => {
        if (!token || !currentAccount || stockInfo?.isBOMBased) return;

        const newStock = parseInt(editValue, 10);
        if (isNaN(newStock) || newStock < 0) {
            setError('Please enter a valid stock quantity');
            return;
        }

        setIsSaving(true);
        setError(null);

        try {
            const res = await fetch(`/api/products/${productWooId}/stock`, {
                method: 'PUT',
                headers: {
                    'Authorization': `Bearer ${token}`,
                    'X-Account-ID': currentAccount.id,
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({ stockQuantity: newStock })
            });

            if (res.ok) {
                setStockInfo(prev => prev ? { ...prev, stockQuantity: newStock, manageStock: true } : prev);
                onStockChange?.(newStock);
            } else {
                const data = await res.json();
                setError(data.error || 'Failed to update stock');
            }
        } catch (err) {
            Logger.error('Failed to save stock', { error: err });
            setError('Failed to save stock');
        } finally {
            setIsSaving(false);
        }
    };

    const handleAdjust = (delta: number) => {
        const current = parseInt(editValue, 10) || 0;
        const newValue = Math.max(0, current + delta);
        setEditValue(newValue.toString());
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

    return (
        <div className="bg-gradient-to-br from-blue-50/50 to-indigo-50/50 rounded-xl border border-blue-100/50 p-6">
            <h4 className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-4 flex items-center gap-2">
                <Package size={14} className="text-blue-600" />
                Stock On Hand
                {stockInfo?.isBOMBased && (
                    <span className="ml-2 px-2 py-0.5 bg-purple-100 text-purple-700 text-[10px] font-medium rounded-full flex items-center gap-1">
                        <Layers size={10} />
                        BOM Calculated
                    </span>
                )}
            </h4>

            {error && (
                <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded-lg flex items-center gap-2 text-red-700 text-sm">
                    <AlertTriangle size={16} />
                    {error}
                </div>
            )}

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
            ) : (
                // Simple product: Editable
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
                            value={editValue}
                            onChange={(e) => setEditValue(e.target.value)}
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
                            onClick={handleSave}
                            disabled={isSaving || editValue === (stockInfo?.stockQuantity?.toString() ?? '')}
                            className="ml-4 px-4 py-2 bg-blue-600 text-white text-sm font-medium rounded-lg hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors flex items-center gap-2"
                        >
                            {isSaving ? <Loader2 className="animate-spin" size={14} /> : null}
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
        </div>
    );
}
