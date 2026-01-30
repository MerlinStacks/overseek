import { WidgetProps } from './WidgetRegistry';
import { Logger } from '../../utils/logger';
import { formatCurrency } from '../../utils/format';
import { ShoppingBag, Loader2 } from 'lucide-react';
import { useEffect, useState, useCallback } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext';
import { useAccount } from '../../context/AccountContext';
import { useWidgetSocket } from '../../hooks/useWidgetSocket';

export function RecentOrdersWidget({ className }: WidgetProps) {
    const { token } = useAuth();
    const { currentAccount } = useAccount();
    const [orders, setOrders] = useState<any[]>([]);
    const [loading, setLoading] = useState(true);
    const [newOrderId, setNewOrderId] = useState<string | null>(null);

    const fetchOrders = useCallback(() => {
        if (!currentAccount || !token) return;

        fetch('/api/analytics/recent-orders', {
            headers: { 'Authorization': `Bearer ${token}`, 'X-Account-ID': currentAccount.id }
        })
            .then(res => res.json())
            .then(data => setOrders(Array.isArray(data) ? data : []))
            .catch(e => Logger.error('Failed to fetch orders', { error: e }))
            .finally(() => setLoading(false));
    }, [currentAccount, token]);

    useEffect(() => {
        fetchOrders();
    }, [fetchOrders]);

    // Real-time: Prepend new orders
    useWidgetSocket<any>('order:new', (data) => {
        if (data?.order) {
            setOrders(prev => [data.order, ...prev.slice(0, 9)]); // Keep max 10
            setNewOrderId(data.order.id);
            setTimeout(() => setNewOrderId(null), 3000);
        }
    });


    return (
        <div className={`bg-white dark:bg-slate-800/90 h-full w-full p-5 flex flex-col rounded-2xl shadow-[0_1px_3px_rgba(0,0,0,0.05),0_1px_2px_rgba(0,0,0,0.03)] dark:shadow-[0_1px_3px_rgba(0,0,0,0.2)] border border-slate-200/80 dark:border-slate-700/50 overflow-hidden transition-all duration-300 hover:shadow-[0_10px_40px_rgba(0,0,0,0.08)] dark:hover:shadow-[0_10px_40px_rgba(0,0,0,0.3)] ${className}`}>
            <div className="flex justify-between items-center mb-4">
                <h3 className="font-semibold text-slate-900 dark:text-white">Recent Orders</h3>
                <div className="p-2 bg-gradient-to-br from-amber-400 to-orange-500 rounded-lg text-white shadow-md shadow-amber-500/20">
                    <ShoppingBag size={16} />
                </div>
            </div>

            <div className="flex-1 overflow-y-auto space-y-2">
                {loading ? (
                    <div className="flex justify-center p-4"><Loader2 className="animate-spin text-slate-400" /></div>
                ) : orders.length === 0 ? (
                    <div className="text-center text-slate-400 dark:text-slate-500 py-4 text-sm">No recent orders</div>
                ) : (
                    orders.map(order => (
                        <div key={order.id} className={`flex justify-between items-center text-sm p-3 hover:bg-slate-50 dark:hover:bg-slate-700/50 rounded-xl transition-all duration-200 cursor-pointer ${order.id === newOrderId ? 'bg-emerald-50 dark:bg-emerald-500/10 ring-1 ring-emerald-200 dark:ring-emerald-500/30 animate-pulse' : ''}`}>
                            <div>
                                <p className="text-xs text-slate-400 dark:text-slate-500 mb-0.5 font-mono">#{order.id}</p>
                                {order.customer_id && order.customer_id > 0 ? (
                                    <Link to={`/customers/${order.customer_id}`} className="font-medium text-slate-900 dark:text-white hover:text-blue-600 dark:hover:text-blue-400 transition-colors">
                                        {order.billing?.first_name || 'Guest'} {order.billing?.last_name}
                                    </Link>
                                ) : (
                                    <p className="font-medium text-slate-900 dark:text-white">{order.billing?.first_name || 'Guest'} {order.billing?.last_name}</p>
                                )}
                                <p className="text-xs text-slate-400 dark:text-slate-500">{order.line_items?.length || 0} items</p>
                            </div>
                            <span className="font-semibold text-slate-900 dark:text-white">
                                {formatCurrency(order.total, order.currency || 'USD')}
                            </span>
                        </div>
                    ))
                )}
            </div>
        </div>
    );
}
