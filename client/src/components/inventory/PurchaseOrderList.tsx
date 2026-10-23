import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { CheckCircle2, Clock, ExternalLink, FileText, Loader2, Package, Plus, RefreshCw } from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import { useAccount } from '../../context/AccountContext';
import { usePermissions } from '../../hooks/usePermissions';
import { useScopedRequest } from '../../hooks/useScopedRequest';
import { subscribeToCrossTabEvents } from '../../utils/productCrossTabEvents';
import { getSafeNavigationUrl } from '../../utils/url';
import { isRecord } from '../../utils/responseValidation';
import { formatDateSafe } from '../../utils/format';
import { DataNote } from '../ui/DataNote';
import { Pagination } from '../ui/Pagination';
import { workspaceStyles as ui } from '../ui/workspaceStyles';

const statuses = ['DRAFT', 'ORDERED', 'RECEIVED', 'CANCELLED'];
const statusLabels: Record<string, string> = { DRAFT: 'Draft', ORDERED: 'Ordered', RECEIVED: 'Received', CANCELLED: 'Cancelled' };
const statusClasses: Record<string, string> = {
    DRAFT: 'border-slate-200 bg-slate-100 text-slate-600 dark:border-slate-600 dark:bg-slate-700 dark:text-slate-300',
    ORDERED: 'border-blue-200 bg-blue-50 text-blue-700 dark:border-blue-900 dark:bg-blue-950/50 dark:text-blue-300',
    RECEIVED: 'border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-900 dark:bg-emerald-950/50 dark:text-emerald-300',
    CANCELLED: 'border-red-200 bg-red-50 text-red-700 dark:border-red-900 dark:bg-red-950/50 dark:text-red-300',
};
function date(value: unknown) {
    if (value === null) return 'Unavailable';
    if (typeof value !== 'string' || !Number.isFinite(Date.parse(value))) throw new Error('Invalid date');
    return formatDateSafe(value, 'Unavailable');
}
function decode(value: unknown) {
    if (!isRecord(value) || !Array.isArray(value.orders) || value.orders.length > 25 || !Number.isSafeInteger(value.total) || (value.total as number) < 0 || !Number.isSafeInteger(value.page) || !Number.isSafeInteger(value.limit)) throw new Error('Invalid overview');
    const orders = value.orders.map(row => {
        if (!isRecord(row) || typeof row.id !== 'string' || !statuses.includes(row.status as string) || !isRecord(row.supplier) || typeof row.supplier.name !== 'string' || row.orderNumber !== null && typeof row.orderNumber !== 'string' || row.trackingLink !== null && typeof row.trackingLink !== 'string') throw new Error('Invalid PO');
        const amount = row.totalAmount === null ? null : typeof row.totalAmount === 'string' && /^\d+(?:\.\d{1,2})?$/.test(row.totalAmount) && Number.isFinite(Number(row.totalAmount)) ? row.totalAmount : null;
        return { id: row.id, number: row.orderNumber as string | null, status: row.status as string, supplier: row.supplier.name, amount, ordered: date(row.orderDate), expected: date(row.expectedDate), tracking: row.trackingLink as string | null };
    });
    return { orders, total: value.total as number, page: value.page as number, limit: value.limit as number };
}

export function PurchaseOrderList() {
    const { token, user } = useAuth(); const { currentAccount } = useAccount(); const { hasPermission } = usePermissions();
    if (!token || !currentAccount || !hasPermission('view_inventory')) return <p role="alert">Select an account with inventory read access.</p>;
    return <ScopedList key={JSON.stringify([user?.id, token, currentAccount.id])} token={token} accountId={currentAccount.id} canCreate={hasPermission('manage_inventory')} />;
}

function ScopedList({ token, accountId, canCreate }: { token: string; accountId: string; canCreate: boolean }) {
    const [page, setPage] = useState(1), [status, setStatus] = useState('');
    return <div className="min-w-0 space-y-5 text-slate-900 dark:text-slate-100">
        <div className="flex flex-wrap items-end justify-between gap-3">
            <label className={`${ui.label} w-full sm:w-48`}>Status<select className={ui.input} value={status} onChange={event => { setStatus(event.target.value); setPage(1); }}><option value="">All orders</option>{statuses.map(value => <option key={value} value={value}>{statusLabels[value]}</option>)}</select></label>
            {canCreate && <Link className={ui.primary} to="/inventory/purchase-orders/new"><Plus size={16} aria-hidden="true" />New Purchase Order</Link>}
        </div>
        <DataNote title="Purchase-order amounts and dates">Order currency and actual receipt dates are unavailable. Amounts are not aggregated; a creation date does not establish when goods were received.</DataNote>
        <Page key={`${status}-${page}`} token={token} accountId={accountId} page={page} status={status} setPage={setPage} />
    </div>;
}

function Page({ token, accountId, page, status, setPage }: { token: string; accountId: string; page: number; status: string; setPage: (page: number) => void }) {
    const read = useScopedRequest(`/api/inventory/purchase-orders/overview?${new URLSearchParams({ page: String(page), limit: '25', ...(status ? { status } : {}) })}`, accountId, token, decode);
    const retry = read.retry;
    useEffect(() => subscribeToCrossTabEvents(event => { if (event.resource === 'purchase-order' && event.accountId === accountId) retry(); }), [accountId, retry]);
    if (read.loading) return <div role="status" className={`${ui.card} flex items-center justify-center gap-2 py-12 text-sm text-slate-500 dark:text-slate-400`}><Loader2 size={18} aria-hidden="true" className="animate-spin motion-reduce:animate-none" />Loading purchase orders…</div>;
    if (read.error || !read.data) return <div role="alert" className={`${ui.alert} flex flex-wrap items-center justify-between gap-3`}>Purchase orders unavailable. <button className={ui.secondary} type="button" onClick={read.retry}>Retry orders</button></div>;
    if (read.data.page !== page || read.data.limit !== 25) return <p role="alert" className={ui.alert}>Page acknowledgement unavailable.</p>;
    const data = read.data;
    const summaries = [
        { label: 'Matching orders', value: data.total, Icon: Package, tone: 'bg-indigo-50 text-indigo-600 dark:bg-indigo-950 dark:text-indigo-300' },
        { label: 'Ordered on this page', value: data.orders.filter(row => row.status === 'ORDERED').length, Icon: Clock, tone: 'bg-blue-50 text-blue-600 dark:bg-blue-950 dark:text-blue-300' },
        { label: 'Drafts on this page', value: data.orders.filter(row => row.status === 'DRAFT').length, Icon: FileText, tone: 'bg-slate-100 text-slate-600 dark:bg-slate-700 dark:text-slate-300' },
        { label: 'Received on this page', value: data.orders.filter(row => row.status === 'RECEIVED').length, Icon: CheckCircle2, tone: 'bg-emerald-50 text-emerald-600 dark:bg-emerald-950 dark:text-emerald-300' },
    ];
    return <>
        <dl className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">{summaries.map(({ label, value, Icon, tone }) => <div className={`${ui.card} flex items-center gap-3 p-4`} key={label}><span aria-hidden="true" className={`rounded-xl p-2.5 ${tone}`}><Icon size={20} /></span><div className="min-w-0"><dt className={ui.muted}>{label}</dt><dd className="mt-1 text-2xl font-semibold tabular-nums">{value.toLocaleString()}</dd></div></div>)}</dl>
        <section aria-label="Purchase orders" className="min-w-0 overflow-hidden rounded-xl border border-slate-200 bg-white shadow-xs dark:border-slate-700 dark:bg-slate-800">
            <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 px-4 py-3 dark:border-slate-700"><p className={ui.muted}>{data.total} matching orders · page {page} · {data.orders.length} displayed</p><button className={`${ui.secondary} text-xs`} type="button" onClick={read.retry}><RefreshCw size={13} aria-hidden="true" />Refresh orders</button></div>
            {!data.orders.length ? <div className="flex flex-col items-center gap-3 px-4 py-12 text-slate-400"><FileText size={32} aria-hidden="true" /><p className="text-sm">No orders on this page.</p></div> : <div className="overflow-x-auto"><table className={`${ui.table} min-w-[880px]`}><caption className="sr-only">Purchase orders, suppliers and delivery status</caption><thead className={ui.tableHead}><tr>{['Order', 'Supplier', 'Status', 'Order date', 'Expected', 'Source amount (currency unknown)', 'Tracking'].map(label => <th scope="col" className={`${ui.cell} font-medium ${label.startsWith('Source amount') ? 'max-w-40 text-right' : ''}`} key={label}>{label}</th>)}</tr></thead><tbody className={ui.tableBody}>{data.orders.map(row => {
                const tracking = getSafeNavigationUrl(row.tracking);
                const number = row.number?.trim();
                return <tr key={row.id} className="transition-colors hover:bg-slate-50/80 dark:hover:bg-slate-700/30">
                    <th scope="row" className={`${ui.cell} max-w-56 font-medium`}><Link className={`${ui.link} block break-words`} to={`/inventory/purchase-orders/${encodeURIComponent(row.id)}`} title={row.id}>{number || 'Unnumbered PO'}</Link>{!number && <span className={`mt-1 block font-mono text-[10px] ${ui.muted}`} title={row.id}>Record ID: {row.id.slice(0, 8).toUpperCase()}</span>}</th>
                    <td className={`${ui.cell} max-w-56 break-words`}>{row.supplier}</td>
                    <td className={ui.cell}><span className={`inline-flex whitespace-nowrap rounded-full border px-2.5 py-1 text-xs font-medium ${statusClasses[row.status]}`}>{statusLabels[row.status]}</span></td>
                    <td className={`${ui.cell} whitespace-nowrap text-xs text-slate-500 dark:text-slate-400`}>{row.ordered}</td>
                    <td className={`${ui.cell} whitespace-nowrap text-xs text-slate-500 dark:text-slate-400`}>{row.expected}</td>
                    <td className={`${ui.cell} text-right font-medium tabular-nums`}>{row.amount ?? 'Unavailable'}</td>
                    <td className={ui.cell}>{tracking ? <a className={`${ui.link} inline-flex items-center gap-1 whitespace-nowrap text-xs`} href={tracking} target="_blank" rel="noopener noreferrer">Track shipment<ExternalLink size={12} aria-hidden="true" /></a> : <span className={ui.muted}>—</span>}</td>
                </tr>;
            })}</tbody></table></div>}
            <Pagination currentPage={page} totalPages={Math.ceil(data.total / 25)} onPageChange={setPage} />
        </section>
    </>;
}
