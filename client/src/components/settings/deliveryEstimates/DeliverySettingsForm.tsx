import { useEffect, useEffectEvent, useRef, useState, type FormEvent } from 'react';
import { CalendarSettings } from './CalendarSettings';
import { ShippingTransitGrid } from './ShippingTransitGrid';
import { BrandingSettings } from './BrandingSettings';
import { DeliverySettingsError, requestSettings } from './api';
import { settingsErrors } from './validation';
import type { DeliverySettings } from './types';
import type { ShippingDiscovery } from './discovery';
import { ShippingDiscoveryPanel } from './ShippingDiscoveryPanel';
import { DeliverySyncPanel } from './DeliverySyncPanel';
import { DeliveryLaunchPanel } from './DeliveryLaunchPanel';

/** Mounted with an account/permission key so drafts and late responses cannot cross scopes. */
export function DeliverySettingsForm({ accountId, token, canEdit, canInventory = false }: { accountId: string; token: string; canEdit: boolean; canInventory?: boolean }) {
    const [settings, setSettings] = useState<DeliverySettings | null>(null);
    const [saved, setSaved] = useState('');
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);
    const [errors, setErrors] = useState<string[]>([]);
    const [blocked, setBlocked] = useState(false);
    const [success, setSuccess] = useState(false);
    const [saveRevision, setSaveRevision] = useState(0);
    const [attempt, setAttempt] = useState(0);
    const [discovery, setDiscovery] = useState<ShippingDiscovery | null>(null);
    const [unconfigured, setUnconfigured] = useState<string[]>([]);
    const controller = useRef<AbortController | null>(null);
    const saveInFlight = useRef(false);
    // Silent token refresh must not replace an in-progress merchant draft.
    const load = useEffectEvent((signal: AbortSignal) => requestSettings(accountId, token, signal));

    useEffect(() => {
        const request = new AbortController();
        controller.current = request;
        setLoading(true); setErrors([]); setBlocked(false); setSettings(null); setSuccess(false);
        load(request.signal).then(data => {
            if (request.signal.aborted) return;
            setSettings(data.settings); setSaved(JSON.stringify(data.settings));
        }).catch(error => {
            if (request.signal.aborted) return;
            setErrors([error instanceof DeliverySettingsError && error.code === 'FEATURE_DISABLED'
                ? 'Delivery estimates are disabled for this account. Contact a super admin.' : error.message || 'Unable to load delivery settings.']);
        }).finally(() => { if (!request.signal.aborted) setLoading(false); });
        return () => request.abort();
    }, [accountId, attempt]);

    const change = (value: DeliverySettings) => { setSettings(value); setSuccess(false); setErrors([]); };
    const save = async (event: FormEvent) => {
        event.preventDefault();
        if (!settings || !canEdit || blocked || saveInFlight.current || !controller.current) return;
        const validation = settingsErrors(settings);
        setErrors(validation); setSuccess(false);
        if (validation.length) return;
        const signal = controller.current.signal;
        saveInFlight.current = true; setSaving(true);
        try {
            const data = await requestSettings(accountId, token, signal, settings);
            if (signal.aborted) return;
            setSettings(data.settings); setSaved(JSON.stringify(data.settings)); setSuccess(true);
            setSaveRevision(revision => revision + 1);
        } catch (error) {
            if (signal.aborted) return;
            if (error instanceof DeliverySettingsError && (error.status === 403 || error.status === 401)) setBlocked(true);
            setErrors([error instanceof DeliverySettingsError && error.code === 'FEATURE_DISABLED'
                ? 'Delivery estimates were disabled for this account. Your draft has not been saved. Contact a super admin.'
                : error instanceof Error ? error.message : 'Unable to save delivery settings.']);
        } finally {
            saveInFlight.current = false;
            if (!signal.aborted) setSaving(false);
        }
    };
    return <>
        <DeliveryLaunchPanel accountId={accountId} token={token} canEdit={canEdit} canInventory={canInventory}
            dirty={settings !== null && JSON.stringify(settings) !== saved} saving={saving} saveRevision={saveRevision} setupUnavailable={loading || !settings || blocked} />
        {loading ? <p role="status">Loading delivery settings…</p> : <form onSubmit={save} className="space-y-6 text-slate-900 dark:text-slate-100
        [&_label]:text-sm [&_label]:font-medium [&_input:not([type=checkbox])]:block [&_input:not([type=checkbox])]:w-full
        [&_input:not([type=checkbox])]:rounded-md [&_input:not([type=checkbox])]:border [&_input:not([type=checkbox])]:p-2
        [&_input]:bg-white dark:[&_input]:bg-slate-900 [&_select]:block [&_select]:w-full [&_select]:rounded-md [&_select]:border [&_select]:p-2
        [&_select]:bg-white dark:[&_select]:bg-slate-900 [&_button]:rounded-md [&_button]:border [&_button]:px-3 [&_button]:py-2 [&_button:disabled]:opacity-50">
        <DeliverySyncPanel accountId={accountId} token={token} canEdit={canEdit} dirty={settings !== null && JSON.stringify(settings) !== saved} saving={saving} saveRevision={saveRevision} />
        {errors.length > 0 && <div role="alert" className="rounded-lg bg-red-50 dark:bg-red-950 p-4 text-red-800 dark:text-red-200">
            <ul className="list-disc pl-4">{errors.map((error, i) => <li key={i}>{error}</li>)}</ul>
        </div>}
        {!settings && <button type="button" onClick={() => setAttempt(value => value + 1)}>Retry loading</button>}
        {settings && <>
            {!canEdit && <p role="status">Read only. Managing these settings requires manage_shipping_settings permission.</p>}
            {blocked && <p>Saving is unavailable. Your draft is retained here; reload after account access is restored.</p>}
            <ShippingDiscoveryPanel accountId={accountId} token={token} canImport={canEdit && !saving && !blocked}
                settings={settings} onChange={change} discovery={discovery} onDiscovery={setDiscovery}
                onImported={keys => setUnconfigured(previous => [...previous, ...keys])} />
            <fieldset disabled={!canEdit || saving || blocked} className="space-y-8 min-w-0">
                <CalendarSettings settings={settings} onChange={change} />
                <ShippingTransitGrid settings={settings} onChange={change} discovery={discovery} unconfigured={unconfigured}
                    onConfigured={key => setUnconfigured(previous => previous.filter(value => value !== key))} />
                <BrandingSettings settings={settings} onChange={change} />
            </fieldset>
            {canEdit && <div className="flex flex-wrap gap-3 items-center">
                <button type="submit" disabled={saving || blocked || JSON.stringify(settings) === saved} className="bg-indigo-600 text-white">{saving ? 'Saving…' : 'Save delivery settings'}</button>
                <span className="text-sm">{JSON.stringify(settings) !== saved ? 'Unsaved changes' : 'No unsaved changes'}</span>
            </div>}
            {success && <p role="status" className="text-green-700 dark:text-green-300">Settings saved in Overseek. Check sync and launch publishing status above. Already-requested activation revalidates after sync; an explicit disable remains in effect. Shipping discovery is separate.</p>}
        </>}
    </form>}
    </>;
}
