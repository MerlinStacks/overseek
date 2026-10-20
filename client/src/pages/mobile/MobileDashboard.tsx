import { useState, useEffect, useCallback, useRef } from 'react';
import { Logger } from '../../utils/logger';
import { useNavigate } from 'react-router-dom';
import {
    ShoppingCart,
    MessageSquare,
    Eye,
    ArrowRight,
    DollarSign,
    Users
} from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import { useAccount } from '../../context/AccountContext';
import { getDateRange } from '../../utils/dateUtils';
import { formatCurrency, formatTimeAgo } from '../../utils/format';
import { RevenueAnomalyBanner } from '../../components/mobile/RevenueAnomalyBanner';
import { DashboardSkeleton } from '../../components/mobile/MobileSkeleton';
import { TrendBadge } from '../../components/mobile/Sparkline';
import { usePermissions } from '../../hooks/usePermissions';
import { useVisibilityPolling } from '../../hooks/useVisibilityPolling';

/**
 * MobileDashboard - Daily overview with account-branded accents.
 */

interface OrderApiResponse {
    id: string;
    orderNumber?: string;
    total?: string | number;
    date_created?: string;
    createdAt?: string;
    status?: string;
    billing?: { first_name?: string; last_name?: string };
}

interface DashboardStats {
    todayOrders?: number;
    todayRevenue?: number;
    pendingMessages?: number;
    yesterdayOrders?: number;
    yesterdayRevenue?: number;
}

interface RecentActivity {
    id: string;
    type: 'order' | 'message' | 'inventory';
    title: string;
    subtitle: string;
    customerName?: string;
    time: string;
    status?: string;
}

interface AnomalyData {
    isAnomaly: boolean;
    direction: 'above' | 'below' | 'normal';
    percentChange: number;
    message: string;
}

function metricValue(value: unknown): number | undefined {
    if (typeof value !== 'number' && (typeof value !== 'string' || !value.trim())) return undefined;
    const number = Number(value);
    return Number.isFinite(number) && number >= 0 ? number : undefined;
}

export function MobileDashboard() {
    const { currentAccount } = useAccount();
    // Never show the previous store's figures while the next store loads.
    return <MobileDashboardContent key={currentAccount?.id || 'no-account'} />;
}

function MobileDashboardContent() {
    const navigate = useNavigate();
    const { token } = useAuth();
    const { currentAccount } = useAccount();
    const { hasPermission } = usePermissions();
    const [stats, setStats] = useState<DashboardStats | null>(null);
    const [activities, setActivities] = useState<RecentActivity[]>([]);
    const [anomaly, setAnomaly] = useState<AnomalyData | null>(null);
    const [liveVisitors, setLiveVisitors] = useState<{ accountId: string; count: number | null } | null>(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const requestVersion = useRef({ value: 0 });

    const accountCurrency = currentAccount?.currency || 'USD';
    const accountId = currentAccount?.id;

    const fetchLiveVisitors = useCallback(async () => {
        if (!accountId || !token) return;
        try {
            const response = await fetch('/api/analytics/visitors/log?live=true&limit=1', {
                headers: { Authorization: `Bearer ${token}`, 'X-Account-ID': accountId }
            });
            if (!response.ok) throw new Error('Could not load live visitor count');
            const data = await response.json();
            setLiveVisitors({ accountId, count: data.total ?? 0 });
        } catch (error) {
            Logger.error('[MobileDashboard] Live visitor count failed', { error });
            setLiveVisitors({ accountId, count: null });
        }
    }, [accountId, token]);

    useVisibilityPolling(fetchLiveVisitors, 30000, [fetchLiveVisitors]);

    const fetchDashboardData = useCallback(async () => {
        const requests = requestVersion.current;
        const version = ++requests.value;
        const isCurrent = () => version === requests.value;
        if (!accountId || !token) {
            setLoading(false);
            return;
        }

        try {
            setLoading(true);
            setError(null);
            const headers = {
                'Authorization': `Bearer ${token}`,
                'X-Account-ID': accountId
            };

            // Use same date utility as desktop for timezone-aware dates
            const { startDate, endDate } = getDateRange('today');
            const yesterday = getDateRange('yesterday');
            // Fetch overview data in parallel; live visitors refresh independently.
            const [salesRes, yesterdaySalesRes, messagesRes, ordersRes, anomalyRes] = await Promise.all([
                fetch(`/api/analytics/sales?startDate=${startDate}&endDate=${endDate}`, { headers }).catch(() => null),
                fetch(`/api/analytics/sales?startDate=${yesterday.startDate}&endDate=${yesterday.endDate}`, { headers }).catch(() => null),
                fetch('/api/chat/unread-count', { headers }).catch(() => null),
                fetch('/api/sync/orders/search?limit=5', { headers }).catch(() => null),
                fetch('/api/analytics/anomalies', { headers }).catch(() => null)
            ]);

            let todayRevenue: number | undefined, todayOrders: number | undefined, pendingMessages: number | undefined;
            let yesterdayRevenue: number | undefined, yesterdayOrders: number | undefined;
            const hasPrimaryData = salesRes?.ok || messagesRes?.ok || ordersRes?.ok;

            if (!hasPrimaryData) {
                throw new Error('Dashboard requests failed');
            }

            if (salesRes?.ok) {
                const data = await salesRes.json();
                Logger.debug('[MobileDashboard] Sales API response', { data });
                todayRevenue = metricValue(data.total);
                todayOrders = metricValue(data.count);
            } else {
                Logger.error('[MobileDashboard] Sales API failed', { status: salesRes?.status });
            }

            if (yesterdaySalesRes?.ok) {
                const data = await yesterdaySalesRes.json();
                yesterdayRevenue = metricValue(data.total);
                yesterdayOrders = metricValue(data.count);
            }

            if (messagesRes?.ok) {
                const data = await messagesRes.json();
                pendingMessages = metricValue(data.count);
            }

            const anomalyData = anomalyRes?.ok ? await anomalyRes.json() : null;
            let recentActivities: RecentActivity[] | undefined;

            // Parse recent activities from orders
            if (ordersRes?.ok) {
                const ordersData = await ordersRes.json();
                recentActivities = (ordersData.orders || ordersData || [])
                    .slice(0, 5)
                    .map((order: OrderApiResponse) => ({
                        id: order.id,
                        type: 'order' as const,
                        title: `Order #${order.orderNumber || String(order.id).slice(-6)}`,
                        subtitle: `${formatCurrency(Number(order.total || 0), accountCurrency)}`,
                        customerName: [order.billing?.first_name, order.billing?.last_name].filter(Boolean).join(' ').trim() || 'Guest',
                        time: formatTimeAgo(order.date_created || order.createdAt || ''),
                        status: order.status
                    }));
            }
            if (!isCurrent()) return;
            setStats(previous => ({
                todayOrders: todayOrders ?? previous?.todayOrders,
                todayRevenue: todayRevenue ?? previous?.todayRevenue,
                pendingMessages: pendingMessages ?? previous?.pendingMessages,
                yesterdayOrders: todayOrders !== undefined ? yesterdayOrders : undefined,
                yesterdayRevenue: todayRevenue !== undefined ? yesterdayRevenue : undefined,
            }));
            setAnomaly(anomalyData);
            if (recentActivities) setActivities(recentActivities);
            if (!salesRes?.ok || !messagesRes?.ok || !ordersRes?.ok) {
                setError('Some data could not be updated. Available figures are shown.');
            }
        } catch (error) {
            if (!isCurrent()) return;
            Logger.error('[MobileDashboard] Error fetching data', { error });
            setError('Could not load dashboard data. Pull down or tap retry to refresh.');
        } finally {
            if (isCurrent()) setLoading(false);
        }
    }, [accountCurrency, accountId, token]);

    useEffect(() => {
        const requests = requestVersion.current;
        fetchDashboardData();

        // Listen for pull-to-refresh
        const handleRefresh = () => {
            void fetchDashboardData();
            void fetchLiveVisitors();
        };
        window.addEventListener('mobile-refresh', handleRefresh);
        return () => {
            ++requests.value;
            window.removeEventListener('mobile-refresh', handleRefresh);
        };
    }, [fetchDashboardData, fetchLiveVisitors]);

    // Currency formatting helper using centralized utility with account currency
    const formatAccountCurrency = (amount: number) =>
        formatCurrency(amount, accountCurrency, { minimumFractionDigits: 0, maximumFractionDigits: 0 });

    // Calculate trend percentages
    const ordersTrend = stats?.todayOrders !== undefined && stats?.yesterdayOrders !== undefined && stats.yesterdayOrders > 0
        ? ((stats.todayOrders - stats.yesterdayOrders) / stats.yesterdayOrders) * 100
        : null;
    const revenueTrend = stats?.todayRevenue !== undefined && stats?.yesterdayRevenue !== undefined && stats.yesterdayRevenue > 0
        ? ((stats.todayRevenue - stats.yesterdayRevenue) / stats.yesterdayRevenue) * 100
        : null;

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

    if (loading && !stats) {
        return <DashboardSkeleton />;
    }

    if (error && !stats) {
        return (
            <div className="rounded-[1.5rem] border border-rose-400/20 bg-rose-500/10 p-5 text-center text-rose-100">
                <p className="mb-4 text-sm font-medium">{error}</p>
                <button
                    onClick={() => void fetchDashboardData()}
                    className="rounded-full bg-white/10 px-4 py-2 text-sm font-bold text-white ring-1 ring-white/15 active:scale-[0.98]"
                >
                    Retry
                </button>
            </div>
        );
    }

    return (
        <div className="space-y-6 pb-6" aria-busy={loading}>
            <div>
                <p className="mb-1 text-xs font-medium text-slate-400">Your daily overview</p>
                <h1 className="text-2xl font-semibold tracking-tight text-white">Today</h1>
            </div>
            {loading && <p role="status" className="text-xs text-slate-400">Updating overview…</p>}
            {error && <div role="status" className="mobile-panel flex items-center justify-between gap-3 p-3 text-sm text-slate-300">
                <p>{error}</p>
                <button type="button" disabled={loading} onClick={() => void fetchDashboardData()} className="mobile-brand-text min-h-11 px-2 font-medium disabled:opacity-50">Retry</button>
            </div>}
            {hasPermission('view_finance') && <RevenueAnomalyBanner anomaly={anomaly} />}

            <div className="grid grid-cols-2 gap-3">
                <button onClick={() => navigate('/m/orders')} className="mobile-metric">
                    <div className="mb-3 flex items-center justify-between">
                        <ShoppingCart size={18} className="mobile-brand-text" />
                        {ordersTrend !== null && <span title="Compared with yesterday"><TrendBadge value={ordersTrend} /></span>}
                    </div>
                    <p className="text-3xl font-semibold tabular-nums tracking-tight text-white">{stats?.todayOrders ?? '—'}</p>
                    <p className="text-xs font-medium text-slate-400">Orders today</p>
                </button>

                {hasPermission('view_finance') && (
                    <button onClick={() => navigate('/m/analytics')} className="mobile-metric">
                        <div className="mb-3 flex items-center justify-between">
                            <DollarSign size={18} className="mobile-brand-text" />
                            {revenueTrend !== null && <span title="Compared with yesterday"><TrendBadge value={revenueTrend} /></span>}
                        </div>
                        <p className="break-all text-2xl font-semibold tabular-nums tracking-tight text-white">{stats?.todayRevenue !== undefined ? formatAccountCurrency(stats.todayRevenue) : '—'}</p>
                        <p className="text-xs font-medium text-slate-400">Revenue today</p>
                    </button>
                )}

                <button onClick={() => navigate('/m/inbox')} className="mobile-metric">
                    <div className="mb-3 flex items-center justify-between">
                        <MessageSquare size={18} className="mobile-brand-text" />
                        {(stats?.pendingMessages || 0) > 0 && <span className="mobile-brand-soft rounded px-2 py-0.5 text-xs font-medium">New</span>}
                    </div>
                    <p className="text-3xl font-semibold tabular-nums tracking-tight text-white">{stats?.pendingMessages ?? '—'}</p>
                    <p className="text-xs font-medium text-slate-400">Unread messages</p>
                </button>

                <button onClick={() => navigate('/m/live-visitors')} className="mobile-metric">
                    <div className="mb-3 flex items-center justify-between">
                        <Eye size={18} className="mobile-brand-text" />
                    </div>
                    <p className="text-3xl font-semibold tabular-nums tracking-tight text-white">{liveVisitors?.accountId === accountId ? liveVisitors?.count ?? '—' : '—'}</p>
                    <p className="text-xs font-medium text-slate-400">Live visitors</p>
                    <p className="mt-1 text-[11px] text-slate-500">Active in the last 3 minutes</p>
                </button>
            </div>

            <div>
                <div className="mb-3 flex items-center justify-between">
                    <h2 className="text-base font-semibold text-white">Recent orders</h2>
                    <button
                        onClick={() => navigate('/m/orders')}
                        className="mobile-brand-text flex min-h-11 items-center gap-1 text-sm font-medium"
                    >
                        View All <ArrowRight size={14} />
                    </button>
                </div>
                <div className="mobile-panel divide-y divide-white/5 overflow-hidden">
                    {activities.length === 0 ? (
                        <div className="p-6 text-center">
                            <Users size={32} className="mx-auto mb-2 text-slate-600" />
                            <p className="text-sm text-slate-400">No recent activity</p>
                        </div>
                    ) : (
                        activities.map((activity) => (
                            <button
                                key={activity.id}
                                onClick={() => navigate(`/m/orders/${activity.id}`)}
                                className="flex w-full items-center p-4 text-left transition-colors active:bg-white/5"
                            >
                                <div className="mr-3 flex h-10 w-10 items-center justify-center rounded-lg bg-white/5 text-slate-400">
                                    <ShoppingCart size={18} />
                                </div>
                                <div className="min-w-0 flex-1">
                                    <p className="truncate font-semibold text-white">{activity.title}</p>
                                    <p className="truncate text-sm text-slate-300">{activity.customerName}</p>
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
