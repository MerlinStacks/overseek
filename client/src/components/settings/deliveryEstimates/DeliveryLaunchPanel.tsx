import { useEffect, useId, useRef, useState } from 'react';
import { useDeliveryLaunch } from '../../../hooks/useDeliveryLaunch';
import { canActivate, isCutoverRecovery, preparationBlockReason, launchGuidance, type Attestation, type LegacyAttestation } from './launchApi';
import { ReceiptRecovery } from './ReceiptRecovery';
import { LegacyReceiptRecovery } from './LegacyReceiptRecovery';
import { PurchaseOrderReceiptRecovery } from './PurchaseOrderReceiptRecovery';

export interface DeliveryLaunchProps {
    accountId: string; token: string; canEdit: boolean; canInventory: boolean;
    canRead?: boolean;
    featureEnabled?: boolean; dirty?: boolean; saving?: boolean; saveRevision?: number; setupUnavailable?: boolean;
}

/** Scope the entire recovery form, UUIDs and confirmations, not only the fetched diagnostic. */
export function DeliveryLaunchPanel(props: DeliveryLaunchProps) {
    return <LaunchPanel key={`${props.accountId}:${props.canEdit}:${props.canInventory}:${props.canRead ?? true}`} {...props} />;
}
function LaunchPanel({ accountId, token, canEdit, canInventory, canRead = true, featureEnabled = true, dirty = false, saving = false, saveRevision = 0, setupUnavailable = false }: DeliveryLaunchProps) {
    const [open, setOpen] = useState(true);
    const [inView, setInView] = useState(true);
    const element = useRef<HTMLElement>(null);
    const [confirmations, setConfirmations] = useState([false, false, false]);
    const preparationHelpId = useId();
    const [busy, setBusy] = useState(false);
    const inFlight = useRef(false);
    const retryRequests = useRef(new Map<string, Attestation>());
    const legacyRetries = useRef(new Map<string, LegacyAttestation>());
    const [error, setError] = useState('');
    const [message, setMessage] = useState('');
    const launch = useDeliveryLaunch(accountId, token, canInventory, open && inView, saveRevision, canRead);
    const status = launch.readiness;
    useEffect(() => {
        if (!element.current || typeof IntersectionObserver === 'undefined') return;
        const observer = new IntersectionObserver(([entry]) => setInView(entry.isIntersecting));
        observer.observe(element.current);
        return () => observer.disconnect();
    }, []);
    const recoveringCutover = isCutoverRecovery(status);
    const draftBlocked = dirty || saving || setupUnavailable;
    const activationBlocked = !featureEnabled || draftBlocked || busy || launch.loading || !canActivate(status);
    const prepareReason = preparationBlockReason(status);
    const preparationBlocked = busy || launch.loading || !!prepareReason
        || (!recoveringCutover && (!featureEnabled || status?.blockers.includes('feature_disabled') || draftBlocked));
    const preparationHelp = busy ? 'Submitting your request. Wait for the response before changing confirmations.'
        : launch.loading ? 'Checking readiness. You can review the confirmations while this finishes.'
            : !canRead ? 'Readiness checks require view_shipping permission. Ask your account role manager to grant it before preparing cutover.'
                : prepareReason
                    ?? (!recoveringCutover && (!featureEnabled || status?.blockers.includes('feature_disabled'))
                        ? 'Delivery Estimates must be enabled before starting initial setup. Existing inventory recovery remains available.'
                        : !recoveringCutover && draftBlocked
                            ? 'Load and save your delivery settings before queueing cutover.'
                            : !confirmations.every(Boolean) ? 'Complete all three confirmations once the work is actually done.' : null);
    const queue = async (action: 'cutover' | 'certification' | 'activate' | 'disable') => {
        if (!canEdit || inFlight.current) return;
        if ((action === 'cutover' || action === 'certification') && (preparationBlocked || !canInventory || !confirmations.every(Boolean))) return;
        if (action === 'activate' && activationBlocked) return;
        inFlight.current = true; setBusy(true); setError(''); setMessage('');
        try {
            const ack = await launch.request<{ accepted: boolean; revision: string }>(action === 'activate' || action === 'disable' ? 'activation' : action,
                action === 'activate' || action === 'disable' ? { active: action === 'activate' }
                    : { receivingPaused: true, legacyJobsDrained: true, preupgradeWorkersRestarted: true });
            if (ack.accepted !== true || !/^\d+$/.test(ack.revision)) throw new Error('Unknown acknowledgement. Refresh state before retrying.');
            setMessage(`${action === 'disable' ? 'Disable' : action === 'activate' ? 'Activation' : action === 'certification' ? 'Certification' : 'Cutover'} queued (revision ${ack.revision}), not yet acknowledged by WooCommerce.`);
            setConfirmations([false, false, false]);
            await launch.refresh();
        } catch (e) {
            if (e instanceof Error && e.name !== 'AbortError') {
                setError(`${e.message} Refresh state and correct the reported cause before re-requesting.`);
                // A legacy-review conflict may have durably frozen receiving even though it returned 409.
                await launch.refresh();
            }
        } finally { inFlight.current = false; setBusy(false); }
    };
    return <section ref={element} aria-label="Delivery launch and recovery" className="space-y-3 rounded-xl border border-slate-200 dark:border-slate-700 p-4 text-sm [&_button]:rounded-md [&_button]:border [&_button]:px-3 [&_button]:py-2 [&_button:disabled]:opacity-50">
        <h3 className="text-lg font-semibold">Launch and receipt recovery</h3>
        <button type="button" aria-expanded={open} onClick={() => setOpen(value => !value)}>{open ? 'Hide launch details' : 'Show launch details'}</button>
        <div hidden={!open} className="space-y-3">
            <p>Refresh readiness, resolve blockers, pause receiving and certify stock owners, then explicitly activate. For an already requested activation, routine settings saves publish and revalidate automatically after sync. Saving never reverses an explicit disable.</p>
            <div className="flex flex-wrap gap-2">
                <button type="button" disabled={launch.loading} onClick={() => void launch.refresh()}>Refresh readiness and receipts</button>
                {canEdit && <button type="button" disabled={busy} onClick={() => void queue('disable')}>Disable storefront estimates</button>}
            </div>
            <p>Disable remains available with unsaved settings or the feature off. It queues a disable; it does not unfreeze receiving during cutover.</p>
            {!canEdit && <p>Read only launch controls. Activation and disable require manage_shipping_settings.</p>}
            {!canRead && <p>Readiness and settings require view_shipping. Your authorized disable or inventory-recovery controls remain available.</p>}
            {!canInventory && <p>Stock certification and receipt recovery require manage_inventory. An account role manager can grant it under Roles &amp; Team.</p>}
            {launch.loading && <p role="status">Refreshing launch state…</p>}
            {(launch.error || error) && <p role="alert">{launch.error} {error}</p>}
            {message && <p role="status">{message}</p>}
            {launch.pollingStopped && <p role="status">Automatic checks paused after 12 checks. Work may still be pending. Use Refresh readiness and receipts to check again.</p>}
            {status && <>
                <p className="font-semibold">{status.ready ? 'Server reports ready' : 'Not ready for activation'} · Verified storefront state: {status.active ? 'active' : 'inactive'} · Desired: {status.desiredActive ? 'active' : 'inactive'}</p>
                <p>Transport: {status.mode} · Cutover: {status.cutoverState} · Receiving: {status.receivingFrozen ? 'frozen' : 'not frozen'} · Control revision: {status.revision} / acknowledged: {status.acknowledgedRevision}</p>
                <p>Unresolved receipts: {status.unresolvedReceipts} · Legacy jobs: {status.unresolvedLegacyJobs} · Pending inputs: {status.pendingInputs} · Configured products: {status.configuredCount}</p>
                <p>Stale inputs: {status.freshness?.stale} · Unverified inputs: {status.freshness?.unverified} · Supported configured mappings: {status.providerSupport?.configuredSupported}</p>
                <p>Work: {status.work.action ?? 'none'} · Attempts: {status.work.attempts}{status.work.nextAttemptAt ? ` · Next attempt: ${status.work.nextAttemptAt}` : ''}</p>
                {status.revalidationRequested && <p role="status">Publishing settings / revalidating. Output is gated until synchronization and fresh readiness checks complete. Resolve the blockers below if publishing cannot finish.</p>}
                {status.actions?.revalidateActivation && <p>The store environment changed. Resolve blockers, refresh readiness and explicitly activate again to revalidate the plugin and checkout environment.</p>}
                {status.work.lastError && <p role="alert">Launch work error: {status.work.lastError}. Correct the cause, then re-request the operation below.</p>}
                {status.sync?.lastError && <p role="alert">Input sync error: {status.sync.lastError}</p>}
                {status.blockers.length > 0 && <div><h4 className="font-semibold">Activation blockers</h4><ul className="list-disc pl-5">{status.blockers.map(code => <li key={code}>{launchGuidance(code)} <code>({code})</code></li>)}</ul></div>}
                {status.warnings.length > 0 && <div><h4 className="font-semibold">Warnings and exclusions</h4><ul className="list-disc pl-5">{status.warnings.map(code => <li key={code}>{launchGuidance(code)} <code>({code})</code></li>)}</ul></div>}
                <p>Readiness is not proof of merchant-specific WBS compatibility. Unmapped rates and unsupported products remain unavailable.</p>
            </>}
            {draftBlocked && <p>Before initial setup or activation, save delivery settings first and wait for the save to finish. Disable, frozen-cutover recovery and receipt recovery remain available.</p>}
            {recoveringCutover && <p>Private cutover recovery can resume with the feature off, once diagnostics and server work state permit it. This does not activate storefront estimates.</p>}
            {canEdit && canInventory && <fieldset disabled={busy} aria-describedby={preparationHelpId} className="space-y-2">
                <legend className="font-semibold">Prepare cutover / stock-owner certification</legend>
                <p>Coordinate the receiving pause with your team. Ask your deployment operator to drain old process-local receipt work and restart every pre-upgrade API/worker process. Confirm only when completed.</p>
                <p className="text-slate-600 dark:text-slate-400">These checkboxes only record your confirmations. They do not pause receiving, restart workers or bypass readiness checks.</p>
                {['I have paused inventory receiving.', 'All legacy receipt jobs and pre-upgrade process-local receipt work have drained.', 'All pre-upgrade API and worker processes have been restarted.'].map((label, i) => <label className={`flex min-h-10 items-center gap-2 ${busy ? 'cursor-wait opacity-60' : 'cursor-pointer'}`} key={label}>
                    <input type="checkbox" className="h-4 w-4 shrink-0 accent-indigo-600" checked={confirmations[i]} onChange={e => setConfirmations(previous => previous.map((value, index) => index === i ? e.target.checked : value))} /> {label}
                </label>)}
                <div id={preparationHelpId} role="status" aria-live="polite" className="rounded-lg border border-slate-200 bg-slate-50 p-3 dark:border-slate-700 dark:bg-slate-900">
                    {preparationBlocked && <p className="font-semibold">Cutover cannot be queued yet.</p>}
                    <p>{preparationHelp ?? 'Confirmations complete. Queue cutover when you are ready.'}</p>
                    {(!status?.plugin || status?.blockers.includes('plugin_control_unavailable_or_upgrade_required')) && !launch.loading && <p className="mt-1">If you have already updated the companion plugin, use “Sync saved settings and production times” below, then “Refresh readiness and receipts”.</p>}
                </div>
                <button type="button" aria-describedby={preparationHelpId} disabled={preparationBlocked || !confirmations.every(Boolean)} onClick={() => void queue(status?.cutoverState === 'guarded' ? 'certification' : 'cutover')}>
                    {status?.cutoverState === 'guarded' ? 'Queue stock-owner certification' : 'Queue / resume cutover'}
                </button>
                <p>This freezes receiving while the durable worker certifies stock owners. Receiving resumes after the guarded handshake; inbound proofs rebuild afterwards. Output stays gated during certification. Previously requested activation is revalidated after fresh proofs are ready; disabled accounts remain inactive.</p>
            </fieldset>}
            {canEdit && <button type="button" className="bg-indigo-600 text-white" disabled={activationBlocked} onClick={() => void queue('activate')}>Activate storefront estimates</button>}
            <PurchaseOrderReceiptRecovery accountId={accountId} token={token} canInventory={canInventory} visible={open && inView} onChanged={() => void launch.refresh()} />
            {canInventory && <div className="space-y-3">
                <h4 className="font-semibold">Receipt operations</h4>
                <p>Up to 50 operations per page. Only parked, uncertain and failed-reconciliation receipts support corrected-count attestation.</p>
                {launch.receipts?.receipts.length === 0 && <p>No receipt operations on this page.</p>}
                {launch.receipts?.receipts.map(receipt => <ReceiptRecovery key={receipt.operationId} receipt={receipt} request={launch.request} retryRequests={retryRequests.current} onQueued={() => void launch.refresh()} />)}
                <div className="flex gap-2">
                    {launch.cursor && <button type="button" disabled={launch.loading} onClick={() => launch.setCursor('')}>First receipt page</button>}
                    {launch.receipts?.nextCursor && <button type="button" disabled={launch.loading} onClick={() => launch.setCursor(launch.receipts!.nextCursor!)}>Next receipt page</button>}
                </div>
                <h4 className="font-semibold">Legacy inventory review</h4>
                <p>Review up to 50 jobs per page. Observation-backed operator attestation never replays stock or BOM work. Once all jobs are drained, explicitly queue / resume cutover above; receiving stays frozen until then.</p>
                {launch.legacy?.jobs.length === 0 && <p>No legacy jobs on this page.</p>}
                {launch.legacy?.jobs.map(job => <LegacyReceiptRecovery key={job.id} job={job} request={launch.request} onChanged={() => void launch.refresh()} retryRequests={legacyRetries.current} />)}
                <div className="flex gap-2">
                    {launch.legacyCursor && <button type="button" disabled={launch.loading} onClick={() => launch.setLegacyCursor('')}>First legacy page</button>}
                    {launch.legacy?.nextCursor && <button type="button" disabled={launch.loading} onClick={() => launch.setLegacyCursor(launch.legacy!.nextCursor!)}>Next legacy page</button>}
                </div>
            </div>}
        </div>
    </section>;
}
