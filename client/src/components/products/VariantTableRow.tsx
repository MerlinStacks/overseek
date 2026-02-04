/**
 * VariantTableRow
 * 
 * Single variant row with inline editing for SKU, price, stock, and dimensions.
 */
import React, { memo } from 'react';
import { ChevronDown, ChevronRight, Package, Loader2 } from 'lucide-react';
import { ProductVariant, getVariantImage } from './variantTypes';

interface VariantTableRowProps {
    variant: ProductVariant;
    isExpanded: boolean;
    onToggleExpand: () => void;
    onFieldChange: (field: keyof ProductVariant, value: any) => void;
    stockEditValue: string;
    onStockEditChange: (value: string) => void;
    onStockAdjust: (delta: number) => void;
    onStockSave: () => void;
    isSavingStock: boolean;
}

export const VariantTableRow = memo(function VariantTableRow({
    variant: v,
    isExpanded,
    onToggleExpand,
    onFieldChange,
    stockEditValue,
    onStockEditChange,
    onStockAdjust,
    onStockSave,
    isSavingStock
}: VariantTableRowProps) {
    const imageUrl = getVariantImage(v);
    const stockUnchanged = stockEditValue === (v.stockQuantity?.toString() ?? '');

    return (
        <tr className={`hover:bg-blue-50/30 transition-colors group ${isExpanded ? 'bg-blue-50/20' : ''}`}>
            <td className="pl-4 text-gray-400 cursor-pointer" onClick={onToggleExpand}>
                {isExpanded ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
            </td>
            <td className="px-2 py-2">
                {imageUrl ? (
                    <img src={imageUrl} alt="" className="w-12 h-12 object-cover rounded-lg border border-gray-100" loading="lazy" />
                ) : (
                    <div className="w-12 h-12 bg-gray-100 rounded-lg flex items-center justify-center text-gray-400">
                        <Package size={16} />
                    </div>
                )}
            </td>
            <td className="px-4 py-2">
                <div className="flex flex-wrap gap-1">
                    {v.attributes?.length > 0 ? (
                        v.attributes.map((attr: any, idx: number) => (
                            <span key={idx} className="inline-flex items-center px-2 py-0.5 rounded-full text-xs bg-gray-100 text-gray-700">
                                <span className="font-medium text-gray-500">{attr.name}:</span>
                                <span className="ml-1">{attr.option}</span>
                            </span>
                        ))
                    ) : (
                        <span className="text-xs text-gray-400 font-mono">#{v.id}</span>
                    )}
                </div>
            </td>
            <td className="px-4 py-2">
                <input
                    type="text"
                    value={v.sku || ''}
                    onChange={(e) => onFieldChange('sku', e.target.value)}
                    className="w-full font-mono text-sm px-2 py-1.5 border border-gray-200 rounded-lg focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 outline-none transition-all"
                    placeholder="SKU"
                    onClick={(e) => e.stopPropagation()}
                />
            </td>
            <td className="px-4 py-2">
                <div className="relative">
                    <span className="absolute left-2 top-1/2 -translate-y-1/2 text-gray-400 text-sm">$</span>
                    <input
                        type="number"
                        step="0.01"
                        value={v.price || ''}
                        onChange={(e) => onFieldChange('price', e.target.value)}
                        className="w-full text-sm pl-5 pr-2 py-1.5 border border-gray-200 rounded-lg focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 outline-none transition-all"
                        placeholder="0.00"
                        onClick={(e) => e.stopPropagation()}
                    />
                </div>
            </td>
            <td className="px-4 py-2">
                <div className="relative">
                    <span className="absolute left-2 top-1/2 -translate-y-1/2 text-gray-400 text-sm">$</span>
                    <input
                        type="number"
                        step="0.01"
                        value={v.salePrice || ''}
                        onChange={(e) => onFieldChange('salePrice', e.target.value)}
                        className="w-full text-sm pl-5 pr-2 py-1.5 border border-gray-200 rounded-lg focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 outline-none transition-all"
                        placeholder="—"
                        onClick={(e) => e.stopPropagation()}
                    />
                </div>
            </td>
            <td className="px-4 py-2">
                <input
                    type="number"
                    step="0.01"
                    min="0"
                    value={v.weight || ''}
                    onChange={(e) => onFieldChange('weight', e.target.value)}
                    className="w-full font-mono text-sm px-2 py-1.5 border border-gray-200 rounded-lg focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 outline-none transition-all"
                    placeholder="0.00"
                    onClick={(e) => e.stopPropagation()}
                />
            </td>
            <td className="px-4 py-2">
                <div className="flex items-center gap-0.5" onClick={(e) => e.stopPropagation()}>
                    <input
                        type="number" step="0.01" min="0"
                        value={v.dimensions?.length || ''}
                        onChange={(e) => onFieldChange('dimensions', { ...v.dimensions, length: e.target.value })}
                        className="w-12 font-mono text-xs px-1 py-1 border border-gray-200 rounded focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 outline-none"
                        placeholder="L" title="Length"
                    />
                    <span className="text-gray-400 text-xs">×</span>
                    <input
                        type="number" step="0.01" min="0"
                        value={v.dimensions?.width || ''}
                        onChange={(e) => onFieldChange('dimensions', { ...v.dimensions, width: e.target.value })}
                        className="w-12 font-mono text-xs px-1 py-1 border border-gray-200 rounded focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 outline-none"
                        placeholder="W" title="Width"
                    />
                    <span className="text-gray-400 text-xs">×</span>
                    <input
                        type="number" step="0.01" min="0"
                        value={v.dimensions?.height || ''}
                        onChange={(e) => onFieldChange('dimensions', { ...v.dimensions, height: e.target.value })}
                        className="w-12 font-mono text-xs px-1 py-1 border border-gray-200 rounded focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 outline-none"
                        placeholder="H" title="Height"
                    />
                </div>
            </td>
            <td className="px-4 py-2">
                {v.manageStock ? (
                    <div className="flex items-center gap-1" onClick={(e) => e.stopPropagation()}>
                        <button
                            type="button"
                            onClick={() => onStockAdjust(-1)}
                            className="w-6 h-6 flex items-center justify-center bg-gray-100 border border-gray-200 rounded text-gray-600 hover:bg-gray-200 transition-colors text-xs font-bold"
                        >−</button>
                        <input
                            type="number" min="0"
                            value={stockEditValue}
                            onChange={(e) => onStockEditChange(e.target.value)}
                            className="w-14 px-1 py-1 text-center font-mono text-sm bg-white border border-gray-200 rounded focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 outline-none"
                        />
                        <button
                            type="button"
                            onClick={() => onStockAdjust(1)}
                            className="w-6 h-6 flex items-center justify-center bg-gray-100 border border-gray-200 rounded text-gray-600 hover:bg-gray-200 transition-colors text-xs font-bold"
                        >+</button>
                        <button
                            type="button"
                            onClick={onStockSave}
                            disabled={isSavingStock || stockUnchanged}
                            className="ml-1 px-2 py-1 bg-blue-600 text-white text-xs font-medium rounded hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                        >
                            {isSavingStock ? <Loader2 className="animate-spin" size={12} /> : 'Save'}
                        </button>
                    </div>
                ) : (
                    <span className="text-xs text-gray-400 italic">Not tracked</span>
                )}
            </td>
        </tr>
    );
});
