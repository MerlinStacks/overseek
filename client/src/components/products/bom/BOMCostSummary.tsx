/**
 * BOMCostSummary - Displays composite cost and buildable units summary.
 * Extracted from BOMPanel.tsx for modularity.
 */
import React from 'react';
import { DollarSign, Package, AlertTriangle, RefreshCw, Loader2, CheckCircle } from 'lucide-react';

export interface BOMCostSummaryProps {
    totalCost: number;
    effectiveStock: number | null;
    currentWooStock: number | null;
    isSyncing: boolean;
    syncStatus: 'idle' | 'success' | 'error';
    onSyncToWoo: () => void;
}

/**
 * Renders the composite cost summary and buildable units with WooCommerce sync.
 */
export function BOMCostSummary({
    totalCost,
    effectiveStock,
    currentWooStock,
    isSyncing,
    syncStatus,
    onSyncToWoo
}: BOMCostSummaryProps) {
    return (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-6">
            {/* Cost Summary */}
            <div className="p-4 bg-green-50/50 rounded-xl border border-green-100">
                <div className="flex items-center gap-2 text-green-700 mb-1">
                    <DollarSign size={18} />
                    <span className="font-semibold text-sm uppercase">Composite Cost</span>
                </div>
                <div className="text-2xl font-bold text-gray-900">${totalCost.toFixed(2)}</div>
            </div>

            {/* Effective Stock & Sync - Only show if there are BOM items with child products */}
            {effectiveStock !== null && (
                <div className={`p-4 rounded-xl border ${currentWooStock !== effectiveStock
                    ? 'bg-amber-50/50 border-amber-200'
                    : 'bg-blue-50/50 border-blue-100'
                    }`}>
                    <div className="flex items-center justify-between mb-1">
                        <div className="flex items-center gap-2 text-blue-700">
                            <Package size={18} />
                            <span className="font-semibold text-sm uppercase">Buildable Units</span>
                        </div>
                        {currentWooStock !== effectiveStock && (
                            <div className="flex items-center gap-1 text-amber-600 text-xs">
                                <AlertTriangle size={14} />
                                <span>Out of sync</span>
                            </div>
                        )}
                    </div>
                    <div className="flex items-end justify-between">
                        <div>
                            <div className="text-2xl font-bold text-gray-900">{effectiveStock}</div>
                            {currentWooStock !== null && currentWooStock !== effectiveStock && (
                                <div className="text-xs text-gray-500 mt-1">
                                    WooCommerce: {currentWooStock}
                                </div>
                            )}
                        </div>
                        <button
                            onClick={onSyncToWoo}
                            disabled={isSyncing || currentWooStock === effectiveStock}
                            className={`flex items-center gap-2 px-3 py-1.5 rounded-lg text-sm font-medium transition-all ${currentWooStock === effectiveStock
                                ? 'bg-gray-100 text-gray-400 cursor-not-allowed'
                                : syncStatus === 'success'
                                    ? 'bg-green-500 text-white'
                                    : syncStatus === 'error'
                                        ? 'bg-red-500 text-white'
                                        : 'bg-blue-500 text-white hover:bg-blue-600'
                                }`}
                        >
                            {isSyncing ? (
                                <Loader2 size={14} className="animate-spin" />
                            ) : syncStatus === 'success' ? (
                                <CheckCircle size={14} />
                            ) : syncStatus === 'error' ? (
                                <AlertTriangle size={14} />
                            ) : (
                                <RefreshCw size={14} />
                            )}
                            {isSyncing ? 'Syncing...' : syncStatus === 'success' ? 'Synced!' : syncStatus === 'error' ? 'Failed' : 'Sync to Woo'}
                        </button>
                    </div>
                </div>
            )}
        </div>
    );
}
