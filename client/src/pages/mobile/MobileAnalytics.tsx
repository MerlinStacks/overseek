import { useState, useEffect } from 'react';
import { Logger } from '../../utils/logger';
import { useNavigate } from 'react-router-dom';
import { TrendingUp, DollarSign, ShoppingCart, Users, Eye, ArrowUpRight, ArrowDownRight, ChevronRight } from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import { useAccount } from '../../context/AccountContext';
import { getDateRange, getComparisonRange, DateRangeOption } from '../../utils/dateUtils';
import { formatCurrency, formatCompact } from '../../utils/format';

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
    const [period, setPeriod] = useState<'today' | 'week' | 'month'>('today');
    const [liveCount, setLiveCount] = useState(0);

    useEffect(() => {
        fetchAnalytics();
    }, [currentAccount, period, token]);

    // Auto-refresh live visitor count every 30 seconds
    useEffect(() => {
        if (!currentAccount || !token) return;

        const fetchLiveCount = async () => {
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
        };

        const interval = setInterval(fetchLiveCount, 30000);
        return () => clearInterval(interval);
    }, [currentAccount, token]);

    const fetchAnalytics = async () => {
        if (!currentAccount || !token) {
            setLoading(false);
            return;
        }

        try {
            setLoading(true);
            const headers = {
                'Authorization': `Bearer ${token}`,
                'X-Account-ID': currentAccount.id
            };

            // Map mobile period to dateUtils options
            const periodMap: Record<string, DateRangeOption> = {
                'today': 'today',
                'week': '7d',
                'month': '30d'
            };
            const currentRange = getDateRange(periodMap[period]);
            const comparisonRange = getComparisonRange(currentRange, 'previous_period');

            // Fetch current period data
            const [salesRes, customerRes, liveRes] = await Promise.all([
                fetch(`/api/analytics/sales?startDate=${currentRange.startDate}&endDate=${currentRange.endDate}`, { headers }),
                fetch(`/api/analytics/customer-growth?startDate=${currentRange.startDate}&endDate=${currentRange.endDate}`, { headers }),
                fetch('/api/analytics/visitors/log?live=true&limit=1', { headers })
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
                visitorCount = liveData.total || 0;
                setLiveCount(visitorCount);
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
            // Set fallback data on error
            setData({
                revenue: { value: 0, change: 0 },
                orders: { value: 0, change: 0 },
                visitors: { value: 0, change: 0 },
                customers: { value: 0, change: 0 },
                conversionRate: { value: 0, change: 0 },
                avgOrderValue: { value: 0, change: 0 }
            });
        } finally {
            setLoading(false);
        }
    };

    // Helper for account-aware currency
    const formatAccountCurrency = (amount: number) =>
        formatCurrency(amount, currentAccount?.currency || 'USD', { minimumFractionDigits: 0, maximumFractionDigits: 0 });

    const periodLabels = { today: 'Today', week: 'This Week', month: 'This Month' };

    if (loading) {
        return (
            <div className="space-y-4 animate-pulse">
                <div className="h-8 bg-gray-200 rounded w-1/3" />
                <div className="flex gap-2">
                    {[...Array(3)].map((_, i) => <div key={i} className="h-10 w-24 bg-gray-200 rounded-full" />)}
                </div>
                <div className="grid grid-cols-2 gap-3">
                    {[...Array(6)].map((_, i) => <div key={i} className="h-32 bg-gray-200 rounded-xl" />)}
                </div>
            </div>
        );
    }

    const metrics = [
        { key: 'revenue', label: 'Revenue', value: formatAccountCurrency(data?.revenue.value || 0), change: data?.revenue.change || 0, icon: DollarSign, color: 'text-green-600', bg: 'bg-green-50' },
        { key: 'orders', label: 'Orders', value: formatCompact(data?.orders.value || 0), change: data?.orders.change || 0, icon: ShoppingCart, color: 'text-blue-600', bg: 'bg-blue-50' },
        { key: 'visitors', label: 'Visitors', value: formatCompact(data?.visitors.value || 0), change: data?.visitors.change || 0, icon: Eye, color: 'text-purple-600', bg: 'bg-purple-50' },
        { key: 'customers', label: 'New Customers', value: formatCompact(data?.customers.value || 0), change: data?.customers.change || 0, icon: Users, color: 'text-indigo-600', bg: 'bg-indigo-50' },
        { key: 'conversion', label: 'Conversion', value: `${(data?.conversionRate.value || 0).toFixed(1)}%`, change: data?.conversionRate.change || 0, icon: TrendingUp, color: 'text-orange-600', bg: 'bg-orange-50' },
        { key: 'aov', label: 'Avg Order', value: formatAccountCurrency(data?.avgOrderValue.value || 0), change: data?.avgOrderValue.change || 0, icon: DollarSign, color: 'text-teal-600', bg: 'bg-teal-50' }
    ];

    return (
        <div className="space-y-4">
            <h1 className="text-2xl font-bold text-gray-900">Analytics</h1>

            {/* Live Visitors Banner */}
            <button
                onClick={() => navigate('/m/live-visitors')}
                className="w-full flex items-center justify-between p-4 bg-gradient-to-r from-green-500 to-emerald-600 rounded-xl text-white shadow-lg shadow-green-200 active:scale-[0.98] transition-transform"
            >
                <div className="flex items-center gap-3">
                    <span className="relative flex h-3 w-3">
                        <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-white opacity-75" />
                        <span className="relative inline-flex rounded-full h-3 w-3 bg-white" />
                    </span>
                    <div className="text-left">
                        <p className="text-2xl font-bold">{liveCount}</p>
                        <p className="text-sm text-green-100">Live visitors now</p>
                    </div>
                </div>
                <ChevronRight size={24} className="text-green-200" />
            </button>

            <div className="flex gap-2">
                {(['today', 'week', 'month'] as const).map((p) => (
                    <button
                        key={p}
                        onClick={() => setPeriod(p)}
                        className={`px-4 py-2 rounded-full text-sm font-medium transition-colors ${period === p ? 'bg-indigo-600 text-white' : 'bg-gray-100 text-gray-700'}`}
                    >
                        {periodLabels[p]}
                    </button>
                ))}
            </div>
            <div className="grid grid-cols-2 gap-3">
                {metrics.map((metric) => {
                    const Icon = metric.icon;
                    const isPositive = metric.change >= 0;
                    const TrendIcon = isPositive ? ArrowUpRight : ArrowDownRight;
                    return (
                        <div key={metric.key} className={`${metric.bg} rounded-xl p-4`}>
                            <div className="flex items-center justify-between mb-3">
                                <Icon size={20} className={metric.color} />
                                <div className={`flex items-center text-xs font-medium ${isPositive ? 'text-green-600' : 'text-red-600'}`}>
                                    <TrendIcon size={14} />{Math.abs(metric.change).toFixed(1)}%
                                </div>
                            </div>
                            <p className={`text-2xl font-bold ${metric.color}`}>{metric.value}</p>
                            <p className="text-xs text-gray-600 mt-1">{metric.label}</p>
                        </div>
                    );
                })}
            </div>
        </div>
    );
}
