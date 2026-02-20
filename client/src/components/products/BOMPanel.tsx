/**
 * BOMPanel - Bill of Materials configuration panel.
 * Manages composite product components, costs, and WooCommerce inventory sync.
 */
import { useState, useEffect, useImperativeHandle, forwardRef } from 'react';
import { Logger } from '../../utils/logger';
import { GitBranch, Loader2, Save } from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import { useAccount } from '../../context/AccountContext';
import { usePermissions } from '../../hooks/usePermissions';
import { BOMCostSummary, BOMSearchDropdown, BOMItemsTable, type BOMItem } from './bom';

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

    // Search for products with debounce
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

                // Smart sorting by relevance
                const sortedResults = sortProductsByRelevance(results, searchTerm);
                setSearchResults(sortedResults);
            } catch (err) {
                Logger.error('Failed to search products', { error: err });
            }
        }, 300);

        return () => clearTimeout(delayDebounceFn);
    }, [searchTerm, token, currentAccount]);

    /**
     * Sorts products by relevance to search term.
     * Prioritizes products matching more search words.
     */
    const sortProductsByRelevance = (products: any[], term: string): any[] => {
        const searchWords = term.toLowerCase().trim().split(/\s+/).filter(w => w.length > 0);

        const getRelevanceScore = (product: any): number => {
            const nameLower = (product.name || '').toLowerCase();
            const skuLower = (product.sku || '').toLowerCase();
            const variantStrings: string[] = (product.searchableVariants || []).map((v: any) =>
                `${(v.attributeString || '')} ${(v.sku || '')}`.toLowerCase()
            );

            let matchCount = 0;
            let variantMatchCount = 0;

            for (const word of searchWords) {
                const matchesName = nameLower.includes(word);
                const matchesSku = skuLower.includes(word);
                const matchesVariant = variantStrings.some(vs => vs.includes(word));

                if (matchesName || matchesSku) matchCount++;
                if (matchesVariant) variantMatchCount++;
            }

            const totalMatches = matchCount + variantMatchCount;
            if (totalMatches === 0) return 1000;

            let score = -totalMatches * 100;
            score -= matchCount * 10;
            if (searchWords.length > 0 && nameLower.startsWith(searchWords[0])) {
                score -= 5;
            }
            return score;
        };

        const sorted = products.sort((a, b) => getRelevanceScore(a) - getRelevanceScore(b));

        // Sort variants within each product
        return sorted.map((product: any) => {
            if (!product.searchableVariants || product.searchableVariants.length === 0) {
                return product;
            }

            const sortedVariants = [...product.searchableVariants].sort((va: any, vb: any) => {
                const aStr = `${(va.attributeString || '')} ${(va.sku || '')}`.toLowerCase();
                const bStr = `${(vb.attributeString || '')} ${(vb.sku || '')}`.toLowerCase();
                const aMatches = searchWords.filter(w => aStr.includes(w)).length;
                const bMatches = searchWords.filter(w => bStr.includes(w)).length;
                return bMatches - aMatches;
            });

            return { ...product, searchableVariants: sortedVariants };
        });
    };

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
                if (data && data.items) {
                    const mapped = data.items.map((item: any) => mapBOMItemFromResponse(item));
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
     * Maps a backend BOM item response to the UI BOMItem interface.
     */
    const mapBOMItemFromResponse = (item: any): BOMItem => {
        let displayName = 'Unknown';
        let isInternal = false;

        if (item.internalProduct) {
            displayName = `[Internal] ${item.internalProduct.name}`;
            isInternal = true;
        } else if (item.childVariation) {
            const variantRaw = item.childVariation.rawData || {};
            const attrString = (variantRaw.attributes || [])
                .map((a: any) => a.option || a.value)
                .filter(Boolean)
                .join(' / ');
            const parentName = item.childProduct?.name || item.childVariation._parentProductName;
            displayName = parentName
                ? `${parentName} - ${attrString || item.childVariation.sku || `#${item.childVariation.wooId}`}`
                : attrString || item.childVariation.sku || `Variant #${item.childVariation.wooId}`;
        } else if (item.childProduct) {
            displayName = item.childProduct.name;
        } else if (item.supplierItem) {
            displayName = item.supplierItem.name || 'Unknown';
        }

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
    };

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
                setEffectiveStock(null);
                setCurrentWooStock(null);
            }
        } catch (err) {
            Logger.error('Failed to fetch effective stock', { error: err });
            setEffectiveStock(null);
            setCurrentWooStock(null);
        }
    };

    const handleSyncToWoo = async () => {
        if (!currentAccount || !productId) return;

        setIsSyncing(true);
        setSyncStatus('idle');

        try {
            const res = await fetch(`/api/inventory/products/${productId}/bom/sync?variationId=${selectedScope}`, {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${token}`,
                    'x-account-id': currentAccount.id
                }
            });

            if (res.ok) {
                const data = await res.json();
                setCurrentWooStock(data.newStock);
                setSyncStatus('success');
                await fetchEffectiveStock();
            } else {
                setSyncStatus('error');
            }
        } catch (err) {
            Logger.error('Failed to sync inventory to WooCommerce', { error: err });
            setSyncStatus('error');
        } finally {
            setIsSyncing(false);
            setTimeout(() => setSyncStatus('idle'), 3000);
        }
    };

    const handleSave = async (): Promise<boolean> => {
        setSaving(true);
        try {
            const payload = {
                variationId: selectedScope,
                items: bomItems.map(item => ({
                    childProductId: item.childProductId,
                    childVariationId: item.childVariationId,
                    internalProductId: item.internalProductId,
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
                fetchBOM();
                if (bomItems.length > 0) {
                    onCOGSUpdate?.(totalCost);
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

    useImperativeHandle(ref, () => ({
        save: handleSave
    }), [bomItems, selectedScope, productId, token, currentAccount, handleSave]);

    const handleAddProduct = (product: any) => {
        // Handle internal products
        if (product.isInternalProduct) {
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

        // Check if self-linking
        if (product.id === productId && !product.isVariant) {
            alert('Cannot add the product to its own BOM.');
            return;
        }

        // Check if already exists
        const alreadyExists = bomItems.some(i => {
            if (product.isVariant) {
                return i.childProductId === product.id && i.childVariationId === Number(product.variantId);
            }
            return i.childProductId === product.id && !i.childVariationId;
        });

        if (alreadyExists) {
            alert('This component is already in the BOM.');
            return;
        }

        const newItem: BOMItem = {
            childProductId: product.id,
            childVariationId: product.isVariant ? Number(product.variantId) : undefined,
            displayName: product.name,
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
                <BOMCostSummary
                    totalCost={totalCost}
                    effectiveStock={effectiveStock}
                    currentWooStock={currentWooStock}
                    isSyncing={isSyncing}
                    syncStatus={syncStatus}
                    onSyncToWoo={handleSyncToWoo}
                />

                {loading ? (
                    <div className="p-12 text-center text-gray-400">
                        <Loader2 className="animate-spin inline mr-2" /> Loading BOM...
                    </div>
                ) : (
                    <>
                        <BOMSearchDropdown
                            searchTerm={searchTerm}
                            onSearchChange={setSearchTerm}
                            searchResults={searchResults}
                            productId={productId}
                            onAddProduct={handleAddProduct}
                        />

                        <BOMItemsTable
                            items={bomItems}
                            selectedScope={selectedScope}
                            onItemsChange={setBomItems}
                        />

                        {/* Save Button */}
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
});
