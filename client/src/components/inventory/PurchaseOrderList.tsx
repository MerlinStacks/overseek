import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext';
import { useAccount } from '../../context/AccountContext';
import { usePermissions } from '../../hooks/usePermissions';
import { useScopedRequest } from '../../hooks/useScopedRequest';
import { subscribeToCrossTabEvents } from '../../utils/productCrossTabEvents';
import { getSafeHref } from '../../utils/url';
import { isRecord } from '../../utils/responseValidation';
const statuses = ['DRAFT', 'ORDERED', 'RECEIVED', 'CANCELLED'];
function date(value: unknown) { if (value === null) return 'Unavailable'; if (typeof value !== 'string' || !Number.isFinite(Date.parse(value))) throw new Error('Invalid date'); return new Date(value).toLocaleDateString(); }
function decode(value: unknown) {
    if (!isRecord(value) || !Array.isArray(value.orders) || value.orders.length > 25 || !Number.isSafeInteger(value.total) || (value.total as number) < 0 || !Number.isSafeInteger(value.page) || !Number.isSafeInteger(value.limit)) throw new Error('Invalid overview');
    const orders = value.orders.map(row => { if (!isRecord(row) || typeof row.id !== 'string' || !statuses.includes(row.status as string) || !isRecord(row.supplier) || typeof row.supplier.name !== 'string' || row.orderNumber !== null && typeof row.orderNumber !== 'string' || row.trackingLink !== null && typeof row.trackingLink !== 'string') throw new Error('Invalid PO'); const amount = row.totalAmount === null ? null : typeof row.totalAmount === 'string' && /^\d+(?:\.\d{1,2})?$/.test(row.totalAmount) && Number.isFinite(Number(row.totalAmount)) ? row.totalAmount : null; return { id: row.id, number: row.orderNumber as string | null, status: row.status as string, supplier: row.supplier.name, amount, ordered: date(row.orderDate), expected: date(row.expectedDate), tracking: row.trackingLink as string | null }; });
    return { orders, total: value.total as number, page: value.page as number, limit: value.limit as number };
}
export function PurchaseOrderList() {
    const { token, user } = useAuth(); const { currentAccount } = useAccount(); const { hasPermission } = usePermissions();
    if (!token || !currentAccount || !hasPermission('view_inventory')) return <p role="alert">Select an account with inventory read access.</p>;
    return <ScopedList key={JSON.stringify([user?.id, token, currentAccount.id])} token={token} accountId={currentAccount.id} canCreate={hasPermission('manage_inventory')} />;
}
function ScopedList({ token, accountId, canCreate }: { token: string; accountId: string; canCreate: boolean }) { const [page, setPage] = useState(1), [status, setStatus] = useState(''); return <div className="space-y-4 text-slate-900 dark:text-slate-100"><div className="flex flex-wrap gap-3"><label>Status <select className="dark:bg-slate-900" value={status} onChange={e => { setStatus(e.target.value); setPage(1); }}><option value="">All orders</option>{statuses.map(value => <option key={value}>{value}</option>)}</select></label>{canCreate && <Link to="/inventory/purchase-orders/new">New Purchase Order</Link>}</div><p>Order currency and actual receipt dates are unavailable. Amounts are not aggregated; a creation date does not establish when goods were received.</p><Page key={`${status}-${page}`} token={token} accountId={accountId} page={page} status={status} setPage={setPage} /></div>; }
function Page({ token, accountId, page, status, setPage }: { token: string; accountId: string; page: number; status: string; setPage: (page: number) => void }) {
    const read = useScopedRequest(`/api/inventory/purchase-orders/overview?${new URLSearchParams({ page: String(page), limit: '25', ...(status ? { status } : {}) })}`, accountId, token, decode);
    const retry = read.retry;
    useEffect(() => subscribeToCrossTabEvents(event => { if (event.resource === 'purchase-order' && event.accountId === accountId) retry(); }), [accountId, retry]);
    if (read.loading) return <p role="status">Loading purchase orders…</p>;
    if (read.error || !read.data) return <p role="alert">Purchase orders unavailable. <button type="button" onClick={read.retry}>Retry orders</button></p>;
    if (read.data.page !== page || read.data.limit !== 25) return <p role="alert">Page acknowledgement unavailable.</p>;
    return <><p>{read.data.total} matching orders · page {page} · {read.data.orders.length} displayed</p>{!read.data.orders.length ? <p>No orders on this page.</p> : <div className="overflow-x-auto"><table className="w-full text-left"><thead><tr><th>Order</th><th>Supplier</th><th>Status</th><th>Order date</th><th>Expected</th><th>Source amount (currency unknown)</th><th>Tracking</th></tr></thead><tbody>{read.data.orders.map(row => <tr key={row.id}><th scope="row" className="p-2"><Link to={`/inventory/purchase-orders/${encodeURIComponent(row.id)}`}>{row.number || row.id}</Link></th><td>{row.supplier}</td><td>{row.status}</td><td>{row.ordered}</td><td>{row.expected}</td><td>{row.amount ?? 'Unavailable'}</td><td>{row.tracking && getSafeHref(row.tracking) && <a href={getSafeHref(row.tracking)} target="_blank" rel="noopener noreferrer">Track shipment</a>}</td></tr>)}</tbody></table></div>}<div className="flex gap-4"><button type="button" disabled={page <= 1} onClick={() => setPage(page - 1)}>Previous</button><button type="button" disabled={page * 25 >= read.data.total} onClick={() => setPage(page + 1)}>Next</button><button type="button" onClick={read.retry}>Refresh orders</button></div></>;
}
