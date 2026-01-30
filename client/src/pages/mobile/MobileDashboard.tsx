import { useState, useEffect, useMemo } from 'react';
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

    useEffect(() => {
        fetchDashboardData();

        // Listen for pull-to-refresh
        const handleRefresh = () => fetchDashboardData();
        window.addEventListener('mobile-refresh', handleRefresh);
        return () => window.removeEventListener('mobile-refresh', handleRefresh);
    }, [currentAccount, token]);

    const fetchDashboardData = async () => {
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
                        subtitle: `${formatCurrency(Number(order.total || 0), currentAccount?.currency || 'USD')}`,
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
    };

    // Currency formatting helper using centralized utility with account currency
    const formatAccountCurrency = (amount: number) =>
        formatCurrency(amount, currentAccount?.currency || 'USD', { minimumFractionDigits: 0, maximumFractionDigits: 0 });

    // Calculate trend percentages
    const ordersTrend = stats?.yesterdayOrders
        ? ((stats.todayOrders - stats.yesterdayOrders) / stats.yesterdayOrders) * 100
        : 0;
    const revenueTrend = stats?.yesterdayRevenue
        ? ((stats.todayRevenue - stats.yesterdayRevenue) / stats.yesterdayRevenue) * 100
        : 0;

    const quickActions = [
        { label: 'Orders', icon: ShoppingCart, path: '/m/orders', color: 'from-blue-500 to-indigo-600' },
        { label: 'Inbox', icon: MessageSquare, path: '/m/inbox', color: 'from-emerald-500 to-teal-600' },
        { label: 'Analytics', icon: TrendingUp, path: '/m/analytics', color: 'from-purple-500 to-violet-600' },
        { label: 'Inventory', icon: Package, path: '/m/inventory', color: 'from-orange-500 to-amber-600' },
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
        <div className="space-y-6">
            {/* Revenue Anomaly Alert Banner - only show if user has finance permission */}
            {hasPermission('view_finance') && <RevenueAnomalyBanner anomaly={anomaly} />}

            {/* Greeting Header */}
            <div className="flex items-center justify-between animate-fade-slide-up">
                <div>
                    <div className="flex items-center gap-2 mb-1">
                        <greeting.icon size={20} className={greeting.color} />
                        <span className={`text-sm font-medium ${greeting.color}`}>{greeting.text}</span>
                    </div>
                    <h1 className="text-2xl font-bold text-white">{firstName} 👋</h1>
                </div>
                <button
                    onClick={() => navigate('/m/notifications')}
                    className="p-3 rounded-2xl bg-slate-800/50 backdrop-blur-sm border border-white/10 hover:bg-slate-700/50 active:scale-95 transition-all"
                >
                    <Bell size={20} className="text-slate-300" />
                </button>
            </div>

            {/* Stat Cards with Sparklines */}
            <div className="grid grid-cols-2 gap-3">
                {/* Orders Card */}
                <div
                    className="bg-slate-800/50 backdrop-blur-sm border border-white/10 rounded-2xl p-4 animate-fade-slide-up cursor-pointer active:scale-[0.98] transition-transform"
                    style={{ animationDelay: '50ms' }}
                    onClick={() => navigate('/m/orders')}
                >
                    <div className="flex items-center justify-between mb-2">
                        <div className="p-2 rounded-xl bg-blue-500/20">
                            <ShoppingCart size={18} className="text-blue-400" />
                        </div>
                        {stats?.yesterdayOrders !== undefined && <TrendBadge value={ordersTrend} />}
                    </div>
                    <p className="text-2xl font-bold text-white mb-0.5">{stats?.todayOrders || 0}</p>
                    <p className="text-xs text-slate-400 mb-2">Orders today</p>
                    <Sparkline data={sparklines.orders} color="#60a5fa" height={24} />
                </div>

                {/* Revenue Card - only show if user has finance permission */}
                {hasPermission('view_finance') && (
                    <div
                        className="bg-slate-800/50 backdrop-blur-sm border border-white/10 rounded-2xl p-4 animate-fade-slide-up cursor-pointer active:scale-[0.98] transition-transform"
                        style={{ animationDelay: '100ms' }}
                        onClick={() => navigate('/m/analytics')}
                    >
                        <div className="flex items-center justify-between mb-2">
                            <div className="p-2 rounded-xl bg-emerald-500/20">
                                <DollarSign size={18} className="text-emerald-400" />
                            </div>
                            {stats?.yesterdayRevenue !== undefined && <TrendBadge value={revenueTrend} />}
                        </div>
                        <p className="text-2xl font-bold text-white mb-0.5">{formatAccountCurrency(stats?.todayRevenue || 0)}</p>
                        <p className="text-xs text-slate-400 mb-2">Revenue today</p>
                        <Sparkline data={sparklines.revenue} color="#34d399" height={24} />
                    </div>
                )}

                {/* Messages Card */}
                <div
                    className="bg-slate-800/50 backdrop-blur-sm border border-white/10 rounded-2xl p-4 animate-fade-slide-up cursor-pointer active:scale-[0.98] transition-transform"
                    style={{ animationDelay: '150ms' }}
                    onClick={() => navigate('/m/inbox')}
                >
                    <div className="flex items-center justify-between mb-2">
                        <div className="p-2 rounded-xl bg-purple-500/20">
                            <MessageSquare size={18} className="text-purple-400" />
                        </div>
                        {(stats?.pendingMessages || 0) > 0 && (
                            <span className="px-2 py-0.5 rounded-full bg-purple-500/20 text-purple-400 text-xs font-medium">
                                New
                            </span>
                        )}
                    </div>
                    <p className="text-2xl font-bold text-white mb-0.5">{stats?.pendingMessages || 0}</p>
                    <p className="text-xs text-slate-400">Unread messages</p>
                </div>

                {/* Low Stock Card */}
                <div
                    className="bg-slate-800/50 backdrop-blur-sm border border-white/10 rounded-2xl p-4 animate-fade-slide-up cursor-pointer active:scale-[0.98] transition-transform"
                    style={{ animationDelay: '200ms' }}
                    onClick={() => navigate('/m/inventory')}
                >
                    <div className="flex items-center justify-between mb-2">
                        <div className="p-2 rounded-xl bg-amber-500/20">
                            <Package size={18} className="text-amber-400" />
                        </div>
                        {(stats?.lowStockItems || 0) > 0 && (
                            <span className="px-2 py-0.5 rounded-full bg-amber-500/20 text-amber-400 text-xs font-medium">
                                Alert
                            </span>
                        )}
                    </div>
                    <p className="text-2xl font-bold text-white mb-0.5">{stats?.lowStockItems || 0}</p>
                    <p className="text-xs text-slate-400">Low stock items</p>
                </div>
            </div>

            {/* Quick Actions */}
            <div>
                <h2 className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-3">Quick Actions</h2>
                <div className="grid grid-cols-4 gap-3">
                    {quickActions.map((action, index) => (
                        <button
                            key={action.label}
                            onClick={() => navigate(action.path)}
                            className="flex flex-col items-center p-3 bg-slate-800/50 backdrop-blur-sm border border-white/10 rounded-2xl active:scale-95 transition-all animate-fade-slide-up"
                            style={{ animationDelay: `${250 + index * 50}ms` }}
                        >
                            <div className={`p-2.5 rounded-xl bg-gradient-to-br ${action.color} mb-2 shadow-lg`}>
                                <action.icon size={18} className="text-white" />
                            </div>
                            <span className="text-xs font-medium text-slate-300">{action.label}</span>
                        </button>
                    ))}
                </div>
            </div>

            {/* Recent Activity */}
            <div>
                <div className="flex items-center justify-between mb-3">
                    <h2 className="text-xs font-semibold text-slate-500 uppercase tracking-wider">Recent Activity</h2>
                    <button
                        onClick={() => navigate('/m/orders')}
                        className="text-sm text-indigo-400 font-medium flex items-center gap-1 hover:text-indigo-300 transition-colors"
                    >
                        View All <ArrowRight size={14} />
                    </button>
                </div>
                <div className="bg-slate-800/50 backdrop-blur-sm border border-white/10 rounded-2xl divide-y divide-white/5 overflow-hidden">
                    {activities.length === 0 ? (
                        <div className="p-6 text-center">
                            <Users size={32} className="text-slate-600 mx-auto mb-2" />
                            <p className="text-slate-400 text-sm">No recent activity</p>
                        </div>
                    ) : (
                        activities.map((activity, index) => (
                            <button
                                key={activity.id}
                                onClick={() => navigate(`/m/orders/${activity.id}`)}
                                className="w-full flex items-center p-4 text-left hover:bg-white/5 active:bg-white/10 transition-colors animate-fade-slide-up"
                                style={{ animationDelay: `${450 + index * 50}ms` }}
                            >
                                <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-indigo-500 to-purple-600 flex items-center justify-center mr-3 shadow-lg">
                                    <ShoppingCart size={18} className="text-white" />
                                </div>
                                <div className="flex-1 min-w-0">
                                    <p className="font-medium text-white truncate">{activity.title}</p>
                                    <p className="text-sm text-slate-400 truncate">{activity.subtitle}</p>
                                </div>
                                <div className="flex flex-col items-end gap-1 ml-2">
                                    <span className="text-xs text-slate-500">{activity.time}</span>
                                    {activity.status && (
                                        <span className={`px-2 py-0.5 rounded-full text-[10px] font-medium capitalize ${getDarkStatusColor(activity.status)}`}>
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
