import { Link } from 'react-router-dom';
import { formatDateSafe } from '../../utils/format';
import { reportMoney } from '../analytics/useReportRequest';
import { isRecord } from '../../utils/responseValidation';

interface Order { id: string; wooId: number; number: string; status: string; total: number; currency: string; dateCreated: string }
interface Props { orders: Order[]; isLoading: boolean; customerId?: string; ordersCount?: number; accountCurrency?: string }
function orderMoney(value: unknown, currency?: string) {
    const amount = typeof value === 'number' ? value : typeof value === 'string' && /^-?\d+(?:\.\d+)?$/.test(value.trim()) ? Number(value) : NaN;
    return Number.isFinite(amount) ? reportMoney(amount, currency) : 'Total unavailable';
}
export function OrdersSection({ orders, isLoading, customerId, ordersCount, accountCurrency }: Props) {
    if (isLoading) return <p role="status" className="text-sm text-slate-500 dark:text-slate-400">Loading orders...</p>;
    if (!Array.isArray(orders) || !orders.every(order => isRecord(order) && typeof order.id === 'string' && typeof order.number === 'string' && typeof order.status === 'string')) return <p role="alert">Order details unavailable.</p>;
    if (!orders.length) return <p className="text-sm text-slate-500 dark:text-slate-400">No orders found.</p>;
    return <div className="space-y-2"><ul className="space-y-2">{orders.map(order => <li key={order.id}><Link to={`/orders/${encodeURIComponent(order.id)}`} className="block p-3 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-slate-900 dark:text-slate-100 hover:border-indigo-400">
        <div className="flex justify-between gap-3"><span className="font-medium">#{order.number}</span><span className="text-xs uppercase">{order.status || 'Status unavailable'}</span></div>
        <div className="flex justify-between gap-3 text-xs mt-1"><span>{formatDateSafe(typeof order.dateCreated === 'string' ? order.dateCreated : undefined, 'Date unavailable')}</span><span>{orderMoney(order.total, typeof order.currency === 'string' ? order.currency || accountCurrency : order.currency == null ? accountCurrency : undefined)}</span></div>
    </Link></li>)}</ul>{customerId && typeof ordersCount === 'number' && Number.isSafeInteger(ordersCount) && ordersCount > orders.length && <Link to={`/customers/${encodeURIComponent(customerId)}`} className="block text-xs text-indigo-600 dark:text-indigo-400">View all {ordersCount} orders</Link>}</div>;
}
