/**
 * Step 2: Product Selection
 * 
 * Allows users to select products to promote in their campaign.
 * Fetches real products from the inventory API.
 */

import React, { useCallback, useMemo, useState, useEffect } from 'react';
import { Search, Check, Package, Loader2 } from 'lucide-react';
import { WizardStepProps, WizardProduct } from '../types';
import { useAuth } from '../../../../context/AuthContext';
import { useAccount } from '../../../../context/AccountContext';

/**
 * Maps API product response to WizardProduct format.
 */
function mapToWizardProduct(apiProduct: any): WizardProduct {
    const imageUrl = apiProduct.mainImage || apiProduct.images?.[0]?.src;
    return {
        id: String(apiProduct.wooId),
        name: apiProduct.name || 'Unnamed Product',
        price: parseFloat(apiProduct.price) || 0,
        image: imageUrl || null,
        sku: apiProduct.sku || ''
    };
}

export function StepProductSelection({ draft, setDraft }: WizardStepProps) {
    const { token } = useAuth();
    const { currentAccount } = useAccount();

    const [products, setProducts] = useState<WizardProduct[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [searchQuery, setSearchQuery] = useState('');

    // Fetch products on mount
    useEffect(() => {
        const fetchProducts = async () => {
            if (!token || !currentAccount) return;

            setLoading(true);
            setError(null);

            try {
                const res = await fetch('/api/products?limit=100', {
                    headers: {
                        'Authorization': `Bearer ${token}`,
                        'x-account-id': currentAccount.id
                    }
                });

                if (!res.ok) {
                    throw new Error('Failed to fetch products');
                }

                const data = await res.json();
                const productList = data.products || data.items || data || [];

                // Map and sort by name for consistent UX
                const mapped = productList
                    .map(mapToWizardProduct)
                    .filter((p: WizardProduct) => p.price > 0); // Only show priced products

                setProducts(mapped);
            } catch (err: any) {
                setError(err.message || 'Failed to load products');
            } finally {
                setLoading(false);
            }
        };

        fetchProducts();
    }, [token, currentAccount]);

    const selectedIds = useMemo(
        () => new Set(draft.selectedProducts.map(p => p.id)),
        [draft.selectedProducts]
    );

    // Filter products by search query
    const filteredProducts = useMemo(() => {
        if (!searchQuery.trim()) return products;
        const q = searchQuery.toLowerCase();
        return products.filter(p =>
            p.name.toLowerCase().includes(q) ||
            (p.sku && p.sku.toLowerCase().includes(q))
        );
    }, [products, searchQuery]);

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

    // Loading state
    if (loading) {
        return (
            <div className="space-y-6 animate-in fade-in slide-in-from-right-4 duration-300">
                <div>
                    <h3 className="text-2xl font-bold text-gray-900 mb-2">Select Products</h3>
                    <p className="text-gray-500">Loading your inventory...</p>
                </div>
                <div className="flex items-center justify-center h-96">
                    <div className="flex flex-col items-center gap-3">
                        <Loader2 className="w-8 h-8 text-blue-500 animate-spin" />
                        <span className="text-sm text-gray-500">Fetching products...</span>
                    </div>
                </div>
            </div>
        );
    }

    // Error state
    if (error) {
        return (
            <div className="space-y-6 animate-in fade-in slide-in-from-right-4 duration-300">
                <div>
                    <h3 className="text-2xl font-bold text-gray-900 mb-2">Select Products</h3>
                    <p className="text-red-500">{error}</p>
                </div>
            </div>
        );
    }

    // Empty state
    if (products.length === 0) {
        return (
            <div className="space-y-6 animate-in fade-in slide-in-from-right-4 duration-300">
                <div>
                    <h3 className="text-2xl font-bold text-gray-900 mb-2">Select Products</h3>
                    <p className="text-gray-500">No products found in your inventory.</p>
                </div>
                <div className="flex flex-col items-center justify-center h-96 bg-gray-50 rounded-2xl">
                    <Package className="w-12 h-12 text-gray-300 mb-4" />
                    <p className="text-gray-500">Sync your WooCommerce products first</p>
                </div>
            </div>
        );
    }

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
                    placeholder="Search by name or SKU..."
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    className="w-full pl-12 pr-4 py-3 rounded-xl border border-gray-200 focus:border-blue-500 focus:ring-2 focus:ring-blue-100 outline-none transition-all"
                />
            </div>

            {/* Product Grid */}
            <div className="grid grid-cols-2 lg:grid-cols-3 gap-4 h-96 overflow-y-auto pr-2">
                {filteredProducts.map(product => {
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
                            {/* Product Image */}
                            <div className="w-full h-20 mb-3 rounded-lg overflow-hidden bg-gray-100 flex items-center justify-center">
                                {product.image ? (
                                    <img
                                        src={product.image}
                                        alt={product.name}
                                        className="w-full h-full object-cover group-hover:scale-105 transition-transform"
                                    />
                                ) : (
                                    <Package className="w-8 h-8 text-gray-300" />
                                )}
                            </div>
                            <h4 className="font-semibold text-gray-900 text-sm mb-1 line-clamp-2">{product.name}</h4>
                            <p className="text-gray-500 text-sm">${product.price.toFixed(2)}</p>
                            {product.sku && (
                                <p className="text-gray-400 text-xs mt-1">SKU: {product.sku}</p>
                            )}

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
