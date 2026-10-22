import { useState, type ReactNode } from 'react';
import { z } from 'zod';
import { useAccount } from '../../context/AccountContext';
import { useAuth } from '../../context/AuthContext';
import { usePermissions } from '../../hooks/usePermissions';
import { useScopedRequest } from '../../hooks/useScopedRequest';
import { useScopedMutation } from '../../hooks/useScopedMutation';
import { formatRelativeTime } from '../../utils/relativeTime';
import { approvedTrackingUrl } from '../../utils/shippingTrackingUrl';
const text = z.string().max(2000), date = z.string().datetime({ offset: true });
const labelSchema = z.object({ id: text.min(1), accountId: text.min(1), wooOrderId: z.number().int().positive(), updatedAt: date, carrier: text, trackingNumber: text.nullish(), trackingUrl: text.nullish(), latestTrackingStatus: text.nullish(), latestTrackingSummary: text.nullish(), serviceName: text.nullish(), status: text, hasMoreEvents: z.boolean(), trackingEvents: z.array(z.object({ id: text.min(1), normalizedState: text.nullish(), status: text.nullish(), description: text.nullish(), location: text.nullish(), occurredAt: date })).max(20) });
function decode(value: unknown) { return z.object({ accountId: text.min(1), wooOrderId: z.number().int().positive(), hasMoreLabels: z.boolean(), labels: z.array(labelSchema).max(50) }).parse(value); }
export function ShipmentMonitoringPanel({ wooOrderId, fallback }: { wooOrderId: number; fallback: ReactNode }) {
    const { token, user } = useAuth(), { currentAccount } = useAccount(), { hasPermission } = usePermissions();
    if (!token || !currentAccount || !Number.isSafeInteger(wooOrderId) || wooOrderId <= 0 || !hasPermission('view_shipping')) return <PanelShell><p>Shipment monitoring unavailable: current shipping read access and order required.</p></PanelShell>;
    return <ScopedMonitor key={JSON.stringify([user?.id, token, currentAccount.id, wooOrderId])} token={token} accountId={currentAccount.id} wooOrderId={wooOrderId} fallback={fallback} />;
}
function ScopedMonitor({ token, accountId, wooOrderId, fallback }: { token: string; accountId: string; wooOrderId: number; fallback: ReactNode }) {
    const read = useScopedRequest(`/api/shipping/orders/${wooOrderId}/shipments`, accountId, token, decode), mutation = useScopedMutation();
    const [blocked, setBlocked] = useState(false); const [operation, setOperation] = useState(() => crypto.randomUUID());
    const refresh = async (label: z.infer<typeof labelSchema>) => {
        if (blocked || mutation.isPending()) return;
        const result = await mutation.run(async signal => {
            const response = await fetch(`/api/shipping/labels/${encodeURIComponent(label.id)}/tracking/refresh`, { method: 'POST', signal, headers: { Authorization: `Bearer ${token}`, 'X-Account-ID': accountId, 'Content-Type': 'application/json' }, body: JSON.stringify({ operationId: operation, version: label.updatedAt, wooOrderId }) });
            if (!response.ok) throw new Error('Unacknowledged');
            const result = z.object({ labelId: text, eventsImported: z.number().int().nonnegative(), eventsTotal: z.number().int().nonnegative(), hadErrors: z.literal(false) }).parse(await response.json());
            if (result.labelId !== label.id || result.eventsImported !== result.eventsTotal) throw new Error('Partial refresh');
        }, 'Tracking refresh unconfirmed or partial. It may already have imported events or triggered automation. Reconcile this operation before another refresh.');
        if (!mutation.isActive()) return;
        if (result.ok) { setOperation(crypto.randomUUID()); read.retry(); } else setBlocked(true);
    };
    if (read.loading) return <PanelShell><p role="status">Loading shipment observations…</p></PanelShell>;
    if (read.error || !read.data || read.data.accountId !== accountId || read.data.wooOrderId !== wooOrderId || read.data.labels.some(label => label.accountId !== accountId || label.wooOrderId !== wooOrderId)) return <PanelShell><p role="alert">Shipment observations unavailable. This is not an empty shipment history.</p><button type="button" onClick={read.retry}>Retry shipment read</button></PanelShell>;
    return <PanelShell><h3 className="font-semibold">Shipment observations</h3>{mutation.error && <p role="alert">{mutation.error} Operation: {operation}</p>}{read.data.hasMoreLabels && <p>Partial label window: newest 50 only.</p>}{!read.data.labels.length ? <><p>No local labels observed for this order.</p>{fallback}</> : read.data.labels.map(label => { const url = approvedTrackingUrl(label.trackingUrl); return <section key={label.id} className="border-t py-3 space-y-2"><h4>{label.serviceName || label.carrier}</h4><p>{label.latestTrackingSummary || label.latestTrackingStatus || label.status || 'Tracking state unavailable'}</p><p>Local observation updated {formatRelativeTime(label.updatedAt)}. This is not proof of carrier freshness.</p><code>{label.trackingNumber || 'Tracking number unavailable'}</code><div className="flex gap-3"><button type="button" disabled={mutation.busy || blocked} onClick={() => void refresh(label)}>Refresh tracking for {label.trackingNumber || label.id}</button>{url && <a href={url} target="_blank" rel="noopener noreferrer">Open carrier tracking</a>}</div>{!label.trackingEvents.length ? <p>No scan events observed. Carrier coverage unknown.</p> : <><p>Showing newest {Math.min(5, label.trackingEvents.length)} events{label.hasMoreEvents || label.trackingEvents.length > 5 ? '; history is partial' : '; source completeness unknown'}.</p>{label.trackingEvents.slice(0, 5).map(event => <div key={event.id} className="rounded bg-slate-50 dark:bg-slate-800 p-2"><p>{event.normalizedState || event.status || 'Unknown scan state'}</p><p>{event.description || 'Description unavailable'}</p><p>{event.location} · {formatRelativeTime(event.occurredAt)}</p></div>)}</>}</section>; })}</PanelShell>;
}
function PanelShell({ children }: { children: ReactNode }) { return <div className="rounded-xl border bg-white dark:bg-slate-900 text-slate-900 dark:text-slate-100 p-5 space-y-4">{children}</div>; }
