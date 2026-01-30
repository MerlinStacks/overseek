import * as React from 'react';
import { Package, Ruler, ToggleLeft, ToggleRight } from 'lucide-react';
import { StockManagementPanel } from './StockManagementPanel';

interface LogisticsPanelProps {
    formData: {
        stockStatus: string;
        manageStock: boolean;
        backorders: 'no' | 'notify' | 'yes';
        binLocation: string;
        weight: string;
        length: string;
        width: string;
        height: string;
    };
    weightUnit?: string;
    dimensionUnit?: string;
    productWooId?: number;
    variants?: Array<{
        id: number;
        sku?: string;
        attributes?: Array<{ name: string; option: string }>;
        stock_quantity?: number | null;
        stock_status?: string;
    }>;
    onChange: (updates: any) => void;
}

export function LogisticsPanel({ formData, weightUnit = 'kg', dimensionUnit = 'cm', productWooId, variants, onChange }: LogisticsPanelProps) {
    const hasVariants = variants && variants.length > 0;

    return (
        <div className="space-y-6">
            {/* Stock Management - shown only for simple products (no variants) when manageStock is enabled */}
            {/* For variable products, stock is managed per-variant in the Variations tab */}
            {productWooId && !hasVariants && formData.manageStock && (
                <StockManagementPanel productWooId={productWooId} />
            )}

            <div className="bg-white/70 backdrop-blur-md rounded-xl shadow-xs border border-white/50 p-6 animate-in fade-in slide-in-from-bottom-4 duration-500">
                <h3 className="text-sm font-bold text-gray-900 uppercase tracking-wide mb-4 flex items-center gap-2">
                    <Package size={16} className="text-blue-600" />
                    Inventory &amp; Shipping
                </h3>

                <div className="space-y-6">
                    {/* Inventory Tracking Toggle */}
                    <div className="flex items-center justify-between py-3 px-4 bg-gray-50/80 rounded-lg border border-gray-100">
                        <div>
                            <span className="text-sm font-medium text-gray-700">Enable Inventory Tracking</span>
                            <p className="text-xs text-gray-500 mt-0.5">Track stock quantities for this product</p>
                        </div>
                        <button
                            type="button"
                            onClick={() => onChange({ manageStock: !formData.manageStock })}
                            className={`flex items-center gap-2 px-3 py-1.5 rounded-full text-sm font-medium transition-colors ${formData.manageStock
                                    ? 'bg-blue-100 text-blue-700 border border-blue-200'
                                    : 'bg-gray-100 text-gray-500 border border-gray-200'
                                }`}
                        >
                            {formData.manageStock ? (
                                <>
                                    <ToggleRight size={18} />
                                    Enabled
                                </>
                            ) : (
                                <>
                                    <ToggleLeft size={18} />
                                    Disabled
                                </>
                            )}
                        </button>
                    </div>

                    {/* Stock controls - only shown when manageStock is enabled */}
                    {formData.manageStock && (
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                            <div>
                                <label className="block text-sm font-medium text-gray-700 mb-1">Stock Status</label>
                                <select
                                    value={formData.stockStatus}
                                    onChange={(e) => onChange({ stockStatus: e.target.value })}
                                    className="w-full px-3 py-2 bg-white/50 border border-gray-200 rounded-lg text-sm focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 outline-hidden transition-all"
                                >
                                    <option value="instock">In Stock</option>
                                    <option value="outofstock">Out of Stock</option>
                                    <option value="onbackorder">On Backorder</option>
                                </select>
                            </div>

                            <div>
                                <label className="block text-sm font-medium text-gray-700 mb-1">Allow Backorders</label>
                                <select
                                    value={formData.backorders}
                                    onChange={(e) => onChange({ backorders: e.target.value })}
                                    className="w-full px-3 py-2 bg-white/50 border border-gray-200 rounded-lg text-sm focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 outline-hidden transition-all"
                                >
                                    <option value="no">Do not allow</option>
                                    <option value="notify">Allow, but notify customer</option>
                                    <option value="yes">Allow</option>
                                </select>
                            </div>
                        </div>
                    )}

                    {/* Variable product notice */}
                    {hasVariants && formData.manageStock && (
                        <p className="text-xs text-blue-600 bg-blue-50 rounded-lg p-3 border border-blue-100">
                            Stock is managed per-variant. Go to the <strong>Variations</strong> tab to edit stock for each variant.
                        </p>
                    )}

                    <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                        <div>
                            <label className="block text-sm font-medium text-gray-700 mb-1">Bin Location</label>
                            <input
                                type="text"
                                value={formData.binLocation}
                                onChange={(e) => onChange({ binLocation: e.target.value })}
                                placeholder="e.g. A-12-4"
                                className="w-full px-3 py-2 bg-white/50 border border-gray-200 rounded-lg text-sm focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 outline-hidden transition-all"
                            />
                        </div>
                    </div>
                </div>

                <div className="mt-8 pt-6 border-t border-gray-100/50">
                    <h4 className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-4 flex items-center gap-2">
                        <Ruler size={14} /> Dimensions &amp; Weight
                    </h4>
                    <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                        <div>
                            <label className="block text-xs font-medium text-gray-500 mb-1">Weight ({weightUnit})</label>
                            <input
                                type="number"
                                step="0.01"
                                value={formData.weight}
                                onChange={(e) => onChange({ weight: e.target.value })}
                                className="w-full px-3 py-2 bg-white/50 border border-gray-200 rounded-lg text-sm focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 outline-hidden transition-all"
                            />
                        </div>
                        <div>
                            <label className="block text-xs font-medium text-gray-500 mb-1">Length ({dimensionUnit})</label>
                            <input
                                type="number"
                                step="0.01"
                                value={formData.length}
                                onChange={(e) => onChange({ length: e.target.value })}
                                className="w-full px-3 py-2 bg-white/50 border border-gray-200 rounded-lg text-sm focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 outline-hidden transition-all"
                            />
                        </div>
                        <div>
                            <label className="block text-xs font-medium text-gray-500 mb-1">Width ({dimensionUnit})</label>
                            <input
                                type="number"
                                step="0.01"
                                value={formData.width}
                                onChange={(e) => onChange({ width: e.target.value })}
                                className="w-full px-3 py-2 bg-white/50 border border-gray-200 rounded-lg text-sm focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 outline-hidden transition-all"
                            />
                        </div>
                        <div>
                            <label className="block text-xs font-medium text-gray-500 mb-1">Height ({dimensionUnit})</label>
                            <input
                                type="number"
                                step="0.01"
                                value={formData.height}
                                onChange={(e) => onChange({ height: e.target.value })}
                                className="w-full px-3 py-2 bg-white/50 border border-gray-200 rounded-lg text-sm focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 outline-hidden transition-all"
                            />
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
}

