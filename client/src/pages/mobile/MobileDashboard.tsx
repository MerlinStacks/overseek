import { useState, useEffect, useMemo, useCallback } from 'react';
import { Logger } from '../../utils/logger';
import { useNavigate } from 'react-router-dom';
import {
    ShoppingCart,
    MessageSquare,
    TrendingUp,
    Package,
    ArrowRight,
    Bell,
    DollarSign,
    Sun,
    Moon,
    Sunrise,
    Sunset,
    Users
} from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import { useAccount } from '../../context/AccountContext';
import { getDateRange } from '../../utils/dateUtils';
import { formatCurrency, formatTimeAgo } from '../../utils/format';
import { RevenueAnomalyBanner } from '../../components/mobile/RevenueAnomalyBanner';
import { DashboardSkeleton } from '../../components/mobile/MobileSkeleton';
import { Sparkline, TrendBadge } from '../../components/mobile/Sparkline';
import { usePermissions } from '../../hooks/usePermissions';

/**
 * MobileDashboard - Premium dark dashboard for the PWA companion app.
 * 
 * Features:
 * - Time-of-day greeting with icon
 * - Glassmorphism stat cards with sparklines
 * - Trend indicators
 * - Smooth staggered animations
 */

interface TrendDataDay {
    orders?: number;
    revenue?: number;
}

interface OrderApiResponse {
    id: string;
    orderNumber?: string;
    total?: string | number;
    date_created?: string;
    createdAt?: string;
    status?: string;
}

interface DashboardStats {
    todayOrders: number;
    todayRevenue: number;
    pendingMessages: number;
    lowStockItems: number;
    yesterdayOrders?: number;
    yesterdayRevenue?: number;
}

interface RecentActivity {
    id: string;
    type: 'order' | 'message' | 'inventory';
    title: string;
    subtitle: string;
    time: string;
    status?: string;
}

interface AnomalyData {
    isAnomaly: boolean;
    direction: 'above' | 'below' | 'normal';
    percentChange: number;
    message: string;
}

interface SparklineData {
    orders: number[];
    revenue: number[];
}

export function MobileDashboard() {
    const navigate = useNavigate();
    const { token, user } = useAuth();
    const { currentAccount } = useAccount();
    const { hasPermission } = usePermissions();
    const [stats, setStats] = useState<DashboardStats | null>(null);
    const [activities, setActivities] = useState<RecentActivity[]>([]);
    const [anomaly, setAnomaly] = useState<AnomalyData | null>(null);
    const [sparklines, setSparklines] = useState<SparklineData>({ orders: [], revenue: [] });
    const [loading, setLoading] = useState(true);

    // Time-based greeting
    const greeting = useMemo(() => {
        const hour = new Date().getHours();
        if (hour >= 5 && hour < 12) {
            return { text: 'Good morning', icon: Sunrise, color: 'text-amber-400' };
        } else if (hour >= 12 && hour < 17) {
            return { text: 'Good afternoon', icon: Sun, color: 'text-yellow-400' };
        } else if (hour >= 17 && hour < 21) {
            return { text: 'Good evening', icon: Sunset, color: 'text-orange-400' };
        } else {
            return { text: 'Good night', icon: Moon, color: 'text-indigo-400' };
        }
    }, []);

    const firstName = user?.fullName?.split(' ')[0] || 'there';

    const accountCurrency = currentAccount?.currency || 'USD';

    const fetchDashboardData = useCallback(async () => {
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

            // Use same date utility as desktop for timezone-aware dates
            const { startDate, endDate } = getDateRange('today');
            const yesterday = getDateRange('yesterday');

            // Fetch all data in parallel (including anomaly detection and 7-day trend)
            const [salesRes, yesterdaySalesRes, messagesRes, inventoryRes, ordersRes, anomalyRes, trendRes] = await Promise.all([
                fetch(`/api/analytics/sales?startDate=${startDate}&endDate=${endDate}`, { headers }),
                fetch(`/api/analytics/sales?startDate=${yesterday.startDate}&endDate=${yesterday.endDate}`, { headers }),
                fetch('/api/chat/unread-count', { headers }),
                fetch('/api/analytics/health', { headers }),
                fetch('/api/sync/orders/search?limit=5', { headers }),
                fetch('/api/analytics/anomalies', { headers }),
                fetch('/api/analytics/trend?days=7', { headers }).catch(() => null)
            ]);

            let todayRevenue = 0, todayOrders = 0, pendingMessages = 0, lowStockItems = 0;
            let yesterdayRevenue = 0, yesterdayOrders = 0;

            if (salesRes.ok) {
                const data = await salesRes.json();
                Logger.debug('[MobileDashboard] Sales API response', { data });
                todayRevenue = data.total || 0;
                todayOrders = data.count || 0;
            } else {
                Logger.error('[MobileDashboard] Sales API failed', { status: salesRes.status });
            }

            if (yesterdaySalesRes.ok) {
                const data = await yesterdaySalesRes.json();
                yesterdayRevenue = data.total || 0;
                yesterdayOrders = data.count || 0;
            }

            if (messagesRes.ok) {
                const data = await messagesRes.json();
                pendingMessages = data.count || 0;
            }

            if (inventoryRes.ok) {
                const data = await inventoryRes.json();
                lowStockItems = Array.isArray(data) ? data.length : 0;
            }

            // Process anomaly data
            if (anomalyRes.ok) {
                const anomalyData = await anomalyRes.json();
                setAnomaly(anomalyData);
            }

            // Process trend data for sparklines
            if (trendRes && trendRes.ok) {
                const trendData = await trendRes.json();
                if (trendData.daily) {
                    setSparklines({
                        orders: trendData.daily.map((d: TrendDataDay) => d.orders || 0),
                        revenue: trendData.daily.map((d: TrendDataDay) => d.revenue || 0)
                    });
                }
            } else {
                // Generate sample sparkline data as fallback
                setSparklines({
                    orders: [todayOrders * 0.7, todayOrders * 0.85, todayOrders * 0.6, todayOrders * 0.9, todayOrders * 0.75, todayOrders * 0.95, todayOrders],
                    revenue: [todayRevenue * 0.65, todayRevenue * 0.8, todayRevenue * 0.7, todayRevenue * 0.85, todayRevenue * 0.75, todayRevenue * 0.9, todayRevenue]
                });
            }

            setStats({ todayOrders, todayRevenue, pendingMessages, lowStockItems, yesterdayOrders, yesterdayRevenue });

            // Parse recent activities from orders
            if (ordersRes.ok) {
                const ordersData = await ordersRes.json();
                const recentActivities: RecentActivity[] = (ordersData.orders || ordersData || [])
                    .slice(0, 5)
                    .map((order: OrderApiResponse) => ({
                        id: order.id,
                        type: 'order' as const,
                        title: `Order #${order.orderNumber || String(order.id).slice(-6)}`,
                        subtitle: `${formatCurrency(Number(order.total || 0), accountCurrency)}`,
                        time: formatTimeAgo(order.date_created || order.createdAt || ''),
                        status: order.status
                    }));
                setActivities(recentActivities);
            }
        } catch (error) {
            Logger.error('[MobileDashboard] Error fetching data', { error });
        } finally {
            setLoading(false);
        }
    }, [accountCurrency, currentAccount, token]);

    useEffect(() => {
        fetchDashboardData();

        // Listen for pull-to-refresh
        const handleRefresh = () => fetchDashboardData();
        window.addEventListener('mobile-refresh', handleRefresh);
        return () => window.removeEventListener('mobile-refresh', handleRefresh);
    }, [fetchDashboardData]);

    // Currency formatting helper using centralized utility with account currency
    const formatAccountCurrency = (amount: number) =>
        formatCurrency(amount, accountCurrency, { minimumFractionDigits: 0, maximumFractionDigits: 0 });

    // Calculate trend percentages
    const ordersTrend = stats?.yesterdayOrders
        ? ((stats.todayOrders - stats.yesterdayOrders) / stats.yesterdayOrders) * 100
        : 0;
    const revenueTrend = stats?.yesterdayRevenue
        ? ((stats.todayRevenue - stats.yesterdayRevenue) / stats.yesterdayRevenue) * 100
        : 0;

    const commandActions = [
        { label: 'Run orders', helper: `${stats?.todayOrders || 0} today`, icon: ShoppingCart, path: '/m/orders', tone: 'bg-sky-400/15 text-sky-100 ring-sky-300/20' },
        { label: 'Open inbox', helper: `${stats?.pendingMessages || 0} unread`, icon: MessageSquare, path: '/m/inbox', tone: 'bg-violet-400/15 text-violet-100 ring-violet-300/20' },
        { label: 'Stock risk', helper: `${stats?.lowStockItems || 0} low`, icon: Package, path: '/m/inventory', tone: 'bg-amber-400/15 text-amber-100 ring-amber-300/20' },
        { label: 'Revenue', helper: formatAccountCurrency(stats?.todayRevenue || 0), icon: TrendingUp, path: '/m/analytics', tone: 'bg-emerald-400/15 text-emerald-100 ring-emerald-300/20' },
    ];

    const commandBrief = [
        (stats?.todayOrders || 0) > 0 ? `${stats?.todayOrders || 0} orders landed today` : 'No orders landed yet today',
        (stats?.pendingMessages || 0) > 0 ? `${stats?.pendingMessages || 0} customer messages need attention` : 'Inbox is clear',
        (stats?.lowStockItems || 0) > 0 ? `${stats?.lowStockItems || 0} stock alerts to review` : 'No stock alerts',
    ];

    // Dark-mode activity status colors - different from standard light-mode utility
    const getDarkStatusColor = (status?: string) => {
        switch (status?.toLowerCase()) {
            case 'completed': return 'bg-emerald-500/20 text-emerald-400';
            case 'processing': return 'bg-blue-500/20 text-blue-400';
            case 'pending': return 'bg-amber-500/20 text-amber-400';
            case 'cancelled': return 'bg-rose-500/20 text-rose-400';
            default: return 'bg-slate-500/20 text-slate-400';
        }
    };

    if (loading) {
        return <DashboardSkeleton />;
    }

    return (
        <div className="space-y-5 pb-28">
            {hasPermission('view_finance') && <RevenueAnomalyBanner anomaly={anomaly} />}

            <div className="rounded-[2rem] border border-white/10 bg-slate-950 px-4 py-5 shadow-2xl shadow-black/30 animate-fade-slide-up">
                <div className="flex items-start justify-between gap-3">
                    <div>
                        <div className="mb-2 inline-flex items-center gap-1.5 rounded-full bg-indigo-400/10 px-2.5 py-1 text-xs font-semibold text-indigo-100 ring-1 ring-indigo-300/20">
                            <greeting.icon size={13} className={greeting.color} />
                            {greeting.text}, {firstName}
                        </div>
                        <h1 className="text-3xl font-black tracking-tight text-white">Command centre</h1>
                        <p className="mt-1 text-sm text-slate-400">Live store priorities for today.</p>
                    </div>
                    <button onClick={() => navigate('/m/notifications')} className="rounded-2xl bg-white/10 p-3 text-slate-200 active:scale-95" aria-label="Open notifications">
                        <Bell size={20} />
                    </button>
                </div>
                <div className="mt-5 space-y-2">
                    {commandBrief.map((brief) => (
                        <div key={brief} className="flex items-center gap-2 rounded-2xl bg-white/[0.06] px-3 py-2 text-sm text-slate-300 ring-1 ring-white/10">
                            <span className="h-1.5 w-1.5 rounded-full bg-indigo-300" />
                            {brief}
                        </div>
                    ))}
                </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
                <button onClick={() => navigate('/m/orders')} className="rounded-[1.5rem] border border-white/10 bg-slate-950 p-4 text-left shadow-lg shadow-black/20 active:scale-[0.99] animate-fade-slide-up" style={{ animationDelay: '25ms' }}>
                    <div className="mb-3 flex items-center justify-between">
                        <div className="rounded-2xl bg-sky-400/15 p-2 text-sky-100 ring-1 ring-sky-300/20"><ShoppingCart size={18} /></div>
                        {stats?.yesterdayOrders !== undefined && <TrendBadge value={ordersTrend} />}
                    </div>
                    <p className="text-3xl font-black text-white">{stats?.todayOrders || 0}</p>
                    <p className="mb-3 text-xs font-medium text-slate-400">Orders today</p>
                    <Sparkline data={sparklines.orders} color="#7dd3fc" height={24} />
                </button>

                {hasPermission('view_finance') && (
                    <button onClick={() => navigate('/m/analytics')} className="rounded-[1.5rem] border border-white/10 bg-slate-950 p-4 text-left shadow-lg shadow-black/20 active:scale-[0.99] animate-fade-slide-up" style={{ animationDelay: '50ms' }}>
                        <div className="mb-3 flex items-center justify-between">
                            <div className="rounded-2xl bg-emerald-400/15 p-2 text-emerald-100 ring-1 ring-emerald-300/20"><DollarSign size={18} /></div>
                            {stats?.yesterdayRevenue !== undefined && <TrendBadge value={revenueTrend} />}
                        </div>
                        <p className="text-3xl font-black text-white">{formatAccountCurrency(stats?.todayRevenue || 0)}</p>
                        <p className="mb-3 text-xs font-medium text-slate-400">Revenue today</p>
                        <Sparkline data={sparklines.revenue} color="#6ee7b7" height={24} />
                    </button>
                )}

                <button onClick={() => navigate('/m/inbox')} className="rounded-[1.5rem] border border-white/10 bg-slate-950 p-4 text-left shadow-lg shadow-black/20 active:scale-[0.99] animate-fade-slide-up" style={{ animationDelay: '75ms' }}>
                    <div className="mb-3 flex items-center justify-between">
                        <div className="rounded-2xl bg-violet-400/15 p-2 text-violet-100 ring-1 ring-violet-300/20"><MessageSquare size={18} /></div>
                        {(stats?.pendingMessages || 0) > 0 && <span className="rounded-full bg-violet-400/15 px-2 py-0.5 text-xs font-bold text-violet-100 ring-1 ring-violet-300/20">New</span>}
                    </div>
                    <p className="text-3xl font-black text-white">{stats?.pendingMessages || 0}</p>
                    <p className="text-xs font-medium text-slate-400">Unread messages</p>
                </button>

                <button onClick={() => navigate('/m/inventory')} className="rounded-[1.5rem] border border-white/10 bg-slate-950 p-4 text-left shadow-lg shadow-black/20 active:scale-[0.99] animate-fade-slide-up" style={{ animationDelay: '100ms' }}>
                    <div className="mb-3 flex items-center justify-between">
                        <div className="rounded-2xl bg-amber-400/15 p-2 text-amber-100 ring-1 ring-amber-300/20"><Package size={18} /></div>
                        {(stats?.lowStockItems || 0) > 0 && <span className="rounded-full bg-amber-400/15 px-2 py-0.5 text-xs font-bold text-amber-100 ring-1 ring-amber-300/20">Alert</span>}
                    </div>
                    <p className="text-3xl font-black text-white">{stats?.lowStockItems || 0}</p>
                    <p className="text-xs font-medium text-slate-400">Low stock items</p>
                </button>
            </div>

            <div>
                <h2 className="mb-3 text-xs font-bold uppercase tracking-wider text-slate-500">Command shortcuts</h2>
                <div className="grid grid-cols-2 gap-3">
                    {commandActions.map((action, index) => (
                        <button
                            key={action.label}
                            onClick={() => navigate(action.path)}
                            className="flex items-center gap-3 rounded-[1.25rem] border border-white/10 bg-slate-950 p-3 text-left shadow-lg shadow-black/20 active:scale-[0.99] animate-fade-slide-up"
                            style={{ animationDelay: `${125 + index * 25}ms` }}
                        >
                            <div className={`rounded-2xl p-2.5 ring-1 ${action.tone}`}>
                                <action.icon size={18} />
                            </div>
                            <div className="min-w-0 flex-1">
                                <p className="truncate text-sm font-black text-white">{action.label}</p>
                                <p className="truncate text-xs text-slate-500">{action.helper}</p>
                            </div>
                            <ArrowRight size={15} className="text-slate-600" />
                        </button>
                    ))}
                </div>
            </div>

            <div>
                <div className="mb-3 flex items-center justify-between">
                    <h2 className="text-xs font-bold uppercase tracking-wider text-slate-500">Recent orders</h2>
                    <button
                        onClick={() => navigate('/m/orders')}
                        className="flex items-center gap-1 text-sm font-bold text-indigo-200"
                    >
                        View All <ArrowRight size={14} />
                    </button>
                </div>
                <div className="overflow-hidden rounded-[1.5rem] border border-white/10 bg-slate-950 shadow-lg shadow-black/20">
                    {activities.length === 0 ? (
                        <div className="p-6 text-center">
                            <Users size={32} className="mx-auto mb-2 text-slate-600" />
                            <p className="text-sm text-slate-400">No recent activity</p>
                        </div>
                    ) : (
                        activities.map((activity, index) => (
                            <button
                                key={activity.id}
                                onClick={() => navigate(`/m/orders/${activity.id}`)}
                                className="flex w-full items-center p-4 text-left transition-colors active:bg-white/10 animate-fade-slide-up"
                                style={{ animationDelay: `${225 + index * 25}ms` }}
                            >
                                <div className="mr-3 flex h-11 w-11 items-center justify-center rounded-2xl bg-indigo-400/15 text-indigo-100 ring-1 ring-indigo-300/20">
                                    <ShoppingCart size={18} />
                                </div>
                                <div className="min-w-0 flex-1">
                                    <p className="truncate font-black text-white">{activity.title}</p>
                                    <p className="truncate text-sm text-slate-400">{activity.subtitle}</p>
                                </div>
                                <div className="ml-2 flex flex-col items-end gap-1">
                                    <span className="text-xs text-slate-500">{activity.time}</span>
                                    {activity.status && (
                                        <span className={`rounded-full px-2 py-0.5 text-[10px] font-bold capitalize ${getDarkStatusColor(activity.status)}`}>
                                            {activity.status}
                                        </span>
                                    )}
                                </div>
                            </button>
                        ))
                    )}
                </div>
            </div>
        </div>
    );
}
