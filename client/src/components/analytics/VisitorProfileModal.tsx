import { useEffect, useId, useState } from 'react';
import { z } from 'zod';
import { Activity, ChevronDown, Clock, ExternalLink, Globe, Info, Loader2, MapPin, Search, ShoppingBag, ShoppingCart, User } from 'lucide-react';
import { Modal } from '../ui/Modal';
import { useAuth } from '../../context/AuthContext';
import { useAccount } from '../../context/AccountContext';
import { readBoundedBytes } from '../../utils/boundedResponse';
import { getSafeNavigationUrl } from '../../utils/url';
import { formatDateTimeSafe, formatTimeSafe } from '../../utils/format';
import { DeviceBrowserBadge } from './DeviceBrowserIcons';

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
type VisitorObservation = z.infer<typeof visitorObservationSchema>;
type Visit = z.infer<typeof visitSchema>;
type Event = z.infer<typeof eventSchema>;
const muted = 'text-slate-500 dark:text-slate-400';

function money(value: unknown, currency: unknown) {
    return (typeof value === 'string' || typeof value === 'number') && /^\d+(?:\.\d{1,4})?$/.test(String(value)) && typeof currency === 'string' && /^[A-Z]{3}$/.test(currency) ? `${currency} ${value}` : 'Monetary basis unavailable';
}

function EventObservation({ event }: { event: Event }) {
    const payload = event.payload;
    const presentation = event.type === 'purchase'
        ? { label: 'Purchase recorded', Icon: ShoppingBag, tone: 'bg-emerald-50 text-emerald-600 dark:bg-emerald-950 dark:text-emerald-400' }
        : event.type.includes('cart') || event.type === 'checkout_start'
            ? { label: event.type.replace(/_/g, ' '), Icon: ShoppingCart, tone: 'bg-amber-50 text-amber-600 dark:bg-amber-950 dark:text-amber-400' }
            : event.type === 'search'
                ? { label: 'Search', Icon: Search, tone: 'bg-violet-50 text-violet-600 dark:bg-violet-950 dark:text-violet-400' }
                : { label: event.type === 'pageview' ? 'Page view' : event.type.replace(/_/g, ' '), Icon: Globe, tone: 'bg-indigo-50 text-indigo-600 dark:bg-indigo-950 dark:text-indigo-400' };
    const { Icon } = presentation;
    const href = getSafeNavigationUrl(event.url);
    return <li className="relative flex min-w-0 gap-3 pb-5 last:pb-0">
        <span aria-hidden="true" className={`relative z-10 flex size-8 shrink-0 items-center justify-center rounded-full ring-4 ring-white dark:ring-slate-800 ${presentation.tone}`}><Icon size={14} /></span>
        <div className="min-w-0 flex-1 pt-0.5">
            <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
                <h5 className="text-xs font-semibold capitalize">{presentation.label}</h5>
                <time dateTime={event.createdAt} title={formatDateTimeSafe(event.createdAt)} className={`text-[11px] tabular-nums ${muted}`}>{formatTimeSafe(event.createdAt)}</time>
            </div>
            {(payload?.productName || payload?.name || event.pageTitle) && <p className="mt-1 break-words text-sm font-medium">{payload?.productName || payload?.name || event.pageTitle}</p>}
            {(payload?.term || payload?.searchQuery) && <p className="mt-1 break-words text-sm text-violet-700 dark:text-violet-300">“{payload.term || payload.searchQuery}”</p>}
            {event.url && (href ? <a className="mt-1 flex min-w-0 items-center gap-1 text-xs text-indigo-600 hover:underline dark:text-indigo-400" href={href} target="_blank" rel="noopener noreferrer" title={event.url}><span className="truncate">{event.url}</span><ExternalLink size={11} className="shrink-0" aria-hidden="true" /></a> : <p className={`mt-1 break-all text-xs ${muted}`}>{event.url}</p>)}
            {payload && <div className={`mt-1 flex flex-wrap gap-x-3 gap-y-1 text-xs ${muted}`}>
                {payload.sku && <span className="break-all">SKU: {payload.sku}</span>}
                {payload.quantity != null && <span>Quantity: {payload.quantity}</span>}
                {(payload.total != null || payload.price != null) && <span>{payload.total != null ? 'Total' : 'Unit price'}: {money(payload.total ?? payload.price, payload.currency)}</span>}
                {payload.orderId != null && <span className="break-all">Order reference: {payload.orderId}</span>}
            </div>}
            {event.type === 'purchase' && <p className={`mt-1 text-[11px] ${muted}`}>Payment and completion not verified.</p>}
        </div>
    </li>;
}

function EventTimeline({ events }: { events: Event[] }) {
    if (!events.length) return <p className={`py-4 text-center text-sm ${muted}`}>No event rows in this response.</p>;
    return <ol aria-label="Activity timeline" className="relative min-w-0 before:absolute before:bottom-4 before:left-4 before:top-2 before:w-px before:bg-slate-200 dark:before:bg-slate-700">
        {[...events].sort((a, b) => Date.parse(a.createdAt) - Date.parse(b.createdAt)).map(event => <EventObservation key={event.id} event={event} />)}
    </ol>;
}

function VisitSection({ visit, latest }: { visit: Visit; latest: boolean }) {
    const [expanded, setExpanded] = useState(latest);
    const contentId = useId();
    const seconds = Math.floor((Date.parse(visit.endedAt) - Date.parse(visit.startedAt)) / 1000);
    const interval = seconds >= 3600 ? `${Math.floor(seconds / 3600)}h ${Math.floor(seconds % 3600 / 60)}m` : seconds >= 60 ? `${Math.floor(seconds / 60)}m ${seconds % 60}s` : `${seconds}s`;
    return <section aria-label={visit.visitNumber !== undefined ? `Visit #${visit.visitNumber}` : `Visit ${visit.id}`} className="min-w-0 overflow-hidden rounded-xl border border-slate-200 dark:border-slate-700">
        <button type="button" aria-expanded={expanded} aria-controls={contentId} onClick={() => setExpanded(value => !value)} className="flex w-full items-start gap-2 bg-slate-50 px-3 py-3 text-left transition-colors hover:bg-slate-100 focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-indigo-500 dark:bg-slate-900/50 dark:hover:bg-slate-700/50">
            <ChevronDown size={16} aria-hidden="true" className={`mt-0.5 shrink-0 text-slate-400 transition-transform ${expanded ? '' : '-rotate-90'}`} />
            <span className="min-w-0 flex-1"><span className="flex flex-wrap items-center gap-2"><span className="break-all text-sm font-semibold">{visit.visitNumber !== undefined ? `Visit #${visit.visitNumber}` : 'Visit'}</span>{latest && <span className="rounded-full bg-indigo-100 px-2 py-0.5 text-[10px] font-medium text-indigo-700 dark:bg-indigo-950 dark:text-indigo-300">Latest</span>}</span><time dateTime={visit.startedAt} className={`mt-1 block text-xs ${muted}`}>{formatDateTimeSafe(visit.startedAt)}</time></span>
            <span className={`shrink-0 text-right text-[11px] ${muted}`}><span className="block">{visit.events.length} {visit.events.length === 1 ? 'event' : 'events'}</span><span className="mt-1 block" title="Observed interval, not engaged time">{interval} interval</span></span>
        </button>
        <div id={contentId} hidden={!expanded} className="border-t border-slate-100 p-4 dark:border-slate-700">
            {expanded && <>
                {(visit.utmSource || visit.referrer) && <div className={`mb-4 space-y-1 border-b border-slate-100 pb-3 text-xs dark:border-slate-700 ${muted}`}>
                    {visit.utmSource && <p className="break-all">Source tag: <span className="font-medium text-slate-700 dark:text-slate-300">{visit.utmSource}</span></p>}
                    {visit.referrer && <p className="break-all">Referrer: {visit.referrer}</p>}
                </div>}
                <EventTimeline events={visit.events} />
            </>}
        </div>
    </section>;
}

function VisitorProfile({ data, visitorId }: { data: VisitorObservation; visitorId: string }) {
    const session = data.session;
    const visits = data.visits ? [...data.visits].sort((a, b) => Date.parse(b.startedAt) - Date.parse(a.startedAt)) : null;
    const sectionTitle = 'text-[11px] font-semibold uppercase tracking-wider text-slate-400 dark:text-slate-500';
    return <div className="min-w-0 space-y-5">
        <header className="flex min-w-0 items-center gap-3">
            <div className="flex size-12 shrink-0 items-center justify-center rounded-2xl bg-indigo-50 text-indigo-600 dark:bg-indigo-950 dark:text-indigo-400"><User size={24} aria-hidden="true" /></div>
            <div className="min-w-0"><h2 className="break-all text-lg font-semibold">{session.email || 'Anonymous visitor'}</h2><p className={`mt-1 break-all font-mono text-[11px] ${muted}`}>Visitor {visitorId}</p></div>
        </header>
        <dl className="grid grid-cols-2 gap-3 sm:grid-cols-3">
            <div className="rounded-xl border border-slate-100 bg-slate-50 p-3 dark:border-slate-700 dark:bg-slate-900/50"><dt className={`text-xs ${muted}`}>Recorded events</dt><dd className="mt-1 text-xl font-semibold tabular-nums">{data.stats.totalEvents.toLocaleString()}</dd></div>
            <div className="rounded-xl border border-slate-100 bg-slate-50 p-3 dark:border-slate-700 dark:bg-slate-900/50"><dt className={`text-xs ${muted}`}>Recorded visits</dt><dd className="mt-1 text-xl font-semibold tabular-nums">{data.stats.totalVisits?.toLocaleString() ?? '—'}</dd></div>
            <div className="col-span-2 rounded-xl border border-slate-100 bg-slate-50 p-3 sm:col-span-1 dark:border-slate-700 dark:bg-slate-900/50"><dt className={`flex items-center gap-1 text-xs ${muted}`}><Clock size={12} aria-hidden="true" />Last activity</dt><dd className="mt-2 text-xs font-medium"><time dateTime={session.lastActiveAt}>{formatDateTimeSafe(session.lastActiveAt)}</time></dd></div>
        </dl>
        <div className="grid min-w-0 gap-5 md:grid-cols-[220px_minmax(0,1fr)]">
            <aside aria-label="Visitor details" className="min-w-0 space-y-5 rounded-xl bg-slate-50 p-4 dark:bg-slate-900/50">
                <section className="space-y-3"><h3 className={sectionTitle}>Details</h3>
                    <div className="flex items-start gap-2 text-sm"><MapPin size={15} aria-hidden="true" className="mt-0.5 shrink-0 text-slate-400" /><span className="break-words">{[session.city, session.country].filter(Boolean).join(', ') || 'Location unavailable'}</span></div>
                    <div className="space-y-1.5"><DeviceBrowserBadge deviceType={session.deviceType} browser={session.browser} os={session.os} /><p className="break-words text-xs capitalize">{session.deviceType || 'Device unavailable'}</p><p className={`break-words text-xs ${muted}`}>{session.browser || 'Browser unavailable'}{session.os ? ` · ${session.os}` : ''}</p></div>
                    {data.stats.firstSeen && <div className={`text-xs ${muted}`}>First seen<time className="mt-1 block text-slate-700 dark:text-slate-300" dateTime={data.stats.firstSeen.createdAt}>{formatDateTimeSafe(data.stats.firstSeen.createdAt)}</time></div>}
                </section>
                <section className="space-y-3 border-t border-slate-200 pt-4 dark:border-slate-700"><h3 className={sectionTitle}>Traffic source</h3><dl className="space-y-3 text-xs"><div><dt className={muted}>Source tag</dt><dd className="mt-1 break-all font-medium">{session.utmSource || 'Unavailable'}</dd></div><div><dt className={muted}>Referrer</dt><dd className="mt-1 break-all">{session.referrer || 'Unavailable'}</dd></div></dl></section>
                {data.customer && <section className="space-y-2 rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-xs dark:border-emerald-900 dark:bg-emerald-950/30"><h3 className="flex items-center gap-1.5 font-semibold text-emerald-800 dark:text-emerald-300"><ShoppingBag size={14} aria-hidden="true" />Associated customer</h3><p className="break-words font-medium">{[data.customer.firstName, data.customer.lastName].filter(Boolean).join(' ') || 'Name unavailable'}</p>{data.customer.email && <p className="break-all">{data.customer.email}</p>}{data.customer.wooId != null && <p className="break-all">WooCommerce #{data.customer.wooId}</p>}<p>Reported spend: {money(data.customer.totalSpent, data.customer.currency)}</p></section>}
            </aside>
            <section aria-label="Visit history" className="min-w-0"><h3 className="mb-3 flex items-center gap-2 text-sm font-semibold"><Activity size={16} aria-hidden="true" className="text-indigo-500" />Visit history</h3><div className="space-y-3">
                {visits ? visits.length ? visits.map((visit, index) => <VisitSection key={visit.id} visit={visit} latest={index === 0} />) : <p className={`py-6 text-center text-sm ${muted}`}>No visit rows in this response.</p> : <EventTimeline events={session.events || []} />}
            </div></section>
        </div>
        <details className={`rounded-lg border border-slate-100 px-3 py-2 text-xs dark:border-slate-700 ${muted}`}><summary className="flex cursor-pointer list-none items-center gap-2 font-medium"><Info size={14} aria-hidden="true" />About this activity data<ChevronDown size={12} aria-hidden="true" className="ml-auto" /></summary><div className="mt-2 space-y-1 leading-relaxed"><p>Recorded tracking data, not a complete or live activity feed. Visit intervals are not engaged time.</p><p>Missing sources are not inferred as direct. Referrers and tags do not establish attribution; a customer association does not verify identity.</p><p>Purchase events do not confirm payment or order completion. Reported spend is not verified net of refunds.</p></div></details>
    </div>;
}

function VisitorScope({ visitorId, accountId, onClose, token }: Props & { token: string }) {
    const [data, setData] = useState<VisitorObservation | null>(null), [state, setState] = useState('loading');
    const [attempt, setAttempt] = useState(0);
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
    }, [visitorId, accountId, token, attempt]);
    return <Modal isOpen onClose={onClose} title="Visitor profile" maxWidth="max-w-4xl"><div className="min-w-0 text-slate-900 dark:text-slate-100">
        {state === 'loading' ? <div role="status" className={`flex min-h-48 items-center justify-center gap-2 text-sm ${muted}`}><Loader2 size={18} aria-hidden="true" className="animate-spin motion-reduce:animate-none" />Loading visitor activity…</div>
            : state === 'unavailable' ? <div role="alert" className="rounded-xl border border-red-200 bg-red-50 p-5 text-sm text-red-700 dark:border-red-900 dark:bg-red-950/30 dark:text-red-300"><p className="font-medium">Visitor activity unavailable</p><p className="mt-1">We couldn’t load this visitor’s data. Please try again.</p><button type="button" onClick={() => { setState('loading'); setAttempt(value => value + 1); }} className="mt-3 rounded-lg border border-red-200 bg-white px-3 py-2 font-medium hover:bg-red-100 dark:border-red-800 dark:bg-slate-800 dark:hover:bg-slate-700">Retry visitor activity</button></div>
                : data && <VisitorProfile data={data} visitorId={visitorId} />}
    </div></Modal>;
}

export default function VisitorProfileModal(props: Props) {
    const { token, user } = useAuth(), { currentAccount } = useAccount();
    if (!token || !user?.id || !currentAccount || currentAccount.id !== props.accountId) return <Modal isOpen onClose={props.onClose} title="Visitor profile"><p role="alert">Select the matching account before viewing visitor observations.</p></Modal>;
    return <VisitorScope key={JSON.stringify([user.id, token, props.accountId, props.visitorId])} {...props} token={token} />;
}
