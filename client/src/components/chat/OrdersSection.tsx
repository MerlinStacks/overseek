/**
 * OrdersSection - Recent orders display component
 * 
 * Extracted from ContactPanel.tsx for improved modularity.
 * Displays customer orders with status badges and links.
 */

import { Package, ExternalLink } from 'lucide-react';
import { cn } from '../../utils/cn';
import { format } from 'date-fns';

interface Order {
    id: string;
    wooId: number;
    number: string;
    status: string;
    total: number;
    currency: string;
    dateCreated: string;
}

interface OrdersSectionProps {
    orders: Order[];
    isLoading: boolean;
    customerId?: string;
    ordersCount?: number;
}

/**
 * Returns appropriate color classes for order status
 */
function getOrderStatusColor(status: string) {
    switch (status.toLowerCase()) {
        case 'completed': return 'bg-green-100 text-green-700';
        case 'processing': return 'bg-blue-100 text-blue-700';
        case 'on-hold': return 'bg-yellow-100 text-yellow-700';
        case 'cancelled':
        case 'refunded': return 'bg-red-100 text-red-700';
        default: return 'bg-gray-100 text-gray-700';
    }
}

/**
 * Displays recent orders for a customer with status and totals.
 */
export function OrdersSection({ orders, isLoading, customerId, ordersCount }: OrdersSectionProps) {
    if (isLoading) {
        return <div className="text-sm text-gray-500 italic">Loading orders...</div>;
    }

    if (orders.length === 0) {
        return <div className="text-sm text-gray-500 italic">No orders found.</div>;
    }

    return (
        <div className="space-y-2">
            {orders.map((order) => (
                <a
                    key={order.id}
                    href={`/orders/${order.id}`}
                    className="block p-2 bg-gray-50 rounded-lg hover:bg-gray-100 transition-colors"
                >
                    <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2">
                            <Package size={14} className="text-gray-400" />
                            <span className="text-sm font-medium text-gray-900">#{order.number}</span>
                        </div>
                        <span className={cn(
                            "px-1.5 py-0.5 rounded text-[10px] font-medium uppercase",
                            getOrderStatusColor(order.status)
                        )}>
                            {order.status}
                        </span>
                    </div>
                    <div className="flex items-center justify-between mt-1">
                        <span className="text-xs text-gray-500">
                            {format(new Date(order.dateCreated), 'MMM d, yyyy')}
                        </span>
                        <span className="text-xs font-medium text-gray-700">
                            {order.currency} {Number(order.total).toFixed(2)}
                        </span>
                    </div>
                </a>
            ))}
            {customerId && ordersCount && ordersCount > 5 && (
                <a
                    href={`/customers/${customerId}`}
                    className="flex items-center justify-center gap-1 text-xs text-blue-600 hover:underline mt-2"
                >
                    View all {ordersCount} orders
                    <ExternalLink size={10} />
                </a>
            )}
        </div>
    );
}
