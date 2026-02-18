/**
 * DeactivatedItemsBanner
 * 
 * Collapsible warning banner showing auto-deactivated BOM items.
 * Provides per-item reactivation and reason visibility so users
 * can decide whether to re-map or leave items disabled.
 */

import { useState } from 'react';
import { AlertTriangle, ChevronDown, ChevronUp, RefreshCw, Loader2 } from 'lucide-react';

export interface DeactivatedItem {
    id: string;
    bomId: string;
    parentProduct: {
        id: string;
        wooId: number;
        name: string;
        variationId: number;
    };
    component: {
        type: 'WooProduct' | 'InternalProduct' | 'Unknown';
        id?: string;
        wooId?: number;
        name?: string;
        variationWooId?: number;
        variationSku?: string;
    };
    quantity: number;
    deactivatedReason: string;
}

interface DeactivatedItemsBannerProps {
    items: DeactivatedItem[];
    onReactivate: (itemId: string) => Promise<void>;
}

/** Why an item might be deactivated — human-readable explanations */
const REASON_LABELS: Record<string, string> = {
    PARENT_PRODUCT_DELETED: 'Parent product was deleted from WooCommerce',
    PARENT_VARIATION_DELETED: 'Parent variation was deleted from WooCommerce',
    CHILD_PRODUCT_DELETED: 'Component product was deleted from WooCommerce',
    CHILD_VARIATION_DELETED: 'Component variation was deleted from WooCommerce',
    UNKNOWN: 'Automatically deactivated (reason unspecified)',
};

export function DeactivatedItemsBanner({ items, onReactivate }: DeactivatedItemsBannerProps) {
    const [isExpanded, setIsExpanded] = useState(false);
    const [reactivatingId, setReactivatingId] = useState<string | null>(null);

    if (items.length === 0) return null;

    /** Handle reactivation with loading state */
    const handleReactivate = async (itemId: string) => {
        setReactivatingId(itemId);
        try {
            await onReactivate(itemId);
        } finally {
            setReactivatingId(null);
        }
    };

    return (
        <div className="bg-amber-50 border border-amber-200 rounded-xl overflow-hidden">
            {/* Banner header — always visible */}
            <button
                onClick={() => setIsExpanded(prev => !prev)}
                className="w-full flex items-center justify-between px-5 py-3 text-left hover:bg-amber-100/50 transition-colors"
            >
                <div className="flex items-center gap-2">
                    <AlertTriangle size={18} className="text-amber-600 flex-shrink-0" />
                    <span className="text-sm font-medium text-amber-800">
                        {items.length} deactivated BOM item{items.length !== 1 ? 's' : ''}
                    </span>
                    <span className="text-xs text-amber-600">
                        — excluded from stock calculations
                    </span>
                </div>
                {isExpanded
                    ? <ChevronUp size={16} className="text-amber-600" />
                    : <ChevronDown size={16} className="text-amber-600" />}
            </button>

            {/* Expandable item list */}
            {isExpanded && (
                <div className="border-t border-amber-200 divide-y divide-amber-100">
                    {items.map(item => (
                        <div key={item.id} className="px-5 py-3 flex items-center justify-between gap-4">
                            <div className="min-w-0 flex-1">
                                <div className="text-sm font-medium text-gray-900 truncate">
                                    {item.parentProduct.name}
                                    {item.parentProduct.variationId > 0 && (
                                        <span className="text-gray-500 ml-1">
                                            (Var #{item.parentProduct.variationId})
                                        </span>
                                    )}
                                </div>
                                <div className="text-xs text-gray-600 mt-0.5">
                                    Component: {item.component.name || 'Unknown'}
                                    {item.component.variationSku && (
                                        <span className="ml-1 text-gray-400">
                                            SKU: {item.component.variationSku}
                                        </span>
                                    )}
                                    <span className="mx-1">·</span>
                                    Qty: {item.quantity}
                                </div>
                                <div className="text-xs text-amber-700 mt-0.5 italic">
                                    {REASON_LABELS[item.deactivatedReason] || item.deactivatedReason}
                                </div>
                            </div>
                            <button
                                onClick={() => handleReactivate(item.id)}
                                disabled={reactivatingId === item.id}
                                className="flex-shrink-0 flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg text-amber-700 bg-amber-100 hover:bg-amber-200 disabled:opacity-50 transition-colors"
                            >
                                {reactivatingId === item.id ? (
                                    <Loader2 size={12} className="animate-spin" />
                                ) : (
                                    <RefreshCw size={12} />
                                )}
                                Reactivate
                            </button>
                        </div>
                    ))}
                </div>
            )}
        </div>
    );
}
