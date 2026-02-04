/**
 * VariantExpandedDetails
 * 
 * Expanded detail row for a variant showing inventory settings, COGS, gold pricing, 
 * profit margins, and BOM configuration.
 */
import React from 'react';
import { DollarSign, TrendingUp } from 'lucide-react';
import { ProductVariant } from './variantTypes';
import { BOMPanel, BOMPanelRef } from './BOMPanel';

interface VariantExpandedDetailsProps {
    variant: ProductVariant;
    productId: string;
    bomPanelRef: (ref: BOMPanelRef | null) => void;
    onFieldChange: (field: keyof ProductVariant, value: any) => void;
    onMultiFieldChange: (updates: Partial<ProductVariant>) => void;
    onBomCogsUpdate: (cogs: number) => void;
    canViewCogs: boolean;
    isGoldPriceEnabled: boolean;
    bomCogs: number | null;
    bomCogsLoading: boolean;
    calculateGoldCogs: (variant: ProductVariant) => number | null;
}

export function VariantExpandedDetails({
    variant: v,
    productId,
    bomPanelRef,
    onFieldChange,
    onMultiFieldChange,
    onBomCogsUpdate,
    canViewCogs,
    isGoldPriceEnabled,
    bomCogs,
    bomCogsLoading,
    calculateGoldCogs
}: VariantExpandedDetailsProps) {
    const goldCogs = calculateGoldCogs(v);
    const hasBom = bomCogs != null && bomCogs > 0;
    const hasGold = goldCogs != null && goldCogs > 0;

    return (
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
                            onClick={() => onFieldChange('manageStock', !v.manageStock)}
                            className={`px-2 py-1 rounded-full text-xs font-medium transition-colors ${v.manageStock
                                ? 'bg-blue-100 text-blue-700 border border-blue-200'
                                : 'bg-gray-100 text-gray-500 border border-gray-200'
                                }`}
                        >
                            {v.manageStock ? 'Enabled' : 'Disabled'}
                        </button>
                    </div>

                    {/* Stock controls */}
                    {v.manageStock && (
                        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                            <div>
                                <label className="block text-xs font-medium text-gray-500 mb-1">Stock Status</label>
                                <select
                                    value={v.stockStatus || 'instock'}
                                    onChange={(e) => onFieldChange('stockStatus', e.target.value)}
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
                                    onChange={(e) => onFieldChange('backorders', e.target.value)}
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
                                <label className="block text-xs font-medium text-gray-500 mb-1 flex items-center gap-1">
                                    COGS (Cost)
                                    {hasBom && <span className="text-[10px] text-purple-600 bg-purple-50 px-1.5 py-0.5 rounded border border-purple-200">BOM</span>}
                                    {!hasBom && hasGold && <span className="text-[10px] text-amber-600 bg-amber-50 px-1.5 py-0.5 rounded border border-amber-200">Gold</span>}
                                </label>
                                {bomCogsLoading ? (
                                    <div className="w-full h-[34px] bg-gray-100 rounded-lg animate-pulse" />
                                ) : hasBom ? (
                                    <div className="w-full text-sm px-3 py-1.5 bg-purple-50/50 border border-purple-200 rounded-lg text-purple-800 font-medium">
                                        ${bomCogs!.toFixed(2)}
                                    </div>
                                ) : hasGold ? (
                                    <div className="w-full text-sm px-3 py-1.5 bg-amber-50/50 border border-amber-200 rounded-lg text-amber-800 font-medium">
                                        ${goldCogs!.toFixed(2)}
                                    </div>
                                ) : (
                                    <input
                                        type="number" step="0.01"
                                        value={v.cogs || ''}
                                        onChange={(e) => {
                                            if (e.target.value.length <= 10) {
                                                onFieldChange('cogs', e.target.value);
                                            }
                                        }}
                                        className="w-full text-sm px-3 py-1.5 border border-gray-200 rounded-lg"
                                        placeholder="0.00"
                                    />
                                )}
                            </div>
                        )}
                        <div>
                            <label className="block text-xs font-medium text-gray-500 mb-1">Bin Location</label>
                            <input
                                type="text"
                                value={v.binLocation || ''}
                                onChange={(e) => onFieldChange('binLocation', e.target.value)}
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
                                        onMultiFieldChange({
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

                    {/* Profit Margin Calculator */}
                    {canViewCogs && <ProfitMarginDisplay variant={v} bomCogs={bomCogs} goldCogs={goldCogs} />}

                    {/* BOM Panel */}
                    <div className="border-l-2 border-blue-100 pl-4">
                        <h4 className="text-sm font-semibold text-gray-800 mb-2">Components (BOM)</h4>
                        <BOMPanel
                            ref={bomPanelRef}
                            productId={productId}
                            fixedVariationId={v.id}
                            onCOGSUpdate={onBomCogsUpdate}
                        />
                    </div>
                </div>
            </td>
        </tr>
    );
}

/**
 * Profit margin display component.
 */
function ProfitMarginDisplay({
    variant: v,
    bomCogs,
    goldCogs
}: {
    variant: ProductVariant;
    bomCogs: number | null;
    goldCogs: number | null;
}) {
    const sellingPrice = parseFloat(v.salePrice || '') || parseFloat(v.price || '') || 0;
    const hasBom = bomCogs != null && bomCogs > 0;
    const hasGold = goldCogs != null && goldCogs > 0;

    let effectiveCogs = 0;
    let cogsSource: 'bom' | 'gold' | 'manual' | 'none' = 'none';

    if (hasBom) {
        effectiveCogs = bomCogs!;
        cogsSource = 'bom';
    } else if (hasGold) {
        effectiveCogs = goldCogs!;
        cogsSource = 'gold';
    } else {
        effectiveCogs = parseFloat(v.cogs || '') || 0;
        if (effectiveCogs > 0) cogsSource = 'manual';
    }

    const hasCogs = effectiveCogs > 0;
    const hasPrice = sellingPrice > 0;

    if (!hasPrice && !hasCogs) return null;

    const profitDollar = sellingPrice - effectiveCogs;
    const profitPercent = sellingPrice > 0 ? ((profitDollar / sellingPrice) * 100) : 0;

    return (
        <div className="mb-4 p-3 bg-gray-50/80 rounded-lg border border-gray-100">
            <div className="flex items-center justify-between">
                <span className="text-xs font-medium text-gray-600 flex items-center gap-1">
                    <TrendingUp size={12} />
                    Profit Margin
                </span>
                {hasCogs && hasPrice ? (
                    <div className="flex items-center gap-2">
                        <span className={`text-sm font-bold ${profitDollar >= 0 ? 'text-green-600' : 'text-red-600'}`}>
                            ${profitDollar.toFixed(2)}
                        </span>
                        <span className={`px-1.5 py-0.5 rounded-full text-xs font-medium ${profitPercent >= 0
                            ? 'bg-green-50 text-green-700 border border-green-200'
                            : 'bg-red-50 text-red-700 border border-red-200'
                            }`}>
                            {profitPercent >= 0 ? '+' : ''}{profitPercent.toFixed(1)}%
                        </span>
                    </div>
                ) : (
                    <span className="text-xs text-gray-400 italic">
                        {!hasCogs ? 'Enter COGS to calculate' : 'Enter price to calculate'}
                    </span>
                )}
            </div>
            {hasCogs && hasPrice && (
                <p className="text-[10px] text-gray-500 mt-1">
                    Based on {v.salePrice && parseFloat(v.salePrice) > 0 ? 'sale' : 'regular'} price of ${sellingPrice.toFixed(2)}
                    {cogsSource === 'bom' && ' • BOM-calculated COGS'}
                    {cogsSource === 'gold' && ' • Gold price COGS'}
                </p>
            )}
        </div>
    );
}
