import { useState, useEffect, useCallback } from 'react';
import { Logger } from '../../utils/logger';
import { Search, Package2, AlertTriangle, Grid, List, ChevronRight } from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import { useAccount } from '../../context/AccountContext';
import { formatCurrency } from '../../utils/format';
import { subscribeToProductChanges } from '../../utils/productCrossTabEvents';
import { MobilePageHeader } from '../../components/mobile/MobilePageHeader';

interface ProductVariation {
    stock_quantity?: number;
    stockQuantity?: number;
}

interface ProductApiResponse {
    id: string;
    name?: string;
    sku?: string;
    variations?: ProductVariation[];
    stock_quantity?: number;
    stockQuantity?: number;
    low_stock_amount?: number;
    lowStockThreshold?: number;
    price?: number;
    mainImage?: string;
    images?: { src?: string }[];
}

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
    const [error, setError] = useState<string | null>(null);
    const [searchQuery, setSearchQuery] = useState('');
    const [filter, setFilter] = useState<'all' | 'low'>('all');
    const [viewMode, setViewMode] = useState<'list' | 'grid'>('list');

    const fetchProducts = useCallback(async () => {
        if (!currentAccount || !token) {
            setLoading(false);
            return;
        }

        try {
            setLoading(true);
            setError(null);
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
            let items = (data.products || data || []).map((p: ProductApiResponse) => ({
                id: p.id,
                name: p.name || 'Unnamed Product',
                sku: p.sku || '-',
                stockQuantity: (p.variations && p.variations.length > 0)
                    ? p.variations.reduce((sum: number, v: ProductVariation) => sum + (v.stock_quantity || v.stockQuantity || 0), 0)
                    : (p.stock_quantity ?? p.stockQuantity ?? 0),
                lowStockThreshold: p.low_stock_amount ?? p.lowStockThreshold ?? 5,
                price: p.price || 0,
                image: p.mainImage || p.images?.[0]?.src
            }));

            if (filter === 'low') {
                items = items.filter((p: Product) => p.stockQuantity <= p.lowStockThreshold);
            }

            setProducts(items);
            setError(null);
        } catch (error) {
            Logger.error('[MobileInventory] Error:', { error: error });
            setError('Could not load inventory. Pull down or tap retry to refresh.');
        } finally {
            setLoading(false);
        }
    }, [currentAccount, filter, searchQuery, token]);

    useEffect(() => {
        void fetchProducts();

        const handleRefresh = () => void fetchProducts();
        window.addEventListener('mobile-refresh', handleRefresh);
        return () => window.removeEventListener('mobile-refresh', handleRefresh);
    }, [fetchProducts]);

    useEffect(() => {
        const unsubscribe = subscribeToProductChanges((event) => {
            if (event.accountId !== currentAccount?.id) {
                return;
            }

            void fetchProducts();
        });

        return unsubscribe;
    }, [currentAccount?.id, fetchProducts]);

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
                    <div className="h-8 bg-white/5 rounded w-28" />
                    <div className="flex gap-2">
                        <div className="h-10 w-10 bg-white/5 rounded-lg" />
                        <div className="h-10 w-10 bg-white/5 rounded-lg" />
                    </div>
                </div>
                <div className="h-12 bg-white/5 rounded-lg" />
                {[...Array(5)].map((_, i) => (
                    <div key={i} className="h-24 mobile-panel" />
                ))}
            </div>
        );
    }

    if (error && products.length === 0) {
        return (
            <div className="rounded-[1.5rem] border border-rose-400/20 bg-rose-500/10 p-5 text-center text-rose-100">
                <p className="mb-4 text-sm font-medium">{error}</p>
                <button
                    onClick={() => void fetchProducts()}
                    className="rounded-full bg-white/10 px-4 py-2 text-sm font-bold text-white ring-1 ring-white/15 active:scale-[0.98]"
                >
                    Retry
                </button>
            </div>
        );
    }

    return (
        <div className="space-y-4">
            {/* Header */}
            <MobilePageHeader title="Inventory" description="Products and stock levels" actions={<>
                    <button
                        onClick={() => setViewMode('list')}
                        aria-label="List view"
                        aria-pressed={viewMode === 'list'}
                        className={`p-2.5 rounded-lg ${viewMode === 'list' ? 'mobile-brand-soft' : 'mobile-icon'}`}
                    >
                        <List size={20} />
                    </button>
                    <button
                        onClick={() => setViewMode('grid')}
                        aria-label="Grid view"
                        aria-pressed={viewMode === 'grid'}
                        className={`p-2.5 rounded-lg ${viewMode === 'grid' ? 'mobile-brand-soft' : 'mobile-icon'}`}
                    >
                        <Grid size={20} />
                    </button>
            </>} />

            {/* Low Stock Alert */}
            {lowStockCount > 0 && (
                <button
                    onClick={() => setFilter(filter === 'low' ? 'all' : 'low')}
                    className={`w-full flex items-center gap-3 p-4 rounded-xl border ${filter === 'low'
                        ? 'bg-amber-400/15 border-amber-400/40'
                        : 'bg-amber-400/5 border-amber-400/15'
                        }`}
                >
                    <div className="p-2 rounded-lg bg-amber-400/10">
                        <AlertTriangle size={20} className="text-amber-300" />
                    </div>
                    <div className="flex-1 text-left">
                        <p className="font-medium text-amber-200">
                            {lowStockCount} item{lowStockCount > 1 ? 's' : ''} low on stock
                        </p>
                        <p className="text-sm text-amber-200/70">
                            {filter === 'low' ? 'Showing low stock only' : 'Tap to view'}
                        </p>
                    </div>
                    <ChevronRight size={20} className="text-amber-300" />
                </button>
            )}

            {/* Search */}
            <form onSubmit={handleSearch} className="relative">
                <Search className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400" size={20} />
                <input
                    type="text"
                    placeholder="Search products..."
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    className="mobile-field w-full pl-12 pr-4 py-3.5 text-base"
                />
            </form>

            {/* Filter Chips */}
            <div className="flex gap-2">
                <button
                    onClick={() => setFilter('all')}
                    className={`px-4 py-2.5 rounded-lg text-sm font-medium ${filter === 'all'
                        ? 'mobile-brand-soft ring-1 ring-current'
                        : 'bg-white/5 text-slate-300'
                        }`}
                >
                    All Products
                </button>
                <button
                    onClick={() => setFilter('low')}
                    className={`px-4 py-2.5 rounded-lg text-sm font-medium flex items-center gap-1.5 ${filter === 'low'
                        ? 'bg-amber-400/15 text-amber-200 ring-1 ring-amber-400/40'
                        : 'bg-white/5 text-slate-300'
                        }`}
                >
                    <AlertTriangle size={14} />
                    Low Stock
                </button>
            </div>

            {/* Products */}
            {products.length === 0 ? (
                <div className="text-center py-16">
                    <div className="mobile-icon w-16 h-16 mx-auto mb-4 rounded-xl flex items-center justify-center">
                        <Package2 size={30} />
                    </div>
                    <p className="text-white font-semibold mb-1">No products found</p>
                    <p className="text-slate-400 text-sm">Products will appear here</p>
                </div>
            ) : viewMode === 'grid' ? (
                /* Grid View */
                <div className="grid grid-cols-2 gap-3">
                    {products.map((product) => {
                        const lowStock = isLowStock(product);
                        return (
                            <div
                                key={product.id}
                                className="mobile-panel p-3"
                            >
                                {product.image ? (
                                    <img src={product.image} alt={product.name} className="w-full h-28 rounded-xl object-cover mb-3" />
                                ) : (
                                    <div className="mobile-icon w-full h-28 rounded-lg flex items-center justify-center mb-3">
                                        <Package2 size={32} />
                                    </div>
                                )}
                                <p className="font-medium text-white text-sm line-clamp-2 mb-1">{product.name}</p>
                                <p className="text-xs text-slate-400 mb-2">SKU: {product.sku}</p>
                                <div className="flex items-center justify-between">
                                    <span className="text-sm font-semibold text-white">{formatAccountCurrency(product.price)}</span>
                                    <span className={`text-sm font-semibold ${lowStock ? 'text-amber-300' : 'text-slate-300'}`}>
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
                                className="mobile-panel p-4 flex items-center gap-4"
                            >
                                {product.image ? (
                                    <img src={product.image} alt={product.name} className="w-16 h-16 rounded-xl object-cover flex-shrink-0" />
                                ) : (
                                    <div className="mobile-icon w-16 h-16 rounded-lg flex items-center justify-center flex-shrink-0">
                                        <Package2 size={28} />
                                    </div>
                                )}
                                <div className="flex-1 min-w-0">
                                    <p className="font-medium text-white truncate mb-0.5">{product.name}</p>
                                    <p className="text-sm text-slate-400">SKU: {product.sku}</p>
                                    <p className="text-sm font-semibold text-white mt-1">{formatAccountCurrency(product.price)}</p>
                                </div>
                                <div className="text-right flex-shrink-0">
                                    <p className={`text-2xl font-semibold tabular-nums ${lowStock ? 'text-amber-300' : 'text-white'}`}>
                                        {product.stockQuantity}
                                    </p>
                                    <p className="text-xs text-slate-400">in stock</p>
                                    {lowStock && (
                                        <span className="inline-flex items-center gap-1 text-xs text-amber-300 font-medium mt-1">
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
