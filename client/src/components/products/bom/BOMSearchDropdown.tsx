/**
 * BOMSearchDropdown - Product search dropdown for adding BOM components.
 * Extracted from BOMPanel.tsx for modularity.
 */
import React from 'react';
import { Plus, Package, GitBranch } from 'lucide-react';

export interface BOMSearchDropdownProps {
    searchTerm: string;
    onSearchChange: (value: string) => void;
    searchResults: any[];
    productId: string;
    onAddProduct: (product: any) => void;
}

/**
 * Renders the product search input and results dropdown for BOM.
 */
export function BOMSearchDropdown({
    searchTerm,
    onSearchChange,
    searchResults,
    productId,
    onAddProduct
}: BOMSearchDropdownProps) {
    return (
        <div className="relative z-20">
            <div className="flex items-center gap-2 mb-2">
                <Plus size={16} className="text-gray-400" />
                <label className="text-sm font-medium text-gray-700">Add Product Component</label>
            </div>
            <input
                type="text"
                placeholder="Search by product name or SKU..."
                className="w-full border p-2 rounded-lg"
                value={searchTerm}
                onChange={(e) => onSearchChange(e.target.value)}
            />
            {/* Search Results Dropdown - use high z-index to escape overflow */}
            {searchResults.length > 0 && (
                <div className="absolute z-50 w-full bg-white border border-gray-200 rounded-xl shadow-xl mt-1 max-h-96 overflow-y-auto">
                    {searchResults
                        // Filter out products that can't be added as components (but allow internal products)
                        .filter(p => (p.isInternalProduct || (!p.hasBOM && p.id !== productId)))
                        .map(p => {
                            const hasVariants = p.searchableVariants && p.searchableVariants.length > 0;
                            // Internal products are always clickable, WooCommerce products only if no variants
                            const isClickable = p.isInternalProduct || !hasVariants;

                            return (
                                <div key={p.id} className="border-b border-gray-50 last:border-b-0">
                                    {/* Parent product row */}
                                    <button
                                        disabled={!isClickable}
                                        className={`w-full text-left p-3 transition-colors flex items-center gap-3 ${isClickable
                                            ? 'hover:bg-blue-50 cursor-pointer'
                                            : 'bg-gray-50/50 cursor-default'
                                            } ${p.isInternalProduct ? 'bg-purple-50/30' : ''}`}
                                        onClick={() => {
                                            if (isClickable) onAddProduct(p);
                                        }}
                                    >
                                        {p.mainImage ? (
                                            <img src={p.mainImage} alt="" className="w-10 h-10 object-cover rounded-lg border border-gray-100" loading="lazy" />
                                        ) : p.isInternalProduct ? (
                                            <div className="w-10 h-10 bg-purple-100 rounded-lg border border-purple-200 flex items-center justify-center">
                                                <Package size={16} className="text-purple-500" />
                                            </div>
                                        ) : null}
                                        <div className="flex-1 min-w-0">
                                            <div className="font-medium text-gray-900 text-sm truncate">
                                                {p.name}
                                                {p.isInternalProduct && (
                                                    <span className="ml-2 text-xs text-purple-600 bg-purple-100 px-1.5 py-0.5 rounded-full border border-purple-200">
                                                        Internal
                                                    </span>
                                                )}
                                                {hasVariants && (
                                                    <span className="ml-2 text-xs text-blue-600 bg-blue-50 px-1.5 py-0.5 rounded-full border border-blue-200">
                                                        {p.searchableVariants.length} variant{p.searchableVariants.length > 1 ? 's' : ''}
                                                    </span>
                                                )}
                                            </div>
                                            <div className="text-xs text-gray-500">
                                                {p.sku && <span className="font-mono">{p.sku}</span>}
                                                {p.sku && p.stockQuantity !== undefined && <span className="mx-1">•</span>}
                                                {p.stockQuantity !== undefined && <span>Stock: {p.stockQuantity}</span>}
                                            </div>
                                        </div>
                                        {isClickable && <div className="text-sm font-semibold text-gray-700">${p.cogs || p.price || '0.00'}</div>}
                                    </button>

                                    {/* Variant sub-options */}
                                    {hasVariants && (
                                        <div className="bg-gray-50/30 border-t border-gray-100">
                                            {p.searchableVariants.map((v: any) => (
                                                <button
                                                    key={v.id}
                                                    className="w-full text-left pl-8 pr-3 py-2 transition-colors flex items-center gap-3 hover:bg-blue-50 border-b border-gray-50 last:border-b-0"
                                                    onClick={() => onAddProduct({
                                                        id: p.id,
                                                        name: `${p.name} - ${v.attributeString || v.sku || `#${v.wooId}`}`,
                                                        cogs: v.cogs,
                                                        sku: v.sku,
                                                        stockQuantity: v.stockQuantity,
                                                        variantId: v.wooId,
                                                        isVariant: true
                                                    })}
                                                >
                                                    <GitBranch size={14} className="text-gray-400 flex-shrink-0" />
                                                    <div className="flex-1 min-w-0">
                                                        <div className="font-medium text-gray-800 text-sm truncate">
                                                            {v.attributeString || `Variant #${v.wooId}`}
                                                        </div>
                                                        <div className="text-xs text-gray-500">
                                                            {v.sku && <span className="font-mono">{v.sku}</span>}
                                                            {v.sku && v.stockQuantity !== undefined && <span className="mx-1">•</span>}
                                                            {v.stockQuantity !== undefined && <span>Stock: {v.stockQuantity}</span>}
                                                        </div>
                                                    </div>
                                                    <div className="text-xs font-medium text-gray-600">
                                                        COGS: ${v.cogs?.toFixed(2) || '0.00'}
                                                    </div>
                                                </button>
                                            ))}
                                        </div>
                                    )}
                                </div>
                            );
                        })}
                </div>
            )}
        </div>
    );
}
