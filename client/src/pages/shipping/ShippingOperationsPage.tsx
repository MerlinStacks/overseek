import { useState } from 'react';
import { Activity, AlertTriangle, Printer, RotateCcw, Send } from 'lucide-react';
import { useAccount } from '../../context/AccountContext';
import { useAuth } from '../../context/AuthContext';
import { useApiMutation, useApiQuery } from '../../hooks/useApiQuery';
import { ShippingComingSoonCard, ShippingPageShell } from './ShippingPageShell';
import { shippingFetch, type ShippingAuditEventRecord, type ShippingLabelRecord, type ShippingPrintJobRecord, type ShippingPrintStation, type ShippingSettingsResponse, type ShippingTrackingHealthSummary } from './shippingApi';

export function ShippingOperationsPage() {
    const { token } = useAuth();
    const { currentAccount } = useAccount();
    const [selectedStations, setSelectedStations] = useState<Record<string, string>>({});
    const [auditSearch, setAuditSearch] = useState('');
    const [auditType, setAuditType] = useState('all');
    const [expandedAuditId, setExpandedAuditId] = useState<string | null>(null);
    const canFetch = Boolean(token && currentAccount?.id);

    const printJobsQuery = useApiQuery<{ printJobs: ShippingPrintJobRecord[] }>({
        queryKey: ['shipping-print-jobs', currentAccount?.id],
        enabled: canFetch,
        queryFn: () => shippingFetch('/print-jobs?limit=100', token!, currentAccount!.id),
    });
    const auditEventsQuery = useApiQuery<{ auditEvents: ShippingAuditEventRecord[] }>({
        queryKey: ['shipping-audit-events', currentAccount?.id],
        enabled: canFetch,
        queryFn: () => shippingFetch('/audit-events?limit=100', token!, currentAccount!.id),
    });
    const printStationsQuery = useApiQuery<{ printStations: ShippingPrintStation[] }>({
        queryKey: ['shipping-print-stations', currentAccount?.id],
        enabled: canFetch,
        queryFn: () => shippingFetch('/print-stations', token!, currentAccount!.id),
    });
    const settingsQuery = useApiQuery<ShippingSettingsResponse>({
        queryKey: ['shipping-settings', currentAccount?.id],
        enabled: canFetch,
        queryFn: () => shippingFetch('/settings', token!, currentAccount!.id),
    });
    const labelsQuery = useApiQuery<{ labels: ShippingLabelRecord[] }>({
        queryKey: ['shipping-labels', currentAccount?.id],
        enabled: canFetch,
        queryFn: () => shippingFetch('/labels?limit=200', token!, currentAccount!.id),
    });
    const trackingHealthQuery = useApiQuery<ShippingTrackingHealthSummary>({
        queryKey: ['shipping-tracking-health', currentAccount?.id],
        enabled: canFetch,
        queryFn: () => shippingFetch('/tracking/health', token!, currentAccount!.id),
    });
    const retryPrintJob = useApiMutation<{ printJob: ShippingPrintJobRecord }, string>({
        invalidateQueries: [['shipping-print-jobs', currentAccount?.id], ['shipping-audit-events', currentAccount?.id]],
        mutationFn: (jobId) => shippingFetch(`/print-jobs/${jobId}/retry`, token!, currentAccount!.id, { method: 'POST' }),
    });
    const reassignPrintJob = useApiMutation<{ printJob: ShippingPrintJobRecord }, { jobId: string; printStationId: string }>({
        invalidateQueries: [['shipping-print-jobs', currentAccount?.id], ['shipping-audit-events', currentAccount?.id]],
        mutationFn: ({ jobId, printStationId }) => shippingFetch(`/print-jobs/${jobId}/reassign`, token!, currentAccount!.id, {
            method: 'POST',
            body: JSON.stringify({ printStationId }),
        }),
    });

    const auditEvents = auditEventsQuery.data?.auditEvents || [];
    const auditTypes = Array.from(new Set(auditEvents.map((event) => event.eventType))).sort();
    const normalizedAuditSearch = auditSearch.trim().toLowerCase();
    const filteredAuditEvents = auditEvents.filter((event) => {
        if (auditType !== 'all' && event.eventType !== auditType) return false;
        if (!normalizedAuditSearch) return true;
        return [
            event.eventType,
            event.orderId || '',
            event.label?.wooOrderId ? String(event.label.wooOrderId) : '',
            event.label?.trackingNumber || '',
            JSON.stringify(event.metadata || {}),
        ].some((value) => value.toLowerCase().includes(normalizedAuditSearch));
    });
    const settingsConfig = settingsQuery.data?.carrierAccount?.config || {};
    const allowlist = Array.isArray(settingsConfig.trackingAutomationAllowlist)
        ? settingsConfig.trackingAutomationAllowlist.map((value) => String(value))
        : [];
    const pollIntervalMinutes = Number(settingsConfig.trackingPollIntervalMinutes || 30);
    const failureBackoffMinutes = Number(settingsConfig.trackingPollFailureBackoffMinutes || 60);
    const labels = labelsQuery.data?.labels || [];
    const trackedLabels = labels.filter((label) => Boolean(label.trackingNumber));
    const terminalStatuses = new Set(['cancelled', 'delivered', 'returned', 'expired', 'exception']);
    const activeTracked = trackedLabels.filter((label) => !terminalStatuses.has(label.status));
    const staleBefore = Date.now() - pollIntervalMinutes * 60 * 1000;
    const staleTracked = activeTracked.filter((label) => {
        const syncedAt = label.trackingSyncedAt;
        if (!syncedAt) return true;
        return new Date(syncedAt).getTime() < staleBefore;
    });
    const recentSyncFailures = labels.filter((label) => (label.errorMessage || '').toLowerCase().includes('woo') || (label.errorMessage || '').toLowerCase().includes('tracking'));

    return (
        <ShippingPageShell
            title="Operations"
            description="Monitor print jobs, retry failed local print work, and review Shipping Hub audit events."
        >
            <ShippingComingSoonCard>
                <div className="mb-4 flex items-center gap-3">
                    <Activity className="text-indigo-600" size={22} />
                    <h2 className="text-lg font-bold text-slate-900 dark:text-white">Tracking Controls</h2>
                </div>
                {trackingHealthQuery.data ? (
                    <p className="mb-3 text-xs text-slate-500 dark:text-slate-400">
                        Health status: <span className="font-semibold text-slate-700 dark:text-slate-200">{trackingHealthQuery.data.status}</span> over last {trackingHealthQuery.data.windowHours}h.
                    </p>
                ) : null}
                <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
                    <div className="rounded-xl border border-slate-200 p-3 dark:border-slate-700">
                        <p className="text-xs font-semibold uppercase text-slate-500 dark:text-slate-400">Poll interval</p>
                        <p className="mt-1 text-sm font-bold text-slate-900 dark:text-white">{pollIntervalMinutes} min</p>
                    </div>
                    <div className="rounded-xl border border-slate-200 p-3 dark:border-slate-700">
                        <p className="text-xs font-semibold uppercase text-slate-500 dark:text-slate-400">Failure backoff</p>
                        <p className="mt-1 text-sm font-bold text-slate-900 dark:text-white">{failureBackoffMinutes} min</p>
                    </div>
                    <div className="rounded-xl border border-slate-200 p-3 dark:border-slate-700">
                        <p className="text-xs font-semibold uppercase text-slate-500 dark:text-slate-400">Active tracked labels</p>
                        <p className="mt-1 text-sm font-bold text-slate-900 dark:text-white">{activeTracked.length}</p>
                    </div>
                    <div className="rounded-xl border border-slate-200 p-3 dark:border-slate-700">
                        <p className="text-xs font-semibold uppercase text-slate-500 dark:text-slate-400">Currently stale</p>
                        <p className="mt-1 text-sm font-bold text-slate-900 dark:text-white">{staleTracked.length}</p>
                    </div>
                </div>
                <div className="mt-4 grid gap-3 xl:grid-cols-2">
                    <div className="rounded-xl border border-slate-200 p-3 dark:border-slate-700">
                        <p className="text-xs font-semibold uppercase text-slate-500 dark:text-slate-400">Automation allowlist</p>
                        <p className="mt-1 text-xs text-slate-600 dark:text-slate-300">
                            {allowlist.length > 0 ? allowlist.join(', ') : 'No shipment triggers enabled yet (safe default).'}
                        </p>
                    </div>
                    <div className="rounded-xl border border-slate-200 p-3 dark:border-slate-700">
                        <p className="text-xs font-semibold uppercase text-slate-500 dark:text-slate-400">Recent sync issues</p>
                        <p className="mt-1 text-xs text-slate-600 dark:text-slate-300">{recentSyncFailures.length} labels with recorded sync/tracking errors.</p>
                    </div>
                </div>
                {trackingHealthQuery.data ? (
                    <div className="mt-3 grid gap-3 md:grid-cols-3">
                        <div className="rounded-lg bg-slate-50 p-3 text-xs text-slate-600 dark:bg-slate-900 dark:text-slate-300">Poll failures (24h): <span className="font-semibold">{trackingHealthQuery.data.recentPollFailures}</span></div>
                        <div className="rounded-lg bg-slate-50 p-3 text-xs text-slate-600 dark:bg-slate-900 dark:text-slate-300">Adapter unavailable (24h): <span className="font-semibold">{trackingHealthQuery.data.recentAdapterUnavailable}</span></div>
                        <div className="rounded-lg bg-slate-50 p-3 text-xs text-slate-600 dark:bg-slate-900 dark:text-slate-300">Stale tracked labels: <span className="font-semibold">{trackingHealthQuery.data.staleTrackedLabels}</span></div>
                    </div>
                ) : null}
                <div className="mt-4 rounded-xl border border-slate-200 p-3 dark:border-slate-700">
                    <p className="text-xs font-semibold uppercase text-slate-500 dark:text-slate-400">Print station health</p>
                    <div className="mt-2 grid gap-2 md:grid-cols-2 xl:grid-cols-3">
                        {printStationsQuery.data?.printStations.map((station) => (
                            <div key={station.id} className="rounded-lg bg-slate-50 p-3 text-xs text-slate-600 dark:bg-slate-900 dark:text-slate-300">
                                <p className="font-semibold text-slate-900 dark:text-white">{station.name}</p>
                                <p>Status: {station.status}</p>
                                <p>Agent: {station.agentVersion || 'unknown'}{station.minimumSupportedVersion ? ` (min ${station.minimumSupportedVersion})` : ''}</p>
                                <p>Printer: {station.defaultPrinterName || 'system default'}</p>
                                {station.lastErrorMessage ? <p className="mt-1 text-red-600 dark:text-red-300">{station.lastErrorMessage}</p> : null}
                            </div>
                        ))}
                        {(printStationsQuery.data?.printStations.length || 0) === 0 ? <p className="text-xs text-slate-500 dark:text-slate-400">No print stations registered.</p> : null}
                    </div>
                </div>
            </ShippingComingSoonCard>
            <div className="grid gap-6 xl:grid-cols-[1.2fr_0.8fr]">
                <ShippingComingSoonCard>
                    <div className="mb-4 flex items-center gap-3">
                        <Printer className="text-indigo-600" size={22} />
                        <h2 className="text-lg font-bold text-slate-900 dark:text-white">Print Queue</h2>
                    </div>
                    {printJobsQuery.isLoading ? <p className="text-sm text-slate-500">Loading print jobs...</p> : null}
                    {printJobsQuery.error ? <p className="text-sm text-red-600">{printJobsQuery.error.message}</p> : null}
                    {retryPrintJob.error ? <p className="mb-3 text-sm text-red-600">{retryPrintJob.error.message}</p> : null}
                    {reassignPrintJob.error ? <p className="mb-3 text-sm text-red-600">{reassignPrintJob.error.message}</p> : null}
                    {(printJobsQuery.data?.printJobs.length || 0) === 0 && !printJobsQuery.isLoading ? <p className="text-sm text-slate-500 dark:text-slate-400">No print jobs have been queued yet.</p> : null}
                    <div className="space-y-3">
                        {printJobsQuery.data?.printJobs.map((job) => {
                            const canRetry = ['failed', 'station_offline'].includes(job.status);
                            const canReassign = ['queued', 'failed', 'station_offline'].includes(job.status);
                            return (
                                <div key={job.id} className="rounded-xl border border-slate-200 p-4 dark:border-slate-700">
                                    <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                                        <div>
                                            <p className="font-semibold text-slate-900 dark:text-white">Order #{job.label?.wooOrderId || '-'} · {job.printStation?.name || 'Unknown station'}</p>
                                            <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">{job.label?.serviceName || 'Label'} · {job.label?.trackingNumber || 'No tracking'} · attempts {job.attempts}</p>
                                            <p className="mt-2 text-xs text-slate-500 dark:text-slate-400">Requested {new Date(job.requestedAt).toLocaleString()} · Picked up {job.pickedUpAt ? new Date(job.pickedUpAt).toLocaleString() : 'not yet'} · Printed {job.printedAt ? new Date(job.printedAt).toLocaleString() : 'not yet'}</p>
                                            {job.errorMessage ? <p className="mt-2 flex items-center gap-2 text-sm text-red-600"><AlertTriangle size={14} /> {job.errorMessage}</p> : null}
                                        </div>
                                        <div className="flex flex-wrap items-center gap-2">
                                            <StatusBadge status={job.status} />
                                            <select
                                                value={selectedStations[job.id] || job.printStationId}
                                                onChange={(event) => setSelectedStations((current) => ({ ...current, [job.id]: event.target.value }))}
                                                disabled={!canReassign}
                                                className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs font-semibold text-slate-700 disabled:opacity-50 dark:border-slate-600 dark:bg-slate-900 dark:text-slate-200"
                                            >
                                                {printStationsQuery.data?.printStations.map((station) => <option key={station.id} value={station.id}>{station.name}</option>)}
                                            </select>
                                            <button
                                                type="button"
                                                onClick={() => reassignPrintJob.mutate({ jobId: job.id, printStationId: selectedStations[job.id] || job.printStationId })}
                                                disabled={!canReassign || reassignPrintJob.isPending || (selectedStations[job.id] || job.printStationId) === job.printStationId}
                                                className="inline-flex items-center gap-2 rounded-lg border border-indigo-200 px-3 py-2 text-xs font-semibold text-indigo-700 hover:bg-indigo-50 disabled:cursor-not-allowed disabled:opacity-50 dark:border-indigo-500/40 dark:text-indigo-300 dark:hover:bg-indigo-500/10"
                                            >
                                                <Send size={14} /> Reassign
                                            </button>
                                            <button
                                                type="button"
                                                onClick={() => retryPrintJob.mutate(job.id)}
                                                disabled={!canRetry || retryPrintJob.isPending}
                                                className="inline-flex items-center gap-2 rounded-lg border border-indigo-200 px-3 py-2 text-xs font-semibold text-indigo-700 hover:bg-indigo-50 disabled:cursor-not-allowed disabled:opacity-50 dark:border-indigo-500/40 dark:text-indigo-300 dark:hover:bg-indigo-500/10"
                                            >
                                                <RotateCcw size={14} /> Retry
                                            </button>
                                        </div>
                                    </div>
                                </div>
                            );
                        })}
                    </div>
                </ShippingComingSoonCard>

                <ShippingComingSoonCard>
                    <div className="mb-4 flex items-center gap-3">
                        <Activity className="text-indigo-600" size={22} />
                        <h2 className="text-lg font-bold text-slate-900 dark:text-white">Audit Log</h2>
                    </div>
                    <div className="mb-4 grid gap-3 md:grid-cols-[1fr_180px]">
                        <label className="block text-sm font-semibold text-slate-700 dark:text-slate-200">
                            Search audit
                            <input
                                value={auditSearch}
                                onChange={(event) => setAuditSearch(event.target.value)}
                                placeholder="Event, order, tracking, metadata"
                                className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm dark:border-slate-600 dark:bg-slate-900"
                            />
                        </label>
                        <label className="block text-sm font-semibold text-slate-700 dark:text-slate-200">
                            Event type
                            <select value={auditType} onChange={(event) => setAuditType(event.target.value)} className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm dark:border-slate-600 dark:bg-slate-900">
                                <option value="all">All events</option>
                                {auditTypes.map((type) => <option key={type} value={type}>{type.replace(/_/g, ' ')}</option>)}
                            </select>
                        </label>
                    </div>
                    <div className="mb-4 flex flex-wrap gap-2">
                        <button
                            type="button"
                            onClick={() => setAuditSearch('TRACKING_')}
                            className="rounded-lg border border-slate-200 px-3 py-1 text-xs font-semibold text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-200 dark:hover:bg-slate-800"
                        >
                            Tracking events
                        </button>
                        <button
                            type="button"
                            onClick={() => setAuditSearch('LABEL_PRINT_FULFILLMENT_SYNC_FAILED')}
                            className="rounded-lg border border-slate-200 px-3 py-1 text-xs font-semibold text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-200 dark:hover:bg-slate-800"
                        >
                            Fulfilment failures
                        </button>
                        <button
                            type="button"
                            onClick={() => { setAuditSearch(''); setAuditType('all'); }}
                            className="rounded-lg border border-slate-200 px-3 py-1 text-xs font-semibold text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-200 dark:hover:bg-slate-800"
                        >
                            Clear
                        </button>
                    </div>
                    {auditEventsQuery.isLoading ? <p className="text-sm text-slate-500">Loading audit events...</p> : null}
                    {auditEventsQuery.error ? <p className="text-sm text-red-600">{auditEventsQuery.error.message}</p> : null}
                    {auditEvents.length === 0 && !auditEventsQuery.isLoading ? <p className="text-sm text-slate-500 dark:text-slate-400">No shipping audit events yet.</p> : null}
                    {auditEvents.length > 0 && filteredAuditEvents.length === 0 ? <p className="text-sm text-slate-500 dark:text-slate-400">No audit events match the current filters.</p> : null}
                    <div className="space-y-3">
                        {filteredAuditEvents.map((event) => (
                            <div key={event.id} className="rounded-xl border border-slate-200 p-4 dark:border-slate-700">
                                <p className="font-semibold text-slate-900 dark:text-white">{event.eventType.replace(/_/g, ' ')}</p>
                                <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">{new Date(event.createdAt).toLocaleString()} · Order {event.label?.wooOrderId || event.orderId || '-'}</p>
                                {event.metadata && Object.keys(event.metadata).length > 0 ? <p className="mt-2 line-clamp-3 rounded bg-slate-50 p-2 text-xs text-slate-600 dark:bg-slate-900 dark:text-slate-300">{JSON.stringify(event.metadata)}</p> : null}
                                <button
                                    type="button"
                                    onClick={() => setExpandedAuditId((current) => current === event.id ? null : event.id)}
                                    className="mt-3 rounded-lg border border-slate-200 px-3 py-1 text-xs font-semibold text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-200 dark:hover:bg-slate-800"
                                >
                                    {expandedAuditId === event.id ? 'Hide details' : 'View details'}
                                </button>
                                {expandedAuditId === event.id ? (
                                    <div className="mt-3 space-y-2">
                                        <AuditJsonBlock title="Metadata" value={event.metadata} />
                                        <AuditJsonBlock title="Before" value={event.beforeSnapshot} />
                                        <AuditJsonBlock title="After" value={event.afterSnapshot} />
                                    </div>
                                ) : null}
                            </div>
                        ))}
                    </div>
                </ShippingComingSoonCard>
            </div>
        </ShippingPageShell>
    );
}

function AuditJsonBlock({ title, value }: { title: string; value?: Record<string, unknown> | null }) {
    if (!value || Object.keys(value).length === 0) return null;
    return (
        <div>
            <p className="text-xs font-semibold uppercase text-slate-500 dark:text-slate-400">{title}</p>
            <pre className="mt-1 max-h-56 overflow-auto rounded-lg bg-slate-950 p-3 text-xs text-slate-100">{JSON.stringify(value, null, 2)}</pre>
        </div>
    );
}

function StatusBadge({ status }: { status: string }) {
    const tone = status === 'printed'
        ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300'
        : status === 'failed' || status === 'station_offline'
            ? 'bg-red-100 text-red-700 dark:bg-red-500/15 dark:text-red-300'
            : 'bg-slate-100 text-slate-700 dark:bg-slate-700 dark:text-slate-200';
    return <span className={`rounded-full px-2 py-1 text-xs font-semibold uppercase ${tone}`}>{status.replace(/_/g, ' ')}</span>;
}
