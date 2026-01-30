import { useEffect, useState, useCallback } from 'react';
import { Logger } from '../../utils/logger';
import { ShoppingCart, TrendingDown, Clock, ArrowRight } from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import { useAccount } from '../../context/AccountContext';

interface ProductAbandonmentStat {
    productId: number;
    productName: string;
    sku: string;
    addToCartCount: number;
    purchaseCount: number;
    removeCount: number;
    abandonmentRate: number;
    quickRemoveCount: number;
}

interface CartAbandonmentData {
    period: string;
    totalAddToCarts: number;
    totalPurchases: number;
    totalRemoves: number;
    overallAbandonmentRate: number;
    topAbandonedProducts: ProductAbandonmentStat[];
    quickRemoveProducts: ProductAbandonmentStat[];
}

interface CartAbandonmentWidgetProps {
    className?: string;
    days?: number;
}

export function CartAbandonmentWidget({ className = '', days = 30 }: CartAbandonmentWidgetProps) {
    const { token } = useAuth();
    const { currentAccount } = useAccount();
    const [data, setData] = useState<CartAbandonmentData | null>(null);
    const [loading, setLoading] = useState(true);
    const [activeTab, setActiveTab] = useState<'abandoned' | 'quickRemove'>('abandoned');

    const fetchData = useCallback(async () => {
        if (!currentAccount || !token) return;

        try {
            const res = await fetch(`/api/tracking/cart-abandonment?days=${days}`, {
                headers: {
                    'Authorization': `Bearer ${token}`,
                    'X-Account-ID': currentAccount.id
                }
            });
            if (res.ok) {
                setData(await res.json());
            }
        } catch (error) {
            Logger.error('Failed to load cart abandonment data', { error });
        } finally {
            setLoading(false);
        }
    }, [currentAccount, token, days]);

    useEffect(() => {
        fetchData();
    }, [fetchData]);

    if (loading) {
        return (
            <div className={`bg-white dark:bg-slate-800/90 h-full w-full p-5 flex flex-col rounded-2xl shadow-[0_1px_3px_rgba(0,0,0,0.05)] dark:shadow-[0_1px_3px_rgba(0,0,0,0.2)] border border-slate-200/80 dark:border-slate-700/50 ${className}`}>
                <div className="flex items-center justify-between mb-4">
                    <h3 className="font-semibold text-slate-900 dark:text-white">Cart Abandonment</h3>
                    <div className="p-2 bg-gradient-to-br from-rose-400 to-red-500 rounded-lg text-white shadow-md">
                        <ShoppingCart size={16} />
                    </div>
                </div>
                <div className="flex-1 flex justify-center items-center">
                    <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-slate-400"></div>
                </div>
            </div>
        );
    }

    if (!data || (data.topAbandonedProducts.length === 0 && data.quickRemoveProducts.length === 0)) {
        return (
            <div className={`bg-white dark:bg-slate-800/90 h-full w-full p-5 flex flex-col rounded-2xl shadow-[0_1px_3px_rgba(0,0,0,0.05)] dark:shadow-[0_1px_3px_rgba(0,0,0,0.2)] border border-slate-200/80 dark:border-slate-700/50 ${className}`}>
                <div className="flex items-center justify-between mb-4">
                    <h3 className="font-semibold text-slate-900 dark:text-white">Cart Abandonment</h3>
                    <div className="p-2 bg-gradient-to-br from-rose-400 to-red-500 rounded-lg text-white shadow-md">
                        <ShoppingCart size={16} />
                    </div>
                </div>
                <div className="flex-1 flex flex-col items-center justify-center text-slate-400 dark:text-slate-500">
                    <ShoppingCart className="w-8 h-8 mb-2 opacity-50" />
                    <span className="text-sm">No abandonment data yet</span>
                    <span className="text-xs mt-1">Tracking cart events...</span>
                </div>
            </div>
        );
    }

    const activeProducts = activeTab === 'abandoned' ? data.topAbandonedProducts : data.quickRemoveProducts;

    return (
        <div className={`bg-white dark:bg-slate-800/90 h-full w-full p-5 flex flex-col rounded-2xl shadow-[0_1px_3px_rgba(0,0,0,0.05)] dark:shadow-[0_1px_3px_rgba(0,0,0,0.2)] border border-slate-200/80 dark:border-slate-700/50 transition-all duration-300 hover:shadow-[0_10px_40px_rgba(0,0,0,0.08)] dark:hover:shadow-[0_10px_40px_rgba(0,0,0,0.3)] ${className}`}>
            {/* Header */}
            <div className="flex items-center justify-between mb-3">
                <div>
                    <h3 className="font-semibold text-slate-900 dark:text-white">Cart Abandonment</h3>
                    <p className="text-xs text-slate-400 dark:text-slate-500">
                        {data.overallAbandonmentRate}% overall rate
                    </p>
                </div>
                <div className="p-2 bg-gradient-to-br from-rose-400 to-red-500 rounded-lg text-white shadow-md shadow-red-500/20">
                    <TrendingDown size={16} />
                </div>
            </div>

            {/* Stats Summary */}
            <div className="grid grid-cols-3 gap-2 mb-4">
                <div className="bg-slate-50 dark:bg-slate-700/50 rounded-lg p-2 text-center">
                    <p className="text-lg font-bold text-slate-900 dark:text-white">{data.totalAddToCarts}</p>
                    <p className="text-[10px] text-slate-500 dark:text-slate-400">Add to Cart</p>
                </div>
                <div className="bg-slate-50 dark:bg-slate-700/50 rounded-lg p-2 text-center">
                    <p className="text-lg font-bold text-emerald-600">{data.totalPurchases}</p>
                    <p className="text-[10px] text-slate-500 dark:text-slate-400">Purchased</p>
                </div>
                <div className="bg-slate-50 dark:bg-slate-700/50 rounded-lg p-2 text-center">
                    <p className="text-lg font-bold text-rose-500">{data.totalRemoves}</p>
                    <p className="text-[10px] text-slate-500 dark:text-slate-400">Removed</p>
                </div>
            </div>

            {/* Tabs */}
            <div className="flex gap-1 mb-3 bg-slate-100 dark:bg-slate-700/50 p-1 rounded-lg">
                <button
                    onClick={() => setActiveTab('abandoned')}
                    className={`flex-1 text-xs py-1.5 px-2 rounded-md transition-colors flex items-center justify-center gap-1 ${activeTab === 'abandoned'
                            ? 'bg-white dark:bg-slate-600 text-slate-900 dark:text-white shadow-sm'
                            : 'text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-300'
                        }`}
                >
                    <TrendingDown size={12} />
                    Most Abandoned
                </button>
                <button
                    onClick={() => setActiveTab('quickRemove')}
                    className={`flex-1 text-xs py-1.5 px-2 rounded-md transition-colors flex items-center justify-center gap-1 ${activeTab === 'quickRemove'
                            ? 'bg-white dark:bg-slate-600 text-slate-900 dark:text-white shadow-sm'
                            : 'text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-300'
                        }`}
                >
                    <Clock size={12} />
                    Quick Removes
                </button>
            </div>

            {/* Product List */}
            <div className="flex-1 overflow-y-auto space-y-2">
                {activeProducts.length === 0 ? (
                    <div className="text-center text-slate-400 dark:text-slate-500 py-4 text-sm">
                        No data for this category
                    </div>
                ) : (
                    activeProducts.slice(0, 5).map((product, idx) => (
                        <div
                            key={product.productId}
                            className="flex items-center justify-between p-2.5 bg-slate-50 dark:bg-slate-700/30 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-700/50 transition-colors"
                        >
                            <div className="flex items-center gap-2 min-w-0 flex-1">
                                <span className={`w-5 h-5 rounded flex items-center justify-center text-[10px] font-bold shrink-0 ${idx === 0 ? 'bg-rose-500 text-white' :
                                        idx === 1 ? 'bg-rose-400 text-white' :
                                            idx === 2 ? 'bg-rose-300 text-white' :
                                                'bg-slate-200 dark:bg-slate-600 text-slate-600 dark:text-slate-300'
                                    }`}>
                                    {idx + 1}
                                </span>
                                <div className="min-w-0 flex-1">
                                    <p className="text-sm font-medium text-slate-800 dark:text-slate-200 truncate">
                                        {product.productName}
                                    </p>
                                    {product.sku && (
                                        <p className="text-[10px] text-slate-400 dark:text-slate-500">
                                            SKU: {product.sku}
                                        </p>
                                    )}
                                </div>
                            </div>
                            <div className="text-right shrink-0 ml-2">
                                {activeTab === 'abandoned' ? (
                                    <>
                                        <p className="text-sm font-bold text-rose-500">{product.abandonmentRate}%</p>
                                        <p className="text-[10px] text-slate-400">{product.addToCartCount} adds</p>
                                    </>
                                ) : (
                                    <>
                                        <p className="text-sm font-bold text-amber-500">{product.quickRemoveCount}x</p>
                                        <p className="text-[10px] text-slate-400">quick removed</p>
                                    </>
                                )}
                            </div>
                        </div>
                    ))
                )}
            </div>

            {/* Footer */}
            <a
                href="/analytics"
                className="mt-3 flex items-center justify-center gap-1 text-xs font-medium text-blue-600 dark:text-blue-400 hover:text-blue-700 dark:hover:text-blue-300 pt-2 border-t border-slate-100 dark:border-slate-700"
            >
                View Full Analytics <ArrowRight size={12} />
            </a>
        </div>
    );
}
