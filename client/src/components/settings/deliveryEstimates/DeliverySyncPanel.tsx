import { useDeliveryEstimateSync, type DeliverySyncStatus } from '../../../hooks/useDeliveryEstimateSync';

const descriptions: Record<DeliverySyncStatus['configurationSync'], string> = {
    not_requested: 'Not requested — queue an initial sync of saved inputs.',
    pending: 'Pending — saved inputs are queued for background sync. Refresh to check progress.',
    synced: 'Saved delivery inputs synced — configuration acknowledged by the plugin.',
    plugin_update_required: 'Plugin update required — sync is parked. Update the companion plugin, then retry using the sync button below.',
    blocked: 'Sync blocked — resolve the reported issue, then retry using the sync button below.',
    failed: 'Sync failed — retry using the sync button below.',
};

export function DeliverySyncPanel({ accountId, token, canEdit, dirty = false, saving = false, saveRevision = 0 }: {
    accountId: string; token: string; canEdit: boolean; dirty?: boolean; saving?: boolean; saveRevision?: number;
}) {
    const { status, busy, error, queued, refresh, queue } = useDeliveryEstimateSync(accountId, token, canEdit, saveRevision);
    return <section aria-label="Settings and production sync readiness" className="space-y-3 rounded-lg border border-slate-200 dark:border-slate-700 p-4">
        <h3 className="font-semibold">Settings and production sync readiness</h3>
        <p className="text-sm">Sync copies saved settings, production times and staged supplier inputs. It does not establish complete delivery readiness or supplier availability. Check the launch panel for storefront activation; syncing does not activate storefront output.</p>
        {busy && <p role="status">{status ? 'Requesting sync status…' : 'Loading sync status…'}</p>}
        {error && <p role="alert" className="text-red-700 dark:text-red-300">{error} {status && 'The status below is from the last successful request.'}</p>}
        {status && <div className="space-y-1 text-sm" aria-live="polite">
            <p>{descriptions[status.configurationSync]}</p>
            <p>Pending inputs: {status.pendingCount} · Synced inputs: {status.syncedCount}</p>
            {status.receiptSafety === 'unverified' && <p className="text-amber-800 dark:text-amber-200">Receipt safety is not yet verified. Managed-stock estimates remain unavailable, even after supplier inputs sync, until receipt and reversal safeguards are complete.</p>}
            {status.inboundCapability === 'plugin_update_required' && <p>Supplier input sync needs a newer companion plugin. Settings and production sync can continue independently.</p>}
            <p>Last acknowledged: {status.lastAcknowledgedAt ? <time dateTime={status.lastAcknowledgedAt}>{new Date(status.lastAcknowledgedAt).toLocaleString()}</time> : 'Never'}</p>
            {status.lastError && <p className="text-amber-800 dark:text-amber-200">Last sync error: {status.lastError}</p>}
        </div>}
        {queued && <p role="status">Sync request queued for background processing. This is not confirmation of completion. Refresh status to check progress.</p>}
        {dirty && <p role="note">Unsaved changes — save delivery settings first. Sync uses saved settings and production times only; unsaved drafts are not sent.</p>}
        {!canEdit && <p className="text-sm">Read only. Syncing requires manage_shipping_settings permission.</p>}
        <div className="flex flex-wrap gap-3">
            {canEdit && <button type="button" disabled={busy || dirty || saving} onClick={() => { if (!dirty && !saving) void queue(); }} className="rounded-md bg-indigo-600 px-3 py-2 text-white disabled:opacity-50">Sync saved settings and production times</button>}
            <button type="button" disabled={busy} onClick={() => void refresh()} className="rounded-md border border-slate-300 dark:border-slate-600 px-3 py-2 disabled:opacity-50">Refresh sync status</button>
        </div>
    </section>;
}
