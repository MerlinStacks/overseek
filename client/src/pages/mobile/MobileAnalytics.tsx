import { useState, useEffect, useCallback } from 'react';
import { Metric, MetricStrip } from '../../components/ui/MetricStrip';
import { Logger } from '../../utils/logger';
import { useNavigate } from 'react-router-dom';
import { TrendingUp, DollarSign, ShoppingCart, Users, Eye, ArrowUpRight, ArrowDownRight, ChevronRight } from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import { useAccount } from '../../context/AccountContext';
import { getDateRange, getComparisonRange, DateRangeOption } from '../../utils/dateUtils';
import { formatCurrency, formatCompact } from '../../utils/format';
import { useVisibilityPolling } from '../../hooks/useVisibilityPolling';

interface AnalyticsData {
    revenue: { value: number; change: number };
    orders: { value: number; change: number };
    visitors: { value: number; change: number };
    customers: { value: number; change: number };
    conversionRate: { value: number; change: number };
    avgOrderValue: { value: number; change: number };
}

export function MobileAnalytics() {
    const navigate = useNavigate();
    const { token } = useAuth();
    const { currentAccount } = useAccount();
    const [data, setData] = useState<AnalyticsData | null>(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [period, setPeriod] = useState<'today' | 'yesterday' | 'week' | 'month'>('today');
    const [liveCount, setLiveCount] = useState(0);

    // Memoized fetch for live count polling
    const fetchLiveCount = useCallback(async () => {
        if (!currentAccount || !token) return;
        try {
            const res = await fetch('/api/analytics/visitors/log?live=true&limit=1', {
                headers: {
                    'Authorization': `Bearer ${token}`,
                    'X-Account-ID': currentAccount.id
                }
            });
            if (res.ok) {
                const data = await res.json();
                setLiveCount(data.total || 0);
            }
        } catch (e) {
            Logger.error('[MobileAnalytics] Live count refresh error:', { error: e });
        }
    }, [currentAccount, token]);

    // Visibility-aware polling: pauses when app is backgrounded/screen off
    useVisibilityPolling(fetchLiveCount, 30000, [fetchLiveCount]);

    const fetchAnalytics = useCallback(async () => {
        if (!currentAccount || !token) {
            setLoading(false);
            return;
        }

        try {
            setLoading(true);
            setError(null);
            const headers = {
                'Authorization': `Bearer ${token}`,
                'X-Account-ID': currentAccount.id
            };

            // Map mobile period to dateUtils options
            const periodMap: Record<string, DateRangeOption> = {
                'today': 'today',
                'yesterday': 'yesterday',
                'week': '7d',
                'month': '30d'
            };
            const currentRange = getDateRange(periodMap[period]);
            const comparisonRange = getComparisonRange(currentRange, 'previous_period');

            // Fetch current period data (including visitor sessions for the period)
            const [salesRes, customerRes, liveRes, visitorSessionsRes] = await Promise.all([
                fetch(`/api/analytics/sales?startDate=${currentRange.startDate}&endDate=${currentRange.endDate}`, { headers }),
                fetch(`/api/analytics/customer-growth?startDate=${currentRange.startDate}&endDate=${currentRange.endDate}`, { headers }),
                fetch('/api/analytics/visitors/log?live=true&limit=1', { headers }),
                // Fetch visitor count for the period (not live) for conversion calculation
                fetch(`/api/analytics/visitors/log?startDate=${currentRange.startDate}&endDate=${currentRange.endDate}&limit=1`, { headers })
            ]);

            // Fetch comparison period data (if available)
            let prevSalesRes = null, prevCustomerRes = null;
            if (comparisonRange) {
                [prevSalesRes, prevCustomerRes] = await Promise.all([
                    fetch(`/api/analytics/sales?startDate=${comparisonRange.startDate}&endDate=${comparisonRange.endDate}`, { headers }),
                    fetch(`/api/analytics/customer-growth?startDate=${comparisonRange.startDate}&endDate=${comparisonRange.endDate}`, { headers })
                ]);
            }

            // Parse current period
            let revenue = 0, orderCount = 0, customerCount = 0, visitorCount = 0;
            const hasPrimaryData = salesRes.ok || customerRes.ok || visitorSessionsRes.ok;

            if (!hasPrimaryData) {
                throw new Error(`Analytics requests failed: sales ${salesRes.status}, customers ${customerRes.status}, visitors ${visitorSessionsRes.status}`);
            }

            if (salesRes.ok) {
                const salesData = await salesRes.json();
                revenue = salesData.total || 0;
                orderCount = salesData.count || 0;
            }

            if (customerRes.ok) {
                const customerData = await customerRes.json();
                customerCount = customerData.newCustomers || customerData.total || 0;
            }

            if (liveRes.ok) {
                const liveData = await liveRes.json();
                setLiveCount(liveData.total || 0);
            }

            // Use period-based visitor count for accurate conversion rate
            if (visitorSessionsRes.ok) {
                const sessionData = await visitorSessionsRes.json();
                visitorCount = sessionData.total || 0;
            }

            // Parse comparison period
            let prevRevenue = 0, prevOrderCount = 0, prevCustomerCount = 0;

            if (prevSalesRes?.ok) {
                const prevSalesData = await prevSalesRes.json();
                prevRevenue = prevSalesData.total || 0;
                prevOrderCount = prevSalesData.count || 0;
            }

            if (prevCustomerRes?.ok) {
                const prevCustomerData = await prevCustomerRes.json();
                prevCustomerCount = prevCustomerData.newCustomers || prevCustomerData.total || 0;
            }

            // Calculate percentage changes
            const calcChange = (current: number, previous: number): number => {
                if (previous === 0) return current > 0 ? 100 : 0;
                return ((current - previous) / previous) * 100;
            };

            const revenueChange = calcChange(revenue, prevRevenue);
            const ordersChange = calcChange(orderCount, prevOrderCount);
            const customersChange = calcChange(customerCount, prevCustomerCount);

            // Calculate AOV
            const aov = orderCount > 0 ? revenue / orderCount : 0;
            const prevAov = prevOrderCount > 0 ? prevRevenue / prevOrderCount : 0;
            const aovChange = calcChange(aov, prevAov);

            // Conversion rate (visitors are live-only, so no comparison available)
            const conversionRate = visitorCount > 0 ? (orderCount / visitorCount) * 100 : 0;

            setData({
                revenue: { value: revenue, change: revenueChange },
                orders: { value: orderCount, change: ordersChange },
                visitors: { value: visitorCount, change: 0 }, // Live visitors have no historical comparison
                customers: { value: customerCount, change: customersChange },
                conversionRate: { value: conversionRate, change: 0 }, // Dependent on visitors
                avgOrderValue: { value: aov, change: aovChange }
            });
        } catch (error) {
            Logger.error('[MobileAnalytics] Error:', { error: error });
            setError('Could not load analytics. Pull down or tap retry to refresh.');
        } finally {
            setLoading(false);
        }
    }, [currentAccount, period, token]);

    useEffect(() => {
        void fetchAnalytics();

        const handleRefresh = () => void fetchAnalytics();
        window.addEventListener('mobile-refresh', handleRefresh);
        return () => window.removeEventListener('mobile-refresh', handleRefresh);
    }, [fetchAnalytics]);

    // Helper for account-aware currency
    const formatAccountCurrency = (amount: number) =>
        formatCurrency(amount, currentAccount?.currency || 'USD', { minimumFractionDigits: 0, maximumFractionDigits: 0 });

    const periodLabels = { today: 'Today', yesterday: 'Yesterday', week: 'This Week', month: 'This Month' };

    if (loading) {
        return (
            <div className="space-y-4 animate-pulse">
                <div className="h-8 bg-slate-700/50 rounded w-1/3" />
                <div className="flex gap-2">
                    {[...Array(3)].map((_, i) => <div key={i} className="h-10 w-24 bg-slate-700/50 rounded-full" />)}
                </div>
                <div className="grid grid-cols-2 gap-3">
                    {[...Array(6)].map((_, i) => <div key={i} className="h-16 bg-slate-800/50" />)}
                </div>
            </div>
        );
    }

    if (error && !data) {
        return (
            <div className="rounded-[1.5rem] border border-rose-400/20 bg-rose-500/10 p-5 text-center text-rose-100">
                <p className="mb-4 text-sm font-medium">{error}</p>
                <button
                    onClick={() => void fetchAnalytics()}
                    className="rounded-full bg-white/10 px-4 py-2 text-sm font-bold text-white ring-1 ring-white/15 active:scale-[0.98]"
                >
                    Retry
                </button>
            </div>
        );
    }

    const metrics = [
        { key: 'revenue', label: 'Revenue', value: formatAccountCurrency(data?.revenue.value || 0), change: data?.revenue.change || 0, icon: DollarSign, color: 'text-emerald-400', iconBg: 'bg-emerald-500/20' },
        { key: 'orders', label: 'Orders', value: formatCompact(data?.orders.value || 0), change: data?.orders.change || 0, icon: ShoppingCart, color: 'text-blue-400', iconBg: 'bg-blue-500/20' },
        { key: 'visitors', label: 'Visitors', value: formatCompact(data?.visitors.value || 0), change: data?.visitors.change || 0, icon: Eye, color: 'text-purple-400', iconBg: 'bg-purple-500/20' },
        { key: 'customers', label: 'New Customers', value: formatCompact(data?.customers.value || 0), change: data?.customers.change || 0, icon: Users, color: 'text-indigo-400', iconBg: 'bg-indigo-500/20' },
        { key: 'conversion', label: 'Conversion', value: `${(data?.conversionRate.value || 0).toFixed(1)}%`, change: data?.conversionRate.change || 0, icon: TrendingUp, color: 'text-orange-400', iconBg: 'bg-orange-500/20' },
        { key: 'aov', label: 'Avg Order', value: formatAccountCurrency(data?.avgOrderValue.value || 0), change: data?.avgOrderValue.change || 0, icon: DollarSign, color: 'text-teal-400', iconBg: 'bg-teal-500/20' }
    ];

    return (
        <div className="space-y-4 animate-fade-slide-up">
            <h1 className="text-2xl font-bold text-white">Analytics</h1>

            {/* Live Visitors Banner */}
            <button
                onClick={() => navigate('/m/live-visitors')}
                className="w-full flex items-center justify-between p-4 mobile-panel active:scale-[0.98] transition-transform"
            >
                <div className="flex items-center gap-3">
                    <span className="relative flex h-3 w-3">
                        <span className="motion-safe:animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75" />
                        <span className="relative inline-flex rounded-full h-3 w-3 bg-emerald-400" />
                    </span>
                    <div className="text-left">
                        <p className="text-xl font-semibold">{liveCount}</p>
                        <p className="text-sm text-slate-400">Live visitors now</p>
                    </div>
                </div>
                <ChevronRight size={24} className="text-slate-400" />
            </button>

            <div className="flex gap-2 overflow-x-auto pb-1 -mx-4 px-4 no-scrollbar">
                {(['today', 'yesterday', 'week', 'month'] as const).map((p) => (
                    <button
                        key={p}
                        onClick={() => setPeriod(p)}
                        className={`px-4 py-2 rounded-full text-sm font-medium transition-all whitespace-nowrap active:scale-95 ${period === p
                            ? 'mobile-brand-solid'
                            : 'bg-slate-700/40 border border-white/10 text-slate-300'
                            }`}
                    >
                        {periodLabels[p]}
                    </button>
                ))}
            </div>
            <MetricStrip label="Analytics summary" className="grid-cols-2">
                {metrics.map((metric) => {
                    const isPositive = metric.change >= 0;
                    const TrendIcon = isPositive ? ArrowUpRight : ArrowDownRight;
                    return (
                        <Metric key={metric.key} label={metric.label} value={metric.value} hint={<span className={`inline-flex items-center ${isPositive ? 'text-emerald-400' : 'text-rose-400'}`}><TrendIcon size={14} />{Math.abs(metric.change).toFixed(1)}%</span>} />
                    );
                })}
            </MetricStrip>
        </div>
    );
}
