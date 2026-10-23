import { useState } from 'react';
import { useScopedRequest } from '../../hooks/useScopedRequest';
import { finiteFields, isRecord } from '../../utils/responseValidation';
import { ShoppingCart, TrendingDown, Clock, ArrowRight } from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import { useAccount } from '../../context/AccountContext';
import { WidgetProps } from './WidgetRegistry';
import { widgetCardClass, widgetTitleClass, widgetHeaderRowClass, widgetHeaderIconBadgeClass, widgetListRowClass, widgetPillClass } from './widgetStyles';

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

export function CartAbandonmentWidget({ className = '', dateRange }: WidgetProps) {
    const { token } = useAuth();
    const { currentAccount } = useAccount();
    if (!token || !currentAccount) return <p role="status">Select an account to view cart activity.</p>;
    return <AccountCart key={JSON.stringify([token, currentAccount.id, dateRange.startDate, dateRange.endDate])} className={className} dateRange={dateRange} accountId={currentAccount.id} token={token} />;
}

function decodeCart(value: unknown): CartAbandonmentData {
    const validProduct = (item: unknown) => isRecord(item) && typeof item.productName === 'string' && (item.sku == null || typeof item.sku === 'string') && finiteFields(item, ['productId', 'addToCartCount', 'purchaseCount', 'removeCount', 'abandonmentRate', 'quickRemoveCount']);
    if (!isRecord(value) || !finiteFields(value, ['totalAddToCarts', 'totalPurchases', 'totalRemoves', 'overallAbandonmentRate']) || !Array.isArray(value.topAbandonedProducts) || !value.topAbandonedProducts.every(validProduct) || !Array.isArray(value.quickRemoveProducts) || !value.quickRemoveProducts.every(validProduct)) throw new Error('Invalid cart metrics');
    return value as unknown as CartAbandonmentData;
}

function AccountCart({ className, dateRange, token, accountId }: WidgetProps & { token: string; accountId: string }) {
    const query = new URLSearchParams({ startDate: dateRange.startDate, endDate: dateRange.endDate });
    const { data, loading, error, retry } = useScopedRequest(`/api/tracking/cart-abandonment?${query}`, accountId, token, decodeCart);
    const [activeTab, setActiveTab] = useState<'abandoned' | 'quickRemove'>('abandoned');

    if (loading) {
        return (
            <div className={`${widgetCardClass} h-full w-full p-5 flex flex-col ${className || ''}`}>
                <div className={widgetHeaderRowClass}>
                    <h3 className={widgetTitleClass}>Cart Abandonment</h3>
                    <div className={widgetHeaderIconBadgeClass}>
                        <ShoppingCart size={16} />
                    </div>
                </div>
                <div role="status" aria-label="Loading cart activity" className="flex-1 flex justify-center items-center">
                    <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-slate-400"></div>
                </div>
            </div>
        );
    }

    if (error || !data) return <div role="alert" className={`${widgetCardClass} p-5 ${className || ''}`}>Could not load cart activity. <button type="button" onClick={retry}>Retry cart activity</button></div>;

    if (data.totalAddToCarts === 0 && data.totalPurchases === 0 && data.totalRemoves === 0 && data.topAbandonedProducts.length === 0 && data.quickRemoveProducts.length === 0) {
        return (
            <div className={`${widgetCardClass} h-full w-full p-5 flex flex-col ${className || ''}`}>
                <div className={widgetHeaderRowClass}>
                    <h3 className={widgetTitleClass}>Cart Abandonment</h3>
                    <div className={widgetHeaderIconBadgeClass}>
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
        <div className={`${widgetCardClass} h-full w-full p-5 flex flex-col ${className || ''}`}>
            {/* Header */}
            <div className={widgetHeaderRowClass}>
                <div>
                    <h3 className={widgetTitleClass}>Cart Abandonment</h3>
                    <p className="text-xs text-slate-400 dark:text-slate-500">
                        {data.overallAbandonmentRate}% overall rate
                    </p>
                </div>
                <div className={widgetHeaderIconBadgeClass}>
                    <TrendingDown size={16} />
                </div>
            </div>

            {/* Stats Summary */}
            <div className="metric-strip mb-3" role="group" aria-label="Cart activity summary">
                <div className="metric-strip-item">
                    <p className="text-xl font-semibold tabular-nums text-slate-900 dark:text-white">{data.totalAddToCarts}</p>
                    <p className="text-[10px] text-slate-500 dark:text-slate-400">Add to Cart</p>
                </div>
                <div className="metric-strip-item">
                    <p className="text-xl font-semibold tabular-nums text-emerald-600">{data.totalPurchases}</p>
                    <p className="text-[10px] text-slate-500 dark:text-slate-400">Purchased</p>
                </div>
                <div className="metric-strip-item">
                    <p className="text-xl font-semibold tabular-nums text-rose-500">{data.totalRemoves}</p>
                    <p className="text-[10px] text-slate-500 dark:text-slate-400">Removed</p>
                </div>
            </div>

            {/* Tabs */}
            <div className="flex gap-1 mb-3 bg-slate-100 dark:bg-slate-700/50 p-1 rounded-lg">
                <button
                    type="button" aria-pressed={activeTab === 'abandoned'}
                    onClick={() => setActiveTab('abandoned')}
                    className={`flex-1 text-xs py-1.5 px-2 rounded-md transition-colors flex items-center justify-center gap-1 ${activeTab === 'abandoned'
                            ? 'bg-[var(--brand-subtle)] text-[var(--brand-text)]'
                            : 'text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-300'
                        }`}
                >
                    <TrendingDown size={12} />
                    Most Abandoned
                </button>
                <button
                    type="button" aria-pressed={activeTab === 'quickRemove'}
                    onClick={() => setActiveTab('quickRemove')}
                    className={`flex-1 text-xs py-1.5 px-2 rounded-md transition-colors flex items-center justify-center gap-1 ${activeTab === 'quickRemove'
                            ? 'bg-[var(--brand-subtle)] text-[var(--brand-text)]'
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
                        <div key={product.productId} className={`flex items-center justify-between ${widgetListRowClass} bg-slate-50 dark:bg-slate-700/30 hover:bg-slate-100 dark:hover:bg-slate-700/50`}>
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
                                        <p className={`text-[10px] text-slate-400 dark:text-slate-500`}>
                                            SKU: {product.sku}
                                        </p>
                                    )}
                                </div>
                            </div>
                            <div className="text-right shrink-0 ml-2">
                                {activeTab === 'abandoned' ? (
                                    <>
                                        <p className="text-sm font-bold text-rose-500">{product.abandonmentRate}%</p>
                                        <p className={widgetPillClass}>{product.addToCartCount} adds</p>
                                    </>
                                ) : (
                                    <>
                                        <p className="text-sm font-bold text-amber-500">{product.quickRemoveCount}x</p>
                                        <p className={widgetPillClass}>quick removed</p>
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
                className="mt-3 flex items-center justify-center gap-1 text-xs font-medium text-[var(--brand-text)] hover:underline focus-visible:outline-[var(--focus-color)] pt-2 border-t border-slate-100 dark:border-slate-700"
            >
                View Full Analytics <ArrowRight size={12} />
            </a>
        </div>
    );
}
