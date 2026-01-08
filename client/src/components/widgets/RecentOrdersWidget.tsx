import { WidgetProps } from './WidgetRegistry';
import { ShoppingBag, Loader2 } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext';
import { useAccount } from '../../context/AccountContext';

export function RecentOrdersWidget({ className }: WidgetProps) {
    const { token } = useAuth();
    const { currentAccount } = useAccount();
    const [orders, setOrders] = useState<any[]>([]);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        if (!currentAccount) return;

        fetch('/api/analytics/recent-orders', {
            headers: { 'Authorization': `Bearer ${token}`, 'X-Account-ID': currentAccount.id }
        })
            .then(res => res.json())
            .then(data => setOrders(Array.isArray(data) ? data : []))
            .catch(console.error)
            .finally(() => setLoading(false));
    }, [currentAccount, token]);

    return (
        <div className={`bg-white h-full w-full p-4 flex flex-col rounded-xl shadow-sm border border-gray-200 overflow-hidden ${className}`}>
            <div className="flex justify-between items-center mb-4">
                <h3 className="font-semibold text-gray-900">Recent Orders</h3>
                <ShoppingBag size={18} className="text-gray-400" />
            </div>

            <div className="flex-1 overflow-y-auto space-y-3">
                {loading ? (
                    <div className="flex justify-center p-4"><Loader2 className="animate-spin text-gray-400" /></div>
                ) : orders.length === 0 ? (
                    <div className="text-center text-gray-400 py-4 text-sm">No recent orders</div>
                ) : (
                    orders.map(order => (
                        <div key={order.id} className="flex justify-between items-center text-sm p-2 hover:bg-gray-50 rounded-lg transition-colors cursor-pointer">
                            <div>
                                <p className="text-xs text-gray-500 mb-0.5">#{order.id}</p>
                                {order.customer_id && order.customer_id > 0 ? (
                                    <Link to={`/customers/${order.customer_id}`} className="font-medium text-gray-900 hover:text-blue-600">
                                        {order.billing?.first_name || 'Guest'} {order.billing?.last_name}
                                    </Link>
                                ) : (
                                    <p className="font-medium text-gray-900">{order.billing?.first_name || 'Guest'} {order.billing?.last_name}</p>
                                )}
                                <p className="text-xs text-gray-500">{order.line_items?.length || 0} items</p>
                            </div>
                            <span className="font-medium text-gray-900">
                                {new Intl.NumberFormat('en-US', { style: 'currency', currency: order.currency || 'USD' }).format(order.total)}
                            </span>
                        </div>
                    ))
                )}
            </div>
        </div>
    );
}
