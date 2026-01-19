import React, { useState, useEffect } from 'react';
import { Layers, ChevronDown, ChevronRight, Package, DollarSign } from 'lucide-react';
import { BOMPanel } from './BOMPanel';
import { useAccountFeature } from '../../hooks/useAccountFeature';

interface ProductVariant {
    id: number;
    sku: string;
    price: string;
    salePrice?: string;
    cogs?: string;
    binLocation?: string;
    stockStatus?: string;
    stockQuantity?: number;
    weight?: string;
    dimensions?: {
        length?: string;
        width?: string;
        height?: string;
    };
    image?: { src: string } | null; // Single image for variation
    images?: any[];
    attributes: any[];
    // Gold Price fields
    isGoldPriceApplied?: boolean;
    goldPriceType?: string | null;
}

interface VariationsPanelProps {
    product: {
        id: string;
        type?: string;
        variations?: number[];
        wooId: number;
    };
    variants: ProductVariant[];
    onUpdate?: (updatedVariants: ProductVariant[]) => void;
}

/**
 * Variations panel with inline editing for SKU, price, and stock.
 * Shows variation image thumbnails and expanded details with BOM configuration.
 */
export const VariationsPanel: React.FC<VariationsPanelProps> = ({ product, variants, onUpdate }) => {
    const [expandedId, setExpandedId] = useState<number | null>(null);
    const [editingVariants, setEditingVariants] = useState<ProductVariant[]>(variants);
    const isGoldPriceEnabled = useAccountFeature('GOLD_PRICE_CALCULATOR');

    useEffect(() => {
        setEditingVariants(variants);
    }, [variants]);

    // Support ATUM's custom variable types (e.g., 'variable-product-part') and any product with variations
    const hasVariations = product.type?.includes('variable') || (product.variations && product.variations.length > 0);
    if (!hasVariations) return null;

    const toggleExpand = (id: number) => {
        setExpandedId(expandedId === id ? null : id);
    };

    const handleFieldChange = (id: number, field: keyof ProductVariant, value: any) => {
        const updated = editingVariants.map(v =>
            v.id === id ? { ...v, [field]: value } : v
        );
        setEditingVariants(updated);
        if (onUpdate) onUpdate(updated);
    };

    // Get variation image from either image object or images array
    const getVariantImage = (v: ProductVariant): string | null => {
        if (v.image?.src) return v.image.src;
        if (v.images && v.images.length > 0) {
            return v.images[0]?.src || v.images[0];
        }
        return null;
    };

    return (
        <div className="bg-white/70 backdrop-blur-md rounded-xl shadow-xs border border-white/50 overflow-hidden animate-in fade-in slide-in-from-bottom-4 duration-500">
            <div className="px-6 py-4 border-b border-gray-100/50 bg-white/30 flex justify-between items-center">
                <div className="flex items-center gap-2">
                    <Layers size={16} className="text-blue-600" />
                    <h3 className="font-bold text-gray-900 uppercase tracking-wide text-sm">Variations</h3>
                    <span className="bg-blue-100 text-blue-700 px-2 py-0.5 rounded-full text-xs font-medium">{product.variations?.length || 0}</span>
                </div>
            </div>
            <div className="p-0 overflow-x-auto">
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
                                    <tr className={`hover:bg-blue-50/30 transition-colors group ${expandedId === v.id ? 'bg-blue-50/20' : ''}`}>
                                        <td
                                            className="pl-4 text-gray-400 cursor-pointer"
                                            onClick={() => toggleExpand(v.id)}
                                        >
                                            {expandedId === v.id ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
                                        </td>
                                        <td className="px-2 py-2">
                                            {getVariantImage(v) ? (
                                                <img
                                                    src={getVariantImage(v)!}
                                                    alt=""
                                                    className="w-12 h-12 object-cover rounded-lg border border-gray-100"
                                                />
                                            ) : (
                                                <div className="w-12 h-12 bg-gray-100 rounded-lg flex items-center justify-center text-gray-400">
                                                    <Package size={16} />
                                                </div>
                                            )}
                                        </td>
                                        <td className="px-4 py-2">
                                            <div className="flex flex-wrap gap-1">
                                                {v.attributes && v.attributes.length > 0 ? (
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
                                                onChange={(e) => handleFieldChange(v.id, 'sku', e.target.value)}
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
                                                    onChange={(e) => handleFieldChange(v.id, 'price', e.target.value)}
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
                                                    onChange={(e) => handleFieldChange(v.id, 'salePrice', e.target.value)}
                                                    className="w-full text-sm pl-5 pr-2 py-1.5 border border-gray-200 rounded-lg focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 outline-none transition-all"
                                                    placeholder="—"
                                                    onClick={(e) => e.stopPropagation()}
                                                />
                                            </div>
                                        </td>
                                        <td className="px-4 py-2">
                                            <span className="text-sm text-gray-700 font-mono">
                                                {v.weight || '—'}
                                            </span>
                                        </td>
                                        <td className="px-4 py-2">
                                            <span className="text-xs text-gray-600 font-mono">
                                                {(v.dimensions?.length || v.dimensions?.width || v.dimensions?.height)
                                                    ? `${v.dimensions.length || '—'} × ${v.dimensions.width || '—'} × ${v.dimensions.height || '—'}`
                                                    : '—'}
                                            </span>
                                        </td>
                                        <td className="px-4 py-2">
                                            <div className="flex items-center gap-2">
                                                {typeof v.stockQuantity === 'number' && (
                                                    <span className="font-mono text-gray-700 font-medium text-sm">{v.stockQuantity}</span>
                                                )}
                                                <span className={`px-2 py-0.5 rounded-full text-xs ${v.stockStatus === 'instock' ? 'bg-green-100 text-green-700' : v.stockStatus === 'onbackorder' ? 'bg-yellow-100 text-yellow-700' : 'bg-red-100 text-red-700'}`}>
                                                    {v.stockStatus === 'instock' ? 'In Stock' : v.stockStatus === 'onbackorder' ? 'Backorder' : 'Out'}
                                                </span>
                                            </div>
                                        </td>
                                    </tr>
                                    {expandedId === v.id && (
                                        <tr className="bg-gray-50/30">
                                            <td colSpan={9} className="p-4 border-t border-gray-100/50">
                                                <div className="ml-8 space-y-4">
                                                    {/* Additional fields */}
                                                    <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-4">
                                                        <div>
                                                            <label className="block text-xs font-medium text-gray-500 mb-1">Stock Status</label>
                                                            <select
                                                                value={v.stockStatus || 'instock'}
                                                                onChange={(e) => handleFieldChange(v.id, 'stockStatus', e.target.value)}
                                                                className="w-full text-sm px-3 py-1.5 border border-gray-200 rounded-lg"
                                                            >
                                                                <option value="instock">In Stock</option>
                                                                <option value="outofstock">Out of Stock</option>
                                                                <option value="onbackorder">On Backorder</option>
                                                            </select>
                                                        </div>
                                                        <div>
                                                            <label className="block text-xs font-medium text-gray-500 mb-1">COGS (Cost)</label>
                                                            <input
                                                                type="number" step="0.01"
                                                                value={v.cogs || ''}
                                                                onChange={(e) => handleFieldChange(v.id, 'cogs', e.target.value)}
                                                                className="w-full text-sm px-3 py-1.5 border border-gray-200 rounded-lg"
                                                                placeholder="0.00"
                                                            />
                                                        </div>
                                                        <div>
                                                            <label className="block text-xs font-medium text-gray-500 mb-1">Bin Location</label>
                                                            <input
                                                                type="text"
                                                                value={v.binLocation || ''}
                                                                onChange={(e) => handleFieldChange(v.id, 'binLocation', e.target.value)}
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
                                                                        handleFieldChange(v.id, 'goldPriceType', newType === 'none' ? null : newType);
                                                                        handleFieldChange(v.id, 'isGoldPriceApplied', newType !== 'none');
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

                                                    <div className="border-l-2 border-blue-100 pl-4">
                                                        <h4 className="text-sm font-semibold text-gray-800 mb-2">Components (BOM)</h4>
                                                        <BOMPanel productId={product.id} fixedVariationId={v.id} />
                                                    </div>
                                                </div>
                                            </td>
                                        </tr>
                                    )}
                                </React.Fragment>
                            ))
                        )}
                    </tbody>
                </table>
            </div>
        </div>
    );
};
