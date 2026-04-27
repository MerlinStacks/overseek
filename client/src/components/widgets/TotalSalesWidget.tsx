import { WidgetProps } from './WidgetRegistry';
import { Logger } from '../../utils/logger';
import { DollarSign, Loader2, TrendingUp, TrendingDown, Minus } from 'lucide-react';
import { useEffect, useState, useCallback, useRef } from 'react';
import { useAuth } from '../../context/AuthContext';
import { useAccount } from '../../context/AccountContext';
import { useWidgetSocket } from '../../hooks/useWidgetSocket';
import { widgetCardClass, widgetSubtleTextClass } from './widgetStyles';

interface SalesResponse {
    total?: number;
    count?: number;
}

export function TotalSalesWidget({ className, dateRange, comparison, comparisonLabel }: WidgetProps) {
    const { token } = useAuth();
    const { currentAccount } = useAccount();
    const [sales, setSales] = useState<number | null>(null);
    const [orderCount, setOrderCount] = useState<number | null>(null);
    const [comparisonSales, setComparisonSales] = useState<number | null>(null);
    const [loading, setLoading] = useState(true);
    const [hasRealtimeUpdate, setHasRealtimeUpdate] = useState(false);
    const indicatorTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const fetchAbortRef = useRef<AbortController | null>(null);

    const fetchSales = useCallback(async () => {
        if (!currentAccount || !token) return;

        fetchAbortRef.current?.abort();
        const controller = new AbortController();
        fetchAbortRef.current = controller;

        setLoading(true);
        try {
            const headers = { 'Authorization': `Bearer ${token}`, 'X-Account-ID': currentAccount.id };
            const currentRequest = fetch(
                `/api/analytics/sales?startDate=${dateRange.startDate}&endDate=${dateRange.endDate}`,
                { headers, signal: controller.signal }
            ).then(async (res) => {
                if (!res.ok) throw new Error(`HTTP ${res.status}`);
                return res.json() as Promise<SalesResponse>;
            });

            const comparisonRequest = comparison
                ? fetch(
                    `/api/analytics/sales?startDate=${comparison.startDate}&endDate=${comparison.endDate}`,
                    { headers, signal: controller.signal }
                ).then(async (res) => {
                    if (!res.ok) throw new Error(`HTTP ${res.status}`);
                    return res.json() as Promise<SalesResponse>;
                })
                : Promise.resolve(null);

            const [currentData, comparisonData] = await Promise.all([currentRequest, comparisonRequest]);
            if (controller.signal.aborted) return;

            setSales(currentData.total || 0);
            setOrderCount(currentData.count || 0);
            setComparisonSales(comparisonData ? (comparisonData.total || 0) : null);
        } catch (err) {
            if (err instanceof DOMException && err.name === 'AbortError') return;
            Logger.error('An error occurred', { error: err });
        } finally {
            if (!controller.signal.aborted) {
                setLoading(false);
            }
        }
    }, [comparison, currentAccount, dateRange.endDate, dateRange.startDate, token]);

    useEffect(() => {
        fetchSales();
        return () => {
            fetchAbortRef.current?.abort();
        };
    }, [fetchSales]);

    useEffect(() => {
        return () => {
            if (indicatorTimeoutRef.current) {
                clearTimeout(indicatorTimeoutRef.current);
                indicatorTimeoutRef.current = null;
            }
        };
    }, []);

    // Real-time: Listen for new orders and update sales.
    useWidgetSocket<{ total?: number }>('order:new', (data) => {
        const incomingTotal = data.total;
        if (typeof incomingTotal === 'number' && !isNaN(incomingTotal)) {
            setSales((prev) => (prev ?? 0) + incomingTotal);
            setOrderCount((prev) => (prev ?? 0) + 1);
            setHasRealtimeUpdate(true);

            if (indicatorTimeoutRef.current) {
                clearTimeout(indicatorTimeoutRef.current);
            }
            indicatorTimeoutRef.current = setTimeout(() => setHasRealtimeUpdate(false), 3000);
        }
    });

    // Calculate percentage change.
    let percentChange = 0;
    let isPositive = false;
    const hasComparison = comparisonSales !== null;

    if (hasComparison && comparisonSales !== 0 && sales !== null) {
        percentChange = ((sales - comparisonSales) / comparisonSales) * 100;
        isPositive = percentChange >= 0;
    } else if (hasComparison && comparisonSales === 0 && sales !== null && sales > 0) {
        percentChange = 100;
        isPositive = true;
    }

    return (
        <div className={`${widgetCardClass} h-full w-full p-6 flex flex-col justify-between hover:-translate-y-0.5 ${hasRealtimeUpdate ? 'ring-2 ring-emerald-500/30 animate-pulse-glow' : ''} ${className || ''}`}>
            <div className="flex justify-between items-start">
                <div>
                    <h3 className={`${widgetSubtleTextClass} font-medium uppercase tracking-wider`}>
                        Total Revenue {currentAccount?.revenueTaxInclusive !== false ? '(Inclusive)' : '(Exclusive)'}
                    </h3>
                    {loading ? (
                        <div className="flex items-center gap-2 mt-3 text-slate-400"><Loader2 className="animate-spin" size={20} /></div>
                    ) : (
                        <>
                            <p
                                className="text-3xl font-bold text-slate-900 dark:text-white mt-3 tracking-tight cursor-default"
                                title={orderCount && orderCount > 0 ? `AOV: $${((sales || 0) / orderCount).toFixed(2)}` : undefined}
                            >
                                {new Intl.NumberFormat('en-AU', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(sales || 0)}
                            </p>
                            {orderCount !== null && (
                                <p className="text-xs text-slate-400 dark:text-slate-500 mt-1.5">
                                    {orderCount.toLocaleString()} order{orderCount !== 1 ? 's' : ''} &middot; AOV ${orderCount > 0 ? ((sales || 0) / orderCount).toFixed(2) : '0.00'}
                                </p>
                            )}
                        </>
                    )}
                </div>
                <div className="p-2.5 bg-gradient-to-br from-emerald-400 to-emerald-600 rounded-lg text-white shadow-lg shadow-emerald-500/25">
                    <DollarSign size={20} />
                </div>
            </div>

            {hasComparison && !loading && (
                <div className="flex items-center gap-2 mt-4 text-sm">
                    <span className={`flex items-center gap-1 font-semibold px-2 py-1 rounded-lg ${isPositive ? 'text-emerald-600 bg-emerald-50 dark:bg-emerald-500/10 dark:text-emerald-400' : 'text-rose-500 bg-rose-50 dark:bg-rose-500/10 dark:text-rose-400'}`}>
                        {isPositive ? <TrendingUp size={14} /> : <TrendingDown size={14} />}
                        {Math.abs(percentChange).toFixed(1)}%
                    </span>
                    <span className="text-slate-400 dark:text-slate-500">{comparisonLabel || 'vs last period'}</span>
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
