
import { WidgetProps } from './WidgetRegistry';
import { Logger } from '../../utils/logger';
import { DollarSign, Loader2, TrendingUp, TrendingDown, Minus, Zap } from 'lucide-react';
import { useEffect, useState, useCallback } from 'react';
import { useAuth } from '../../context/AuthContext';
import { useAccount } from '../../context/AccountContext';
import { useWidgetSocket } from '../../hooks/useWidgetSocket';

export function TotalSalesWidget({ className, dateRange, comparison }: WidgetProps) {
    const { token } = useAuth();
    const { currentAccount } = useAccount();
    const [sales, setSales] = useState<number | null>(null);
    const [orderCount, setOrderCount] = useState<number | null>(null);
    const [comparisonSales, setComparisonSales] = useState<number | null>(null);
    const [loading, setLoading] = useState(true);
    const [hasRealtimeUpdate, setHasRealtimeUpdate] = useState(false);

    const fetchSales = useCallback(async () => {
        if (!currentAccount || !token) return;

        setLoading(true);
        try {
            const currentRes = await fetch(`/api/analytics/sales?startDate=${dateRange.startDate}&endDate=${dateRange.endDate}`, {
                headers: { 'Authorization': `Bearer ${token}`, 'X-Account-ID': currentAccount.id }
            });
            const currentData = await currentRes.json();
            setSales(currentData.total || 0);
            setOrderCount(currentData.count || 0);

            if (comparison) {
                const compRes = await fetch(`/api/analytics/sales?startDate=${comparison.startDate}&endDate=${comparison.endDate}`, {
                    headers: { 'Authorization': `Bearer ${token}`, 'X-Account-ID': currentAccount.id }
                });
                const compData = await compRes.json();
                setComparisonSales(compData.total || 0);
            } else {
                setComparisonSales(null);
            }
        } catch (err) {
            Logger.error('An error occurred', { error: err });
        } finally {
            setLoading(false);
        }
    }, [currentAccount, token, dateRange, comparison]);

    useEffect(() => {
        fetchSales();
    }, [fetchSales]);

    // Real-time: Listen for new orders and update sales
    useWidgetSocket<{ total?: number }>('order:new', (data) => {
        if (data.total && sales !== null) {
            setSales(prev => (prev || 0) + data.total!);
            setOrderCount(prev => (prev || 0) + 1);
            setHasRealtimeUpdate(true);
            // Clear the indicator after 3 seconds
            setTimeout(() => setHasRealtimeUpdate(false), 3000);
        }
    });


    // Calculate percentage change
    let percentChange = 0;
    let isPositive = false;
    const hasComparison = comparisonSales !== null;

    if (hasComparison && comparisonSales !== 0 && sales !== null) {
        percentChange = ((sales - comparisonSales!) / comparisonSales!) * 100;
        isPositive = percentChange >= 0;
    } else if (hasComparison && comparisonSales === 0 && sales !== null && sales > 0) {
        percentChange = 100; // Zero to something is 100% growth essentially
        isPositive = true;
    }

    return (
        <div className={`bg-white dark:bg-slate-800/90 h-full w-full p-6 flex flex-col justify-between rounded-2xl shadow-[0_1px_3px_rgba(0,0,0,0.05),0_1px_2px_rgba(0,0,0,0.03)] dark:shadow-[0_1px_3px_rgba(0,0,0,0.2)] border border-slate-200/80 dark:border-slate-700/50 transition-all duration-300 hover:shadow-[0_10px_40px_rgba(0,0,0,0.08)] dark:hover:shadow-[0_10px_40px_rgba(0,0,0,0.3)] hover:-translate-y-0.5 ${hasRealtimeUpdate ? 'ring-2 ring-emerald-500/30 animate-pulse-glow' : ''} ${className}`}>
            <div className="flex justify-between items-start">
                <div>
                    <h3 className="text-slate-500 dark:text-slate-400 text-sm font-medium uppercase tracking-wider">
                        Total Revenue {currentAccount?.revenueTaxInclusive !== false ? '(Inclusive)' : '(Exclusive)'}
                    </h3>
                    {loading ? (
                        <div className="flex items-center gap-2 mt-3 text-slate-400"><Loader2 className="animate-spin" size={20} /></div>
                    ) : (
                        <>
                            <p className="text-3xl font-bold text-slate-900 dark:text-white mt-3 tracking-tight">
                                {new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(sales || 0)}
                            </p>
                            {orderCount !== null && (
                                <p className="text-xs text-slate-400 dark:text-slate-500 mt-1.5">
                                    {orderCount.toLocaleString()} order{orderCount !== 1 ? 's' : ''}
                                </p>
                            )}
                        </>
                    )}
                </div>
                <div className="p-3 bg-gradient-to-br from-emerald-400 to-emerald-600 rounded-xl text-white shadow-lg shadow-emerald-500/25">
                    <DollarSign size={24} />
                </div>
            </div>

            {hasComparison && !loading && (
                <div className="flex items-center gap-2 mt-4 text-sm">
                    <span className={`flex items-center gap-1 font-semibold px-2 py-1 rounded-lg ${isPositive ? 'text-emerald-600 bg-emerald-50 dark:bg-emerald-500/10 dark:text-emerald-400' : 'text-rose-500 bg-rose-50 dark:bg-rose-500/10 dark:text-rose-400'}`}>
                        {isPositive ? <TrendingUp size={14} /> : <TrendingDown size={14} />}
                        {Math.abs(percentChange).toFixed(1)}%
                    </span>
                    <span className="text-slate-400 dark:text-slate-500">vs last period</span>
                </div>
            )}
            {!hasComparison && !loading && (
                <div className="flex items-center gap-1 mt-4 text-sm text-slate-400 dark:text-slate-500">
                    <Minus size={14} />
                    <span>No comparison</span>
                </div>
            )}
        </div>
    );
}
