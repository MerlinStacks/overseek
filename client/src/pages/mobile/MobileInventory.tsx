import { useState, useEffect } from 'react';
import { Logger } from '../../utils/logger';
import { Search, Package2, AlertTriangle, Grid, List, ChevronRight } from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import { useAccount } from '../../context/AccountContext';
import { formatCurrency } from '../../utils/format';

interface Product {
    id: string;
    name: string;
    sku: string;
    stockQuantity: number;
    lowStockThreshold: number;
    price: number;
    image?: string;
}

export function MobileInventory() {
    const { token } = useAuth();
    const { currentAccount } = useAccount();
    const [products, setProducts] = useState<Product[]>([]);
    const [loading, setLoading] = useState(true);
    const [searchQuery, setSearchQuery] = useState('');
    const [filter, setFilter] = useState<'all' | 'low'>('all');
    const [viewMode, setViewMode] = useState<'list' | 'grid'>('list');

    useEffect(() => {
        fetchProducts();
    }, [currentAccount, filter, token]);

    const fetchProducts = async () => {
        if (!currentAccount || !token) {
            setLoading(false);
            return;
        }

        try {
            setLoading(true);
            const params = new URLSearchParams();
            params.append('limit', '50');
            if (searchQuery) params.append('q', searchQuery);

            const response = await fetch(`/api/products?${params}`, {
                headers: {
                    'Authorization': `Bearer ${token}`,
                    'X-Account-ID': currentAccount.id
                }
            });

            if (!response.ok) throw new Error('Failed to fetch');

            const data = await response.json();
            let items = (data.products || data || []).map((p: any) => ({
                id: p.id,
                name: p.name || 'Unnamed Product',
                sku: p.sku || '-',
                stockQuantity: (p.variations && p.variations.length > 0)
                    ? p.variations.reduce((sum: number, v: any) => sum + (v.stock_quantity || v.stockQuantity || 0), 0)
                    : (p.stock_quantity ?? p.stockQuantity ?? 0),
                lowStockThreshold: p.low_stock_amount ?? p.lowStockThreshold ?? 5,
                price: p.price || 0,
                image: p.mainImage || p.images?.[0]?.src
            }));

            if (filter === 'low') {
                items = items.filter((p: Product) => p.stockQuantity <= p.lowStockThreshold);
            }

            setProducts(items);
        } catch (error) {
            Logger.error('[MobileInventory] Error:', { error: error });
        } finally {
            setLoading(false);
        }
    };

    const handleSearch = (e: React.FormEvent) => {
        e.preventDefault();
        fetchProducts();
    };

    const isLowStock = (product: Product) => product.stockQuantity <= product.lowStockThreshold;
    const lowStockCount = products.filter(isLowStock).length;

    // Currency formatting helper
    const formatAccountCurrency = (amount: number) =>
        formatCurrency(amount, currentAccount?.currency || 'USD', { minimumFractionDigits: 0 });

    if (loading) {
        return (
            <div className="space-y-4 animate-pulse">
                <div className="flex items-center justify-between">
                    <div className="h-8 bg-gray-200 rounded w-28" />
                    <div className="flex gap-2">
                        <div className="h-10 w-10 bg-gray-200 rounded-xl" />
                        <div className="h-10 w-10 bg-gray-200 rounded-xl" />
                    </div>
                </div>
                <div className="h-12 bg-gray-200 rounded-2xl" />
                {[...Array(5)].map((_, i) => (
                    <div key={i} className="h-24 bg-gray-200 rounded-2xl" />
                ))}
            </div>
        );
    }

    return (
        <div className="space-y-4">
            {/* Header */}
            <div className="flex items-center justify-between">
                <h1 className="text-2xl font-bold text-gray-900">Inventory</h1>
                <div className="flex gap-2">
                    <button
                        onClick={() => setViewMode('list')}
                        className={`p-2.5 rounded-xl transition-colors ${viewMode === 'list' ? 'bg-indigo-600 text-white' : 'bg-gray-100 text-gray-600'}`}
                    >
                        <List size={20} />
                    </button>
                    <button
                        onClick={() => setViewMode('grid')}
                        className={`p-2.5 rounded-xl transition-colors ${viewMode === 'grid' ? 'bg-indigo-600 text-white' : 'bg-gray-100 text-gray-600'}`}
                    >
                        <Grid size={20} />
                    </button>
                </div>
            </div>

            {/* Low Stock Alert */}
            {lowStockCount > 0 && (
                <button
                    onClick={() => setFilter(filter === 'low' ? 'all' : 'low')}
                    className={`w-full flex items-center gap-3 p-4 rounded-2xl transition-all active:scale-[0.98] ${filter === 'low'
                        ? 'bg-amber-500 text-white'
                        : 'bg-amber-50 border border-amber-200'
                        }`}
                >
                    <div className={`p-2 rounded-full ${filter === 'low' ? 'bg-amber-400' : 'bg-amber-100'}`}>
                        <AlertTriangle size={20} className={filter === 'low' ? 'text-white' : 'text-amber-600'} />
                    </div>
                    <div className="flex-1 text-left">
                        <p className={`font-semibold ${filter === 'low' ? 'text-white' : 'text-amber-900'}`}>
                            {lowStockCount} item{lowStockCount > 1 ? 's' : ''} low on stock
                        </p>
                        <p className={`text-sm ${filter === 'low' ? 'text-amber-100' : 'text-amber-700'}`}>
                            {filter === 'low' ? 'Showing low stock only' : 'Tap to view'}
                        </p>
                    </div>
                    <ChevronRight size={20} className={filter === 'low' ? 'text-amber-100' : 'text-amber-400'} />
                </button>
            )}

            {/* Search */}
            <form onSubmit={handleSearch} className="relative">
                <Search className="absolute left-4 top-1/2 -translate-y-1/2 text-gray-400" size={20} />
                <input
                    type="text"
                    placeholder="Search products..."
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    className="w-full pl-12 pr-4 py-3.5 bg-white border border-gray-200 rounded-2xl focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent text-base"
                />
            </form>

            {/* Filter Chips */}
            <div className="flex gap-2">
                <button
                    onClick={() => setFilter('all')}
                    className={`px-4 py-2.5 rounded-full text-sm font-semibold transition-all ${filter === 'all'
                        ? 'bg-indigo-600 text-white shadow-lg shadow-indigo-200'
                        : 'bg-white text-gray-700 border border-gray-200'
                        }`}
                >
                    All Products
                </button>
                <button
                    onClick={() => setFilter('low')}
                    className={`px-4 py-2.5 rounded-full text-sm font-semibold flex items-center gap-1.5 transition-all ${filter === 'low'
                        ? 'bg-amber-500 text-white shadow-lg shadow-amber-200'
                        : 'bg-white text-gray-700 border border-gray-200'
                        }`}
                >
                    <AlertTriangle size={14} />
                    Low Stock
                </button>
            </div>

            {/* Products */}
            {products.length === 0 ? (
                <div className="text-center py-16">
                    <div className="w-20 h-20 mx-auto mb-4 bg-gray-100 rounded-full flex items-center justify-center">
                        <Package2 className="text-gray-400" size={36} />
                    </div>
                    <p className="text-gray-900 font-semibold mb-1">No products found</p>
                    <p className="text-gray-500 text-sm">Products will appear here</p>
                </div>
            ) : viewMode === 'grid' ? (
                /* Grid View */
                <div className="grid grid-cols-2 gap-3">
                    {products.map((product) => {
                        const lowStock = isLowStock(product);
                        return (
                            <div
                                key={product.id}
                                className="bg-white rounded-2xl p-3 shadow-sm border border-gray-100 active:scale-[0.98] transition-all"
                            >
                                {product.image ? (
                                    <img src={product.image} alt={product.name} className="w-full h-28 rounded-xl object-cover mb-3" />
                                ) : (
                                    <div className="w-full h-28 rounded-xl bg-gray-100 flex items-center justify-center mb-3">
                                        <Package2 size={32} className="text-gray-400" />
                                    </div>
                                )}
                                <p className="font-semibold text-gray-900 text-sm line-clamp-2 mb-1">{product.name}</p>
                                <p className="text-xs text-gray-500 mb-2">SKU: {product.sku}</p>
                                <div className="flex items-center justify-between">
                                    <span className="text-sm font-bold text-gray-900">{formatAccountCurrency(product.price)}</span>
                                    <span className={`text-sm font-bold ${lowStock ? 'text-amber-600' : 'text-emerald-600'}`}>
                                        {product.stockQuantity}
                                    </span>
                                </div>
                            </div>
                        );
                    })}
                </div>
            ) : (
                /* List View */
                <div className="space-y-3">
                    {products.map((product) => {
                        const lowStock = isLowStock(product);
                        return (
                            <div
                                key={product.id}
                                className="bg-white rounded-2xl p-4 shadow-sm border border-gray-100 flex items-center gap-4 active:scale-[0.98] transition-all"
                            >
                                {product.image ? (
                                    <img src={product.image} alt={product.name} className="w-16 h-16 rounded-xl object-cover flex-shrink-0" />
                                ) : (
                                    <div className="w-16 h-16 rounded-xl bg-gray-100 flex items-center justify-center flex-shrink-0">
                                        <Package2 size={28} className="text-gray-400" />
                                    </div>
                                )}
                                <div className="flex-1 min-w-0">
                                    <p className="font-semibold text-gray-900 truncate mb-0.5">{product.name}</p>
                                    <p className="text-sm text-gray-500">SKU: {product.sku}</p>
                                    <p className="text-sm font-bold text-gray-900 mt-1">{formatAccountCurrency(product.price)}</p>
                                </div>
                                <div className="text-right flex-shrink-0">
                                    <p className={`text-2xl font-bold ${lowStock ? 'text-amber-600' : 'text-emerald-600'}`}>
                                        {product.stockQuantity}
                                    </p>
                                    <p className="text-xs text-gray-500">in stock</p>
                                    {lowStock && (
                                        <span className="inline-flex items-center gap-1 text-xs text-amber-600 font-medium mt-1">
                                            <AlertTriangle size={10} /> Low
                                        </span>
                                    )}
                                </div>
                            </div>
                        );
                    })}
                </div>
            )}
        </div>
    );
}
