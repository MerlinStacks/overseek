/**
 * Step 2: Product Selection
 * 
 * Allows users to select products to promote in their campaign.
 * Currently uses mock data - integrate with inventory API for production.
 */

import React, { useCallback, useMemo } from 'react';
import { Search, Check } from 'lucide-react';
import { WizardStepProps, WizardProduct } from '../types';

// TODO: Replace with actual inventory API call
const MOCK_PRODUCTS: WizardProduct[] = [
    { id: '1', name: 'Premium Leather Bag', price: 129.99, image: '👜' },
    { id: '2', name: 'Wireless Headphones', price: 89.99, image: '🎧' },
    { id: '3', name: 'Smart Watch Series 5', price: 299.99, image: '⌚' },
    { id: '4', name: 'Running Shoes', price: 119.99, image: '👟' },
    { id: '5', name: 'Cotton T-Shirt Pack', price: 49.99, image: '👕' },
    { id: '6', name: 'Designer Sunglasses', price: 159.99, image: '🕶️' },
];

export function StepProductSelection({ draft, setDraft }: WizardStepProps) {

    const selectedIds = useMemo(
        () => new Set(draft.selectedProducts.map(p => p.id)),
        [draft.selectedProducts]
    );

    const toggleProduct = useCallback((product: WizardProduct) => {
        setDraft(d => {
            const isSelected = d.selectedProducts.some(p => p.id === product.id);
            return {
                ...d,
                selectedProducts: isSelected
                    ? d.selectedProducts.filter(p => p.id !== product.id)
                    : [...d.selectedProducts, product]
            };
        });
    }, [setDraft]);

    const clearSelection = useCallback(() => {
        setDraft(d => ({ ...d, selectedProducts: [] }));
    }, [setDraft]);

    return (
        <div className="space-y-6 animate-in fade-in slide-in-from-right-4 duration-300">
            <div>
                <h3 className="text-2xl font-bold text-gray-900 mb-2">Select Products</h3>
                <p className="text-gray-500">Choose the products you want to feature in this campaign.</p>
            </div>

            {/* Search Bar */}
            <div className="relative">
                <Search className="absolute left-4 top-1/2 -translate-y-1/2 text-gray-400" size={20} />
                <input
                    type="text"
                    placeholder="Search inventory..."
                    className="w-full pl-12 pr-4 py-3 rounded-xl border border-gray-200 focus:border-blue-500 focus:ring-2 focus:ring-blue-100 outline-none transition-all"
                />
            </div>

            {/* Product Grid */}
            <div className="grid grid-cols-2 lg:grid-cols-3 gap-4 h-96 overflow-y-auto pr-2">
                {MOCK_PRODUCTS.map(product => {
                    const isSelected = selectedIds.has(product.id);
                    return (
                        <button
                            key={product.id}
                            onClick={() => toggleProduct(product)}
                            className={`relative p-4 rounded-2xl border-2 text-left transition-all group ${isSelected
                                    ? 'border-blue-500 bg-blue-50/30'
                                    : 'border-gray-100 bg-white hover:border-gray-200 hover:shadow-sm'
                                }`}
                        >
                            <div className="text-4xl mb-3 group-hover:scale-110 transition-transform">
                                {product.image}
                            </div>
                            <h4 className="font-semibold text-gray-900 text-sm mb-1">{product.name}</h4>
                            <p className="text-gray-500 text-sm">${product.price.toFixed(2)}</p>

                            {isSelected && (
                                <div className="absolute top-3 right-3 w-6 h-6 bg-blue-500 text-white rounded-full flex items-center justify-center shadow-md animate-in zoom-in duration-200">
                                    <Check size={14} />
                                </div>
                            )}
                        </button>
                    );
                })}
            </div>

            <div className="flex justify-between text-sm text-gray-500 pt-2 border-t border-gray-100">
                <span>{draft.selectedProducts.length} items selected</span>
                {draft.selectedProducts.length > 0 && (
                    <button
                        onClick={clearSelection}
                        className="text-red-500 hover:text-red-600"
                    >
                        Clear Selection
                    </button>
                )}
            </div>
        </div>
    );
}
