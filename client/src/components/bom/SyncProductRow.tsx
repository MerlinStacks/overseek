/**
 * SyncProductRow Component
 * 
 * Displays a single product row in the BOM sync table with expandable details.
 * Extracted from BOMSyncPage.tsx for maintainability.
 */

import {
    ChevronDown,
    ChevronRight,
    Package,
    ArrowRight,
    AlertTriangle,
    CheckCircle,
    XCircle,
    AlertCircle,
    RefreshCw,
    Loader2
} from 'lucide-react';
import type { PendingChange, BOMComponent } from '../../hooks/useBOMSync';
import { getErrorDetails } from '../../hooks/useBOMSync';

interface SyncProductRowProps {
    item: PendingChange;
    isExpanded: boolean;
    isSyncingThis: boolean;
    isSyncingAll: boolean;
    errorMsg: string | null;
    onToggleExpand: () => void;
    onSync: () => void;
}

export function SyncProductRow({
    item,
    isExpanded,
    isSyncingThis,
    isSyncingAll,
    errorMsg,
    onToggleExpand,
    onSync
}: SyncProductRowProps) {
    const diff = item.effectiveStock - (item.currentWooStock ?? 0);
    const errorDetails = errorMsg ? getErrorDetails(errorMsg) : null;

    // Find bottleneck component
    const bottleneckComponent = item.components?.reduce((min, c) =>
        c.buildableUnits < min.buildableUnits ? c : min
        , item.components[0]);

    return (
        <div>
            {/* Main Row */}
            <div
                className={`px-6 py-4 hover:bg-gray-50 cursor-pointer transition-colors ${errorMsg ? 'bg-red-50/30' : ''}`}
                onClick={onToggleExpand}
            >
                <div className="flex items-center gap-4">
                    {/* Expand Icon */}
                    <div className="text-gray-400">
                        {item.components?.length > 0 ? (
                            isExpanded ? <ChevronDown size={18} /> : <ChevronRight size={18} />
                        ) : (
                            <div className="w-[18px]" />
                        )}
                    </div>

                    {/* Product Image */}
                    <div className="w-12 h-12 bg-gray-100 rounded-lg overflow-hidden border border-gray-200 flex-shrink-0">
                        {item.mainImage ? (
                            <img src={item.mainImage} alt="" className="w-full h-full object-cover" />
                        ) : (
                            <div className="w-full h-full flex items-center justify-center text-gray-400">
                                <Package size={20} />
                            </div>
                        )}
                    </div>

                    {/* Product Info */}
                    <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                            <span className="font-medium text-gray-900 truncate">{item.name}</span>
                            {item.variationId > 0 && (
                                <span className="px-1.5 py-0.5 rounded text-xs font-medium bg-purple-100 text-purple-700">
                                    Variant
                                </span>
                            )}
                        </div>
                        {item.sku && <div className="text-xs text-gray-500 font-mono">{item.sku}</div>}
                        {item.components?.length > 0 && (
                            <div className="text-xs text-gray-400 mt-0.5">
                                {item.components.length} component{item.components.length !== 1 ? 's' : ''}
                                {bottleneckComponent && (
                                    <span className="text-amber-600 ml-2">
                                        • Limited by: {bottleneckComponent.childName}
                                    </span>
                                )}
                            </div>
                        )}
                    </div>

                    {/* Stock Values */}
                    <div className="flex items-center gap-6 text-center">
                        <div>
                            <div className="text-xs text-gray-500 mb-1">WooCommerce</div>
                            <div className="text-lg font-bold text-gray-600">{item.currentWooStock ?? '—'}</div>
                        </div>
                        <div className="text-gray-300">
                            <ArrowRight size={20} />
                        </div>
                        <div>
                            <div className="text-xs text-gray-500 mb-1">Effective</div>
                            <div className="text-lg font-bold text-blue-600">{item.effectiveStock}</div>
                        </div>
                        <div className="w-16">
                            <div className="text-xs text-gray-500 mb-1">Diff</div>
                            <div className={`text-lg font-bold ${diff > 0 ? 'text-green-600' : diff < 0 ? 'text-red-600' : 'text-gray-400'}`}>
                                {diff > 0 ? '+' : ''}{diff}
                            </div>
                        </div>
                    </div>

                    {/* Status & Actions */}
                    <div className="flex items-center gap-3">
                        {errorMsg ? (
                            <span className="inline-flex items-center gap-1 px-2 py-1 rounded-full text-xs font-medium bg-red-100 text-red-800">
                                <XCircle size={12} />
                                Error
                            </span>
                        ) : item.needsSync ? (
                            <span className="inline-flex items-center gap-1 px-2 py-1 rounded-full text-xs font-medium bg-amber-100 text-amber-800">
                                <AlertTriangle size={12} />
                                Needs Sync
                            </span>
                        ) : (
                            <span className="inline-flex items-center gap-1 px-2 py-1 rounded-full text-xs font-medium bg-green-100 text-green-800">
                                <CheckCircle size={12} />
                                In Sync
                            </span>
                        )}
                        <button
                            onClick={(e) => {
                                e.stopPropagation();
                                onSync();
                            }}
                            disabled={isSyncingThis || isSyncingAll}
                            className="inline-flex items-center gap-1 px-3 py-1.5 text-sm font-medium text-blue-600 hover:bg-blue-50 rounded-lg transition-colors disabled:opacity-50"
                        >
                            {isSyncingThis ? (
                                <Loader2 size={14} className="animate-spin" />
                            ) : (
                                <RefreshCw size={14} />
                            )}
                            {errorMsg ? 'Retry' : 'Sync'}
                        </button>
                    </div>
                </div>
            </div>

            {/* Error Details */}
            {errorDetails && (
                <div className="px-6 py-3 bg-red-50 border-t border-red-100">
                    <div className="flex items-start gap-3 ml-8">
                        <AlertCircle size={16} className="text-red-500 mt-0.5 flex-shrink-0" />
                        <div className="flex-1">
                            <div className="text-sm font-medium text-red-800">{errorDetails.message}</div>
                            <div className="text-sm text-red-600 mt-1">
                                <span className="font-medium">Fix:</span> {errorDetails.fix}
                            </div>
                        </div>
                    </div>
                </div>
            )}

            {/* Expanded Component Breakdown */}
            {isExpanded && item.components?.length > 0 && (
                <ComponentBreakdown components={item.components} bottleneckName={bottleneckComponent?.childName} />
            )}
        </div>
    );
}

interface ComponentBreakdownProps {
    components: BOMComponent[];
    bottleneckName?: string;
}

function ComponentBreakdown({ components, bottleneckName }: ComponentBreakdownProps) {
    return (
        <div className="px-6 py-4 bg-gray-50 border-t border-gray-100">
            <div className="ml-8">
                <div className="text-xs font-semibold text-gray-500 uppercase mb-3">Component Breakdown</div>
                <div className="space-y-2">
                    {components.map((comp, idx) => {
                        const isBottleneck = comp.childName === bottleneckName;
                        return (
                            <div
                                key={idx}
                                className={`flex items-center justify-between p-3 rounded-lg border ${isBottleneck
                                    ? 'bg-amber-50 border-amber-200'
                                    : 'bg-white border-gray-200'
                                    }`}
                            >
                                <div className="flex items-center gap-3">
                                    <Package size={16} className={isBottleneck ? 'text-amber-500' : 'text-gray-400'} />
                                    <div>
                                        <div className="font-medium text-gray-900">{comp.childName}</div>
                                        <div className="text-xs text-gray-500">
                                            {comp.requiredQty}× required per unit
                                            {comp.componentType && (
                                                <span className="ml-2 px-1.5 py-0.5 rounded text-xs bg-gray-100 text-gray-600">
                                                    {comp.componentType === 'InternalProduct' ? 'Internal' :
                                                        comp.componentType === 'ProductVariation' ? 'Variant' : 'Product'}
                                                </span>
                                            )}
                                        </div>
                                    </div>
                                </div>
                                <div className="flex items-center gap-6 text-center">
                                    <div>
                                        <div className="text-xs text-gray-500">Stock</div>
                                        <div className={`font-bold ${comp.childStock <= 0 ? 'text-red-600' : 'text-gray-900'}`}>
                                            {comp.childStock}
                                        </div>
                                    </div>
                                    <div>
                                        <div className="text-xs text-gray-500">Can Build</div>
                                        <div className={`font-bold ${isBottleneck ? 'text-amber-600' : 'text-blue-600'}`}>
                                            {comp.buildableUnits}
                                        </div>
                                    </div>
                                    {isBottleneck && (
                                        <span className="inline-flex items-center gap-1 px-2 py-1 rounded-full text-xs font-medium bg-amber-100 text-amber-800">
                                            <AlertTriangle size={12} />
                                            Bottleneck
                                        </span>
                                    )}
                                </div>
                            </div>
                        );
                    })}
                </div>
            </div>
        </div>
    );
}
