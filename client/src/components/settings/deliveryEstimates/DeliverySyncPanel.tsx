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
    const { status, busy, error, queued, requestDisposition, backgroundPending, refresh, queue } = useDeliveryEstimateSync(accountId, token, canEdit, saveRevision);
    const progress = status?.progress;
    return <section aria-label="Settings and production sync readiness" className="space-y-3 rounded-lg border border-slate-200 dark:border-slate-700 p-4">
        <h3 className="font-semibold">Settings and production sync readiness</h3>
        <p className="text-sm">Sync copies saved settings, production times and staged supplier inputs. It does not establish complete delivery readiness or supplier availability. Check the launch panel for storefront activation; syncing does not activate storefront output.</p>
        {busy && <p role="status">{status ? 'Requesting sync status…' : 'Loading sync status…'}</p>}
        {error && <p role="alert" className="text-red-700 dark:text-red-300">{error} {status && 'The status below is from the last successful request.'}</p>}
        {status && <div className="space-y-1 text-sm" aria-live="polite">
            <p>{descriptions[status.configurationSync]}</p>
            {progress ? <>
                <dl className="grid grid-cols-2 gap-x-4 gap-y-1 sm:grid-cols-3">
                    {[
                        ['Total inputs', progress.totalInputs],
                        ['Current-version synced', status.syncedCount],
                        ['Acknowledged at least once', progress.acknowledgedInputs],
                        ['Queued / pending', progress.pendingInputs],
                        ['Blocked', progress.blockedInputs],
                        ['Failed', progress.failedInputs],
                        ['Plugin update required', progress.pluginUpdateRequiredInputs],
                    ].map(([label, count]) => <div key={label}><dt>{label}</dt><dd className="font-semibold tabular-nums">{count}</dd></div>)}
                </dl>
                <p>Data preparation: {progress.rebuildingProducts || progress.rebuildingInbound ? 'Saved data rebuild requested before sync.' : progress.dirtyProducts ? 'Waiting to rebuild saved product data.' : 'No data rebuild pending.'} Dirty products awaiting rebuild: {progress.dirtyProducts}.</p>
                <p>Product rebuild: {progress.rebuildingProducts ? 'Requested' : 'Idle'} · Inbound rebuild: {progress.rebuildingInbound ? 'Requested' : 'Idle'}</p>
                <details>
                    <summary className="cursor-pointer">Sync counts by scope</summary>
                    <ul className="space-y-2 pt-2">
                        {progress.scopes.map(scope => <li key={scope.scope}>
                            <strong>{{ settings: 'Settings', product: 'Products', inbound: 'Supplier inputs' }[scope.scope]}</strong>: Total {scope.total} · Current-version synced {scope.synced} · Acknowledged at least once {scope.acknowledged} · Queued / pending {scope.pending} · Blocked {scope.blocked} · Failed {scope.failed} · Plugin update required {scope.pluginUpdateRequired}
                        </li>)}
                    </ul>
                </details>
            </> : <>
                <p>Pending inputs: {status.pendingCount} · Synced inputs: {status.syncedCount}</p>
                <p>Synced inputs reflect current-version state. Acknowledged-at-least-once, rebuild and scope counts are unavailable from this server.</p>
            </>}
            <p>These are current-state counts, not cumulative job totals. Saved changes or data rebuilds can requeue inputs: current-version synced may fall while pending rises. This does not mean previously acknowledged data was lost. Acknowledged-at-least-once counts can overlap pending inputs.</p>
            {status.receiptSafety === 'unverified' && <p className="text-amber-800 dark:text-amber-200">Receipt safety is not yet verified. Managed-stock estimates remain unavailable, even after supplier inputs sync, until receipt and reversal safeguards are complete.</p>}
            {status.inboundCapability === 'plugin_update_required' && <p>Supplier input sync needs a newer companion plugin. Settings and production sync can continue independently.</p>}
            <p>Last acknowledged: {status.lastAcknowledgedAt ? <time dateTime={status.lastAcknowledgedAt}>{new Date(status.lastAcknowledgedAt).toLocaleString()}</time> : 'Never'}</p>
            {status.lastError && <p className="text-amber-800 dark:text-amber-200">Last sync error: {status.lastError}</p>}
        </div>}
        {queued && <p role="status">Sync request queued for background processing. This is not confirmation of completion. Refresh status to check progress.</p>}
        {requestDisposition === 'already_running' && <p role="status">Sync is already running and was not restarted. Refresh status to check progress.</p>}
        {requestDisposition === 'retrying' && <p role="status">Sync retry requested for inputs needing attention. Refresh status to check progress.</p>}
        {backgroundPending && <p className="text-sm">Background work is pending. Another full sync is disabled while it runs; refresh status to check progress.</p>}
        {dirty && <p role="note">Unsaved changes — save delivery settings first. Sync uses saved settings and production times only; unsaved drafts are not sent.</p>}
        {!canEdit && <p className="text-sm">Read only. Syncing requires manage_shipping_settings permission.</p>}
        <div className="flex flex-wrap gap-3">
            {canEdit && <button type="button" disabled={busy || dirty || saving || backgroundPending} onClick={() => { if (!dirty && !saving && !backgroundPending) void queue(); }} className="rounded-md bg-indigo-600 px-3 py-2 text-white disabled:opacity-50">Sync saved settings and production times</button>}
            <button type="button" disabled={busy} onClick={() => void refresh()} className="rounded-md border border-slate-300 dark:border-slate-600 px-3 py-2 disabled:opacity-50">Refresh sync status</button>
        </div>
    </section>;
}
