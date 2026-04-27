import { WidgetProps } from './WidgetRegistry';
import { Logger } from '../../utils/logger';
import { formatCurrency } from '../../utils/format';
import { RelativeTime } from '../ui/RelativeTime';
import { ShoppingBag } from 'lucide-react';
import { useEffect, useState, useCallback, useRef } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext';
import { useAccount } from '../../context/AccountContext';
import { useWidgetSocket } from '../../hooks/useWidgetSocket';
import { WidgetLoadingState, WidgetEmptyState, WidgetErrorState } from './WidgetState';
import { widgetCardClass, widgetTitleClass, widgetHeaderRowClass, widgetHeaderIconBadgeClass, widgetListRowClass } from './widgetStyles';

interface OrderLineItem {
    quantity?: number;
    name?: string;
}

interface OrderBilling {
    first_name?: string;
    last_name?: string;
}

interface RecentOrder {
    id: string;
    customer_id?: number;
    billing?: OrderBilling;
    line_items?: OrderLineItem[];
    date_created?: string;
    payment_method_title?: string;
    status?: string;
    total?: string | number;
    currency?: string;
}

interface OrderNewEventPayload {
    order?: RecentOrder;
}

function toNumericTotal(value: string | number | undefined): number {
    if (typeof value === 'number') return value;
    if (typeof value === 'string') {
        const parsed = Number(value);
        return Number.isFinite(parsed) ? parsed : 0;
    }
    return 0;
}

export function RecentOrdersWidget({ className }: WidgetProps) {
    const { token } = useAuth();
    const { currentAccount } = useAccount();
    const [orders, setOrders] = useState<RecentOrder[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [newOrderId, setNewOrderId] = useState<string | null>(null);
    const newOrderTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const fetchAbortRef = useRef<AbortController | null>(null);

    const fetchOrders = useCallback(async () => {
        if (!currentAccount || !token) return;

        fetchAbortRef.current?.abort();
        const controller = new AbortController();
        fetchAbortRef.current = controller;

        setLoading(true);
        try {
            const res = await fetch('/api/analytics/recent-orders', {
                headers: { 'Authorization': `Bearer ${token}`, 'X-Account-ID': currentAccount.id },
                signal: controller.signal
            });
            if (!res.ok) throw new Error(`HTTP ${res.status}`);
            const data = await res.json();
            if (controller.signal.aborted) return;

            setOrders(Array.isArray(data) ? data : []);
            setError(null);
        } catch (err) {
            if (err instanceof DOMException && err.name === 'AbortError') return;
            Logger.error('Failed to fetch orders', { error: err });
            setError('Failed to load recent orders');
        } finally {
            if (!controller.signal.aborted) {
                setLoading(false);
            }
        }
    }, [currentAccount, token]);

    useEffect(() => {
        fetchOrders();
        return () => {
            fetchAbortRef.current?.abort();
        };
    }, [fetchOrders]);

    useEffect(() => {
        return () => {
            if (newOrderTimeoutRef.current) {
                clearTimeout(newOrderTimeoutRef.current);
                newOrderTimeoutRef.current = null;
            }
        };
    }, []);

    // Real-time: prepend new orders.
    useWidgetSocket<OrderNewEventPayload>('order:new', (data) => {
        if (data?.order) {
            setOrders((prev) => [data.order as RecentOrder, ...prev.slice(0, 9)]);
            setNewOrderId(data.order.id);
            if (newOrderTimeoutRef.current) {
                clearTimeout(newOrderTimeoutRef.current);
            }
            newOrderTimeoutRef.current = setTimeout(() => setNewOrderId(null), 3000);
        }
    });

    return (
        <div className={`${widgetCardClass} h-full w-full p-5 flex flex-col overflow-hidden ${className || ''}`}>
            <div className={widgetHeaderRowClass}>
                <h3 className={widgetTitleClass}>Recent Orders</h3>
                <div className={`${widgetHeaderIconBadgeClass} bg-gradient-to-br from-amber-400 to-orange-500 shadow-amber-500/20`}>
                    <ShoppingBag size={16} />
                </div>
            </div>

            <div className="flex-1 overflow-y-auto space-y-2">
                {loading ? (
                    <WidgetLoadingState message="Loading orders..." />
                ) : error ? (
                    <WidgetErrorState message={error} onRetry={fetchOrders} />
                ) : orders.length === 0 ? (
                    <WidgetEmptyState message="No recent orders" />
                ) : (
                    orders.map((order) => (
                        <div key={order.id} className={`flex justify-between items-center text-sm ${widgetListRowClass} hover:bg-slate-50 dark:hover:bg-slate-700/50 cursor-pointer ${order.id === newOrderId ? 'bg-emerald-50 dark:bg-emerald-500/10 ring-1 ring-emerald-200 dark:ring-emerald-500/30 animate-pulse' : ''}`}>
                            <div>
                                <p className="text-xs text-slate-400 dark:text-slate-500 mb-0.5 font-mono">#{order.id}</p>
                                {order.customer_id && order.customer_id > 0 ? (
                                    <Link to={`/customers/${order.customer_id}`} className="font-medium text-slate-900 dark:text-white hover:text-blue-600 dark:hover:text-blue-400 transition-colors">
                                        {order.billing?.first_name || 'Guest'} {order.billing?.last_name}
                                    </Link>
                                ) : (
                                    <p className="font-medium text-slate-900 dark:text-white">{order.billing?.first_name || 'Guest'} {order.billing?.last_name}</p>
                                )}
                                <p className="text-xs text-slate-400 dark:text-slate-500">
                                    <span title={order.line_items?.map((i) => `${i.quantity || 0}x ${i.name || 'Item'}`).join('\n') || 'No items'} className="border-b border-dotted border-slate-300 dark:border-slate-600 cursor-default">
                                        {order.line_items?.length || 0} item{(order.line_items?.length || 0) !== 1 ? 's' : ''}
                                    </span>
                                    {order.date_created && <span className="ml-1.5">&middot; <RelativeTime date={order.date_created} className="text-xs text-slate-400 dark:text-slate-500" /></span>}
                                </p>
                            </div>
                            <span className="font-semibold text-slate-900 dark:text-white cursor-default" title={order.payment_method_title || order.status}>
                                {formatCurrency(toNumericTotal(order.total), order.currency || 'USD')}
                            </span>
                        </div>
                    ))
                )}
            </div>
        </div>
    );
}
