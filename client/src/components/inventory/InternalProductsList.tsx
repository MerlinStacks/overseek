/**
 * Internal Products List Component
 * 
 * Displays and manages internal-only products (components not synced to WooCommerce).
 * Used as a tab within the InventoryPage.
 */

import { useState, useEffect } from 'react';
import { useAuth } from '../../context/AuthContext';
import { useAccount } from '../../context/AccountContext';
import { usePermissions } from '../../hooks/usePermissions';
import { Logger } from '../../utils/logger';
import {
    Package, Plus, Search, Loader2, Trash2, Edit2, Box,
    AlertTriangle, Building2
} from 'lucide-react';
import { Pagination } from '../ui/Pagination';

interface InternalProduct {
    id: string;
    accountId: string;
    name: string;
    sku: string | null;
    description: string | null;
    stockQuantity: number;
    cogs: number | null;
    binLocation: string | null;
    mainImage: string | null;
    images: string[];
    supplierId: string | null;
    supplier: { id: string; name: string } | null;
    bomUsageCount?: number;
    createdAt: string;
    updatedAt: string;
}

interface InternalProductFormData {
    name: string;
    sku: string;
    description: string;
    stockQuantity: number;
    cogs: number | string;
    binLocation: string;
    supplierId: string;
}

export function InternalProductsList() {
    const { token } = useAuth();
    const { currentAccount } = useAccount();
    const { hasPermission } = usePermissions();
    const canViewCogs = hasPermission('view_cogs');

    const [products, setProducts] = useState<InternalProduct[]>([]);
    const [isLoading, setIsLoading] = useState(true);
    const [searchQuery, setSearchQuery] = useState('');
    const [debouncedQuery, setDebouncedQuery] = useState('');
    const [page, setPage] = useState(1);
    const [limit, setLimit] = useState(20);
    const [total, setTotal] = useState(0);

    // Modal state
    const [showModal, setShowModal] = useState(false);
    const [editingProduct, setEditingProduct] = useState<InternalProduct | null>(null);
    const [isSaving, setIsSaving] = useState(false);
    const [formData, setFormData] = useState<InternalProductFormData>({
        name: '',
        sku: '',
        description: '',
        stockQuantity: 0,
        cogs: '',
        binLocation: '',
        supplierId: ''
    });

    // Suppliers for dropdown
    const [suppliers, setSuppliers] = useState<Array<{ id: string; name: string }>>([]);

    // Debounce search
    useEffect(() => {
        const timer = setTimeout(() => {
            setDebouncedQuery(searchQuery);
            setPage(1);
        }, 500);
        return () => clearTimeout(timer);
    }, [searchQuery]);

    // Fetch products
    useEffect(() => {
        fetchProducts();
    }, [currentAccount, token, debouncedQuery, page, limit]);

    // Fetch suppliers on mount
    useEffect(() => {
        fetchSuppliers();
    }, [currentAccount, token]);

    async function fetchProducts() {
        if (!currentAccount || !token) return;

        setIsLoading(true);
        try {
            const params = new URLSearchParams({
                limit: limit.toString(),
                offset: ((page - 1) * limit).toString(),
                ...(debouncedQuery && { search: debouncedQuery })
            });

            const res = await fetch(`/api/inventory/internal-products?${params}`, {
                headers: {
                    'Authorization': `Bearer ${token}`,
                    'X-Account-ID': currentAccount.id
                }
            });

            if (res.ok) {
                const data = await res.json();
                setProducts(data.items);
                setTotal(data.total);
            }
        } catch (err) {
            Logger.error('Failed to fetch internal products', { error: err });
        } finally {
            setIsLoading(false);
        }
    }

    async function fetchSuppliers() {
        if (!currentAccount || !token) return;

        try {
            const res = await fetch('/api/inventory/suppliers', {
                headers: {
                    'Authorization': `Bearer ${token}`,
                    'X-Account-ID': currentAccount.id
                }
            });

            if (res.ok) {
                const data = await res.json();
                setSuppliers(data.map((s: any) => ({ id: s.id, name: s.name })));
            }
        } catch (err) {
            Logger.error('Failed to fetch suppliers', { error: err });
        }
    }

    function openCreateModal() {
        setEditingProduct(null);
        setFormData({
            name: '',
            sku: '',
            description: '',
            stockQuantity: 0,
            cogs: '',
            binLocation: '',
            supplierId: ''
        });
        setShowModal(true);
    }

    function openEditModal(product: InternalProduct) {
        setEditingProduct(product);
        setFormData({
            name: product.name,
            sku: product.sku || '',
            description: product.description || '',
            stockQuantity: product.stockQuantity,
            cogs: product.cogs?.toString() || '',
            binLocation: product.binLocation || '',
            supplierId: product.supplierId || ''
        });
        setShowModal(true);
    }

    async function handleSave() {
        if (!currentAccount || !token || !formData.name.trim()) return;

        setIsSaving(true);
        try {
            const payload = {
                name: formData.name.trim(),
                sku: formData.sku.trim() || undefined,
                description: formData.description.trim() || undefined,
                stockQuantity: Number(formData.stockQuantity) || 0,
                cogs: formData.cogs ? Number(formData.cogs) : undefined,
                binLocation: formData.binLocation.trim() || undefined,
                supplierId: formData.supplierId || undefined
            };

            const url = editingProduct
                ? `/api/inventory/internal-products/${editingProduct.id}`
                : '/api/inventory/internal-products';

            const res = await fetch(url, {
                method: editingProduct ? 'PUT' : 'POST',
                headers: {
                    'Authorization': `Bearer ${token}`,
                    'X-Account-ID': currentAccount.id,
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify(payload)
            });

            if (res.ok) {
                setShowModal(false);
                fetchProducts();
            } else {
                const err = await res.json();
                alert(err.error || 'Failed to save');
            }
        } catch (err) {
            Logger.error('Failed to save internal product', { error: err });
            alert('Failed to save');
        } finally {
            setIsSaving(false);
        }
    }

    async function handleDelete(product: InternalProduct) {
        if (!currentAccount || !token) return;

        const message = product.bomUsageCount && product.bomUsageCount > 0
            ? `This component is used in ${product.bomUsageCount} BOM(s). Delete anyway?`
            : `Delete "${product.name}"?`;

        if (!confirm(message)) return;

        try {
            const force = product.bomUsageCount && product.bomUsageCount > 0 ? '?force=true' : '';
            const res = await fetch(`/api/inventory/internal-products/${product.id}${force}`, {
                method: 'DELETE',
                headers: {
                    'Authorization': `Bearer ${token}`,
                    'X-Account-ID': currentAccount.id
                }
            });

            if (res.ok) {
                fetchProducts();
            } else {
                const err = await res.json();
                alert(err.error || 'Failed to delete');
            }
        } catch (err) {
            Logger.error('Failed to delete internal product', { error: err });
        }
    }

    const totalPages = Math.ceil(total / limit);

    return (
        <div className="space-y-4">
            {/* Header */}
            <div className="flex justify-between items-center">
                <div className="relative">
                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" size={18} />
                    <input
                        type="text"
                        placeholder="Search components..."
                        className="pl-10 pr-4 py-2 border border-gray-300 rounded-lg outline-hidden focus:ring-2 focus:ring-blue-500 w-64"
                        value={searchQuery}
                        onChange={(e) => setSearchQuery(e.target.value)}
                    />
                </div>
                <button
                    onClick={openCreateModal}
                    className="flex items-center gap-2 px-4 py-2 bg-gradient-to-r from-blue-600 to-indigo-600 text-white rounded-lg hover:from-blue-700 hover:to-indigo-700 transition-all shadow-sm"
                >
                    <Plus size={18} />
                    Add Component
                </button>
            </div>

            {/* Table */}
            <div className="bg-white rounded-xl shadow-xs border border-gray-200 overflow-hidden">
                <table className="w-full text-left border-collapse">
                    <thead>
                        <tr className="bg-gray-50 border-b border-gray-200 text-xs uppercase text-gray-500 font-semibold">
                            <th className="px-6 py-4 w-16">Image</th>
                            <th className="px-6 py-4">Name</th>
                            <th className="px-6 py-4">SKU</th>
                            <th className="px-6 py-4">Stock</th>
                            {canViewCogs && <th className="px-6 py-4">COGS</th>}
                            <th className="px-6 py-4">Supplier</th>
                            <th className="px-6 py-4">BOM Usage</th>
                            <th className="px-6 py-4 text-center">Actions</th>
                        </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-100">
                        {isLoading ? (
                            <tr>
                                <td colSpan={8} className="p-12 text-center">
                                    <Loader2 className="animate-spin inline text-blue-600" />
                                </td>
                            </tr>
                        ) : products.length === 0 ? (
                            <tr>
                                <td colSpan={8} className="p-12 text-center text-gray-500">
                                    <div className="flex flex-col items-center gap-2">
                                        <Box size={48} className="text-gray-300" />
                                        <p>No internal components found.</p>
                                        <p className="text-sm">These are components used in BOMs that are not sold on WooCommerce.</p>
                                    </div>
                                </td>
                            </tr>
                        ) : (
                            products.map((product) => (
                                <tr key={product.id} className="hover:bg-gray-50 transition-colors">
                                    <td className="px-6 py-4">
                                        <div className="w-10 h-10 bg-gray-100 rounded-lg overflow-hidden border border-gray-200 flex items-center justify-center">
                                            {product.mainImage ? (
                                                <img src={product.mainImage} alt="" className="w-full h-full object-cover" />
                                            ) : (
                                                <Package size={16} className="text-gray-400" />
                                            )}
                                        </div>
                                    </td>
                                    <td className="px-6 py-4">
                                        <div className="font-medium text-gray-900">{product.name}</div>
                                        {product.binLocation && (
                                            <div className="text-xs text-gray-500">📍 {product.binLocation}</div>
                                        )}
                                    </td>
                                    <td className="px-6 py-4 text-sm font-mono text-gray-500">
                                        {product.sku || '-'}
                                    </td>
                                    <td className="px-6 py-4">
                                        <span className={`text-lg font-bold ${product.stockQuantity === 0 ? 'text-red-600' :
                                            product.stockQuantity < 10 ? 'text-amber-600' : 'text-gray-900'
                                            }`}>
                                            {product.stockQuantity}
                                        </span>
                                    </td>
                                    {canViewCogs && (
                                        <td className="px-6 py-4 text-sm text-gray-600">
                                            {product.cogs ? `$${product.cogs.toFixed(2)}` : '-'}
                                        </td>
                                    )}
                                    <td className="px-6 py-4 text-sm text-gray-600">
                                        {product.supplier ? (
                                            <span className="flex items-center gap-1">
                                                <Building2 size={14} className="text-gray-400" />
                                                {product.supplier.name}
                                            </span>
                                        ) : '-'}
                                    </td>
                                    <td className="px-6 py-4">
                                        {product.bomUsageCount && product.bomUsageCount > 0 ? (
                                            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-purple-100 text-purple-700">
                                                {product.bomUsageCount} BOM{product.bomUsageCount > 1 ? 's' : ''}
                                            </span>
                                        ) : (
                                            <span className="text-xs text-gray-400">Unused</span>
                                        )}
                                    </td>
                                    <td className="px-6 py-4 text-center">
                                        <div className="flex items-center justify-center gap-1">
                                            <button
                                                onClick={() => openEditModal(product)}
                                                className="p-2 text-gray-500 hover:text-blue-600 hover:bg-blue-50 rounded-lg transition-colors"
                                                title="Edit"
                                            >
                                                <Edit2 size={16} />
                                            </button>
                                            <button
                                                onClick={() => handleDelete(product)}
                                                className="p-2 text-gray-500 hover:text-red-600 hover:bg-red-50 rounded-lg transition-colors"
                                                title="Delete"
                                            >
                                                <Trash2 size={16} />
                                            </button>
                                        </div>
                                    </td>
                                </tr>
                            ))
                        )}
                    </tbody>
                </table>
                {!isLoading && products.length > 0 && (
                    <Pagination
                        currentPage={page}
                        totalPages={totalPages}
                        onPageChange={setPage}
                        itemsPerPage={limit}
                        onItemsPerPageChange={(newLimit) => {
                            setLimit(newLimit);
                            setPage(1);
                        }}
                        allowItemsPerPage={true}
                    />
                )}
            </div>

            {/* Create/Edit Modal */}
            {showModal && (
                <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
                    <div className="bg-white rounded-xl shadow-2xl w-full max-w-lg mx-4 animate-in fade-in zoom-in-95 duration-200">
                        <div className="px-6 py-4 border-b border-gray-100">
                            <h2 className="text-lg font-semibold text-gray-900">
                                {editingProduct ? 'Edit Component' : 'Add Component'}
                            </h2>
                        </div>
                        <div className="p-6 space-y-4">
                            <div>
                                <label className="block text-sm font-medium text-gray-700 mb-1">Name *</label>
                                <input
                                    type="text"
                                    value={formData.name}
                                    onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                                    placeholder="Component name"
                                />
                            </div>
                            <div className="grid grid-cols-2 gap-4">
                                <div>
                                    <label className="block text-sm font-medium text-gray-700 mb-1">SKU</label>
                                    <input
                                        type="text"
                                        value={formData.sku}
                                        onChange={(e) => setFormData({ ...formData, sku: e.target.value })}
                                        className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                                        placeholder="INT-001"
                                    />
                                </div>
                                <div>
                                    <label className="block text-sm font-medium text-gray-700 mb-1">Bin Location</label>
                                    <input
                                        type="text"
                                        value={formData.binLocation}
                                        onChange={(e) => setFormData({ ...formData, binLocation: e.target.value })}
                                        className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                                        placeholder="A1-B2"
                                    />
                                </div>
                            </div>
                            <div className="grid grid-cols-2 gap-4">
                                <div>
                                    <label className="block text-sm font-medium text-gray-700 mb-1">Stock Quantity</label>
                                    <input
                                        type="number"
                                        value={formData.stockQuantity}
                                        onChange={(e) => setFormData({ ...formData, stockQuantity: Number(e.target.value) })}
                                        className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                                        min="0"
                                    />
                                </div>
                                {canViewCogs && (
                                    <div>
                                        <label className="block text-sm font-medium text-gray-700 mb-1">COGS ($)</label>
                                        <input
                                            type="number"
                                            value={formData.cogs}
                                            onChange={(e) => setFormData({ ...formData, cogs: e.target.value })}
                                            className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                                            min="0"
                                            step="0.01"
                                            placeholder="0.00"
                                        />
                                    </div>
                                )}
                            </div>
                            <div>
                                <label className="block text-sm font-medium text-gray-700 mb-1">Supplier</label>
                                <select
                                    value={formData.supplierId}
                                    onChange={(e) => setFormData({ ...formData, supplierId: e.target.value })}
                                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                                >
                                    <option value="">No supplier</option>
                                    {suppliers.map((s) => (
                                        <option key={s.id} value={s.id}>{s.name}</option>
                                    ))}
                                </select>
                            </div>
                            <div>
                                <label className="block text-sm font-medium text-gray-700 mb-1">Description</label>
                                <textarea
                                    value={formData.description}
                                    onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                                    rows={3}
                                    placeholder="Optional description..."
                                />
                            </div>
                        </div>
                        <div className="px-6 py-4 border-t border-gray-100 flex justify-end gap-3">
                            <button
                                onClick={() => setShowModal(false)}
                                className="px-4 py-2 text-gray-600 hover:text-gray-800 font-medium"
                            >
                                Cancel
                            </button>
                            <button
                                onClick={handleSave}
                                disabled={isSaving || !formData.name.trim()}
                                className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors disabled:opacity-50 flex items-center gap-2"
                            >
                                {isSaving && <Loader2 size={16} className="animate-spin" />}
                                {editingProduct ? 'Save Changes' : 'Create Component'}
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}
