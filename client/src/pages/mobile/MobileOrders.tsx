import { useState, useEffect, useCallback, useRef, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import {
    AlertTriangle,
    CheckCircle,
    ChevronRight,
    Clock,
    Package,
    RefreshCw,
    Search,
    ShoppingBag,
    Truck,
    XCircle,
    type LucideIcon,
} from 'lucide-react';
import { Logger } from '../../utils/logger';
import { useAuth } from '../../context/AuthContext';
import { useAccount } from '../../context/AccountContext';
import { useToast } from '../../context/ToastContext';
import { useHaptic } from '../../hooks/useHaptic';
import { formatCurrency } from '../../utils/format';
import { OrdersSkeleton } from '../../components/mobile/MobileSkeleton';
import { subscribeToCrossTabEvents } from '../../utils/productCrossTabEvents';

interface OrderApiResponse {
    id: string | number;
    orderNumber?: string;
    billing?: { first_name?: string; last_name?: string; email?: string };
    total?: number | string;
    status?: string;
    date_created?: string;
    createdAt?: string;
    line_items?: Array<{ name?: string; quantity?: number }>;
    tags?: string[];
}

interface OrdersSearchResponse {
    orders?: OrderApiResponse[];
    total?: number;
}

interface StatusCountsResponse {
    total: number;
    counts: Record<string, number>;
}

interface Order {
    id: string;
    orderNumber: string;
    customerName: string;
    customerEmail: string;
    total: number;
    status: string;
    createdAt: string;
    itemCount: number;
    itemSummary: string;
    tags: string[];
}

interface StatusConfig {
    icon: LucideIcon;
    color: string;
    bg: string;
    ring: string;
    label: string;
    next?: string;
}

const PAGE_SIZE = 20;

const STATUS_CONFIG: Record<string, StatusConfig> = {
    pending: { icon: Clock, color: 'text-amber-200', bg: 'bg-amber-500/15', ring: 'ring-amber-400/20', label: 'Pending', next: 'processing' },
    processing: { icon: Package, color: 'text-sky-200', bg: 'bg-sky-500/15', ring: 'ring-sky-400/20', label: 'Processing', next: 'shipped' },
    'on-hold': { icon: AlertTriangle, color: 'text-orange-200', bg: 'bg-orange-500/15', ring: 'ring-orange-400/20', label: 'On hold', next: 'processing' },
    shipped: { icon: Truck, color: 'text-violet-200', bg: 'bg-violet-500/15', ring: 'ring-violet-400/20', label: 'Shipped', next: 'completed' },
    delivered: { icon: CheckCircle, color: 'text-emerald-200', bg: 'bg-emerald-500/15', ring: 'ring-emerald-400/20', label: 'Delivered' },
    completed: { icon: CheckCircle, color: 'text-emerald-200', bg: 'bg-emerald-500/15', ring: 'ring-emerald-400/20', label: 'Completed' },
    cancelled: { icon: XCircle, color: 'text-rose-200', bg: 'bg-rose-500/15', ring: 'ring-rose-400/20', label: 'Cancelled' },
    refunded: { icon: RefreshCw, color: 'text-slate-200', bg: 'bg-slate-500/15', ring: 'ring-slate-400/20', label: 'Refunded' },
    failed: { icon: XCircle, color: 'text-rose-200', bg: 'bg-rose-500/15', ring: 'ring-rose-400/20', label: 'Failed' },
};

const VIEWS = [
    { label: 'Command', status: 'all', hint: 'Everything live' },
    { label: 'To Pack', status: 'processing', hint: 'Needs fulfilment' },
    { label: 'Payment', status: 'pending', hint: 'Waiting' },
    { label: 'On Hold', status: 'on-hold', hint: 'Blocked' },
    { label: 'Done', status: 'completed', hint: 'Closed' },
] as const;

export function MobileOrders() {
    const navigate = useNavigate();
    const { token } = useAuth();
    const { currentAccount } = useAccount();
    const toast = useToast();
    const { triggerHaptic } = useHaptic();
    const [orders, setOrders] = useState<Order[]>([]);
    const [statusCounts, setStatusCounts] = useState<StatusCountsResponse | null>(null);
    const [loading, setLoading] = useState(true);
    const [searchQuery, setSearchQuery] = useState('');
    const [activeStatus, setActiveStatus] = useState('all');
    const [page, setPage] = useState(1);
    const [hasMore, setHasMore] = useState(true);
    const ordersAbortRef = useRef<AbortController | null>(null);
    const countsAbortRef = useRef<AbortController | null>(null);
    const ordersRequestIdRef = useRef(0);
    const countsRequestIdRef = useRef(0);

    const activeView = VIEWS.find((view) => view.status === activeStatus) || VIEWS[0];
    const getStatusConfig = useCallback((status: string) => STATUS_CONFIG[status.toLowerCase()] || STATUS_CONFIG.pending, []);
    const formatAccountCurrency = useCallback(
        (amount: number) => formatCurrency(amount, currentAccount?.currency || 'USD', { minimumFractionDigits: 0, maximumFractionDigits: 0 }),
        [currentAccount?.currency]
    );

    const fetchStatusCounts = useCallback(async () => {
        if (!currentAccount || !token) return;

        countsAbortRef.current?.abort();
        const controller = new AbortController();
        countsAbortRef.current = controller;
        const requestId = ++countsRequestIdRef.current;

        try {
            const res = await fetch('/api/sync/orders/status-counts', {
                headers: { Authorization: `Bearer ${token}`, 'X-Account-ID': currentAccount.id },
                signal: controller.signal,
            });
            if (!res.ok) throw new Error('Failed to fetch status counts');
            const counts = await res.json() as Partial<StatusCountsResponse>;
            if (requestId !== countsRequestIdRef.current) return;
            setStatusCounts({ total: counts.total || 0, counts: counts.counts || {} });
        } catch (error) {
            if (error instanceof DOMException && error.name === 'AbortError') return;
            Logger.warn('[MobileOrders] Failed to fetch status counts', { error });
        }
    }, [currentAccount, token]);

    const fetchOrders = useCallback(async (targetPage: number, reset = false) => {
        if (!currentAccount || !token) {
            setLoading(false);
            return;
        }

        ordersAbortRef.current?.abort();
        const controller = new AbortController();
        ordersAbortRef.current = controller;
        const requestId = ++ordersRequestIdRef.current;

        try {
            if (reset) {
                setLoading(true);
                setPage(1);
            }

            const params = new URLSearchParams({ page: String(targetPage), limit: String(PAGE_SIZE) });
            if (activeStatus !== 'all') params.append('status', activeStatus);
            if (searchQuery.trim()) params.append('q', searchQuery.trim());

            const res = await fetch(`/api/sync/orders/search?${params}`, {
                headers: { Authorization: `Bearer ${token}`, 'X-Account-ID': currentAccount.id },
                signal: controller.signal,
            });
            if (!res.ok) throw new Error('Failed to fetch orders');

            const data = await res.json() as OrdersSearchResponse | OrderApiResponse[];
            if (requestId !== ordersRequestIdRef.current) return;
            const rawOrders = Array.isArray(data) ? data : data.orders || [];
            const responseTotal = Array.isArray(data) ? rawOrders.length : data.total;
            const nextTotal = responseTotal ?? ((targetPage - 1) * PAGE_SIZE + rawOrders.length);
            const newOrders = rawOrders.map((order): Order => {
                const lineItems = order.line_items || [];
                const firstItem = lineItems[0]?.name || '';
                const customerName = order.billing?.first_name
                    ? `${order.billing.first_name} ${order.billing.last_name || ''}`.trim()
                    : order.billing?.email || 'Guest';

                return {
                    id: String(order.id),
                    orderNumber: order.orderNumber || `#${String(order.id).slice(-6).toUpperCase()}`,
                    customerName,
                    customerEmail: order.billing?.email || '',
                    total: Number(order.total || 0),
                    status: order.status || 'pending',
                    createdAt: order.date_created || order.createdAt || '',
                    itemCount: lineItems.length,
                    itemSummary: firstItem ? `${firstItem}${lineItems.length > 1 ? ` +${lineItems.length - 1}` : ''}` : 'No line items',
                    tags: order.tags || [],
                };
            });

            setOrders(prev => reset ? newOrders : [...prev, ...newOrders]);
            setHasMore(targetPage * PAGE_SIZE < nextTotal);
            setPage(targetPage + 1);
        } catch (error) {
            if (error instanceof DOMException && error.name === 'AbortError') return;
            Logger.error('[MobileOrders] Error fetching orders:', { error });
            toast.error('Could not load orders.');
        } finally {
            if (requestId === ordersRequestIdRef.current) {
                setLoading(false);
            }
        }
    }, [activeStatus, currentAccount, searchQuery, toast, token]);

    useEffect(() => {
        void fetchOrders(1, true);
        void fetchStatusCounts();

        const handleRefresh = () => {
            void fetchOrders(1, true);
            void fetchStatusCounts();
        };

        window.addEventListener('mobile-refresh', handleRefresh);
        return () => window.removeEventListener('mobile-refresh', handleRefresh);
    }, [fetchOrders, fetchStatusCounts]);

    useEffect(() => {
        const unsubscribe = subscribeToCrossTabEvents((event) => {
            if (event.resource !== 'order' || event.accountId !== currentAccount?.id) return;
            void fetchOrders(1, true);
            void fetchStatusCounts();
        });
        return unsubscribe;
    }, [currentAccount?.id, fetchOrders, fetchStatusCounts]);

    useEffect(() => {
        return () => {
            ordersAbortRef.current?.abort();
            countsAbortRef.current?.abort();
        };
    }, []);

    const handleSearch = (event: FormEvent) => {
        event.preventDefault();
        triggerHaptic();
        void fetchOrders(1, true);
    };

    const handleViewChange = (status: string) => {
        triggerHaptic();
        setActiveStatus(status);
    };

    const formatDate = (date: string) => {
        if (!date) return 'No date';

        const d = new Date(date);
        const now = new Date();
        if (d.toDateString() === now.toDateString()) return d.toLocaleTimeString('en-AU', { hour: 'numeric', minute: '2-digit' });
        if (new Date(now.getTime() - 86400000).toDateString() === d.toDateString()) return 'Yesterday';
        return d.toLocaleDateString('en-AU', { day: 'numeric', month: 'short' });
    };

    const getOrderAge = (date: string) => {
        if (!date) return 'Unknown age';

        const hours = Math.max(0, Math.floor((Date.now() - new Date(date).getTime()) / 36e5));
        if (hours < 1) return 'Just now';
        if (hours < 24) return `${hours}h old`;
        return `${Math.floor(hours / 24)}d old`;
    };

    const getOrderSignal = (order: Order) => {
        const ageHours = order.createdAt ? (Date.now() - new Date(order.createdAt).getTime()) / 36e5 : 0;
        if (order.status === 'on-hold' || order.status === 'failed') return { label: 'Blocked', className: 'bg-orange-400/15 text-orange-100 ring-orange-300/20' };
        if (order.status === 'pending') return { label: 'Payment', className: 'bg-amber-400/15 text-amber-100 ring-amber-300/20' };
        if (order.status === 'processing' && ageHours > 48) return { label: 'Aging', className: 'bg-rose-400/15 text-rose-100 ring-rose-300/20' };
        if (order.total >= 500) return { label: 'High value', className: 'bg-emerald-400/15 text-emerald-100 ring-emerald-300/20' };
        return { label: 'On track', className: 'bg-slate-400/10 text-slate-200 ring-white/10' };
    };

    if (loading && orders.length === 0) return <OrdersSkeleton />;

    return (
        <div className="space-y-4 pb-28 animate-fade-slide-up">
            <form onSubmit={handleSearch} className="sticky top-2 z-10">
                <div className="relative rounded-2xl border border-white/10 bg-slate-950/90 shadow-xl shadow-black/20 backdrop-blur-xl">
                    <Search size={17} className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400" />
                    <input
                        type="search"
                        placeholder="Search order, customer, product..."
                        value={searchQuery}
                        onChange={(event) => setSearchQuery(event.target.value)}
                        className="w-full bg-transparent py-3.5 pl-11 pr-4 text-[15px] text-white placeholder-slate-500 outline-none"
                    />
                </div>
            </form>

            <div className="-mx-4 flex gap-2 overflow-x-auto px-4 pb-1 no-scrollbar">
                {VIEWS.map((view) => {
                    const count = view.status === 'all' ? statusCounts?.total : statusCounts?.counts?.[view.status];
                    const isActive = activeStatus === view.status;

                    return (
                        <button
                            key={view.status}
                            onClick={() => handleViewChange(view.status)}
                            className={`min-w-[116px] rounded-2xl px-3 py-3 text-left transition active:scale-95 ${isActive ? 'bg-white text-slate-950 shadow-lg' : 'bg-slate-900/80 text-slate-300 ring-1 ring-white/10'}`}
                        >
                            <span className="block text-sm font-black">{view.label}</span>
                            <span className={`mt-1 block text-xs ${isActive ? 'text-slate-500' : 'text-slate-500'}`}>{count?.toLocaleString() ?? '...'} · {view.hint}</span>
                        </button>
                    );
                })}
            </div>

            <div className="space-y-3">
                {orders.length === 0 ? (
                    <EmptyOrders activeView={activeView.label} />
                ) : (
                    orders.map((order, index) => (
                        <OrderRow
                            key={order.id}
                            order={order}
                            index={index}
                            getStatusConfig={getStatusConfig}
                            getOrderSignal={getOrderSignal}
                            formatAccountCurrency={formatAccountCurrency}
                            formatDate={formatDate}
                            getOrderAge={getOrderAge}
                            onOpen={() => {
                                triggerHaptic();
                                navigate(`/m/orders/${order.id}`);
                            }}
                        />
                    ))
                )}

                {hasMore && orders.length > 0 && (
                    <button
                        onClick={() => fetchOrders(page, false)}
                        disabled={loading}
                        className="w-full rounded-2xl border border-white/10 bg-slate-900 py-4 text-sm font-black text-indigo-200 disabled:opacity-50"
                    >
                        {loading ? 'Loading...' : 'Load more orders'}
                    </button>
                )}
            </div>
        </div>
    );
}

interface OrderRowProps {
    order: Order;
    index: number;
    getStatusConfig: (status: string) => StatusConfig;
    getOrderSignal: (order: Order) => { label: string; className: string };
    formatAccountCurrency: (amount: number) => string;
    formatDate: (date: string) => string;
    getOrderAge: (date: string) => string;
    onOpen: () => void;
}

function OrderRow({ order, index, getStatusConfig, getOrderSignal, formatAccountCurrency, formatDate, getOrderAge, onOpen }: OrderRowProps) {
    const config = getStatusConfig(order.status);
    const StatusIcon = config.icon;
    const signal = getOrderSignal(order);

    return (
        <button
            onClick={onOpen}
            className="w-full rounded-[1.5rem] border border-white/10 bg-slate-950 p-4 text-left shadow-lg shadow-black/20 transition active:scale-[0.99]"
            style={{ animationDelay: `${index * 12}ms` }}
        >
            <div className="flex items-start justify-between gap-3">
                <div className="flex min-w-0 gap-3">
                    <div className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl ${config.bg} ring-1 ${config.ring}`}>
                        <StatusIcon size={18} className={config.color} />
                    </div>
                    <div className="min-w-0">
                        <div className="flex items-center gap-2">
                            <p className="truncate text-base font-black text-white">{order.orderNumber}</p>
                            <span className={`rounded-full px-2 py-0.5 text-[10px] font-bold ring-1 ${signal.className}`}>{signal.label}</span>
                        </div>
                        <p className="mt-0.5 truncate text-sm text-slate-300">{order.customerName}</p>
                        <p className="mt-1 truncate text-xs text-slate-500">{order.itemSummary}</p>
                    </div>
                </div>
                <div className="shrink-0 text-right">
                    <p className="text-base font-black text-white">{formatAccountCurrency(order.total)}</p>
                    <p className="text-xs text-slate-500">{formatDate(order.createdAt)}</p>
                </div>
            </div>

            <div className="mt-4 flex items-center justify-between border-t border-white/5 pt-3">
                <div className="flex items-center gap-2">
                    <span className={`rounded-full px-2.5 py-1 text-xs font-bold ${config.bg} ${config.color}`}>{config.label}</span>
                    <span className="text-xs text-slate-500">{getOrderAge(order.createdAt)}</span>
                </div>
                <ChevronRight size={17} className="text-slate-600" />
            </div>
        </button>
    );
}

function EmptyOrders({ activeView }: { activeView: string }) {
    return (
        <div className="rounded-[2rem] border border-white/10 bg-slate-950 px-5 py-14 text-center">
            <div className="mx-auto mb-4 flex h-20 w-20 items-center justify-center rounded-3xl bg-white/[0.06]">
                <ShoppingBag className="text-slate-500" size={36} />
            </div>
            <p className="text-lg font-black text-white">No orders in {activeView}</p>
            <p className="mt-1 text-sm text-slate-400">Switch views or clear search to widen the list.</p>
        </div>
    );
}
