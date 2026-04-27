import { WidgetProps } from './WidgetRegistry';
import { Logger } from '../../utils/logger';
import { Package } from 'lucide-react';
import { useEffect, useState, useCallback, useRef } from 'react';
import { useAuth } from '../../context/AuthContext';
import { useAccount } from '../../context/AccountContext';
import { useWidgetSocket } from '../../hooks/useWidgetSocket';
import { WidgetLoadingState, WidgetEmptyState, WidgetErrorState } from './WidgetState';
import { widgetCardClass, widgetTitleClass, widgetHeaderRowClass, widgetHeaderIconBadgeClass, widgetListRowClass, widgetPillClass } from './widgetStyles';

interface TopProduct {
    name: string;
    quantity: number;
}

export function TopProductsWidget({ className, dateRange }: WidgetProps) {
    const { token } = useAuth();
    const { currentAccount } = useAccount();
    const [products, setProducts] = useState<TopProduct[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const socketDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const fetchAbortRef = useRef<AbortController | null>(null);

    const fetchTopProducts = useCallback(async () => {
        if (!currentAccount || !token) return;

        fetchAbortRef.current?.abort();
        const controller = new AbortController();
        fetchAbortRef.current = controller;
        setLoading(true);
        setError(null);

        try {
            const url = `/api/analytics/top-products?startDate=${dateRange.startDate}&endDate=${dateRange.endDate}`;
            const res = await fetch(url, {
                headers: { 'Authorization': `Bearer ${token}`, 'X-Account-ID': currentAccount.id },
                signal: controller.signal
            });
            if (!res.ok) throw new Error(`HTTP ${res.status}`);
            const data = await res.json();
            if (controller.signal.aborted) return;

            setProducts(Array.isArray(data) ? data : []);
        } catch (err) {
            if (err instanceof DOMException && err.name === 'AbortError') return;
            Logger.error('Failed to fetch top products', { error: err });
            setError('Failed to load top products');
        } finally {
            if (!controller.signal.aborted) {
                setLoading(false);
            }
        }
    }, [currentAccount, dateRange.endDate, dateRange.startDate, token]);

    useEffect(() => {
        fetchTopProducts();
        return () => {
            fetchAbortRef.current?.abort();
        };
    }, [fetchTopProducts]);

    useEffect(() => {
        return () => {
            if (socketDebounceRef.current) {
                clearTimeout(socketDebounceRef.current);
                socketDebounceRef.current = null;
            }
        };
    }, []);

    // Real-time: debounced refetch when new orders arrive.
    useWidgetSocket<{ orderId: string }>('order:new', () => {
        if (socketDebounceRef.current) clearTimeout(socketDebounceRef.current);
        socketDebounceRef.current = setTimeout(() => fetchTopProducts(), 3000);
    });

    return (
        <div className={`${widgetCardClass} h-full w-full p-5 flex flex-col overflow-hidden ${className || ''}`}>
            <div className={widgetHeaderRowClass}>
                <h3 className={widgetTitleClass}>Top Products</h3>
                <div className={`${widgetHeaderIconBadgeClass} bg-gradient-to-br from-violet-400 to-purple-600 shadow-purple-500/20`}>
                    <Package size={16} />
                </div>
            </div>

            <div className="flex-1 overflow-y-auto space-y-2">
                {loading ? (
                    <WidgetLoadingState message="Loading products..." />
                ) : error ? (
                    <WidgetErrorState message={error} onRetry={fetchTopProducts} />
                ) : products.length === 0 ? (
                    <WidgetEmptyState message="No products found" />
                ) : (
                    products.map((product, idx) => (
                        <div key={`${product.name}-${idx}`} className={`flex justify-between items-center text-sm ${widgetListRowClass} hover:bg-slate-50 dark:hover:bg-slate-700/50`}>
                            <div className="flex gap-3 items-center overflow-hidden">
                                <div className={`w-7 h-7 rounded-lg flex items-center justify-center text-xs font-bold shrink-0 ${idx === 0 ? 'bg-gradient-to-br from-amber-400 to-amber-500 text-white shadow-sm' :
                                    idx === 1 ? 'bg-gradient-to-br from-slate-300 to-slate-400 text-white shadow-sm' :
                                        idx === 2 ? 'bg-gradient-to-br from-orange-300 to-orange-400 text-white shadow-sm' :
                                            'bg-slate-100 dark:bg-slate-700 text-slate-600 dark:text-slate-300'
                                    }`}>
                                    {idx + 1}
                                </div>
                                <p className="font-medium text-slate-900 dark:text-white truncate" title={product.name}>{product.name}</p>
                            </div>
                            <span className={`font-semibold text-slate-500 dark:text-slate-400 shrink-0 bg-slate-100 dark:bg-slate-700 ${widgetPillClass}`}>
                                {product.quantity} sold
                            </span>
                        </div>
                    ))
                )}
            </div>
        </div>
    );
}
