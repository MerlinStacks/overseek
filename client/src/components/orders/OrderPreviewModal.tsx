import { useNavigate } from 'react-router-dom';
import { Modal } from '../ui/Modal';
import { useAuth } from '../../context/AuthContext';
import { useAccount } from '../../context/AccountContext';
import { useScopedRequest } from '../../hooks/useScopedRequest';
import { isRecord } from '../../utils/responseValidation';
import { formatDateSafe } from '../../utils/format';
import { reportMoney } from '../analytics/useReportRequest';
import { getStatusBadgeClasses } from '../../utils/orderStatus';

interface Props { orderId: number | null; isOpen: boolean; onClose: () => void }
interface Item { id: number | string; name: string; quantity: number; price: number; total: number }
interface Order { status: string; date_created: string; currency?: string; billing?: { first_name?: string; last_name?: string; email?: string }; line_items?: Item[]; total: number }
function numberValue(value: unknown): number {
    if (typeof value !== 'number' && (typeof value !== 'string' || !/^-?\d+(?:\.\d+)?$/.test(value.trim()))) throw new Error('Invalid order amount');
    const result = Number(value); if (!Number.isFinite(result)) throw new Error('Invalid order amount'); return result;
}
function decodeOrder(value: unknown): Order {
    if (!isRecord(value) || typeof value.status !== 'string' || typeof value.date_created !== 'string' || (value.currency != null && (typeof value.currency !== 'string' || !/^[A-Z]{3}$/i.test(value.currency))) || (value.billing != null && (!isRecord(value.billing) || !['first_name', 'last_name', 'email'].every(key => value.billing && ((value.billing as Record<string, unknown>)[key] == null || typeof (value.billing as Record<string, unknown>)[key] === 'string')))) || (value.line_items != null && !Array.isArray(value.line_items))) throw new Error('Invalid order response');
    const items = (value.line_items ?? []) as unknown[];
    const line_items = items.map(item => {
        if (!isRecord(item) || !['string', 'number'].includes(typeof item.id) || typeof item.name !== 'string' || typeof item.quantity !== 'number' || !Number.isFinite(item.quantity)) throw new Error('Invalid order item');
        return { id: item.id, name: item.name, quantity: item.quantity, price: numberValue(item.price), total: numberValue(item.total) } as Item;
    });
    return { ...value, total: numberValue(value.total), line_items } as unknown as Order;
}
export function OrderPreviewModal({ isOpen, orderId, onClose }: Props) {
    const { token } = useAuth(); const { currentAccount } = useAccount();
    if (!isOpen) return null;
    return <Modal isOpen onClose={onClose} title={`Order #${orderId ?? 'unavailable'}`} maxWidth="max-w-lg">
        {token && currentAccount && orderId ? <OrderPreview key={JSON.stringify([token, currentAccount.id, orderId])} orderId={orderId} token={token} accountId={currentAccount.id} onClose={onClose} /> : <p role="status">Select an account and order to preview.</p>}
    </Modal>;
}
function OrderPreview({ orderId, token, accountId, onClose }: { orderId: number; token: string; accountId: string; onClose: () => void }) {
    const navigate = useNavigate(); const { data, loading, error, retry } = useScopedRequest(`/api/orders/${orderId}`, accountId, token, decodeOrder);
    const money = (amount: number) => reportMoney(amount, data?.currency);
    return <div className="space-y-4 text-slate-900 dark:text-slate-100">
        {loading ? <p role="status">Loading order details...</p> : error || !data ? <p role="alert">Could not load order data. <button type="button" onClick={retry}>Retry order preview</button></p> : <>
            <div className="flex flex-wrap items-center justify-between gap-3"><span className={`rounded-full border px-2.5 py-1 text-xs font-semibold capitalize ${getStatusBadgeClasses(data.status)}`}>{data.status}</span><span className="text-xs text-slate-500 dark:text-slate-400">{formatDateSafe(data.date_created, 'Date unavailable')}</span></div>
            <div className="p-4 rounded-lg bg-slate-100 dark:bg-slate-900"><p className="font-medium">{data.billing?.first_name} {data.billing?.last_name}</p><p className="text-sm break-all">{data.billing?.email}</p></div>
            <h3 className="font-semibold">Order Items</h3><ul className="divide-y divide-slate-100 dark:divide-slate-700">{data.line_items?.map(item => <li key={item.id} className="flex items-start justify-between gap-3 py-3 text-sm"><div className="min-w-0 flex-1 break-words font-medium">{item.name}<p className="text-xs font-normal text-slate-500 dark:text-slate-400">{item.quantity} × {money(item.price)}</p></div><span className="shrink-0 font-medium tabular-nums">{money(item.total)}</span></li>)}</ul>
            <div className="flex justify-between font-semibold border-t border-slate-200 dark:border-slate-700 pt-3"><span>Total</span><span>{money(data.total)}</span></div>
        </>}
        <div className="flex flex-wrap justify-end gap-3 border-t border-slate-100 pt-4 dark:border-slate-700"><button type="button" onClick={onClose} className="rounded-lg border border-slate-200 px-4 py-2 text-sm font-medium transition-colors hover:bg-slate-50 focus-visible:outline-2 focus-visible:outline-[var(--focus-color)] dark:border-slate-600 dark:hover:bg-slate-700">Close preview</button><button type="button" onClick={() => { onClose(); navigate(`/orders/${orderId}`); }} className="rounded-lg bg-[var(--primary-color)] px-4 py-2 text-sm font-medium text-[var(--primary-foreground)] transition-colors hover:bg-[var(--primary-hover)] focus-visible:outline-2 focus-visible:outline-[var(--focus-color)]">View Full Details</button></div>
    </div>;
}
