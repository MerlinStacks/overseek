import { useEffect, useEffectEvent, useRef, useState, type FormEvent } from 'react';
import { CalendarSettings } from './CalendarSettings';
import { SimpleShippingTimes } from './SimpleShippingTimes';
import { DeliverySettingsError, requestSettings } from './api';
import { settingsErrors } from './validation';
import { methodKey, type DeliverySettings } from './types';
import { useDeliveryLaunch } from '../../../hooks/useDeliveryLaunch';

/** Account/permission-keyed by the page; explicit enable persists through navigation. */
export function DeliverySettingsForm({ accountId, token, canEdit, featureEnabled = true, canRead = true }: {
    accountId: string; token: string; canEdit: boolean; featureEnabled?: boolean; canRead?: boolean;
}) {
    const [settings, setSettings] = useState<DeliverySettings | null>(null);
    const [saved, setSaved] = useState('');
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);
    const [errors, setErrors] = useState<string[]>([]);
    const [blocked, setBlocked] = useState(false);
    const [success, setSuccess] = useState(false);
    const [attempt, setAttempt] = useState(0);
    const [requested, setRequested] = useState<boolean | null>(null);
    const controller = useRef<AbortController | null>(null);
    const inFlight = useRef(false);
    const launch = useDeliveryLaunch(accountId, token, false, true, 0, canRead, true);
    const status = launch.readiness;
    const on = requested ?? (status ? status.desiredActive || (status.active && status.work.action !== 'disable') : false);
    const dirty = settings !== null && JSON.stringify(settings) !== saved;
    const load = useEffectEvent((signal: AbortSignal) => requestSettings(accountId, token, signal));
    useEffect(() => {
        if (requested !== null && status?.desiredActive === requested) setRequested(null);
    }, [requested, status?.desiredActive]);
    useEffect(() => {
        const request = new AbortController(); controller.current = request;
        if (!featureEnabled || !canRead) { setLoading(false); return () => request.abort(); }
        setLoading(true); setErrors([]); setBlocked(false);
        load(request.signal).then(data => {
            if (request.signal.aborted) return;
            setSettings(data.settings); setSaved(JSON.stringify(data.settings));
        }).catch(error => {
            if (!request.signal.aborted) setErrors([error.message || 'Could not load delivery settings.']);
        }).finally(() => { if (!request.signal.aborted) setLoading(false); });
        return () => request.abort();
    }, [accountId, attempt, featureEnabled, canRead]);

    const change = (value: DeliverySettings) => { setSettings(value); setSuccess(false); setErrors([]); };
    const save = async (enable = false) => {
        if (!settings || !canEdit || !featureEnabled || blocked || inFlight.current || !controller.current) return;
        const next = { ...settings, estimateMode: 'production' as const };
        const validation = settingsErrors(next);
        if (enable && !next.shippingMethods.some(row => row.enabled)) validation.push('Enter shipping times for at least one method below.');
        setErrors(validation); setSuccess(false);
        if (validation.length) return;
        inFlight.current = true; setSaving(true);
        const signal = controller.current.signal;
        try {
            const data = await requestSettings(accountId, token, signal, next, enable);
            if (signal.aborted) return;
            setSettings(data.settings); setSaved(JSON.stringify(data.settings)); setSuccess(!enable);
            if (enable) setRequested(true);
            await launch.refresh();
        } catch (error) {
            if (signal.aborted) return;
            if (error instanceof DeliverySettingsError && [401, 403].includes(error.status)) setBlocked(true);
            setErrors([error instanceof Error ? error.message : 'Could not save. Please try again.']);
        } finally { inFlight.current = false; if (!signal.aborted) setSaving(false); }
    };
    const disable = async () => {
        if (!canEdit || inFlight.current || !controller.current) return;
        const signal = controller.current.signal;
        inFlight.current = true; setSaving(true); setErrors([]); setSuccess(false);
        try {
            const result = await launch.request<{ accepted: boolean }>('activation', { active: false }, signal);
            if (result.accepted !== true) throw new Error('Could not confirm the change. Please try again.');
            if (signal.aborted) return;
            setRequested(false);
            await launch.refresh();
        } catch (error) {
            if (!signal.aborted) setErrors([error instanceof Error ? error.message : 'Could not turn off estimates.']);
        } finally { inFlight.current = false; if (!signal.aborted) setSaving(false); }
    };
    const submit = (event: FormEvent) => { event.preventDefault(); void save(); };
    const settled = status && !status.work.action && !status.revalidationRequested && (requested === null || status.desiredActive === requested);
    const failed = !!status?.work.action && status.work.attempts >= 8 && !!status.work.lastError;
    const confirmedOff = !on && !status?.active && status?.plugin?.state.active === false;
    const statusText = !canRead ? 'Store status unavailable' : !status ? 'Checking your store…'
        : confirmedOff ? 'Off' : failed ? on ? 'Could not turn on' : 'Could not confirm estimates are off'
        : !settled ? on ? 'Turning on…' : status.work.action === 'disable' ? 'Turning off…' : 'Off' : status.active ? 'On' : on ? 'Finishing setup…' : 'Off';
    const issue = status?.blockers.find(code => !['settings_not_synced_or_invalid', 'inputs_pending', 'no_eligible_configured_products', 'cutover_required'].includes(code));
    const help = issue === 'no_configured_products' ? 'Add production times to your products to show delivery dates.'
        : issue === 'no_supported_enabled_shipping_mapping' ? 'Enter shipping times for a supported method below.'
        : issue?.includes('plugin') ? 'Update or reconnect the Overseek WooCommerce plugin to finish enabling estimates.'
        : issue === 'receiving_frozen' ? 'An inventory update is still in progress. Estimates will be available once it finishes.'
        : issue && issue !== 'feature_disabled' ? 'Your store needs attention before estimates can appear. Contact support for help.' : null;
    return <div className="space-y-6">
        <section aria-label="Delivery estimates status" className="flex flex-wrap items-center justify-between gap-4 rounded-xl bg-slate-50 p-5 dark:bg-slate-900/50">
            <div><p role="status" className="text-lg font-semibold">{statusText}</p>
                <p className="mt-1 text-sm text-slate-600 dark:text-slate-400">Show delivery dates beside shipping methods at cart and checkout.</p></div>
            {canEdit && canRead && !launch.error && <button type="button" role="switch" aria-checked={on} aria-label="Delivery estimates"
                disabled={saving || (!on && (loading || !settings || blocked || !featureEnabled || !canRead || !status))}
                onClick={() => void (on ? disable() : save(true))}
                className={`inline-flex min-h-11 items-center gap-3 rounded-full px-4 py-2 font-semibold transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-600 disabled:opacity-50 ${on ? 'bg-indigo-600 text-white' : 'bg-slate-200 text-slate-800 dark:bg-slate-700 dark:text-slate-100'}`}>
                <span aria-hidden="true" className={`relative h-6 w-10 rounded-full ${on ? 'bg-indigo-400' : 'bg-slate-400'}`}><span className={`absolute top-1 h-4 w-4 rounded-full bg-white transition-transform ${on ? 'translate-x-5' : 'translate-x-1'}`} /></span>
                {on ? 'Turn off' : 'Turn on'}
            </button>}
            {canEdit && (!canRead || launch.error) && <button type="button" disabled={saving} onClick={() => void disable()} className="rounded-lg border border-slate-300 px-4 py-2 text-sm dark:border-slate-600">Turn off estimates</button>}
        </section>
        {!featureEnabled && <p role="alert">Delivery estimates are unavailable for this account. Contact your account administrator.</p>}
        {!canRead && <p>You do not have permission to view delivery settings.</p>}
        {help && on && <p role="status" className="text-sm text-amber-800 dark:text-amber-300">{help}</p>}
        {status?.estimateMode === 'production' && status.warnings.includes('production_products_not_synced') && <p role="status" className="text-sm text-slate-600 dark:text-slate-400">
            {status.eligibleConfiguredCount !== undefined ? `${status.eligibleConfiguredCount} of ${status.configuredCount} product timings synced. ` : ''}
            Remaining timings sync in the background. Estimates can appear for synced products once turned on.
        </p>}
        {errors.length > 0 && <div role="alert" className="rounded-lg bg-red-50 p-4 text-sm text-red-800 dark:bg-red-950 dark:text-red-200">{errors.map(error => <p key={error}>{error}</p>)}</div>}
        {launch.error && <p role="alert" className="text-sm">Could not check your store. <button type="button" className="underline" onClick={() => void launch.refresh()}>Try again</button></p>}
        {failed && !confirmedOff && <div role="alert" className="text-sm">
            <p>Your store could not confirm the change. Check the Overseek plugin connection, then retry.</p>
            {canEdit && <button type="button" disabled={saving} className="mt-2 underline" onClick={() => void (on ? save(true) : disable())}>Retry {on ? 'turning on' : 'turning off'}</button>}
        </div>}
        {loading && <p role="status">Loading delivery settings…</p>}
        {!settings && !loading && featureEnabled && canRead && <button type="button" onClick={() => setAttempt(value => value + 1)}>Retry loading</button>}
        {settings && featureEnabled && canRead && <form onSubmit={submit} className="space-y-6 [&_label]:text-sm [&_input:not([type=checkbox])]:mt-1 [&_input:not([type=checkbox])]:block [&_input:not([type=checkbox])]:w-full [&_input:not([type=checkbox])]:rounded-lg [&_input:not([type=checkbox])]:border [&_input:not([type=checkbox])]:p-2 [&_input]:bg-white dark:[&_input]:bg-slate-900 [&_select]:mt-1 [&_select]:block [&_select]:w-full [&_select]:rounded-lg [&_select]:border [&_select]:p-2 [&_select]:bg-white dark:[&_select]:bg-slate-900">
            {!canEdit && <p className="text-sm">You have read-only access to these settings.</p>}
            <p className="text-sm text-slate-500 dark:text-slate-400">Delivery dates use your product production times plus shipping time.</p>
            <fieldset disabled={!canEdit || saving || blocked} className="min-w-0 space-y-6">
                <CalendarSettings settings={settings} onChange={change} />
                <SimpleShippingTimes accountId={accountId} token={token} canEdit={canEdit && !saving && !blocked} settings={settings} onChange={change} />
                <details className="rounded-xl border border-slate-200 p-4 dark:border-slate-700">
                    <summary className="cursor-pointer text-sm font-medium">Show estimates on product pages</summary>
                    <div className="mt-3 space-y-3 text-sm">
                        <p>Place the <strong>Overseek Delivery Estimate</strong> block or <code className="select-all">[overseek_delivery_estimate]</code> on your product page.</p>
                        <label>Product-page shipping method<select value={settings.defaultMethod ? methodKey(settings.defaultMethod) : ''} onChange={event => {
                            const row = settings.shippingMethods.find(method => methodKey(method) === event.target.value);
                            change({ ...settings, defaultMethod: row ? { methodId: row.methodId, instanceId: row.instanceId, mappingKind: row.mappingKind, rateId: row.rateId } : null });
                        }}><option value="">Choose a shipping method</option>{settings.shippingMethods.filter(row => row.enabled).map(row => <option key={methodKey(row)} value={methodKey(row)}>{row.title} — {row.zoneName}</option>)}</select></label>
                    </div>
                </details>
            </fieldset>
            {canEdit && <div className="flex items-center gap-3"><button type="submit" disabled={saving || blocked || !dirty} className="rounded-lg bg-indigo-600 px-5 py-2.5 font-medium text-white disabled:opacity-50">{saving ? 'Saving…' : 'Save changes'}</button>
                {success && <p role="status" className="text-sm text-emerald-700 dark:text-emerald-300">Saved. Your store updates automatically.</p>}
            </div>}
        </form>}
    </div>;
}
