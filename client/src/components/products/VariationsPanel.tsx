import React, { useState } from 'react';
import { Layers, ChevronDown, ChevronRight } from 'lucide-react';
import { BOMPanel } from './BOMPanel';

// ... (ProductVariant and interface remain same)
interface ProductVariant {
    id: number;
    sku: string;
    price: string;
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
    onManage?: () => void;
}

export const VariationsPanel: React.FC<VariationsPanelProps> = ({ product, variants, onManage }) => {
    const [expandedId, setExpandedId] = useState<number | null>(null);

    if (product.type !== 'variable') return null;

    const toggleExpand = (id: number) => {
        setExpandedId(expandedId === id ? null : id);
    };

    return (
        <div className="bg-white/70 backdrop-blur-md rounded-xl shadow-sm border border-white/50 overflow-hidden animate-in fade-in slide-in-from-bottom-4 duration-500">
            <div className="px-6 py-4 border-b border-gray-100/50 bg-white/30 flex justify-between items-center">
                <div className="flex items-center gap-2">
                    <Layers size={16} className="text-blue-600" />
                    <h3 className="font-bold text-gray-900 uppercase tracking-wide text-sm">Variations</h3>
                    <span className="bg-blue-100 text-blue-700 px-2 py-0.5 rounded-full text-xs font-medium">{product.variations?.length || 0}</span>
                </div>
                <button
                    onClick={onManage}
                    className="text-sm text-blue-600 font-medium hover:text-blue-800 transition-colors"
                >
                    Manage in WooCommerce
                </button>
            </div>
            <div className="p-0">
                <table className="w-full text-left text-sm">
                    <thead className="bg-gray-50/50 text-gray-500 font-medium border-b border-gray-100/50">
                        <tr>
                            <th className="w-8"></th>
                            <th className="px-6 py-3">ID</th>
                            <th className="px-6 py-3">SKU</th>
                            <th className="px-6 py-3">Price</th>
                            <th className="px-6 py-3">Attributes</th>
                        </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-100/50">
                        {variants.length === 0 ? (
                            <tr><td colSpan={5} className="px-6 py-12 text-center text-gray-400">No variations loaded via API yet.</td></tr>
                        ) : (
                            variants.map(v => (
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
                                        <td className="px-6 py-4 font-medium text-gray-900">{v.price}</td>
                                        <td className="px-6 py-4 text-gray-500">
                                            <span className="inline-flex items-center px-2 py-1 rounded-md bg-gray-100 text-xs text-gray-600">
                                                Placeholder Attributes
                                            </span>
                                        </td>
                                    </tr>
                                    {expandedId === v.id && (
                                        <tr className="bg-gray-50/30">
                                            <td colSpan={5} className="p-4 border-t border-gray-100/50">
                                                <div className="ml-8 border-l-2 border-blue-100 pl-4">
                                                    <BOMPanel productId={product.id} fixedVariationId={v.id} />
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
