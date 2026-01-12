import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import {
    ShoppingCart,
    MessageSquare,
    TrendingUp,
    Package,
    ArrowRight,
    Bell,
    DollarSign
} from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import { useAccount } from '../../context/AccountContext';

/**
 * MobileDashboard - Main dashboard for the PWA companion app.
 */

interface DashboardStats {
    todayOrders: number;
    todayRevenue: number;
    pendingMessages: number;
    lowStockItems: number;
}

interface RecentActivity {
    id: string;
    type: 'order' | 'message' | 'inventory';
    title: string;
    subtitle: string;
    time: string;
}

export function MobileDashboard() {
    const navigate = useNavigate();
    const { token } = useAuth();
    const { currentAccount } = useAccount();
    const [stats, setStats] = useState<DashboardStats | null>(null);
    const [activities, setActivities] = useState<RecentActivity[]>([]);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        fetchDashboardData();
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

            const ordersRes = await fetch('/api/sync/orders/search?limit=5', { headers });

            // Set default stats
            setStats({
                todayOrders: 0,
                todayRevenue: 0,
                pendingMessages: 0,
                lowStockItems: 0
            });

            if (ordersRes.ok) {
                const ordersData = await ordersRes.json();
                const recentActivities: RecentActivity[] = (ordersData.orders || ordersData || [])
                    .slice(0, 5)
                    .map((order: any) => ({
                        id: order.id,
                        type: 'order' as const,
                        title: `Order #${order.orderNumber || String(order.id).slice(-6)}`,
                        subtitle: `$${Number(order.total || 0).toFixed(2)} - ${order.status || 'pending'}`,
                        time: formatTimeAgo(order.date_created || order.createdAt)
                    }));
                setActivities(recentActivities);

                // Update stats from orders
                setStats(prev => ({
                    ...prev!,
                    todayOrders: recentActivities.length
                }));
            }
        } catch (error) {
            console.error('[MobileDashboard] Error fetching data:', error);
        } finally {
            setLoading(false);
        }
    };

    const formatTimeAgo = (date: string) => {
        if (!date) return '';
        const now = new Date();
        const then = new Date(date);
        const diff = Math.floor((now.getTime() - then.getTime()) / 1000);

        if (diff < 60) return 'Just now';
        if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
        if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
        return `${Math.floor(diff / 86400)}d ago`;
    };

    const formatCurrency = (amount: number) => {
        return new Intl.NumberFormat('en-AU', {
            style: 'currency',
            currency: 'AUD',
            minimumFractionDigits: 0,
            maximumFractionDigits: 0
        }).format(amount);
    };

    const quickActions = [
        { label: 'Orders', icon: ShoppingCart, path: '/m/orders', color: 'bg-blue-500' },
        { label: 'Inbox', icon: MessageSquare, path: '/m/inbox', color: 'bg-green-500' },
        { label: 'Analytics', icon: TrendingUp, path: '/m/analytics', color: 'bg-purple-500' },
        { label: 'Inventory', icon: Package, path: '/m/inventory', color: 'bg-orange-500' },
    ];

    if (loading) {
        return (
            <div className="space-y-4 animate-pulse">
                <div className="h-8 bg-gray-200 rounded w-1/2" />
                <div className="grid grid-cols-2 gap-3">
                    {[...Array(4)].map((_, i) => (
                        <div key={i} className="h-24 bg-gray-200 rounded-xl" />
                    ))}
                </div>
            </div>
        );
    }

    return (
        <div className="space-y-6 animate-fade-slide-up">
            <div className="flex items-center justify-between">
                <div>
                    <h1 className="text-2xl font-bold text-gray-900">Dashboard</h1>
                    <p className="text-sm text-gray-500">Welcome back!</p>
                </div>
                <button
                    onClick={() => navigate('/m/more')}
                    className="p-2 rounded-full bg-gray-100"
                >
                    <Bell size={20} className="text-gray-600" />
                </button>
            </div>

            <div className="grid grid-cols-2 gap-3">
                <div className="bg-blue-50 rounded-xl p-4 animate-fade-slide-up" style={{ animationDelay: '50ms' }}>
                    <ShoppingCart size={20} className="text-blue-600 mb-2" />
                    <p className="text-2xl font-bold text-blue-600">{stats?.todayOrders || 0}</p>
                    <p className="text-xs text-gray-600">Today's Orders</p>
                </div>
                <div className="bg-green-50 rounded-xl p-4 animate-fade-slide-up" style={{ animationDelay: '100ms' }}>
                    <DollarSign size={20} className="text-green-600 mb-2" />
                    <p className="text-2xl font-bold text-green-600">{formatCurrency(stats?.todayRevenue || 0)}</p>
                    <p className="text-xs text-gray-600">Today's Revenue</p>
                </div>
                <div className="bg-purple-50 rounded-xl p-4 animate-fade-slide-up" style={{ animationDelay: '150ms' }}>
                    <MessageSquare size={20} className="text-purple-600 mb-2" />
                    <p className="text-2xl font-bold text-purple-600">{stats?.pendingMessages || 0}</p>
                    <p className="text-xs text-gray-600">Messages</p>
                </div>
                <div className="bg-orange-50 rounded-xl p-4 animate-fade-slide-up" style={{ animationDelay: '200ms' }}>
                    <Package size={20} className="text-orange-600 mb-2" />
                    <p className="text-2xl font-bold text-orange-600">{stats?.lowStockItems || 0}</p>
                    <p className="text-xs text-gray-600">Low Stock</p>
                </div>
            </div>

            <div>
                <h2 className="text-sm font-semibold text-gray-500 uppercase mb-3">Quick Actions</h2>
                <div className="grid grid-cols-4 gap-3">
                    {quickActions.map((action) => (
                        <button
                            key={action.label}
                            onClick={() => navigate(action.path)}
                            className="flex flex-col items-center p-3 bg-white rounded-xl shadow-sm border border-gray-100 active:scale-95 transition-transform"
                        >
                            <div className={`p-2 rounded-lg ${action.color} mb-2`}>
                                <action.icon size={20} className="text-white" />
                            </div>
                            <span className="text-xs font-medium text-gray-700">{action.label}</span>
                        </button>
                    ))}
                </div>
            </div>

            <div>
                <div className="flex items-center justify-between mb-3">
                    <h2 className="text-sm font-semibold text-gray-500 uppercase">Recent Activity</h2>
                    <button
                        onClick={() => navigate('/m/orders')}
                        className="text-sm text-indigo-600 font-medium flex items-center gap-1"
                    >
                        View All <ArrowRight size={14} />
                    </button>
                </div>
                <div className="bg-white rounded-xl shadow-sm border border-gray-100 divide-y divide-gray-100">
                    {activities.length === 0 ? (
                        <div className="p-4 text-center text-gray-500">
                            No recent activity
                        </div>
                    ) : (
                        activities.map((activity) => (
                            <button
                                key={activity.id}
                                onClick={() => navigate(`/m/orders/${activity.id}`)}
                                className="w-full flex items-center p-4 text-left active:bg-gray-50"
                            >
                                <div className="flex-1 min-w-0">
                                    <p className="font-medium text-gray-900 truncate">{activity.title}</p>
                                    <p className="text-sm text-gray-500 truncate">{activity.subtitle}</p>
                                </div>
                                <span className="text-xs text-gray-400 ml-2">{activity.time}</span>
                            </button>
                        ))
                    )}
                </div>
            </div>
        </div>
    );
}
