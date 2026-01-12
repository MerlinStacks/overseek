import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import {
    Search,
    ChevronRight,
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

interface Order {
    id: string;
    orderNumber: string;
    customerName: string;
    total: number;
    status: string;
    createdAt: string;
    itemCount: number;
}

const STATUS_CONFIG: Record<string, { icon: typeof Package; color: string; bg: string; label: string }> = {
    pending: { icon: Clock, color: 'text-amber-600', bg: 'bg-amber-100', label: 'Pending' },
    processing: { icon: Package, color: 'text-blue-600', bg: 'bg-blue-100', label: 'Processing' },
    shipped: { icon: Truck, color: 'text-purple-600', bg: 'bg-purple-100', label: 'Shipped' },
    delivered: { icon: CheckCircle, color: 'text-emerald-600', bg: 'bg-emerald-100', label: 'Delivered' },
    completed: { icon: CheckCircle, color: 'text-emerald-600', bg: 'bg-emerald-100', label: 'Completed' },
    cancelled: { icon: XCircle, color: 'text-red-600', bg: 'bg-red-100', label: 'Cancelled' },
    refunded: { icon: RefreshCw, color: 'text-gray-600', bg: 'bg-gray-100', label: 'Refunded' },
};

const FILTER_OPTIONS = ['All', 'Pending', 'Processing', 'Shipped', 'Completed'];

export function MobileOrders() {
    const navigate = useNavigate();
    const { token } = useAuth();
    const { currentAccount } = useAccount();
    const [orders, setOrders] = useState<Order[]>([]);
    const [loading, setLoading] = useState(true);
    const [searchQuery, setSearchQuery] = useState('');
    const [activeFilter, setActiveFilter] = useState('All');
    const [hasMore, setHasMore] = useState(true);
    const [page, setPage] = useState(1);

    useEffect(() => {
        fetchOrders(true);
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
            const newOrders = (data.orders || data || []).map((o: any) => ({
                id: o.id,
                orderNumber: o.orderNumber || `#${String(o.id).slice(-6).toUpperCase()}`,
                customerName: o.billing?.first_name
                    ? `${o.billing.first_name} ${o.billing.last_name || ''}`.trim()
                    : o.billing?.email || 'Guest',
                total: o.total || 0,
                status: o.status || 'pending',
                createdAt: o.date_created || o.createdAt,
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
            console.error('[MobileOrders] Error fetching orders:', error);
        } finally {
            setLoading(false);
        }
    };

    const handleSearch = (e: React.FormEvent) => {
        e.preventDefault();
        fetchOrders(true);
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

    const formatCurrency = (amount: number) => {
        return new Intl.NumberFormat('en-AU', {
            style: 'currency',
            currency: 'AUD',
            minimumFractionDigits: 0,
            maximumFractionDigits: 0
        }).format(amount);
    };

    const getStatusConfig = (status: string) => {
        return STATUS_CONFIG[status.toLowerCase()] || STATUS_CONFIG.pending;
    };

    if (loading && orders.length === 0) {
        return (
            <div className="space-y-4 animate-pulse">
                <div className="h-8 bg-gray-200 rounded w-24" />
                <div className="h-12 bg-gray-200 rounded-2xl" />
                <div className="flex gap-2">
                    {[...Array(4)].map((_, i) => (
                        <div key={i} className="h-10 w-24 bg-gray-200 rounded-full flex-shrink-0" />
                    ))}
                </div>
                {[...Array(5)].map((_, i) => (
                    <div key={i} className="h-24 bg-gray-200 rounded-2xl" />
                ))}
            </div>
        );
    }

    return (
        <div className="space-y-4">
            {/* Header */}
            <div className="flex items-center justify-between">
                <h1 className="text-2xl font-bold text-gray-900">Orders</h1>
                <span className="text-sm text-gray-500">{orders.length} orders</span>
            </div>

            {/* Search */}
            <form onSubmit={handleSearch} className="relative">
                <Search className="absolute left-4 top-1/2 -translate-y-1/2 text-gray-400" size={20} />
                <input
                    type="text"
                    placeholder="Search by order # or customer..."
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    className="w-full pl-12 pr-4 py-3.5 bg-white border border-gray-200 rounded-2xl focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent text-base"
                />
            </form>

            {/* Filter Chips */}
            <div className="flex gap-2 overflow-x-auto pb-1 -mx-4 px-4 scrollbar-hide">
                {FILTER_OPTIONS.map((filter) => {
                    const filterConfig = filter !== 'All' ? getStatusConfig(filter) : null;
                    return (
                        <button
                            key={filter}
                            onClick={() => setActiveFilter(filter)}
                            className={`
                                px-4 py-2.5 rounded-full text-sm font-semibold whitespace-nowrap transition-all flex items-center gap-2
                                ${activeFilter === filter
                                    ? 'bg-indigo-600 text-white shadow-lg shadow-indigo-200'
                                    : 'bg-white text-gray-700 border border-gray-200 active:bg-gray-50'
                                }
                            `}
                        >
                            {filterConfig && <filterConfig.icon size={14} />}
                            {filter}
                        </button>
                    );
                })}
            </div>

            {/* Orders List */}
            <div className="space-y-3">
                {orders.length === 0 ? (
                    <div className="text-center py-16">
                        <div className="w-20 h-20 mx-auto mb-4 bg-gray-100 rounded-full flex items-center justify-center">
                            <ShoppingBag className="text-gray-400" size={36} />
                        </div>
                        <p className="text-gray-900 font-semibold mb-1">No orders found</p>
                        <p className="text-gray-500 text-sm">Orders will appear here</p>
                    </div>
                ) : (
                    orders.map((order) => {
                        const config = getStatusConfig(order.status);
                        const StatusIcon = config.icon;

                        return (
                            <button
                                key={order.id}
                                onClick={() => navigate(`/m/orders/${order.id}`)}
                                className="w-full bg-white rounded-2xl p-4 shadow-sm border border-gray-100 active:scale-[0.98] transition-all"
                            >
                                <div className="flex items-start justify-between mb-3">
                                    <div>
                                        <p className="text-lg font-bold text-gray-900">{order.orderNumber}</p>
                                        <p className="text-sm text-gray-500">{order.customerName}</p>
                                    </div>
                                    <span className="text-xs text-gray-500">{formatDate(order.createdAt)}</span>
                                </div>

                                <div className="flex items-center justify-between">
                                    <p className="text-xl font-bold text-gray-900">{formatCurrency(order.total)}</p>
                                    <div className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full ${config.bg}`}>
                                        <StatusIcon size={14} className={config.color} />
                                        <span className={`text-sm font-semibold ${config.color}`}>
                                            {config.label}
                                        </span>
                                    </div>
                                </div>

                                {order.itemCount > 0 && (
                                    <p className="text-xs text-gray-500 mt-2">
                                        {order.itemCount} item{order.itemCount > 1 ? 's' : ''}
                                    </p>
                                )}
                            </button>
                        );
                    })
                )}

                {/* Load More */}
                {hasMore && orders.length > 0 && (
                    <button
                        onClick={() => fetchOrders()}
                        disabled={loading}
                        className="w-full py-4 text-indigo-600 font-semibold disabled:opacity-50 bg-white rounded-2xl border border-gray-100 active:bg-gray-50"
                    >
                        {loading ? 'Loading...' : 'Load More Orders'}
                    </button>
                )}
            </div>
        </div>
    );
}
