import React, { useState } from 'react';
import { Layers, ChevronDown, ChevronRight } from 'lucide-react';
import { BOMPanel } from './BOMPanel';

interface ProductVariant {
    id: number;
    sku: string;
    price: string;
    salePrice?: string;
    cogs?: string; // Cost of Goods Sold
    binLocation?: string;
    stockStatus?: string;
    images?: any[];
    attributes: any[];
}

interface VariationsPanelProps {
    product: {
        id: string; // Internal UUID needed for BOM
        type?: string;
        variations?: number[];
        wooId: number; // For "Manage in Woo" link
    };
    variants: ProductVariant[];
    onUpdate?: (updatedVariants: ProductVariant[]) => void;
}

export const VariationsPanel: React.FC<VariationsPanelProps> = ({ product, variants, onUpdate }) => {
    const [expandedId, setExpandedId] = useState<number | null>(null);
    const [editingVariants, setEditingVariants] = useState<ProductVariant[]>(variants);

    useEffect(() => {
        setEditingVariants(variants);
    }, [variants]);

    if (product.type !== 'variable') return null;

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

    return (
        <div className="bg-white/70 backdrop-blur-md rounded-xl shadow-xs border border-white/50 overflow-hidden animate-in fade-in slide-in-from-bottom-4 duration-500">
            <div className="px-6 py-4 border-b border-gray-100/50 bg-white/30 flex justify-between items-center">
                <div className="flex items-center gap-2">
                    <Layers size={16} className="text-blue-600" />
                    <h3 className="font-bold text-gray-900 uppercase tracking-wide text-sm">Variations</h3>
                    <span className="bg-blue-100 text-blue-700 px-2 py-0.5 rounded-full text-xs font-medium">{product.variations?.length || 0}</span>
                </div>
                {/* manage link removed */}
            </div>
            <div className="p-0">
                <table className="w-full text-left text-sm">
                    <thead className="bg-gray-50/50 text-gray-500 font-medium border-b border-gray-100/50">
                        <tr>
                            <th className="w-8"></th>
                            <th className="px-6 py-3">ID</th>
                            <th className="px-6 py-3">SKU</th>
                            <th className="px-6 py-3">Price</th>
                            <th className="px-6 py-3">Stock</th>
                        </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-100/50">
                        {editingVariants.length === 0 ? (
                            <tr><td colSpan={5} className="px-6 py-12 text-center text-gray-400">No variations loaded via API yet.</td></tr>
                        ) : (
                            editingVariants.map(v => (
                                <React.Fragment key={v.id}>
                                    <tr
                                        onClick={() => toggleExpand(v.id)}
                                        className={`hover:bg-blue-50/30 transition-colors group cursor-pointer ${expandedId === v.id ? 'bg-blue-50/20' : ''}`}
                                    >
                                        <td className="pl-4 text-gray-400">
                                            {expandedId === v.id ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
                                        </td>
                                        <td className="px-6 py-4 font-mono text-gray-500">#{v.id}</td>
                                        <td className="px-6 py-4 font-mono font-medium text-gray-700">{v.sku}</td>
                                        <td className="px-6 py-4 font-medium text-gray-900">${v.price}</td>
                                        <td className="px-6 py-4">
                                            <span className={`px-2 py-1 rounded-full text-xs ${v.stockStatus === 'instock' ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'}`}>
                                                {v.stockStatus === 'instock' ? 'In Stock' : 'Out of Stock'}
                                            </span>
                                        </td>
                                    </tr>
                                    {expandedId === v.id && (
                                        <tr className="bg-gray-50/30">
                                            <td colSpan={5} className="p-4 border-t border-gray-100/50">
                                                <div className="ml-8 space-y-4">

                                                    {/* Quick Edit Fields */}
                                                    <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-4">
                                                        <div>
                                                            <label className="block text-xs font-medium text-gray-500 mb-1">SKU</label>
                                                            <input
                                                                type="text"
                                                                value={v.sku || ''}
                                                                onChange={(e) => handleFieldChange(v.id, 'sku', e.target.value)}
                                                                className="w-full text-sm border-gray-200 rounded-lg"
                                                            />
                                                        </div>
                                                        <div>
                                                            <label className="block text-xs font-medium text-gray-500 mb-1">Regular Price</label>
                                                            <input
                                                                type="number" step="0.01"
                                                                value={v.price || ''}
                                                                onChange={(e) => handleFieldChange(v.id, 'price', e.target.value)}
                                                                className="w-full text-sm border-gray-200 rounded-lg"
                                                            />
                                                        </div>
                                                        <div>
                                                            <label className="block text-xs font-medium text-gray-500 mb-1">Sale Price</label>
                                                            <input
                                                                type="number" step="0.01"
                                                                value={v.salePrice || ''}
                                                                onChange={(e) => handleFieldChange(v.id, 'salePrice', e.target.value)}
                                                                className="w-full text-sm border-gray-200 rounded-lg"
                                                            />
                                                        </div>
                                                        <div>
                                                            <label className="block text-xs font-medium text-gray-500 mb-1">Stock Status</label>
                                                            <select
                                                                value={v.stockStatus || 'instock'}
                                                                onChange={(e) => handleFieldChange(v.id, 'stockStatus', e.target.value)}
                                                                className="w-full text-sm border-gray-200 rounded-lg"
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
                                                                className="w-full text-sm border-gray-200 rounded-lg"
                                                                placeholder="0.00"
                                                            />
                                                        </div>
                                                        <div>
                                                            <label className="block text-xs font-medium text-gray-500 mb-1">Bin Location</label>
                                                            <input
                                                                type="text"
                                                                value={v.binLocation || ''}
                                                                onChange={(e) => handleFieldChange(v.id, 'binLocation', e.target.value)}
                                                                className="w-full text-sm border-gray-200 rounded-lg"
                                                                placeholder="e.g. A-01-02"
                                                            />
                                                        </div>
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
