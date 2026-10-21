import { useCallback, useState } from 'react';
import { useVisibilityPolling } from '../../hooks/useVisibilityPolling';
import { useScopedMutation } from '../../hooks/useScopedMutation';
import { useAuth } from '../../context/AuthContext';
import { useAccount } from '../../context/AccountContext';
import { isRecord } from '../../utils/responseValidation';
import { toValidDate } from '../../utils/format';
import { reportMoney } from '../analytics/useReportRequest';
import { RelativeTime } from '../ui/RelativeTime';

interface Event {
    id: string; type: string; createdAt: string;
    payload?: { items?: Array<{ name?: string | null }>; total?: number | string | null; currency?: string | null } | null;
    session?: { email?: string | null; city?: string | null; country?: string | null } | null;
}
function amount(value: unknown): number | null {
    if (value == null) return null;
    const number = typeof value === 'number' ? value : typeof value === 'string' && /^-?\d+(?:\.\d+)?$/.test(value.trim()) ? Number(value) : NaN;
    if (!Number.isFinite(number)) throw new Error('Invalid event total');
    return number;
}
function decodeEvents(value: unknown): Event[] {
    if (!isRecord(value) || !Array.isArray(value.data) || !value.data.every(item => {
        if (!isRecord(item) || !['id', 'type', 'createdAt'].every(key => typeof item[key] === 'string')) return false;
        if (item.session != null && (!isRecord(item.session) || !['email', 'city', 'country'].every(key => (item.session as Record<string, unknown>)[key] == null || typeof (item.session as Record<string, unknown>)[key] === 'string'))) return false;
        if (item.payload == null) return true;
        if (!isRecord(item.payload)) return false;
        const payload = item.payload;
        if (payload.items != null && (!Array.isArray(payload.items) || !payload.items.every(product => isRecord(product) && (product.name == null || typeof product.name === 'string')))) return false;
        if (payload.currency != null && (typeof payload.currency !== 'string' || !/^[A-Z]{3}$/i.test(payload.currency))) return false;
        amount(payload.total); return true;
    })) throw new Error('Invalid ecommerce stream');
    return value.data;
}
function eventLabel(event: Event) {
    const who = event.session?.email || 'Guest';
    const total = amount(event.payload?.total);
    const money = total === null ? '' : ` (${reportMoney(total, event.payload?.currency ?? undefined)})`;
    switch (event.type) {
        case 'add_to_cart': {
            const names = event.payload?.items?.map(item => item.name).filter((name): name is string => typeof name === 'string' && !!name) ?? [];
            return `${who} added ${names.slice(0, 2).join(', ') || 'items'}${names.length > 2 ? ` +${names.length - 2} more` : ''}${money}`;
        }
        case 'remove_from_cart': return `${who} removed items from cart`;
        case 'cart_view': return `${who} viewed cart${money}`;
        case 'checkout_view': return `${who} viewed checkout${money}`;
        case 'checkout_start': return `${who} started checkout`;
        case 'purchase': case 'checkout_success': return `${who} completed a purchase${money}`;
        default: return `${who} performed ${event.type}`;
    }
}
export default function EcommerceLogWidget() {
    const { token } = useAuth(); const { currentAccount } = useAccount();
    if (!token || !currentAccount) return <p role="status">Select an account to view ecommerce activity.</p>;
    return <AccountLog key={JSON.stringify([token, currentAccount.id])} token={token} accountId={currentAccount.id} />;
}
function AccountLog({ token, accountId }: { token: string; accountId: string }) {
    const [events, setEvents] = useState<Event[] | null>(null);
    const { run, busy, error, isPending, isActive } = useScopedMutation();
    const fetchLog = useCallback(async () => {
        if (isPending() || !isActive()) return;
        const result = await run(async signal => {
            const response = await fetch('/api/analytics/ecommerce/log?limit=20&live=true', { signal, headers: { Authorization: `Bearer ${token}`, 'x-account-id': accountId } });
            if (!response.ok) throw new Error('Stream unavailable');
            return decodeEvents(await response.json());
        }, 'Could not refresh ecommerce activity. Any activity shown below is from the last successful refresh.');
        if (result.ok) setEvents(result.value);
    }, [run, accountId, token, isPending, isActive]);
    useVisibilityPolling(fetchLog, 15000, [fetchLog], `ecommerce-log:${accountId}`);
    return <section aria-label="Ecommerce activity" className="h-full overflow-y-auto p-2 space-y-3 text-slate-900 dark:text-slate-100">
        {error && <p role="alert">{error} <button type="button" disabled={busy} onClick={() => void fetchLog()}>Retry ecommerce activity</button></p>}
        {events === null && !error ? <p role="status">Loading ecommerce activity...</p> : <>
            {busy && <p role="status">Refreshing ecommerce activity...</p>}
            {events?.length === 0 && <p>No recent commerce activity.</p>}
            <ul className="space-y-2">{events?.map(event => <li key={event.id} className="p-3 border border-slate-200 dark:border-slate-700 rounded-lg bg-white dark:bg-slate-800"><p className="text-sm break-words">{eventLabel(event)}</p><p className="text-xs text-slate-500 dark:text-slate-400">{toValidDate(event.createdAt) ? <RelativeTime date={event.createdAt} className="text-xs" /> : 'Date unavailable'}{event.session?.country ? ` · ${event.session.city ? `${event.session.city}, ` : ''}${event.session.country}` : ''}</p></li>)}</ul>
        </>}
    </section>;
}
