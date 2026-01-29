import { WidgetProps } from './WidgetRegistry';
import { Logger } from '../../utils/logger';
import { Package, Loader2 } from 'lucide-react';
import { useEffect, useState, useCallback } from 'react';
import { useAuth } from '../../context/AuthContext';
import { useAccount } from '../../context/AccountContext';
import { useWidgetSocket } from '../../hooks/useWidgetSocket';

export function TopProductsWidget({ className, dateRange }: WidgetProps) {
    const { token } = useAuth();
    const { currentAccount } = useAccount();
    const [products, setProducts] = useState<any[]>([]);
    const [loading, setLoading] = useState(true);

    const fetchTopProducts = useCallback(() => {
        if (!currentAccount || !token) return;

        const url = `/api/analytics/top-products?startDate=${dateRange.startDate}&endDate=${dateRange.endDate}`;

        fetch(url, {
            headers: { 'Authorization': `Bearer ${token}`, 'X-Account-ID': currentAccount.id }
        })
            .then(res => res.json())
            .then(data => setProducts(Array.isArray(data) ? data : []))
            .catch(e => Logger.error('Failed to fetch top products', { error: e }))
            .finally(() => setLoading(false));
    }, [currentAccount, token, dateRange]);

    useEffect(() => {
        fetchTopProducts();
    }, [fetchTopProducts]);

    // Real-time: Refetch when new orders arrive
    useWidgetSocket<{ orderId: string }>('order:new', () => {
        fetchTopProducts();
    });

    return (
        <div className={`bg-white dark:bg-slate-800/90 h-full w-full p-5 flex flex-col rounded-2xl shadow-[0_1px_3px_rgba(0,0,0,0.05),0_1px_2px_rgba(0,0,0,0.03)] dark:shadow-[0_1px_3px_rgba(0,0,0,0.2)] border border-slate-200/80 dark:border-slate-700/50 overflow-hidden transition-all duration-300 hover:shadow-[0_10px_40px_rgba(0,0,0,0.08)] dark:hover:shadow-[0_10px_40px_rgba(0,0,0,0.3)] ${className}`}>
            <div className="flex justify-between items-center mb-4">
                <h3 className="font-semibold text-slate-900 dark:text-white">Top Products</h3>
                <div className="p-2 bg-gradient-to-br from-violet-400 to-purple-600 rounded-lg text-white shadow-md shadow-purple-500/20">
                    <Package size={16} />
                </div>
            </div>

            <div className="flex-1 overflow-y-auto space-y-2">
                {loading ? (
                    <div className="flex justify-center p-4"><Loader2 className="animate-spin text-slate-400" /></div>
                ) : products.length === 0 ? (
                    <div className="text-center text-slate-400 dark:text-slate-500 py-4 text-sm">No products found</div>
                ) : (
                    products.map((product, idx) => (
                        <div key={idx} className="flex justify-between items-center text-sm p-3 hover:bg-slate-50 dark:hover:bg-slate-700/50 rounded-xl transition-all duration-200">
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
                            <span className="font-semibold text-slate-500 dark:text-slate-400 shrink-0 text-xs bg-slate-100 dark:bg-slate-700 px-2 py-1 rounded-md">
                                {product.quantity} sold
                            </span>
                        </div>
                    ))
                )}
            </div>
        </div>
    );
}
