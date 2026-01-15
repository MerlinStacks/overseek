
import { WidgetProps } from './WidgetRegistry';
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
            console.error(err);
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
        <div className={`bg-white h-full w-full p-6 flex flex-col justify-between rounded-xl shadow-xs border border-gray-200 ${className}`}>
            <div className="flex justify-between items-start">
                <div>
                    <h3 className="text-gray-500 text-sm font-medium uppercase tracking-wider">
                        Total Revenue {currentAccount?.revenueTaxInclusive !== false ? '(Inclusive)' : '(Exclusive)'}
                    </h3>
                    {loading ? (
                        <div className="flex items-center gap-2 mt-2 text-gray-400"><Loader2 className="animate-spin" size={20} /></div>
                    ) : (
                        <>
                            <p className="text-3xl font-bold text-gray-900 mt-2">
                                {new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(sales || 0)}
                            </p>
                            {orderCount !== null && (
                                <p className="text-xs text-gray-400 mt-1">
                                    {orderCount.toLocaleString()} order{orderCount !== 1 ? 's' : ''}
                                </p>
                            )}
                        </>
                    )}
                </div>
                <div className="p-3 bg-green-100 rounded-lg text-green-600">
                    <DollarSign size={24} />
                </div>
            </div>

            {hasComparison && !loading && (
                <div className="flex items-center gap-2 mt-4 text-sm">
                    <span className={`flex items-center gap-1 font-medium ${isPositive ? 'text-green-600' : 'text-red-500'}`}>
                        {isPositive ? <TrendingUp size={14} /> : <TrendingDown size={14} />}
                        {Math.abs(percentChange).toFixed(1)}%
                    </span>
                    <span className="text-gray-400">vs last period</span>
                </div>
            )}
            {!hasComparison && !loading && (
                <div className="flex items-center gap-1 mt-4 text-sm text-gray-400">
                    <Minus size={14} />
                    <span>No comparison</span>
                </div>
            )}
        </div>
    );
}
