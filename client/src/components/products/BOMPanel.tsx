import { useState, useEffect, useImperativeHandle, forwardRef } from 'react';
import { Logger } from '../../utils/logger';
import { Plus, Trash2, DollarSign, Loader2, GitBranch, RefreshCw, Package, AlertTriangle, CheckCircle, Save } from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import { useAccount } from '../../context/AccountContext';
import { usePermissions } from '../../hooks/usePermissions';

interface BOMItem {
    id?: string;
    childProductId?: string;
    childVariationId?: number; // Added for variant persistence
    internalProductId?: string; // For internal-only components
    supplierItemId?: string;
    displayName: string;
    quantity: number;
    wasteFactor: number;
    cost: number;
    isInternal?: boolean; // Visual indicator
}


interface BOMPanelProps {
    productId: string; // Internal UUID
    variants?: any[]; // Passed from parent
    fixedVariationId?: number; // If set, locks to this ID
    onSaveComplete?: () => void; // Optional callback after save completes
    onCOGSUpdate?: (cogs: number) => void; // Optional callback to update parent COGS
}

/**
 * Exposes a save() method via ref so parent can trigger BOM save.
 */
export interface BOMPanelRef {
    save: () => Promise<boolean>;
}

export const BOMPanel = forwardRef<BOMPanelRef, BOMPanelProps>(function BOMPanel({ productId, variants = [], fixedVariationId, onSaveComplete, onCOGSUpdate }, ref) {
    const { token } = useAuth();
    const { currentAccount } = useAccount();
    const { hasPermission } = usePermissions();
    const canViewCogs = hasPermission('view_cogs');
    const [bomItems, setBomItems] = useState<BOMItem[]>([]);
    const [loading, setLoading] = useState(false);
    const [saving, setSaving] = useState(false);

    const [searchTerm, setSearchTerm] = useState('');
    const [searchResults, setSearchResults] = useState<any[]>([]);

    // BOM Inventory Sync state
    const [effectiveStock, setEffectiveStock] = useState<number | null>(null);
    const [currentWooStock, setCurrentWooStock] = useState<number | null>(null);
    const [isSyncing, setIsSyncing] = useState(false);
    const [syncStatus, setSyncStatus] = useState<'idle' | 'success' | 'error'>('idle');

    // 0 = Main Product, otherwise Variant ID
    // If fixedVariationId is defined, use it, else default to 0
    const [selectedScope, setSelectedScope] = useState<number>(fixedVariationId !== undefined ? fixedVariationId : 0);

    useEffect(() => {
        if (!currentAccount || !productId || !canViewCogs) return;
        fetchBOM();
        fetchEffectiveStock();
    }, [productId, currentAccount, token, selectedScope, canViewCogs]);

    // Search for products
    useEffect(() => {
        if (!searchTerm || searchTerm.length < 2) {
            setSearchResults([]);
            return;
        }

        const delayDebounceFn = setTimeout(async () => {
            try {
                // Fetch both WooCommerce products and internal products in parallel
                const [wooRes, internalRes] = await Promise.all([
                    fetch(`/api/products?q=${encodeURIComponent(searchTerm)}&limit=8`, {
                        headers: {
                            'Authorization': `Bearer ${token}`,
                            'x-account-id': currentAccount?.id || ''
                        }
                    }),
                    fetch(`/api/inventory/internal-products?search=${encodeURIComponent(searchTerm)}&limit=8`, {
                        headers: {
                            'Authorization': `Bearer ${token}`,
                            'x-account-id': currentAccount?.id || ''
                        }
                    })
                ]);

                let results: any[] = [];

                if (wooRes.ok) {
                    const wooData = await wooRes.json();
                    results = [...(wooData.products || [])];
                }

                if (internalRes.ok) {
                    const internalData = await internalRes.json();
                    // Mark internal products for visual distinction
                    const internalProducts = (internalData.items || []).map((ip: any) => ({
                        ...ip,
                        isInternalProduct: true,
                        name: ip.name,
                        mainImage: ip.mainImage,
                        cogs: ip.cogs,
                        stockQuantity: ip.stockQuantity,
                        price: ip.cogs // Use COGS as display price for internal
                    }));
                    results = [...results, ...internalProducts];
                }

                /**
                 * Smart sorting: prioritize products matching more search words.
                 * For "hoodie small", products with "Hoodie" in name AND "Small" variant rank highest.
                 */
                const searchWords = searchTerm.toLowerCase().trim().split(/\s+/).filter(w => w.length > 0);

                const sortedResults = results.sort((a, b) => {
                    /**
                     * Calculates relevance score based on how many search words match.
                     * Higher match count = lower score = higher priority.
                     */
                    const getRelevanceScore = (product: any): number => {
                        const nameLower = (product.name || '').toLowerCase();
                        const skuLower = (product.sku || '').toLowerCase();

                        // Gather all variant attribute strings for this product
                        const variantStrings: string[] = (product.searchableVariants || []).map((v: any) =>
                            `${(v.attributeString || '')} ${(v.sku || '')}`.toLowerCase()
                        );

                        // Count how many search words match in name, SKU, or variants
                        let matchCount = 0;
                        let variantMatchCount = 0;

                        for (const word of searchWords) {
                            const matchesName = nameLower.includes(word);
                            const matchesSku = skuLower.includes(word);
                            const matchesVariant = variantStrings.some(vs => vs.includes(word));

                            if (matchesName || matchesSku) {
                                matchCount++;
                            }
                            if (matchesVariant) {
                                variantMatchCount++;
                            }
                        }

                        // Total matches (name/SKU + variants contribute)
                        const totalMatches = matchCount + variantMatchCount;

                        // Higher total matches = lower (better) score
                        // Use negative to invert: more matches = more negative = sorts first
                        // Then add secondary criteria for tie-breaking
                        if (totalMatches === 0) return 1000; // No matches at all

                        // Base score: negative match count (more matches = lower score)
                        let score = -totalMatches * 100;

                        // Bonus for name matching more words (prioritize main product name matches)
                        score -= matchCount * 10;

                        // Slight bonus if name starts with first search word
                        if (searchWords.length > 0 && nameLower.startsWith(searchWords[0])) {
                            score -= 5;
                        }

                        return score;
                    };

                    return getRelevanceScore(a) - getRelevanceScore(b);
                });

                // Also sort variants within each product so matching variants appear first
                const sortedWithVariants = sortedResults.map((product: any) => {
                    if (!product.searchableVariants || product.searchableVariants.length === 0) {
                        return product;
                    }

                    const sortedVariants = [...product.searchableVariants].sort((va: any, vb: any) => {
                        const aStr = `${(va.attributeString || '')} ${(va.sku || '')}`.toLowerCase();
                        const bStr = `${(vb.attributeString || '')} ${(vb.sku || '')}`.toLowerCase();

                        // Count how many search words each variant matches
                        const aMatches = searchWords.filter(w => aStr.includes(w)).length;
                        const bMatches = searchWords.filter(w => bStr.includes(w)).length;

                        return bMatches - aMatches; // Higher matches first
                    });

                    return { ...product, searchableVariants: sortedVariants };
                });

                setSearchResults(sortedWithVariants);
            } catch (err) {
                Logger.error('Failed to search products', { error: err });
            }
        }, 300);

        return () => clearTimeout(delayDebounceFn);
    }, [searchTerm, token, currentAccount]);


    const fetchBOM = async () => {
        setLoading(true);
        try {
            const res = await fetch(`/api/inventory/products/${productId}/bom?variationId=${selectedScope}`, {
                headers: {
                    'Authorization': `Bearer ${token}`,
                    'x-account-id': currentAccount?.id || ''
                }
            });

            if (res.ok) {
                const data = await res.json();
                // Map backend response to UI BOMItems
                if (data && data.items) {
                    const mapped = data.items.map((item: any) => {
                        // Build display name: prefer internal product, then variant, then product, then supplier item
                        let displayName = 'Unknown';
                        let isInternal = false;

                        if (item.internalProduct) {
                            // Internal product (component-only)
                            displayName = `[Internal] ${item.internalProduct.name}`;
                            isInternal = true;
                        } else if (item.childVariation) {
                            // Variant: use parent product name + variant attributes
                            const variantRaw = item.childVariation.rawData || {};
                            const attrString = (variantRaw.attributes || [])
                                .map((a: any) => a.option || a.value)
                                .filter(Boolean)
                                .join(' / ');
                            displayName = item.childProduct
                                ? `${item.childProduct.name} - ${attrString || item.childVariation.sku || `#${item.childVariation.wooId}`}`
                                : attrString || item.childVariation.sku || `Variant #${item.childVariation.wooId}`;
                        } else if (item.childProduct) {
                            displayName = item.childProduct.name;
                        } else if (item.supplierItem) {
                            displayName = item.supplierItem.name || 'Unknown';
                        }

                        // Get COGS: prioritize internal product COGS > variant COGS > product COGS > supplier cost
                        let cost = 0;
                        if (item.internalProduct?.cogs) {
                            cost = Number(item.internalProduct.cogs);
                        } else if (item.childVariation?.cogs) {
                            cost = Number(item.childVariation.cogs);
                        } else if (item.childProduct?.cogs) {
                            cost = Number(item.childProduct.cogs);
                        } else if (item.supplierItem?.cost) {
                            cost = Number(item.supplierItem.cost);
                        }

                        return {
                            id: item.id,
                            childProductId: item.childProductId,
                            childVariationId: item.childVariationId,
                            internalProductId: item.internalProductId,
                            supplierItemId: item.supplierItemId,
                            displayName,
                            quantity: Number(item.quantity),
                            wasteFactor: Number(item.wasteFactor),
                            cost,
                            isInternal
                        };
                    });
                    setBomItems(mapped);
                } else {
                    setBomItems([]);
                }
            } else {
                setBomItems([]);
            }
        } catch (err) {
            Logger.error('An error occurred', { error: err });
        } finally {
            setLoading(false);
        }
    };

    /**
     * Fetches the calculated effective stock for this BOM product.
     */
    const fetchEffectiveStock = async () => {
        if (!currentAccount || !productId) return;

        try {
            const res = await fetch(`/api/inventory/products/${productId}/bom/effective-stock?variationId=${selectedScope}`, {
                headers: {
                    'Authorization': `Bearer ${token}`,
                    'x-account-id': currentAccount.id
                }
            });

            if (res.ok) {
                const data = await res.json();
                setEffectiveStock(data.effectiveStock);
                setCurrentWooStock(data.currentWooStock);
            } else {
                // No BOM with child products
                setEffectiveStock(null);
                setCurrentWooStock(null);
            }
        } catch (err) {
            Logger.error('Failed to fetch effective stock', { error: err });
            setEffectiveStock(null);
            setCurrentWooStock(null);
        }
    };

    /**
     * Syncs the calculated effective stock to WooCommerce.
     */
    const handleSyncToWoo = async () => {
        if (!currentAccount || !productId) return;

        setIsSyncing(true);
        setSyncStatus('idle');

        try {
            const res = await fetch(`/api/inventory/products/${productId}/bom/sync`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${token}`,
                    'x-account-id': currentAccount.id
                },
                body: JSON.stringify({ variationId: selectedScope })
            });

            if (res.ok) {
                const data = await res.json();
                setCurrentWooStock(data.newStock);
                setSyncStatus('success');
                // Refresh effective stock data
                await fetchEffectiveStock();
            } else {
                setSyncStatus('error');
            }
        } catch (err) {
            Logger.error('Failed to sync inventory to WooCommerce', { error: err });
            setSyncStatus('error');
        } finally {
            setIsSyncing(false);
            // Reset status after 3 seconds
            setTimeout(() => setSyncStatus('idle'), 3000);
        }
    };

    /**
     * Saves the BOM configuration. Returns true on success, false on failure.
     */
    const handleSave = async (): Promise<boolean> => {
        setSaving(true);
        try {
            const payload = {
                variationId: selectedScope,
                items: bomItems.map(item => ({
                    childProductId: item.childProductId,
                    childVariationId: item.childVariationId, // Include this!
                    internalProductId: item.internalProductId, // For internal components
                    supplierItemId: item.supplierItemId,
                    quantity: item.quantity,
                    wasteFactor: item.wasteFactor
                }))
            };

            const res = await fetch(`/api/inventory/products/${productId}/bom`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${token}`,
                    'x-account-id': currentAccount?.id || ''
                },
                body: JSON.stringify(payload)
            });

            if (res.ok) {
                fetchBOM(); // Refresh
                // Only notify parent of COGS update if there are BOM items
                // This preserves manually-entered COGS for products without BOM
                if (bomItems.length > 0) {
                    const currentTotalCost = bomItems.reduce((sum, item) => {
                        const itemCost = Number(item.cost) * Number(item.quantity) * (1 + Number(item.wasteFactor));
                        return sum + itemCost;
                    }, 0);
                    onCOGSUpdate?.(currentTotalCost);
                }
                onSaveComplete?.();
                return true;
            } else {
                return false;
            }
        } catch (err) {
            Logger.error('An error occurred', { error: err });
            return false;
        } finally {
            setSaving(false);
        }
    };

    // Expose save method to parent via ref - placed after handleSave definition
    useImperativeHandle(ref, () => ({
        save: handleSave
    }), [bomItems, selectedScope, productId, token, currentAccount, handleSave]);

    const handleAddProduct = (product: any) => {
        // Handle internal products
        if (product.isInternalProduct) {
            // Check if already exists
            const alreadyExists = bomItems.some(i => i.internalProductId === product.id);
            if (alreadyExists) {
                alert('This component is already in the BOM.');
                return;
            }

            const newItem: BOMItem = {
                internalProductId: product.id,
                displayName: `[Internal] ${product.name}`,
                quantity: 1,
                wasteFactor: 0,
                cost: Number(product.cogs) || 0,
                isInternal: true
            };

            setBomItems([...bomItems, newItem]);
            setSearchTerm('');
            setSearchResults([]);
            return;
        }

        // Check if self-linking (only for parent product, not variants)
        if (product.id === productId && !product.isVariant) {
            alert('Cannot add the product to its own BOM.');
            return;
        }

        // Check if already exists (handle both parent products and variants)
        const alreadyExists = bomItems.some(i => {
            if (product.isVariant) {
                // Check exact variation ID match
                return i.childProductId === product.id && i.childVariationId === Number(product.variantId);
            }
            // For parent products, check matching ID and ensure it's not a variant item
            return i.childProductId === product.id && !i.childVariationId;
        });

        if (alreadyExists) {
            alert('This component is already in the BOM.');
            return;
        }

        const newItem: BOMItem = {
            childProductId: product.id,
            childVariationId: product.isVariant ? Number(product.variantId) : undefined,
            displayName: product.name, // For variants, this includes the variant attributes
            quantity: 1,
            wasteFactor: 0,
            cost: Number(product.cogs) || 0
        };

        setBomItems([...bomItems, newItem]);
        setSearchTerm('');
        setSearchResults([]);
    };

    const totalCost = bomItems.reduce((sum, item) => {
        const itemCost = Number(item.cost) * Number(item.quantity) * (1 + Number(item.wasteFactor));
        return sum + itemCost;
    }, 0);

    // Hide entire panel if user doesn't have COGS permission
    if (!canViewCogs) return null;

    return (
        <div className="bg-white/70 backdrop-blur-md rounded-xl shadow-xs border border-white/50 animate-in fade-in slide-in-from-bottom-4 duration-500 delay-100">
            <div className="px-6 py-4 border-b border-gray-100 bg-gray-50/50 flex justify-between items-center">
                <div className="flex items-center gap-4">
                    <h3 className="font-semibold text-gray-900">BOM Configuration</h3>

                    {/* Scope Selector - Only show if NO fixedVariationId */}
                    {fixedVariationId === undefined && (
                        <div className="flex items-center gap-2 bg-white px-3 py-1.5 rounded-lg border border-gray-200 text-sm">
                            <GitBranch size={16} className="text-gray-400" />
                            <select
                                value={selectedScope}
                                onChange={(e) => setSelectedScope(Number(e.target.value))}
                                className="bg-transparent border-none outline-hidden text-gray-700 font-medium cursor-pointer min-w-[150px]"
                            >
                                <option value={0}>Main Product</option>
                                {variants.map(v => (
                                    <option key={v.id} value={v.id}>
                                        Variant #{v.id} {v.sku ? `(${v.sku})` : ''}
                                    </option>
                                ))}
                            </select>
                        </div>
                    )}
                </div>

            </div>

            <div className="p-6 space-y-6">
                {/* Cost & Inventory Summary */}
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-6">
                    {/* Cost Summary */}
                    <div className="p-4 bg-green-50/50 rounded-xl border border-green-100">
                        <div className="flex items-center gap-2 text-green-700 mb-1">
                            <DollarSign size={18} />
                            <span className="font-semibold text-sm uppercase">Composite Cost</span>
                        </div>
                        <div className="text-2xl font-bold text-gray-900">${totalCost.toFixed(2)}</div>
                    </div>

                    {/* Effective Stock & Sync - Only show if there are BOM items with child products */}
                    {effectiveStock !== null && (
                        <div className={`p-4 rounded-xl border ${currentWooStock !== effectiveStock
                            ? 'bg-amber-50/50 border-amber-200'
                            : 'bg-blue-50/50 border-blue-100'
                            }`}>
                            <div className="flex items-center justify-between mb-1">
                                <div className="flex items-center gap-2 text-blue-700">
                                    <Package size={18} />
                                    <span className="font-semibold text-sm uppercase">Buildable Units</span>
                                </div>
                                {currentWooStock !== effectiveStock && (
                                    <div className="flex items-center gap-1 text-amber-600 text-xs">
                                        <AlertTriangle size={14} />
                                        <span>Out of sync</span>
                                    </div>
                                )}
                            </div>
                            <div className="flex items-end justify-between">
                                <div>
                                    <div className="text-2xl font-bold text-gray-900">{effectiveStock}</div>
                                    {currentWooStock !== null && currentWooStock !== effectiveStock && (
                                        <div className="text-xs text-gray-500 mt-1">
                                            WooCommerce: {currentWooStock}
                                        </div>
                                    )}
                                </div>
                                <button
                                    onClick={handleSyncToWoo}
                                    disabled={isSyncing || currentWooStock === effectiveStock}
                                    className={`flex items-center gap-2 px-3 py-1.5 rounded-lg text-sm font-medium transition-all ${currentWooStock === effectiveStock
                                        ? 'bg-gray-100 text-gray-400 cursor-not-allowed'
                                        : syncStatus === 'success'
                                            ? 'bg-green-500 text-white'
                                            : syncStatus === 'error'
                                                ? 'bg-red-500 text-white'
                                                : 'bg-blue-500 text-white hover:bg-blue-600'
                                        }`}
                                >
                                    {isSyncing ? (
                                        <Loader2 size={14} className="animate-spin" />
                                    ) : syncStatus === 'success' ? (
                                        <CheckCircle size={14} />
                                    ) : syncStatus === 'error' ? (
                                        <AlertTriangle size={14} />
                                    ) : (
                                        <RefreshCw size={14} />
                                    )}
                                    {isSyncing ? 'Syncing...' : syncStatus === 'success' ? 'Synced!' : syncStatus === 'error' ? 'Failed' : 'Sync to Woo'}
                                </button>
                            </div>
                        </div>
                    )}
                </div>

                {loading ? (
                    <div className="p-12 text-center text-gray-400">
                        <Loader2 className="animate-spin inline mr-2" /> Loading BOM...
                    </div>
                ) : (
                    <>
                        {/* Search Add */}
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
                                onChange={(e) => setSearchTerm(e.target.value)}
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
                                                            if (isClickable) handleAddProduct(p);
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
                                                                    onClick={() => handleAddProduct({
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

                        {/* List */}
                        <table className="w-full">
                            <thead className="bg-gray-50/50 text-xs text-gray-500 uppercase">
                                <tr>
                                    <th className="p-3 text-left">Component</th>
                                    <th className="p-3 w-24">Qty</th>
                                    <th className="p-3 w-24">Waste %</th>
                                    <th className="p-3 text-right">Cost</th>
                                    <th className="p-3 w-10"></th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-gray-100">
                                {bomItems.length === 0 ? (
                                    <tr>
                                        <td colSpan={5} className="p-6 text-center text-sm text-gray-400">
                                            No BOM items configured for this {selectedScope === 0 ? 'product' : 'variant'}.
                                        </td>
                                    </tr>
                                ) : (
                                    bomItems.map((item, idx) => (
                                        <tr key={idx}>
                                            <td className="p-3">
                                                <div className="font-medium text-sm">{item.displayName}</div>
                                            </td>
                                            <td className="p-3">
                                                <input
                                                    type="number" min="0" step="any"
                                                    value={item.quantity}
                                                    onChange={e => {
                                                        const newItems = [...bomItems];
                                                        newItems[idx].quantity = Number(e.target.value);
                                                        setBomItems(newItems);
                                                    }}
                                                    className="w-full border rounded-sm p-1 text-center text-sm"
                                                />
                                            </td>
                                            <td className="p-3">
                                                <input
                                                    type="number" min="0" step="0.01"
                                                    value={item.wasteFactor}
                                                    onChange={e => {
                                                        const newItems = [...bomItems];
                                                        newItems[idx].wasteFactor = Number(e.target.value);
                                                        setBomItems(newItems);
                                                    }}
                                                    className="w-full border rounded-sm p-1 text-center text-sm"
                                                />
                                            </td>
                                            <td className="p-3 text-right text-sm">
                                                ${(Number(item.quantity) * Number(item.cost) * (1 + Number(item.wasteFactor))).toFixed(2)}
                                            </td>
                                            <td className="p-3">
                                                <button
                                                    onClick={() => setBomItems(bomItems.filter((_, i) => i !== idx))}
                                                    className="text-gray-400 hover:text-red-500"
                                                >
                                                    <Trash2 size={16} />
                                                </button>
                                            </td>
                                        </tr>
                                    ))
                                )}
                            </tbody>
                        </table>

                        {/* Save Button for inline BOMPanel (especially for variant BOMs) */}
                        {bomItems.length > 0 && (
                            <div className="flex justify-end mt-4 pt-4 border-t border-gray-100">
                                <button
                                    onClick={handleSave}
                                    disabled={saving}
                                    className="flex items-center gap-2 px-4 py-2 bg-blue-500 text-white rounded-lg hover:bg-blue-600 disabled:opacity-50 disabled:cursor-not-allowed transition-all text-sm font-medium"
                                >
                                    {saving ? (
                                        <Loader2 size={14} className="animate-spin" />
                                    ) : (
                                        <Save size={14} />
                                    )}
                                    {saving ? 'Saving...' : 'Save BOM'}
                                </button>
                            </div>
                        )}
                    </>
                )}
            </div>
        </div>
    );
}
);
