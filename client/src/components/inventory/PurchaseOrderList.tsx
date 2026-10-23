import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { CheckCircle2, Clock, ExternalLink, FileText, Loader2, Package, Plus, RefreshCw } from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import { useAccount } from '../../context/AccountContext';
import { usePermissions } from '../../hooks/usePermissions';
import { useScopedRequest } from '../../hooks/useScopedRequest';
import { useScopedMutation } from '../../hooks/useScopedMutation';
import { emitCrossTabEvent, subscribeToCrossTabEvents } from '../../utils/productCrossTabEvents';
import { getSafeNavigationUrl } from '../../utils/url';
import { isRecord } from '../../utils/responseValidation';
import { formatDateSafe } from '../../utils/format';
import { DataNote } from '../ui/DataNote';
import { Pagination } from '../ui/Pagination';
import { Metric, MetricStrip } from '../ui/MetricStrip';
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
type Order = ReturnType<typeof decode>['orders'][number];
interface ReceiveControls { allowed: boolean; busy: boolean; attempted: ReadonlySet<string>; run: (row: Order) => void }

export function PurchaseOrderList() {
    const { token, user } = useAuth(); const { currentAccount } = useAccount(); const { hasPermission } = usePermissions();
    if (!token || !currentAccount || !hasPermission('view_inventory')) return <p role="alert">Select an account with inventory read access.</p>;
    return <ScopedList key={JSON.stringify([user?.id, token, currentAccount.id])} token={token} accountId={currentAccount.id} canCreate={hasPermission('manage_inventory')} />;
}

function ScopedList({ token, accountId, canCreate }: { token: string; accountId: string; canCreate: boolean }) {
    const [page, setPage] = useState(1), [status, setStatus] = useState('');
    const mutation = useScopedMutation();
    // Retain attempted-row locks across paging/filtering/refreshes: an aborted request may have committed.
    const [attempted, setAttempted] = useState<ReadonlySet<string>>(() => new Set());
    const [revision, setRevision] = useState(0);
    const [receipt, setReceipt] = useState<{ id: string; text: string } | null>(null);
    const receive = async (row: Order) => {
        if (!canCreate || row.status !== 'ORDERED' || attempted.has(row.id) || mutation.isPending()) return;
        const label = row.number?.trim() || `unnumbered PO (${row.id.slice(0, 8).toUpperCase()})`;
        if (!window.confirm(`Mark ${label} from ${row.supplier} as received? This runs the stock-receipt workflow and may update inventory. Confirm only after the goods have arrived.`)) return;
        setAttempted(current => new Set([...current, row.id])); setReceipt(null);
        const result = await mutation.run(async signal => {
            const response = await fetch(`/api/inventory/purchase-orders/${encodeURIComponent(row.id)}`, { method: 'PUT', signal, headers: { Authorization: `Bearer ${token}`, 'X-Account-ID': accountId, 'Content-Type': 'application/json' }, body: JSON.stringify({ status: 'RECEIVED' }) });
            if (!response.ok) throw new Error('Receipt unacknowledged');
            const saved: unknown = await response.json();
            if (!isRecord(saved) || saved.id !== row.id || saved.status !== 'RECEIVED' || saved._warnings !== undefined && (!Array.isArray(saved._warnings) || !saved._warnings.every(warning => typeof warning === 'string'))) throw new Error('Invalid receipt acknowledgement');
            return (saved._warnings as string[] | undefined) ?? [];
        }, 'Receipt outcome unconfirmed or blocked. Do not repeat this stock action; open the purchase order to review its status and receipt recovery.');
        if (!mutation.isActive()) return;
        if (!result.ok) { setReceipt({ id: row.id, text: '' }); return; }
        setReceipt({ id: row.id, text: result.value.length ? `Marked received with warnings: ${result.value.join(' ')} Review the purchase order before taking further stock actions.` : 'Purchase order marked received. Review the purchase order for stock-receipt details.' });
        setRevision(value => value + 1);
        emitCrossTabEvent({ resource: 'purchase-order', type: 'status-updated', accountId, resourceId: row.id });
    };
    return <div className="min-w-0 space-y-5 text-slate-900 dark:text-slate-100">
        {(mutation.error || receipt) && <div className={`${mutation.error ? ui.alert : ui.notice} space-y-2`}><p role={mutation.error ? 'alert' : 'status'}>{mutation.error || receipt?.text}</p>{receipt && <Link className={ui.link} to={`/inventory/purchase-orders/${encodeURIComponent(receipt.id)}`}>Review purchase order</Link>}</div>}
        <Page key={`${status}-${page}-${revision}`} token={token} accountId={accountId} page={page} status={status} setStatus={value => { setStatus(value); setPage(1); }} setPage={setPage} receive={{ allowed: canCreate, busy: mutation.busy, attempted, run: row => { void receive(row); } }} />
    </div>;
}

function Page({ token, accountId, page, status, setStatus, setPage, receive }: { token: string; accountId: string; page: number; status: string; setStatus: (status: string) => void; setPage: (page: number) => void; receive: ReceiveControls }) {
    const read = useScopedRequest(`/api/inventory/purchase-orders/overview?${new URLSearchParams({ page: String(page), limit: '25', ...(status ? { status } : {}) })}`, accountId, token, decode);
    const retry = read.retry;
    useEffect(() => subscribeToCrossTabEvents(event => { if (event.resource === 'purchase-order' && event.accountId === accountId) retry(); }), [accountId, retry]);
    const data = !read.loading && !read.error && read.data?.page === page && read.data.limit === 25 ? read.data : null;
    const summaries = data ? [
        { label: 'Matching orders', value: data.total, Icon: Package, tone: 'text-[var(--brand-text)]' },
        { label: 'Ordered on this page', value: data.orders.filter(row => row.status === 'ORDERED').length, Icon: Clock, tone: 'text-blue-600 dark:text-blue-300' },
        { label: 'Drafts on this page', value: data.orders.filter(row => row.status === 'DRAFT').length, Icon: FileText, tone: 'text-slate-600 dark:text-slate-300' },
        { label: 'Received on this page', value: data.orders.filter(row => row.status === 'RECEIVED').length, Icon: CheckCircle2, tone: 'text-emerald-600 dark:text-emerald-300' },
    ] : [];
    const toolbar = <>
        <div aria-label="Purchase order filters and summary" className="flex min-w-0 flex-wrap items-end gap-3">
            <label className={`${ui.label} w-full sm:w-40 sm:shrink-0`}>Status<select className={ui.input} value={status} onChange={event => setStatus(event.target.value)}><option value="">All orders</option>{statuses.map(value => <option key={value} value={value}>{statusLabels[value]}</option>)}</select></label>
            {data && <MetricStrip label="Purchase order summary" className="w-full xl:w-auto xl:flex-1">{summaries.map(({ label, value, Icon, tone }) => <Metric key={label} label={<span className="inline-flex items-center gap-1.5"><Icon size={13} aria-hidden="true" />{label}</span>} value={value.toLocaleString()} valueClassName={tone} />)}</MetricStrip>}
            {receive.allowed && <Link className={`${ui.primary} sm:ml-auto`} to="/inventory/purchase-orders/new"><Plus size={16} aria-hidden="true" />New Purchase Order</Link>}
        </div>
        <DataNote title="Purchase-order amounts and dates">Order currency and actual receipt dates are unavailable. Amounts are not aggregated; a creation date does not establish when goods were received.</DataNote>
    </>;
    if (read.loading) return <>{toolbar}<div role="status" className={`${ui.card} flex items-center justify-center gap-2 py-12 text-sm text-slate-500 dark:text-slate-400`}><Loader2 size={18} aria-hidden="true" className="animate-spin motion-reduce:animate-none" />Loading purchase orders…</div></>;
    if (read.error || !read.data) return <>{toolbar}<div role="alert" className={`${ui.alert} flex flex-wrap items-center justify-between gap-3`}>Purchase orders unavailable. <button className={ui.secondary} type="button" onClick={read.retry}>Retry orders</button></div></>;
    if (!data) return <>{toolbar}<p role="alert" className={ui.alert}>Page acknowledgement unavailable.</p></>;
    return <>
        {toolbar}
        <section aria-label="Purchase orders" className="min-w-0 overflow-hidden rounded-xl border border-slate-200 bg-white shadow-xs dark:border-slate-700 dark:bg-slate-800">
            <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 px-4 py-3 dark:border-slate-700"><p className={ui.muted}>{data.total} matching orders · page {page} · {data.orders.length} displayed</p><button className={`${ui.secondary} text-xs`} type="button" onClick={read.retry}><RefreshCw size={13} aria-hidden="true" />Refresh orders</button></div>
            {!data.orders.length ? <div className="flex flex-col items-center gap-3 px-4 py-12 text-slate-400"><FileText size={32} aria-hidden="true" /><p className="text-sm">No orders on this page.</p></div> : <div className="overflow-x-auto"><table className={`${ui.table} min-w-[880px]`}><caption className="sr-only">Purchase orders, suppliers and delivery status</caption><thead className={ui.tableHead}><tr>{['Order', 'Supplier', 'Status', 'Order date', 'Expected', 'Source amount (currency unknown)', 'Tracking', ...(receive.allowed ? ['Actions'] : [])].map(label => <th scope="col" className={`${ui.cell} font-medium ${label.startsWith('Source amount') ? 'max-w-40 text-right' : ''}`} key={label}>{label}</th>)}</tr></thead><tbody className={ui.tableBody}>{data.orders.map(row => {
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
                    {receive.allowed && <td className={ui.cell}>{row.status === 'ORDERED' ? <button className={`${ui.secondary} whitespace-nowrap text-xs`} type="button" disabled={receive.busy || receive.attempted.has(row.id)} onClick={() => receive.run(row)}><CheckCircle2 size={15} aria-hidden="true" />{receive.attempted.has(row.id) ? 'Receipt attempted' : 'Mark received'}</button> : <span className={ui.muted}>—</span>}</td>}
                </tr>;
            })}</tbody></table></div>}
            <Pagination currentPage={page} totalPages={Math.ceil(data.total / 25)} onPageChange={setPage} />
        </section>
    </>;
}
