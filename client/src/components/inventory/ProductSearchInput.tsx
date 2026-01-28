/**
 * ProductSearchInput - Combobox for searching and selecting products
 * 
 * Fetches products via the existing search API and allows selection.
 * Variants are flattened into the same list for single-click selection.
 * SKU matches are prioritized in results.
 */

import { useState, useEffect, useRef, useCallback } from 'react';
import { useAuth } from '../../context/AuthContext';
import { useAccount } from '../../context/AccountContext';
import { Search, Package, X, Loader2 } from 'lucide-react';
import { Logger } from '../../utils/logger';

export interface ProductSelection {
    productId: string;        // Internal UUID
    wooId: number;            // WooCommerce ID
    variationWooId?: number;  // Variant WooId if selected
    name: string;
    sku?: string;
    price?: number;
    cogs?: number;
    image?: string;
}

interface ProductResult {
    id: string;
    woo_id?: number;
    name: string;
    sku?: string;
    price?: number;
    cogs?: number;
    stock_quantity?: number;
    stock_status?: string;
    images?: { src: string }[];
    main_image?: string;
    type?: string;
    variations?: VariationResult[];
    hasBOM?: boolean;
}

interface VariationResult {
    wooId: number;
    sku?: string;
    price?: number;
    cogs?: number;
    attributes?: { name: string; option: string }[];
    stock_quantity?: number;
}

/** Flattened item for display - can be a simple product or a variant */
interface FlatItem {
    productId: string;
    wooId: number;
    variationWooId?: number;
    name: string;
    sku?: string;
    price?: number;
    cogs?: number;
    stock?: number;
    image?: string;
    isVariant: boolean;
    parentName?: string;
}

interface ProductSearchInputProps {
    onSelect: (product: ProductSelection) => void;
    placeholder?: string;
    disabled?: boolean;
    initialValue?: string;
}

export function ProductSearchInput({
    onSelect,
    placeholder = 'Search by SKU or product name...',
    disabled = false,
    initialValue = ''
}: ProductSearchInputProps) {
    const { token } = useAuth();
    const { currentAccount } = useAccount();

    const [query, setQuery] = useState(initialValue);
    const [flatResults, setFlatResults] = useState<FlatItem[]>([]);
    const [isLoading, setIsLoading] = useState(false);
    const [isOpen, setIsOpen] = useState(false);

    const inputRef = useRef<HTMLInputElement>(null);
    const dropdownRef = useRef<HTMLDivElement>(null);
    const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

    /**
     * Flatten products + their variants into a single list.
     * SKU matches are prioritized to the top.
     */
    const flattenAndSort = (products: ProductResult[], searchQuery: string): FlatItem[] => {
        const items: FlatItem[] = [];
        const queryLower = searchQuery.toLowerCase().trim();

        for (const product of products) {
            // Skip BOM products
            if (product.hasBOM) continue;

            // Use searchableVariants (contains full variant data with COGS) over variations (only WooCommerce IDs)
            const searchableVariants = (product as any).searchableVariants || [];
            const hasVariations = product.type === 'variable' && searchableVariants.length > 0;

            if (hasVariations) {
                // Add each variant as a separate item
                for (const variation of searchableVariants) {
                    const variantLabel = variation.attributeString ||
                        variation.attributes?.map((attr: any) => attr.option).join(' / ') ||
                        `Variant ${variation.wooId}`;

                    items.push({
                        productId: product.id,
                        wooId: product.woo_id || 0,
                        variationWooId: variation.wooId,
                        name: `${product.name} - ${variantLabel}`,
                        sku: variation.sku || product.sku,
                        price: variation.price || product.price,
                        cogs: variation.cogs || product.cogs,
                        stock: variation.stockQuantity ?? variation.stock_quantity,
                        image: product.main_image || product.images?.[0]?.src,
                        isVariant: true,
                        parentName: product.name
                    });
                }
            } else {
                // Simple product
                items.push({
                    productId: product.id,
                    wooId: product.woo_id || 0,
                    name: product.name,
                    sku: product.sku,
                    price: product.price,
                    cogs: product.cogs,
                    stock: product.stock_quantity,
                    image: product.main_image || product.images?.[0]?.src,
                    isVariant: false
                });
            }
        }

        // Sort: SKU exact match first, then SKU contains, then name match
        items.sort((a, b) => {
            const aSkuExact = a.sku?.toLowerCase() === queryLower ? 1 : 0;
            const bSkuExact = b.sku?.toLowerCase() === queryLower ? 1 : 0;
            if (aSkuExact !== bSkuExact) return bSkuExact - aSkuExact;

            const aSkuContains = a.sku?.toLowerCase().includes(queryLower) ? 1 : 0;
            const bSkuContains = b.sku?.toLowerCase().includes(queryLower) ? 1 : 0;
            if (aSkuContains !== bSkuContains) return bSkuContains - aSkuContains;

            return 0;
        });

        return items;
    };

    const searchProducts = useCallback(async (searchQuery: string) => {
        if (!searchQuery.trim() || !token || !currentAccount) {
            setFlatResults([]);
            return;
        }

        setIsLoading(true);
        try {
            const res = await fetch(`/api/products?q=${encodeURIComponent(searchQuery)}&limit=20`, {
                headers: {
                    'Authorization': `Bearer ${token}`,
                    'X-Account-ID': currentAccount.id
                }
            });

            if (res.ok) {
                const data = await res.json();
                const products = data.products || data || [];
                const flattened = flattenAndSort(products, searchQuery);
                setFlatResults(flattened.slice(0, 15)); // Cap at 15 items
            }
        } catch (error) {
            Logger.error('Product search failed', { error });
        } finally {
            setIsLoading(false);
        }
    }, [token, currentAccount]);

    useEffect(() => {
        if (debounceRef.current) {
            clearTimeout(debounceRef.current);
        }

        if (query.trim().length >= 2) {
            debounceRef.current = setTimeout(() => {
                searchProducts(query);
            }, 300);
        } else {
            setFlatResults([]);
        }

        return () => {
            if (debounceRef.current) {
                clearTimeout(debounceRef.current);
            }
        };
    }, [query, searchProducts]);

    useEffect(() => {
        function handleClickOutside(event: MouseEvent) {
            if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
                setIsOpen(false);
            }
        }
        function handleEscape(event: KeyboardEvent) {
            if (event.key === 'Escape') {
                setIsOpen(false);
            }
        }

        document.addEventListener('mousedown', handleClickOutside);
        document.addEventListener('keydown', handleEscape);
        return () => {
            document.removeEventListener('mousedown', handleClickOutside);
            document.removeEventListener('keydown', handleEscape);
        };
    }, []);

    const handleSelect = (item: FlatItem) => {
        onSelect({
            productId: item.productId,
            wooId: item.wooId,
            variationWooId: item.variationWooId,
            name: item.name,
            sku: item.sku,
            price: item.price,
            cogs: item.cogs,
            image: item.image
        });

        setQuery(item.name);
        setIsOpen(false);
        setFlatResults([]);
    };

    const clearSelection = () => {
        setQuery('');
        inputRef.current?.focus();
    };

    return (
        <div className="relative" ref={dropdownRef}>
            <div className="relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" size={16} />
                <input
                    ref={inputRef}
                    type="text"
                    value={query}
                    onChange={(e) => {
                        setQuery(e.target.value);
                        setIsOpen(true);
                    }}
                    onFocus={() => setIsOpen(true)}
                    placeholder={placeholder}
                    disabled={disabled}
                    className="w-full pl-10 pr-8 py-2 text-sm border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none disabled:bg-gray-50 disabled:text-gray-500"
                    aria-label="Search products"
                    aria-expanded={isOpen}
                    role="combobox"
                />
                {query && (
                    <button
                        type="button"
                        onClick={clearSelection}
                        className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
                    >
                        <X size={16} />
                    </button>
                )}
            </div>

            {/* Dropdown - Flattened list */}
            {isOpen && (query.length >= 2 || flatResults.length > 0) && (
                <div className="absolute z-50 w-full mt-1 bg-white border border-gray-200 rounded-lg shadow-lg max-h-72 overflow-y-auto">
                    {isLoading ? (
                        <div className="p-4 text-center text-gray-500">
                            <Loader2 className="animate-spin inline mr-2" size={16} />
                            Searching...
                        </div>
                    ) : flatResults.length === 0 ? (
                        <div className="p-4 text-center text-gray-500 text-sm">
                            No products found for "{query}"
                        </div>
                    ) : (
                        flatResults.map((item, idx) => (
                            <button
                                key={`${item.productId}-${item.variationWooId || 'simple'}-${idx}`}
                                type="button"
                                onClick={() => handleSelect(item)}
                                className="w-full px-3 py-2.5 text-left hover:bg-blue-50 flex items-center gap-3 border-b border-gray-100 last:border-0"
                            >
                                {/* Product image */}
                                <div className="w-10 h-10 bg-gray-100 rounded-md flex-shrink-0 flex items-center justify-center overflow-hidden">
                                    {item.image ? (
                                        <img src={item.image} alt="" className="w-full h-full object-cover" />
                                    ) : (
                                        <Package size={20} className="text-gray-300" />
                                    )}
                                </div>

                                <div className="flex-1 min-w-0">
                                    <div className="text-sm font-medium text-gray-900 truncate">
                                        {item.name}
                                    </div>
                                    <div className="text-xs text-gray-500 flex items-center gap-2 flex-wrap">
                                        {item.sku && (
                                            <span className="bg-gray-100 px-1.5 py-0.5 rounded font-mono">
                                                {item.sku}
                                            </span>
                                        )}
                                        {item.stock !== undefined && (
                                            <span className={item.stock <= 0 ? 'text-red-500' : ''}>
                                                Stock: {item.stock}
                                            </span>
                                        )}
                                        {item.isVariant && (
                                            <span className="text-blue-600 text-xs">Variant</span>
                                        )}
                                    </div>
                                </div>

                                <div className="text-right flex-shrink-0">
                                    {item.cogs !== undefined && item.cogs > 0 ? (
                                        <span className="text-sm font-medium text-green-700">
                                            ${Number(item.cogs).toFixed(2)}
                                        </span>
                                    ) : item.price !== undefined ? (
                                        <span className="text-sm text-gray-500">
                                            ${Number(item.price).toFixed(2)}
                                        </span>
                                    ) : null}
                                </div>
                            </button>
                        ))
                    )}
                </div>
            )}
        </div>
    );
}
