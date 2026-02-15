import { useState, useEffect } from 'react';
import { Logger } from '../../utils/logger';
import { useNavigate } from 'react-router-dom';
import {
    Search,
    Package,
    Truck,
    CheckCircle,
    XCircle,
    Clock,
    RefreshCw,
    ShoppingBag
} from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import { useAccount } from '../../context/AccountContext';
import { useHaptic } from '../../hooks/useHaptic';
import { SwipeableRow } from '../../components/ui/SwipeableRow';
import { formatCurrency } from '../../utils/format';
import { OrdersSkeleton } from '../../components/mobile/MobileSkeleton';

interface OrderApiResponse {
    id: string;
    orderNumber?: string;
    billing?: {
        first_name?: string;
        last_name?: string;
        email?: string;
    };
    total?: number;
    status?: string;
    date_created?: string;
    createdAt?: string;
    line_items?: unknown[];
}

interface Order {
    id: string;
    orderNumber: string;
    customerName: string;
    total: number;
    status: string;
    createdAt: string;
    itemCount: number;
}

/**
 * Dark-mode status config with colors matching glassmorphism theme.
 */
const STATUS_CONFIG: Record<string, { icon: typeof Package; color: string; bg: string; label: string; next?: string }> = {
    pending: { icon: Clock, color: 'text-amber-400', bg: 'bg-amber-500/20', label: 'Pending', next: 'processing' },
    processing: { icon: Package, color: 'text-blue-400', bg: 'bg-blue-500/20', label: 'Processing', next: 'shipped' },
    shipped: { icon: Truck, color: 'text-purple-400', bg: 'bg-purple-500/20', label: 'Shipped', next: 'completed' },
    delivered: { icon: CheckCircle, color: 'text-emerald-400', bg: 'bg-emerald-500/20', label: 'Delivered' },
    completed: { icon: CheckCircle, color: 'text-emerald-400', bg: 'bg-emerald-500/20', label: 'Completed' },
    cancelled: { icon: XCircle, color: 'text-red-400', bg: 'bg-red-500/20', label: 'Cancelled' },
    refunded: { icon: RefreshCw, color: 'text-slate-400', bg: 'bg-slate-500/20', label: 'Refunded' },
};

const FILTER_OPTIONS = ['All', 'Pending', 'Processing', 'Shipped', 'Completed'];

/**
 * MobileOrders - Premium dark-mode orders list for PWA.
 * Features swipe-to-advance status, search, and filters.
 */
export function MobileOrders() {
    const navigate = useNavigate();
    const { token } = useAuth();
    const { currentAccount } = useAccount();
    const { triggerHaptic } = useHaptic();
    const [orders, setOrders] = useState<Order[]>([]);
    const [loading, setLoading] = useState(true);
    const [searchQuery, setSearchQuery] = useState('');
    const [activeFilter, setActiveFilter] = useState('All');
    const [hasMore, setHasMore] = useState(true);
    const [page, setPage] = useState(1);

    useEffect(() => {
        fetchOrders(true);
        // Listen for refresh events from pull-to-refresh
        const handleRefresh = () => fetchOrders(true);
        window.addEventListener('mobile-refresh', handleRefresh);
        return () => window.removeEventListener('mobile-refresh', handleRefresh);
    }, [currentAccount, activeFilter, token]);

    const fetchOrders = async (reset = false) => {
        if (!currentAccount || !token) {
            setLoading(false);
            return;
        }

        try {
            if (reset) {
                setLoading(true);
                setPage(1);
            }

            const currentPage = reset ? 1 : page;
            const params = new URLSearchParams();
            params.append('page', currentPage.toString());
            params.append('limit', '20');
            if (activeFilter !== 'All') params.append('status', activeFilter.toLowerCase());
            if (searchQuery) params.append('q', searchQuery);

            const res = await fetch(`/api/sync/orders/search?${params}`, {
                headers: {
                    'Authorization': `Bearer ${token}`,
                    'X-Account-ID': currentAccount.id
                }
            });

            if (!res.ok) throw new Error('Failed to fetch orders');

            const data = await res.json();
            const newOrders = (data.orders || data || []).map((o: OrderApiResponse) => ({
                id: o.id,
                orderNumber: o.orderNumber || `#${String(o.id).slice(-6).toUpperCase()}`,
                customerName: o.billing?.first_name
                    ? `${o.billing.first_name} ${o.billing.last_name || ''}`.trim()
                    : o.billing?.email || 'Guest',
                total: o.total || 0,
                status: o.status || 'pending',
                createdAt: o.date_created || o.createdAt || '',
                itemCount: o.line_items?.length || 0
            }));

            if (reset) {
                setOrders(newOrders);
            } else {
                setOrders(prev => [...prev, ...newOrders]);
            }

            setHasMore(newOrders.length === 20);
            setPage(currentPage + 1);
        } catch (error) {
            Logger.error('[MobileOrders] Error fetching orders:', { error: error });
        } finally {
            setLoading(false);
        }
    };

    const handleSearch = (e: React.FormEvent) => {
        e.preventDefault();
        triggerHaptic();
        fetchOrders(true);
    };

    const handleFilterChange = (filter: string) => {
        triggerHaptic();
        setActiveFilter(filter);
    };

    const formatDate = (date: string) => {
        const d = new Date(date);
        const now = new Date();
        const isToday = d.toDateString() === now.toDateString();
        const isYesterday = new Date(now.getTime() - 86400000).toDateString() === d.toDateString();

        if (isToday) return d.toLocaleTimeString('en-AU', { hour: 'numeric', minute: '2-digit' });
        if (isYesterday) return 'Yesterday';
        return d.toLocaleDateString('en-AU', { day: 'numeric', month: 'short' });
    };

    const formatAccountCurrency = (amount: number) =>
        formatCurrency(amount, currentAccount?.currency || 'USD', { minimumFractionDigits: 0, maximumFractionDigits: 0 });

    const getStatusConfig = (status: string) => {
        return STATUS_CONFIG[status.toLowerCase()] || STATUS_CONFIG.pending;
    };

    const advanceStatus = async (orderId: string, currentStatus: string) => {
        const config = getStatusConfig(currentStatus);
        if (!config.next) return;

        triggerHaptic(15);

        // Optimistically update
        setOrders(prev => prev.map(o =>
            o.id === orderId ? { ...o, status: config.next! } : o
        ));

        try {
            await fetch(`/api/sync/orders/${orderId}`, {
                method: 'PATCH',
                headers: {
                    'Authorization': `Bearer ${token}`,
                    'X-Account-ID': currentAccount!.id,
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({ status: config.next })
            });
        } catch (error) {
            Logger.error('[MobileOrders] Status update failed:', { error: error });
            fetchOrders(true);
        }
    };

    if (loading && orders.length === 0) {
        return <OrdersSkeleton />;
    }

    return (
        <div className="space-y-4 animate-fade-slide-up">
            {/* Header */}
            <div className="flex items-center justify-between">
                <h1 className="text-2xl font-bold text-white">Orders</h1>
                <span className="text-sm text-slate-400 bg-slate-800/50 px-3 py-1 rounded-full">
                    {orders.length} orders
                </span>
            </div>

            {/* Search */}
            <form onSubmit={handleSearch} className="relative">
                <div className="absolute left-4 top-1/2 -translate-y-1/2 p-1.5 rounded-lg bg-slate-700/50">
                    <Search size={16} className="text-slate-400" />
                </div>
                <input
                    type="text"
                    placeholder="Search by order # or customer..."
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    className="w-full pl-14 pr-4 py-3.5 pwa-card text-white placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-indigo-500/50 focus:border-indigo-500/50 transition-all"
                />
            </form>

            {/* Filter Chips */}
            <div className="flex gap-2 overflow-x-auto pb-1 -mx-4 px-4 no-scrollbar">
                {FILTER_OPTIONS.map((filter) => {
                    const filterConfig = filter !== 'All' ? getStatusConfig(filter) : null;
                    const isActive = activeFilter === filter;
                    return (
                        <button
                            key={filter}
                            onClick={() => handleFilterChange(filter)}
                            className={`
                                px-4 py-2 rounded-full text-sm font-medium whitespace-nowrap transition-all flex items-center gap-2 active:scale-95
                                ${isActive
                                    ? 'bg-gradient-to-r from-indigo-500 to-purple-600 text-white shadow-lg shadow-indigo-500/25'
                                    : 'bg-slate-700/40 border border-white/10 text-slate-300'
                                }
                            `}
                        >
                            {filterConfig && <filterConfig.icon size={14} />}
                            {filter}
                        </button>
                    );
                })}
            </div>

            {/* Swipe Hint */}
            {orders.length > 0 && (
                <p className="text-xs text-slate-500 text-center">
                    ← Swipe right to advance order status
                </p>
            )}

            {/* Orders List */}
            <div className="space-y-3">
                {orders.length === 0 ? (
                    <div className="text-center py-16">
                        <div className="w-20 h-20 mx-auto mb-4 pwa-card flex items-center justify-center">
                            <ShoppingBag className="text-slate-500" size={36} />
                        </div>
                        <p className="text-white font-semibold mb-1">No orders found</p>
                        <p className="text-slate-400 text-sm">Orders will appear here</p>
                    </div>
                ) : (
                    orders.map((order, index) => {
                        const config = getStatusConfig(order.status);
                        const StatusIcon = config.icon;
                        const nextConfig = config.next ? getStatusConfig(config.next) : null;
                        const NextIcon = nextConfig?.icon;

                        return (
                            <SwipeableRow
                                key={order.id}
                                leftAction={config.next && NextIcon ? {
                                    icon: <NextIcon size={24} className="text-white" />,
                                    color: 'bg-indigo-500',
                                    onAction: () => advanceStatus(order.id, order.status)
                                } : undefined}
                            >
                                <button
                                    onClick={() => {
                                        triggerHaptic();
                                        navigate(`/m/orders/${order.id}`);
                                    }}
                                    className="w-full pwa-card p-4 active:bg-slate-700/50 transition-all animate-fade-slide-up"
                                    style={{ animationDelay: `${index * 15}ms` }}
                                >
                                    <div className="flex items-start justify-between mb-3">
                                        <div className="flex items-center gap-3">
                                            <div className={`w-10 h-10 rounded-xl ${config.bg} flex items-center justify-center`}>
                                                <StatusIcon size={18} className={config.color} />
                                            </div>
                                            <div className="text-left">
                                                <p className="font-bold text-white">{order.orderNumber}</p>
                                                <p className="text-sm text-slate-400">{order.customerName}</p>
                                            </div>
                                        </div>
                                        <span className="text-xs text-slate-500">{formatDate(order.createdAt)}</span>
                                    </div>

                                    <div className="flex items-center justify-between pt-3 border-t border-white/5">
                                        <span className={`text-xs font-medium px-2.5 py-1 rounded-full ${config.bg} ${config.color}`}>
                                            {config.label}
                                        </span>
                                        <p className="text-lg font-bold text-white">{formatAccountCurrency(order.total)}</p>
                                    </div>

                                    {order.itemCount > 0 && (
                                        <p className="text-xs text-slate-500 mt-2">
                                            {order.itemCount} item{order.itemCount > 1 ? 's' : ''}
                                        </p>
                                    )}
                                </button>
                            </SwipeableRow>
                        );
                    })
                )}

                {/* Load More */}
                {hasMore && orders.length > 0 && (
                    <button
                        onClick={() => fetchOrders()}
                        disabled={loading}
                        className="w-full py-4 text-indigo-400 font-semibold disabled:opacity-50 pwa-card active:bg-slate-700/50 transition-all"
                    >
                        {loading ? 'Loading...' : 'Load More Orders'}
                    </button>
                )}
            </div>
        </div>
    );
}
