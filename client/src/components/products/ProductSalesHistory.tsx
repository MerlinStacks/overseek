import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext';
import { useAccount } from '../../context/AccountContext';
import { usePermissions } from '../../hooks/usePermissions';
import { useScopedRequest } from '../../hooks/useScopedRequest';
import { isRecord } from '../../utils/responseValidation';
interface Sale { orderId: number; orderNumber: string; customerWooId: number | null; date: string; status: string; customerName: string; customerEmail: string; quantity: number; lineTotal: number | null; orderTotal: number | null; currency: string | null }
interface History { sales: Sale[]; total: number; page: number; limit: number; totalPages: number }
const positive = (value: unknown): value is number => typeof value === 'number' && Number.isSafeInteger(value) && value > 0;
const nonnegative = (value: unknown): value is number => typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
function decode(value: unknown): History {
    if (!isRecord(value) || !positive(value.page) || value.limit !== 15 || !nonnegative(value.total) || !nonnegative(value.totalPages) || value.totalPages !== Math.ceil(value.total / 15) || !Array.isArray(value.sales) || value.sales.length > 15) throw new Error('Invalid history page');
    for (const row of value.sales) if (!isRecord(row) || !positive(row.orderId) || row.customerWooId !== null && !positive(row.customerWooId) || !['orderNumber', 'status', 'customerName', 'customerEmail'].every(key => typeof row[key] === 'string' && String(row[key]).length <= 1000) || typeof row.date !== 'string' || !Number.isFinite(Date.parse(row.date)) || !positive(row.quantity) || !['lineTotal', 'orderTotal'].every(key => row[key] === null || typeof row[key] === 'number' && Number.isFinite(row[key])) || row.currency !== null && (typeof row.currency !== 'string' || !/^[A-Z]{3}$/.test(row.currency))) throw new Error('Invalid sale');
    if (new Set(value.sales.map(row => row.orderId)).size !== value.sales.length) throw new Error('Duplicate orders');
    return value as unknown as History;
}
function storeUrl(value: string | undefined) { try { const url = new URL(value || ''); if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.search || url.hash) return null; return url.toString().replace(/\/$/, ''); } catch { return null; } }
export function ProductSalesHistory({ productWooId }: { productWooId: number }) {
    const { token, user } = useAuth(); const { currentAccount } = useAccount(); const { hasPermission } = usePermissions();
    if (!token || !currentAccount || !positive(productWooId)) return <p role="status">Select a valid account and product.</p>;
    if (!hasPermission('view_orders') || !hasPermission('view_customers')) return <p>Order and customer view permissions required.</p>;
    return <ScopedHistory key={JSON.stringify([user?.id, token, currentAccount.id, productWooId])} token={token} accountId={currentAccount.id} productWooId={productWooId} wooUrl={storeUrl(currentAccount.wooUrl)} />;
}
function ScopedHistory(props: { token: string; accountId: string; productWooId: number; wooUrl: string | null }) {
    const [page, setPage] = useState(1);
    return <section className="rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 p-4 text-slate-900 dark:text-slate-100 space-y-3"><h3 className="font-semibold">Sales History</h3><p>Synced local order records, not a complete or live provider sales ledger.</p><HistoryPage key={page} {...props} page={page} setPage={setPage} /></section>;
}
function HistoryPage({ token, accountId, productWooId, wooUrl, page, setPage }: { token: string; accountId: string; productWooId: number; wooUrl: string | null; page: number; setPage: (value: number) => void }) {
    const read = useScopedRequest(`/api/products/${productWooId}/sales-history?page=${page}&limit=15`, accountId, token, decode);
    if (read.loading) return <p role="status">Loading order history…</p>;
    if (read.error || !read.data || read.data.page !== page) return <p role="alert">Sales history unavailable. <button onClick={read.retry}>Retry sales history</button></p>;
    const data = read.data;
    const money = (amount: number | null, currency: string | null) => { if (amount === null || currency === null) return 'Unavailable'; try { return new Intl.NumberFormat(undefined, { style: 'currency', currency }).format(amount); } catch { return 'Unavailable'; } };
    return <>
        {data.sales.length === 0 ? <p>No synced sales in this page.</p> : <div className="overflow-x-auto"><table className="w-full text-left"><thead><tr>{['Order', 'Date', 'Customer', 'Quantity', 'Line total', 'Order total', 'Status'].map(label => <th className="p-2" key={label}>{label}</th>)}</tr></thead><tbody>{data.sales.map(sale => <tr key={sale.orderId}><td className="p-2"><Link to={`/orders/${sale.orderId}`}>{sale.orderNumber}</Link> {wooUrl && <a href={`${wooUrl}/wp-admin/post.php?post=${sale.orderId}&action=edit`} target="_blank" rel="noopener noreferrer" aria-label={`Open order ${sale.orderNumber} in WooCommerce (new tab)`}>↗</a>}</td><td className="p-2">{new Date(sale.date).toLocaleString()}</td><td className="p-2">{sale.customerWooId ? <Link to={`/customers/${sale.customerWooId}`}>{sale.customerName}</Link> : sale.customerName}<p>{sale.customerEmail}</p></td><td className="p-2">{sale.quantity}</td><td className="p-2">{money(sale.lineTotal, sale.currency)}</td><td className="p-2">{money(sale.orderTotal, sale.currency)}</td><td className="p-2">{sale.status}</td></tr>)}</tbody></table></div>}
        <nav aria-label="Sales history pages" className="flex gap-4"><button disabled={page <= 1} onClick={() => setPage(page - 1)} aria-label="Previous sales page">Previous</button><span>Page {page} · {data.total} synced orders{data.totalPages > 666 ? ' (view limited to 666 pages)' : ''}</span><button disabled={page >= Math.min(data.totalPages, 666)} onClick={() => setPage(page + 1)} aria-label="Next sales page">Next</button></nav>
    </>;
}
