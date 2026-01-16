import { useState, useEffect, useImperativeHandle, forwardRef } from 'react';
import { Logger } from '../../utils/logger';
import { Plus, Trash2, Calendar, DollarSign, Loader2, GitBranch } from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import { useAccount } from '../../context/AccountContext';

interface BOMItem {
    id?: string; // Optional for new items
    childProductId?: string; // If it's a product link
    supplierItemId?: string; // If it's a raw material
    displayName: string;
    quantity: number;
    wasteFactor: number;
    cost: number;
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
    const [bomItems, setBomItems] = useState<BOMItem[]>([]);
    const [loading, setLoading] = useState(false);
    const [saving, setSaving] = useState(false);

    const [searchTerm, setSearchTerm] = useState('');
    const [searchResults, setSearchResults] = useState<any[]>([]);


    // 0 = Main Product, otherwise Variant ID
    // If fixedVariationId is defined, use it, else default to 0
    const [selectedScope, setSelectedScope] = useState<number>(fixedVariationId !== undefined ? fixedVariationId : 0);

    useEffect(() => {
        if (!currentAccount || !productId) return;
        fetchBOM();
    }, [productId, currentAccount, token, selectedScope]);

    // Search for products
    useEffect(() => {
        if (!searchTerm || searchTerm.length < 2) {
            setSearchResults([]);
            return;
        }

        const delayDebounceFn = setTimeout(async () => {
            try {
                const res = await fetch(`/api/products?q=${encodeURIComponent(searchTerm)}&limit=8`, {
                    headers: {
                        'Authorization': `Bearer ${token}`,
                        'x-account-id': currentAccount?.id || ''
                    }
                });
                if (res.ok) {
                    const data = await res.json();
                    // API returns 'products' not 'items'
                    setSearchResults(data.products || []);
                }
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
                    const mapped = data.items.map((item: any) => ({
                        id: item.id,
                        childProductId: item.childProductId,
                        supplierItemId: item.supplierItemId,
                        displayName: item.childProduct ? item.childProduct.name : (item.supplierItem?.name || 'Unknown'),
                        quantity: Number(item.quantity),
                        wasteFactor: Number(item.wasteFactor),
                        cost: item.childProduct ? (Number(item.childProduct.cogs) || 0) : (Number(item.supplierItem?.cost) || 0)
                    }));
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
     * Saves the BOM configuration. Returns true on success, false on failure.
     */
    const handleSave = async (): Promise<boolean> => {
        setSaving(true);
        try {
            const payload = {
                variationId: selectedScope,
                items: bomItems.map(item => ({
                    childProductId: item.childProductId,
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
                // Notify parent of the new COGS calculated from BOM
                const currentTotalCost = bomItems.reduce((sum, item) => {
                    const itemCost = Number(item.cost) * Number(item.quantity) * (1 + Number(item.wasteFactor));
                    return sum + itemCost;
                }, 0);
                onCOGSUpdate?.(currentTotalCost);
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
        // Check if self-linking
        if (product.id === productId) {
            alert('Cannot add the product to its own BOM.');
            return;
        }

        // Check if already exists
        if (bomItems.some(i => i.childProductId === product.id)) {
            alert('This product is already in the BOM.');
            return;
        }

        const newItem: BOMItem = {
            childProductId: product.id,
            displayName: product.name,
            quantity: 1,
            wasteFactor: 0,
            cost: Number(product.cogs) || 0 // Assuming COGS is available, otherwise 0
        };

        setBomItems([...bomItems, newItem]);
        setSearchTerm('');
        setSearchResults([]);
    };

    const totalCost = bomItems.reduce((sum, item) => {
        const itemCost = Number(item.cost) * Number(item.quantity) * (1 + Number(item.wasteFactor));
        return sum + itemCost;
    }, 0);

    return (
        <div className="bg-white/70 backdrop-blur-md rounded-xl shadow-xs border border-white/50 overflow-hidden animate-in fade-in slide-in-from-bottom-4 duration-500 delay-100">
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
                {/* Cost Summary */}
                <div className="p-4 bg-green-50/50 rounded-xl border border-green-100 mb-6">
                    <div className="flex items-center gap-2 text-green-700 mb-1">
                        <DollarSign size={18} />
                        <span className="font-semibold text-sm uppercase">Composite Cost ({selectedScope === 0 ? 'Main' : `Variant #${selectedScope}`})</span>
                    </div>
                    <div className="text-2xl font-bold text-gray-900">${totalCost.toFixed(2)}</div>
                </div>

                {loading ? (
                    <div className="p-12 text-center text-gray-400">
                        <Loader2 className="animate-spin inline mr-2" /> Loading BOM...
                    </div>
                ) : (
                    <>
                        {/* Search Add */}
                        <div className="relative">
                            <div className="flex items-center gap-2 mb-2">
                                <Plus size={16} className="text-gray-400" />
                                <label className="text-sm font-medium text-gray-700">Add Product Component</label>
                            </div>
                            <input
                                type="text"
                                placeholder="Search for a product..."
                                className="w-full border p-2 rounded-lg"
                                value={searchTerm}
                                onChange={(e) => setSearchTerm(e.target.value)}
                            />
                            {/* Search Results Dropdown */}
                            {searchResults.length > 0 && (
                                <div className="absolute z-10 w-full bg-white border border-gray-200 rounded-xl shadow-xl mt-1 max-h-72 overflow-y-auto">
                                    {searchResults.map(p => (
                                        <button
                                            key={p.id}
                                            disabled={p.hasBOM || p.id === productId}
                                            className={`w-full text-left p-3 transition-colors flex items-center gap-3 border-b border-gray-50 last:border-b-0 ${p.hasBOM || p.id === productId ? 'opacity-50 cursor-not-allowed bg-gray-50' : 'hover:bg-blue-50'}`}
                                            onClick={() => !p.hasBOM && p.id !== productId && handleAddProduct(p)}
                                        >
                                            {p.mainImage && (
                                                <img src={p.mainImage} alt="" className="w-10 h-10 object-cover rounded-lg border border-gray-100" />
                                            )}
                                            <div className="flex-1 min-w-0">
                                                <div className="font-medium text-gray-900 text-sm truncate">
                                                    {p.name}
                                                    {p.hasBOM && <span className="ml-2 text-xs text-amber-600 bg-amber-50 px-1.5 py-0.5 rounded-full border border-amber-200">Composite Product</span>}
                                                    {p.id === productId && <span className="ml-2 text-xs text-gray-600 bg-gray-100 px-1.5 py-0.5 rounded-full border border-gray-200">Current Product</span>}
                                                </div>
                                                <div className="text-xs text-gray-500">
                                                    {p.sku && <span className="font-mono">{p.sku}</span>}
                                                    {p.sku && p.stockQuantity !== undefined && <span className="mx-1">•</span>}
                                                    {p.stockQuantity !== undefined && <span>Stock: {p.stockQuantity}</span>}
                                                </div>
                                            </div>
                                            <div className="text-sm font-semibold text-gray-700">${p.price || '0.00'}</div>
                                        </button>
                                    ))}
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
                    </>
                )}
            </div>
        </div>
    );
}
);
