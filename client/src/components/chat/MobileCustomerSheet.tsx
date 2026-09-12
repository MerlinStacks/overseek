import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext';
import { useAccount } from '../../context/AccountContext';
import { Modal } from '../ui/Modal';

/** Additive to MobileChatConversation; no dependency on the mobile chat hook. */
export interface MobileCustomerConversation {
    id: string;
    customerName: string;
    customerEmail?: string | null;
    customer?: {
        id?: string | null;
        wooId?: number | string | null;
        firstName?: string | null;
        lastName?: string | null;
        email?: string | null;
        totalSpent?: number | string | null;
        ordersCount?: number | null;
    } | null;
}

export interface MobileCustomerSheetProps {
    open: boolean;
    onClose: () => void;
    conversation: MobileCustomerConversation | null;
}

interface Order {
    id: string;
    wooId?: number;
    number?: string;
    status?: string;
    total?: number | string;
    currency?: string;
    dateCreated?: string;
}

function money(value: number | string | null | undefined, currency?: string) {
    if (value == null || value === '' || !Number.isFinite(Number(value))) return 'Unavailable';
    try {
        return new Intl.NumberFormat('en-AU', { style: 'currency', currency: currency || 'USD' }).format(Number(value));
    } catch {
        return Number(value).toFixed(2);
    }
}

function orderDate(value?: string) {
    const date = value ? new Date(value) : null;
    return date && Number.isFinite(date.getTime())
        ? date.toLocaleDateString('en-AU', { day: 'numeric', month: 'short', year: 'numeric' })
        : 'Date unavailable';
}

export function MobileCustomerSheet({ open, onClose, conversation }: MobileCustomerSheetProps) {
    const { token } = useAuth();
    const { currentAccount } = useAccount();
    const customer = conversation?.customer;
    const email = customer?.email?.trim() || conversation?.customerEmail?.trim() || '';
    const rawWooId = String(customer?.wooId ?? '').trim();
    const wooId = /^\d+$/.test(rawWooId) && Number.isSafeInteger(Number(rawWooId)) && Number(rawWooId) > 0
        ? Number(rawWooId) : null;
    const filter = wooId ? `customerId=${wooId}` : email ? `billingEmail=${encodeURIComponent(email)}` : '';
    const accountId = currentAccount?.id;
    const available = Boolean(conversation && accountId && token && filter);
    const [attempt, setAttempt] = useState(0);
    const key = JSON.stringify([open, accountId, token, conversation?.id, customer?.id, filter, attempt]);
    const [result, setResult] = useState<{ key: string; orders: Order[]; error: boolean } | null>(null);

    useEffect(() => {
        setResult(null);
        if (!open || !available) return;
        const controller = new AbortController();
        async function load() {
            try {
                const response = await fetch(`/api/orders?${filter}&limit=5`, {
                    headers: { Authorization: `Bearer ${token}`, 'X-Account-ID': accountId! },
                    signal: controller.signal,
                });
                if (!response.ok) throw new Error('Orders request failed');
                const data: unknown = await response.json();
                if (!data || typeof data !== 'object' || !('orders' in data) || !Array.isArray(data.orders)
                    || !data.orders.every(order => order && typeof order.id === 'string')) {
                    throw new Error('Invalid orders response');
                }
                if (!controller.signal.aborted) setResult({ key, orders: data.orders.slice(0, 5), error: false });
            } catch {
                if (!controller.signal.aborted) setResult({ key, orders: [], error: true });
            }
        }
        void load();
        return () => controller.abort();
    }, [open, available, key, filter, token, accountId]);

    // Key the rendered result as well as aborting requests: never paint previous-account data.
    const current = result?.key === key ? result : null;
    const name = [customer?.firstName, customer?.lastName].filter(Boolean).join(' ').trim()
        || conversation?.customerName || 'Unknown customer';

    return (
        <Modal isOpen={open} onClose={onClose} title="Customer details" variant="sheet">
            <div className="space-y-6">
                <section aria-label="Customer information" className="space-y-3">
                    <h2 className="break-words text-lg font-semibold text-slate-100">{name}</h2>
                    <p className="break-all text-sm text-slate-300">{email || 'Email unavailable'}</p>
                    <dl className="grid grid-cols-2 gap-3 rounded-2xl border border-white/10 bg-slate-950/50 p-4">
                        <div><dt className="text-xs text-slate-400">Total spent</dt><dd className="mt-1 font-semibold">{money(customer?.totalSpent, currentAccount?.currency)}</dd></div>
                        <div><dt className="text-xs text-slate-400">Orders</dt><dd className="mt-1 font-semibold">{customer?.ordersCount ?? 'Unavailable'}</dd></div>
                    </dl>
                    {customer?.id && (
                        <Link to={`/m/customers/${encodeURIComponent(customer.id)}`} onClick={onClose} className="flex min-h-11 items-center rounded-xl px-3 text-sm font-medium text-indigo-200 hover:bg-white/5 focus-visible:outline-2 focus-visible:outline-indigo-300">
                            View customer profile
                        </Link>
                    )}
                </section>
                <section aria-label="Recent orders" className="space-y-3">
                    <h2 className="font-semibold text-slate-100">Recent orders <span className="text-sm font-normal text-slate-400">(latest 5)</span></h2>
                    {!available ? <p role="status" className="text-sm text-slate-400">Order history unavailable. {!filter ? 'No customer ID or email is available.' : 'Select an account and sign in to view orders.'}</p>
                        : !current ? <p role="status" className="text-sm text-slate-300">Loading orders…</p>
                            : current.error ? <div role="alert" className="text-sm text-rose-200">
                                <p>Could not load recent orders.</p>
                                <button type="button" onClick={() => setAttempt(value => value + 1)} className="mt-2 min-h-11 rounded-xl border border-white/15 px-4 text-slate-100 hover:bg-white/5">Retry</button>
                            </div>
                                : current.orders.length === 0 ? <p role="status" className="text-sm text-slate-400">No orders found for this customer.</p>
                                    : <ul className="space-y-2">
                                        {current.orders.map(order => <li key={order.id}>
                                            <Link to={`/m/orders/${encodeURIComponent(order.id)}`} onClick={onClose} className="block min-h-11 space-y-2 rounded-xl border border-white/10 bg-slate-950/50 p-3 hover:bg-slate-800 focus-visible:outline-2 focus-visible:outline-indigo-300">
                                                <div className="flex flex-wrap items-center justify-between gap-2"><span className="font-medium">Order #{order.number || order.wooId || order.id}</span><span className="rounded-lg bg-white/5 px-2 py-1 text-xs capitalize text-slate-300">{order.status?.replace(/-/g, ' ') || 'Status unavailable'}</span></div>
                                                <div className="flex flex-wrap justify-between gap-2 text-sm"><span className="text-slate-400">{orderDate(order.dateCreated)}</span><span>{money(order.total, order.currency || currentAccount?.currency)}</span></div>
                                            </Link>
                                        </li>)}
                                    </ul>}
                </section>
            </div>
        </Modal>
    );
}
