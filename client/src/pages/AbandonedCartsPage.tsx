import { useDeferredValue, useEffect, useState } from 'react';
import { CheckCircle2, Download, Eye, Loader2, MailCheck, MoreVertical, Search, ShoppingCart } from 'lucide-react';
import { formatDistanceToNow } from 'date-fns';
import { useAccount } from '../context/AccountContext';
import { useAuth } from '../context/AuthContext';
import VisitorProfileModal from '../components/analytics/VisitorProfileModal';
import { formatCurrency } from '../utils/format';
import { Logger } from '../utils/logger';

interface CartItem {
    productId: number;
    variationId?: number;
    name: string;
    sku?: string;
    thumbnail?: string;
    quantity: number;
    price: number;
    total: number;
}

interface AbandonedCart {
    id: string;
    visitorId: string;
    email: string | null;
    phone: string | null;
    wooCustomerId: number | null;
    customerName: string | null;
    createdAt: string;
    lastActiveAt: string;
    minutesSinceActivity: number;
    status: 'Not sent' | 'Flow sent' | 'Recovered';
    flowName: string | null;
    flowSentAt: string | null;
    recoveredAt: string | null;
    recoveredOrderId: string | null;
    recoveredRevenue: number | null;
    cartItems: CartItem[];
    itemCount: number;
    cartValue: number;
    currency: string;
}

interface AbandonedCartsResponse {
    items: AbandonedCart[];
    total: number;
    limit: number;
    offset: number;
}

function initials(cart: AbandonedCart) {
    const name = cart.customerName || cart.email || cart.visitorId;
    const parts = name.split(/\s+|@/).filter(Boolean);
    return (parts.length > 1 ? `${parts[0][0]}${parts[1][0]}` : name.slice(0, 2)).toUpperCase();
}

function formatDateTime(value: string) {
    return new Intl.DateTimeFormat('en-AU', {
        day: '2-digit',
        month: '2-digit',
        year: 'numeric',
        hour: 'numeric',
        minute: '2-digit'
    }).format(new Date(value));
}

function itemSummary(items: CartItem[]) {
    if (items.length === 0) return 'No item details captured';
    return items.map((item) => {
        const quantity = item.quantity > 1 ? ` x${item.quantity}` : '';
        return `${item.name}${quantity}`;
    }).join(', ');
}

export function AbandonedCartsPage() {
    const { token } = useAuth();
    const { currentAccount } = useAccount();
    const accountId = currentAccount?.id;
    const [search, setSearch] = useState('');
    const deferredSearch = useDeferredValue(search);
    const [data, setData] = useState<AbandonedCartsResponse>({ items: [], total: 0, limit: 50, offset: 0 });
    const [loading, setLoading] = useState(true);
    const [selectedVisitorId, setSelectedVisitorId] = useState<string | null>(null);

    useEffect(() => {
        if (!token || !accountId) return;

        const controller = new AbortController();
        const selectedAccountId = accountId;
        const params = new URLSearchParams({ limit: '100', thresholdMinutes: '30' });
        if (deferredSearch.trim()) params.set('search', deferredSearch.trim());

        async function fetchCarts() {
            setLoading(true);
            try {
                const res = await fetch(`/api/tracking/abandoned-carts?${params.toString()}`, {
                    signal: controller.signal,
                    headers: {
                        Authorization: `Bearer ${token}`,
                        'X-Account-ID': selectedAccountId
                    }
                });
                if (res.ok) setData(await res.json());
            } catch (error) {
                if ((error as Error).name !== 'AbortError') {
                    Logger.error('Failed to load abandoned carts', { error });
                }
            } finally {
                if (!controller.signal.aborted) setLoading(false);
            }
        }

        fetchCarts();
        return () => controller.abort();
    }, [accountId, deferredSearch, token]);

    const exportCsv = () => {
        const headers = ['Contact', 'Email', 'Phone', 'Created On', 'Last Active', 'Status', 'Flow', 'Flow Sent', 'Recovered', 'Order', 'Items', 'Total'];
        const rows = data.items.map((cart) => [
            cart.customerName || `Visitor ${cart.visitorId.slice(0, 8)}`,
            cart.email || '',
            cart.phone || '',
            formatDateTime(cart.createdAt),
            formatDistanceToNow(new Date(cart.lastActiveAt), { addSuffix: true }),
            cart.status,
            cart.flowName || '',
            cart.flowSentAt ? formatDateTime(cart.flowSentAt) : '',
            cart.recoveredAt ? formatDateTime(cart.recoveredAt) : '',
            cart.recoveredOrderId || '',
            itemSummary(cart.cartItems),
            formatCurrency(cart.cartValue, cart.currency)
        ]);
        const csv = [headers, ...rows]
            .map((row) => row.map((value) => `"${String(value).replace(/"/g, '""')}"`).join(','))
            .join('\n');
        const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8;' }));
        const link = document.createElement('a');
        link.href = url;
        link.download = 'abandoned-carts.csv';
        link.click();
        URL.revokeObjectURL(url);
    };

    return (
        <div className="space-y-6">
            <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
                <div>
                    <h1 className="text-2xl font-bold text-slate-950 dark:text-white">
                        Recoverable Carts <span className="text-sm font-medium text-slate-500 dark:text-slate-400">({data.total} Results)</span>
                    </h1>
                    <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">Carts with contact details that have been inactive for at least 30 minutes.</p>
                </div>
                <button
                    type="button"
                    onClick={exportCsv}
                    disabled={data.items.length === 0}
                    className="inline-flex items-center justify-center gap-2 rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm font-semibold text-slate-700 shadow-sm hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200 dark:hover:bg-slate-700"
                >
                    <Download className="h-4 w-4" />
                    Export All
                </button>
            </div>

            <div className="relative max-w-sm">
                <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                <input
                    value={search}
                    onChange={(event) => setSearch(event.target.value)}
                    placeholder="Search..."
                    className="w-full rounded-lg border border-slate-200 bg-white py-2 pl-10 pr-3 text-sm text-slate-900 outline-hidden focus:border-blue-400 focus:ring-2 focus:ring-blue-100 dark:border-slate-700 dark:bg-slate-900 dark:text-white dark:focus:ring-blue-500/20"
                />
            </div>

            <div className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm dark:border-slate-700 dark:bg-slate-900">
                <div className="overflow-x-auto">
                    <table className="min-w-full divide-y divide-slate-100 text-sm dark:divide-slate-800">
                        <thead className="bg-slate-100/80 text-left text-xs font-semibold uppercase tracking-wide text-slate-600 dark:bg-slate-800/70 dark:text-slate-300">
                            <tr>
                                <th className="w-10 px-4 py-3"><input type="checkbox" className="rounded border-slate-300" aria-label="Select all carts" /></th>
                                <th className="w-8 px-2 py-3"></th>
                                <th className="px-4 py-3">Contact</th>
                                <th className="px-4 py-3">Details</th>
                                <th className="px-4 py-3">Created On</th>
                                <th className="px-4 py-3">Status</th>
                                <th className="min-w-[320px] px-4 py-3">Items</th>
                                <th className="px-4 py-3 text-right">Total</th>
                                <th className="px-4 py-3 text-right">Action</th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                            {loading && data.items.length === 0 && (
                                <tr>
                                    <td colSpan={9} className="px-4 py-16 text-center text-slate-500">
                                        <Loader2 className="mx-auto mb-2 h-6 w-6 animate-spin" />
                                        Loading abandoned carts...
                                    </td>
                                </tr>
                            )}
                            {!loading && data.items.length === 0 && (
                                <tr>
                                    <td colSpan={9} className="px-4 py-16 text-center text-slate-500">
                                        <ShoppingCart className="mx-auto mb-2 h-8 w-8 text-slate-300" />
                                        No recoverable carts found.
                                    </td>
                                </tr>
                            )}
                            {data.items.map((cart) => (
                                <tr
                                    key={cart.id}
                                    className={cart.recoveredAt
                                        ? 'bg-emerald-50/80 hover:bg-emerald-100/70 dark:bg-emerald-950/25 dark:hover:bg-emerald-950/40'
                                        : 'hover:bg-slate-50 dark:hover:bg-slate-800/60'}
                                >
                                    <td className="px-4 py-3 align-top"><input type="checkbox" className="rounded border-slate-300" aria-label={`Select ${cart.email || cart.visitorId}`} /></td>
                                    <td className="px-2 py-3 align-top text-slate-400"><MoreVertical className="h-4 w-4" /></td>
                                    <td className="px-4 py-3 align-top">
                                        <div className="flex items-start gap-3">
                                            <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-blue-600 text-xs font-bold text-white">{initials(cart)}</div>
                                            <div className="min-w-0">
                                                <button onClick={() => setSelectedVisitorId(cart.visitorId)} className="font-semibold text-blue-700 hover:underline dark:text-blue-400">
                                                    {cart.customerName || '-'}
                                                </button>
                                                <div className="mt-1 text-xs text-slate-500 dark:text-slate-400">Last Active: {formatDistanceToNow(new Date(cart.lastActiveAt), { addSuffix: true })}</div>
                                            </div>
                                        </div>
                                    </td>
                                    <td className="px-4 py-3 align-top text-slate-700 dark:text-slate-300">
                                        <div>{cart.email}</div>
                                        {cart.phone && <div className="mt-1">{cart.phone}</div>}
                                    </td>
                                    <td className="whitespace-nowrap px-4 py-3 align-top text-slate-700 dark:text-slate-300">{formatDateTime(cart.createdAt)}</td>
                                    <td className="px-4 py-3 align-top">
                                        {cart.recoveredAt ? (
                                            <div className="space-y-1">
                                                <span className="inline-flex items-center gap-1 rounded-full bg-emerald-600 px-2.5 py-1 text-xs font-semibold text-white">
                                                    <CheckCircle2 className="h-3.5 w-3.5" />
                                                    Recovered
                                                </span>
                                                <div className="text-xs text-emerald-700 dark:text-emerald-300">
                                                    {formatDateTime(cart.recoveredAt)}{cart.recoveredOrderId ? ` - Order #${cart.recoveredOrderId}` : ''}
                                                </div>
                                            </div>
                                        ) : cart.flowSentAt ? (
                                            <div className="space-y-1">
                                                <span className="inline-flex items-center gap-1 rounded-full bg-blue-50 px-2.5 py-1 text-xs font-semibold text-blue-700 dark:bg-blue-500/15 dark:text-blue-300">
                                                    <MailCheck className="h-3.5 w-3.5" />
                                                    Flow sent
                                                </span>
                                                <div className="text-xs text-slate-500 dark:text-slate-400">
                                                    {cart.flowName || 'Abandoned cart flow'} - {formatDateTime(cart.flowSentAt)}
                                                </div>
                                            </div>
                                        ) : (
                                            <span className="rounded-full bg-slate-100 px-2.5 py-1 text-xs font-semibold text-slate-600 dark:bg-slate-800 dark:text-slate-300">Not sent</span>
                                        )}
                                    </td>
                                    <td className="px-4 py-3 align-top text-blue-700 dark:text-blue-400">{itemSummary(cart.cartItems)}</td>
                                    <td className="px-4 py-3 align-top text-right">
                                        <span className="rounded-full bg-emerald-100 px-2 py-1 text-xs font-bold text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300">{formatCurrency(cart.cartValue, cart.currency)}</span>
                                    </td>
                                    <td className="px-4 py-3 align-top text-right">
                                        <button onClick={() => setSelectedVisitorId(cart.visitorId)} className="inline-flex items-center gap-1 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200 dark:hover:bg-slate-700">
                                            <Eye className="h-4 w-4" />
                                            View
                                        </button>
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
            </div>

            {selectedVisitorId && currentAccount && (
                <VisitorProfileModal visitorId={selectedVisitorId} accountId={currentAccount.id} onClose={() => setSelectedVisitorId(null)} />
            )}
        </div>
    );
}
