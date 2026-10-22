import { useEffect, useState } from 'react';
import { z } from 'zod';
import { Modal } from '../ui/Modal';
import { useAuth } from '../../context/AuthContext';
import { useAccount } from '../../context/AccountContext';
import { readBoundedBytes } from '../../utils/boundedResponse';
import { getSafeHref } from '../../utils/url';

interface Props { visitorId: string; accountId: string; onClose: () => void }
const text = z.string().max(2000), count = z.number().int().nonnegative().safe();
const timestamp = z.string().datetime({ offset: true });
const eventSchema = z.object({ id: text, type: z.string().max(80), url: text.nullish(), pageTitle: text.nullish(), createdAt: timestamp, payload: z.object({ productName: text.nullish(), name: text.nullish(), sku: text.nullish(), term: text.nullish(), searchQuery: text.nullish(), quantity: z.number().finite().nullish(), price: z.union([text, z.number().finite()]).nullish(), total: z.union([text, z.number().finite()]).nullish(), currency: z.string().max(10).nullish(), orderId: z.union([text, count]).nullish() }).nullish() });
const visitSchema = z.object({ id: text, visitNumber: count.optional(), startedAt: timestamp, endedAt: timestamp, referrer: text.nullish(), utmSource: text.nullish(), events: z.array(eventSchema).max(1000) }).refine(value => Date.parse(value.endedAt) >= Date.parse(value.startedAt), 'Invalid visit interval');
const visitorObservationSchema = z.object({
    session: z.object({ id: text, visitorId: text, email: text.nullish(), city: text.nullish(), country: text.nullish(), deviceType: text.nullish(), browser: text.nullish(), os: text.nullish(), referrer: text.nullish(), utmSource: text.nullish(), lastActiveAt: timestamp, events: z.array(eventSchema).max(1000).optional() }),
    visits: z.array(visitSchema).max(200).optional(),
    customer: z.object({ firstName: text.nullish(), lastName: text.nullish(), email: text.nullish(), wooId: z.union([text, count]).nullish(), totalSpent: z.union([text, z.number().finite()]).nullish(), currency: z.string().max(10).nullish() }).nullish(),
    stats: z.object({ totalEvents: count, totalVisits: count.optional(), firstSeen: z.object({ createdAt: timestamp }).nullish() }),
});
function money(value: unknown, currency: unknown) {
    return (typeof value === 'string' || typeof value === 'number') && /^\d+(?:\.\d{1,4})?$/.test(String(value)) && typeof currency === 'string' && /^[A-Z]{3}$/.test(currency) ? `${currency} ${value}` : 'Monetary basis unavailable';
}
function EventObservation({ event }: { event: z.infer<typeof eventSchema> }) {
    const payload = event.payload;
    return <li className="space-y-1 border-l-2 border-slate-200 pl-3 dark:border-slate-600"><p><time dateTime={event.createdAt}>{new Date(event.createdAt).toLocaleString()}</time> · {event.type === 'purchase' ? 'Reported purchase event (payment/completion not verified)' : event.type.replace(/_/g, ' ')}</p>{event.pageTitle && <p>{event.pageTitle}</p>}{event.url && <a className="block break-all text-indigo-600 dark:text-indigo-300" href={getSafeHref(event.url)} target="_blank" rel="noreferrer">{event.url}</a>}{(payload?.productName || payload?.name) && <p>{payload.productName || payload.name}</p>}{(payload?.term || payload?.searchQuery) && <p>Reported search: {payload.term || payload.searchQuery}</p>}{payload?.quantity != null && <p>Reported quantity: {payload.quantity}</p>}{payload && (payload.total != null || payload.price != null) && <p>Reported {payload.total != null ? 'total' : 'unit price'}: {money(payload.total ?? payload.price, payload.currency)}</p>}{payload?.orderId != null && <p>Reported order reference: {payload.orderId}</p>}</li>;
}
function VisitorScope({ visitorId, accountId, onClose, token }: Props & { token: string }) {
    const [data, setData] = useState<z.infer<typeof visitorObservationSchema> | null>(null), [state, setState] = useState('loading');
    useEffect(() => {
        let active = true;
        const controller = new AbortController();
        void (async () => {
            try {
                if (!visitorId || visitorId.length > 200) throw new Error('Invalid visitor');
                const response = await fetch(`/api/analytics/visitors/${encodeURIComponent(visitorId)}`, { signal: AbortSignal.any([controller.signal, AbortSignal.timeout(15000)]), headers: { Authorization: `Bearer ${token}`, 'X-Account-ID': accountId } });
                if (!response.ok) throw new Error('Unavailable');
                const result = visitorObservationSchema.parse(JSON.parse(new TextDecoder().decode(await readBoundedBytes(response, 2 * 1024 * 1024))));
                if (result.session.visitorId !== visitorId) throw new Error('Visitor mismatch');
                const events = result.visits?.flatMap(visit => visit.events) ?? result.session.events ?? [];
                if (events.length > 2000 || new Set(events.map(event => event.id)).size !== events.length || new Set(result.visits?.map(visit => visit.id)).size !== (result.visits?.length ?? 0)) throw new Error('Observation identity/coverage invalid');
                if (active) { setData(result); setState('observed'); }
            } catch { if (active) setState('unavailable'); }
        })();
        return () => { active = false; controller.abort(); };
    }, [visitorId, accountId, token]);
    return <Modal isOpen onClose={onClose} title="Visitor observations" maxWidth="max-w-4xl"><div className="space-y-4 break-words text-slate-900 dark:text-slate-100">{state === 'loading' && <p role="status">Loading scoped visitor observations…</p>}{state === 'unavailable' && <p role="alert">Visitor observations unavailable. No not-found, identity or activity conclusion is inferred.</p>}{data && <><p>Visitor {visitorId} · {data.session.email || 'Identity not observed'}</p><p>Reported location: {[data.session.city, data.session.country].filter(Boolean).join(', ') || 'unavailable'} · device: {data.session.deviceType || 'unavailable'} · browser: {data.session.browser || 'unavailable'}</p><p>Reported source: {data.session.utmSource || data.session.referrer || 'unavailable (not inferred as direct)'}. Referrers and tags do not establish attribution.</p><p>Last activity: {new Date(data.session.lastActiveAt).toLocaleString()} · {data.stats.totalEvents} reported events{data.stats.totalVisits !== undefined ? ` / ${data.stats.totalVisits} reported visits` : ''}. This bounded response is not certified complete or live.</p>{data.customer && <section><h3 className="font-semibold">Reported customer association (not identity verification)</h3><p>{[data.customer.firstName, data.customer.lastName].filter(Boolean).join(' ') || 'Name unavailable'} · {data.customer.email || 'Email unavailable'}</p><p>Reported spend: {money(data.customer.totalSpent, data.customer.currency)}. Refund/net-spend basis is not established.</p></section>}{data.visits ? [...data.visits].sort((a, b) => Date.parse(b.startedAt) - Date.parse(a.startedAt)).map(visit => <details key={visit.id} className="rounded border p-3"><summary className="cursor-pointer">Visit {visit.visitNumber !== undefined ? `reported #${visit.visitNumber}` : visit.id} · {new Date(visit.startedAt).toLocaleString()} · {visit.events.length} observed event rows</summary><p>Reported interval ends {new Date(visit.endedAt).toLocaleString()}; interval is not active browsing duration.</p><ol className="space-y-3">{[...visit.events].sort((a, b) => Date.parse(a.createdAt) - Date.parse(b.createdAt)).map(event => <EventObservation key={event.id} event={event} />)}</ol>{!visit.events.length && <p>No event rows in this visit response.</p>}</details>) : <ol className="space-y-3">{data.session.events?.map(event => <EventObservation key={event.id} event={event} />)}</ol>}</>}</div></Modal>;
}
export default function VisitorProfileModal(props: Props) {
    const { token, user } = useAuth(), { currentAccount } = useAccount();
    if (!token || !user?.id || !currentAccount || currentAccount.id !== props.accountId) return <Modal isOpen onClose={props.onClose} title="Visitor observations"><p role="alert">Select the matching account before viewing visitor observations.</p></Modal>;
    return <VisitorScope key={JSON.stringify([user.id, token, props.accountId, props.visitorId])} {...props} token={token} />;
}
