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
    RefreshCw
} from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import { useAccount } from '../../context/AccountContext';

/**
 * MobileOrders - Order management optimized for mobile.
 * 
 * Features:
 * - Search and filter
 * - Status badges
 * - Tap to view details
 * - Pull-to-refresh (handled by MobileLayout)
 */

interface Order {
    id: string;
    orderNumber: string;
    customerName: string;
    total: number;
    status: string;
    createdAt: string;
    itemCount: number;
}

const STATUS_CONFIG: Record<string, { icon: typeof Package; color: string; bg: string }> = {
    pending: { icon: Clock, color: 'text-yellow-600', bg: 'bg-yellow-100' },
    processing: { icon: Package, color: 'text-blue-600', bg: 'bg-blue-100' },
    shipped: { icon: Truck, color: 'text-purple-600', bg: 'bg-purple-100' },
    delivered: { icon: CheckCircle, color: 'text-green-600', bg: 'bg-green-100' },
    completed: { icon: CheckCircle, color: 'text-green-600', bg: 'bg-green-100' },
    cancelled: { icon: XCircle, color: 'text-red-600', bg: 'bg-red-100' },
    refunded: { icon: RefreshCw, color: 'text-gray-600', bg: 'bg-gray-100' },
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
        if (!currentAccount || !token) return;

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

        if (isToday) {
            return d.toLocaleTimeString('en-AU', { hour: 'numeric', minute: '2-digit' });
        }
        return d.toLocaleDateString('en-AU', { day: 'numeric', month: 'short' });
    };

    const formatCurrency = (amount: number) => {
        return new Intl.NumberFormat('en-AU', {
            style: 'currency',
            currency: 'AUD'
        }).format(amount);
    };

    const getStatusConfig = (status: string) => {
        return STATUS_CONFIG[status.toLowerCase()] || STATUS_CONFIG.pending;
    };

    if (loading && orders.length === 0) {
        return (
            <div className="space-y-4 animate-pulse">
                <div className="h-10 bg-gray-200 rounded-lg" />
                <div className="flex gap-2 overflow-x-auto">
                    {[...Array(4)].map((_, i) => (
                        <div key={i} className="h-8 w-20 bg-gray-200 rounded-full flex-shrink-0" />
                    ))}
                </div>
                {[...Array(5)].map((_, i) => (
                    <div key={i} className="h-20 bg-gray-200 rounded-xl" />
                ))}
            </div>
        );
    }

    return (
        <div className="space-y-4">
            {/* Header */}
            <h1 className="text-2xl font-bold text-gray-900">Orders</h1>

            {/* Search */}
            <form onSubmit={handleSearch} className="relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" size={20} />
                <input
                    type="text"
                    placeholder="Search orders..."
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    className="w-full pl-10 pr-4 py-3 bg-white border border-gray-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent"
                />
            </form>

            {/* Filter Chips */}
            <div className="flex gap-2 overflow-x-auto pb-2 -mx-4 px-4 scrollbar-hide">
                {FILTER_OPTIONS.map((filter) => (
                    <button
                        key={filter}
                        onClick={() => setActiveFilter(filter)}
                        className={`
                            px-4 py-2 rounded-full text-sm font-medium whitespace-nowrap transition-colors
                            ${activeFilter === filter
                                ? 'bg-indigo-600 text-white'
                                : 'bg-gray-100 text-gray-700 active:bg-gray-200'
                            }
                        `}
                    >
                        {filter}
                    </button>
                ))}
            </div>

            {/* Orders List */}
            <div className="space-y-3">
                {orders.length === 0 ? (
                    <div className="text-center py-12">
                        <Package className="mx-auto text-gray-300 mb-4" size={48} />
                        <p className="text-gray-500">No orders found</p>
                    </div>
                ) : (
                    orders.map((order) => {
                        const config = getStatusConfig(order.status);
                        const StatusIcon = config.icon;

                        return (
                            <button
                                key={order.id}
                                onClick={() => navigate(`/m/orders/${order.id}`)}
                                className="w-full bg-white rounded-xl p-4 shadow-sm border border-gray-100 flex items-center gap-4 active:bg-gray-50 transition-colors"
                            >
                                <div className={`p-2 rounded-lg ${config.bg}`}>
                                    <StatusIcon size={20} className={config.color} />
                                </div>
                                <div className="flex-1 min-w-0 text-left">
                                    <div className="flex items-center justify-between mb-1">
                                        <span className="font-semibold text-gray-900">
                                            {order.orderNumber}
                                        </span>
                                        <span className="text-sm text-gray-500">
                                            {formatDate(order.createdAt)}
                                        </span>
                                    </div>
                                    <p className="text-sm text-gray-600 truncate">
                                        {order.customerName}
                                    </p>
                                    <div className="flex items-center justify-between mt-1">
                                        <span className="text-sm font-medium text-gray-900">
                                            {formatCurrency(order.total)}
                                        </span>
                                        <span className={`text-xs font-medium capitalize ${config.color}`}>
                                            {order.status}
                                        </span>
                                    </div>
                                </div>
                                <ChevronRight size={20} className="text-gray-400 flex-shrink-0" />
                            </button>
                        );
                    })
                )}

                {/* Load More */}
                {hasMore && orders.length > 0 && (
                    <button
                        onClick={() => fetchOrders()}
                        disabled={loading}
                        className="w-full py-3 text-indigo-600 font-medium disabled:opacity-50"
                    >
                        {loading ? 'Loading...' : 'Load More'}
                    </button>
                )}
            </div>
        </div>
    );
}
