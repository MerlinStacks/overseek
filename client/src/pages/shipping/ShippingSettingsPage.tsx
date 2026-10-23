import { useEffect, useRef, useState } from 'react';
import { z } from 'zod';
import { usePermissions } from '../../hooks/usePermissions';
import { ShippingPageShell } from './ShippingPageShell';
import { ShippingBoundary, ShippingReadState, identity, date, useDraftUnload, useShippingRead, type ShippingScope } from './shippingWorkspace';
import { shippingFetch } from './shippingApi';
import { KeyRound, MapPin, Printer, Settings, ShieldCheck } from 'lucide-react';
import { workspaceStyles as ui } from '../../components/ui/workspaceStyles';
import { DataNote } from '../../components/ui/DataNote';

const configSchema = z.record(z.string().max(100), z.unknown());
const settingsSchema = z.object({ accountId: identity, credentialsConfigured: z.boolean(), carrierAccount: z.object({ id: identity, updatedAt: date, displayName: z.string().max(120), isEnabled: z.boolean(), config: configSchema.nullish(), senderAddress: configSchema.nullish() }).nullable() });
const stationSchema = z.object({ id: identity, name: z.string().max(120), updatedAt: date, status: z.string().max(80), lastSeenAt: date.nullish() });
function decodeSettings(value: unknown) { return settingsSchema.parse(value); }
function decodeStations(value: unknown) { return z.object({ accountId: identity, printStations: z.array(stationSchema).max(100), partial: z.boolean() }).parse(value); }
const defaults: Record<string, string | boolean | number> = {
    apiProduct: 'SHIPPING_AND_TRACKING', apiEnvironment: 'sandbox', apiBaseUrl: 'https://digitalapi.auspost.com.au/shipping/v1',
    testEndpointPath: '/accounts/{account_number}', ratesEndpointPath: '/prices/shipments', labelsEndpointPath: '/labels', labelPdfEndpointPath: '/labels/{request_id}', trackingEndpointPath: '/track?tracking_ids={tracking_ids}', cancellationEndpointPath: '/shipments/{shipment_id}',
    accountNumber: '', paymentMethod: '', dispatchStatus: 'In Dispatch', defaultDomesticService: '', defaultExpressService: '', defaultInternationalService: '', defaultPackagePresetId: '', defaultPrintStationId: '', labelFormat: 'PDF', labelPrintGroup: 'Parcel Post', labelLayout: 'A6-1pp', labelPaperType: 'single_shipping_label', printDeliveryMethod: 'open_pdf', labelBranded: false, wooFulfillmentBehavior: 'keep_in_dispatch', trackingSyncEnabled: false, trackingPollIntervalMinutes: 30, trackingPollFailureBackoffMinutes: 60,
};
const enums: Record<string, string[]> = { apiEnvironment: ['sandbox', 'production'], paymentMethod: ['', 'CHARGE_ACCOUNT', 'CREDIT_CARD', 'PAYPAL'], wooFulfillmentBehavior: ['keep_in_dispatch', 'label_created', 'print_success'], printDeliveryMethod: ['open_pdf', 'remote_print'], labelPrintGroup: ['Parcel Post', 'Express Post'], labelLayout: ['A4-1pp', 'A4-3pp', 'A4-4pp', 'A6-1pp'], labelPaperType: ['a4_label_sheet', 'single_shipping_label'], labelFormat: ['PDF'] };
const senderFields = ['name', 'company', 'phone', 'email', 'address1', 'address2', 'suburb', 'state', 'postcode', 'country'];
const triggers = ['SHIPMENT_RECEIVED_BY_CARRIER', 'SHIPMENT_IN_TRANSIT', 'SHIPMENT_OUT_FOR_DELIVERY', 'SHIPMENT_DELIVERY_ATTEMPTED', 'SHIPMENT_DELIVERED', 'SHIPMENT_EXCEPTION'];

export function ShippingSettingsPage() { return <ShippingBoundary>{scope => <SettingsRead scope={scope} />}</ShippingBoundary>; }
function SettingsRead({ scope }: { scope: ShippingScope }) {
    const { hasPermission } = usePermissions();
    return hasPermission('manage_shipping_settings') ? <AdmittedSettingsRead scope={scope} /> : <p role="alert">Shipping settings management access required.</p>;
}
function AdmittedSettingsRead({ scope }: { scope: ShippingScope }) {
    const read = useShippingRead('/settings', scope, decodeSettings);
    if (read.loading || read.error || !read.data) return <ShippingReadState loading={read.loading} retry={read.retry} />;
    return <SettingsDraft key={JSON.stringify(read.data)} scope={scope} snapshot={read.data} reload={read.retry} />;
}
function SettingsDraft({ scope, snapshot, reload }: { scope: ShippingScope; snapshot: z.infer<typeof settingsSchema>; reload: () => void }) {
    const settings = snapshot.carrierAccount, observed = settings?.config ?? {};
    const { hasPermission } = usePermissions();
    const stations = useShippingRead('/settings/stations', scope, decodeStations);
    const [config, setConfig] = useState<Record<string, string | boolean | number>>(() => Object.fromEntries(Object.entries(defaults).map(([key, fallback]) => [key, observed[key] === undefined ? fallback : typeof observed[key] === typeof fallback ? observed[key] as string | boolean | number : 'unknown'])));
    const [sender, setSender] = useState<Record<string, string>>(() => Object.fromEntries(senderFields.map(key => [key, typeof settings?.senderAddress?.[key] === 'string' ? String(settings.senderAddress[key]) : ''])));
    const [displayName, setDisplayName] = useState(settings?.displayName ?? 'Australia Post'), [enabled, setEnabled] = useState(settings?.isEnabled ?? false);
    const [mappings, setMappings] = useState(() => JSON.stringify(observed.shippingMethodServiceMappings ?? [], null, 2)), [allowlist, setAllowlist] = useState(() => JSON.stringify(observed.trackingAutomationAllowlist ?? []));
    const [apiKey, setApiKey] = useState(''), [apiSecret, setApiSecret] = useState('');
    const [name, setName] = useState(''), [printer, setPrinter] = useState(''), [token, setToken] = useState<string | null>(null);
    const [busy, setBusy] = useState(false), [blocked, setBlocked] = useState(false), [message, setMessage] = useState('');
    const pendingRef = useRef(false), activeRef = useRef(true);
    const [operationId, setOperationId] = useState(() => crypto.randomUUID());
    const current = JSON.stringify([config, sender, displayName, enabled, mappings, allowlist, apiKey, apiSecret]);
    const [baseline] = useState(current), dirty = baseline !== current;
    useDraftUnload(dirty || busy || blocked || !!token);
    useEffect(() => { activeRef.current = true; return () => { activeRef.current = false; }; }, []);
    useEffect(() => { if (!token) return; const timer = setTimeout(() => setToken(null), 60000); return () => clearTimeout(timer); }, [token]);
    const editable = hasPermission('manage_shipping_settings') && !busy && !blocked;
    const run = async (action: 'save' | 'test' | 'refresh' | 'create' | 'rotate', resource?: z.infer<typeof stationSchema>) => {
        if (!editable || pendingRef.current) return;
        if (action !== 'save' && dirty) { setMessage('Save or deliberately discard the draft first. Tests/refresh use saved credentials only.'); return; }
        let data: unknown = {};
        if (action === 'save') {
            try {
                const parsedMappings = z.array(z.object({ wooShippingMethod: z.string().trim().min(1).max(180), auspostServiceCode: z.string().trim().min(1).max(80), matchType: z.enum(['exact', 'contains']) }).strict()).max(200).parse(JSON.parse(mappings));
                const parsedAllowlist = z.array(z.enum(triggers as [string, ...string[]])).max(6).parse(JSON.parse(allowlist));
                for (const [key, options] of Object.entries(enums)) if (!options.includes(String(config[key]))) throw new Error('Unknown policy');
                if (!/^[A-Z]{2}$/.test(sender.country)) throw new Error('Country required');
                data = { ...config, senderAddress: sender, displayName, isEnabled: enabled, shippingMethodServiceMappings: parsedMappings, trackingAutomationAllowlist: parsedAllowlist, ...(apiKey ? { apiKey } : {}), ...(apiSecret ? { apiSecret } : {}) };
            } catch { setMessage('Review supported policy values, explicit sender country and bounded mapping/trigger JSON arrays. No unknown value will be silently replaced.'); return; }
        }
        if (action === 'create') data = { name: name.trim(), defaultPrinterName: printer.trim() || null };
        if (!window.confirm(action === 'save' ? 'Save this reviewed settings snapshot, including environment, endpoints, tracking and fulfillment policy? Missing values shown as draft defaults are included. No provider test or print is requested.' : action === 'test' || action === 'refresh' ? `Run a saved-credential provider ${action}? This may make external requests. Lost acknowledgement requires reconciliation, not a new operation.` : `${action === 'rotate' ? 'Rotate this station token and invalidate its previous credential' : 'Create this print station credential'}? The token is shown once for 60 seconds; this does not print.`)) return;
        pendingRef.current = true; setBusy(true); setToken(null); setMessage('');
        try {
            const path = action === 'save' ? '/settings' : action === 'test' ? '/settings/test-connection' : action === 'refresh' ? '/settings/auspost-service-catalog' : action === 'create' ? '/print-stations' : `/print-stations/${encodeURIComponent(resource!.id)}/rotate-token`;
            const result = z.object({ accountId: identity, operationId: z.string().uuid(), value: z.unknown() }).parse(await shippingFetch(path, scope.token, scope.accountId, { method: action === 'save' ? 'PATCH' : 'POST', body: JSON.stringify({ operationId, resourceId: resource?.id ?? settings?.id ?? null, version: resource?.updatedAt ?? settings?.updatedAt ?? null, data }) }));
            if (result.accountId !== scope.accountId || result.operationId !== operationId) throw new Error('Acknowledgement mismatch');
            if (!activeRef.current) return;
            if (action === 'save') { setApiKey(''); setApiSecret(''); reload(); }
            else if (action === 'create' || action === 'rotate') {
                const value = z.object({ token: z.string().regex(/^[a-f0-9]{64}$/), printStation: z.object({ id: identity }) }).parse(result.value);
                setToken(value.token); stations.retry();
            } else setMessage(action === 'refresh' ? 'Catalog refresh acknowledged. Provider result is not shipment eligibility; review the saved account and service code before use.' : 'Provider test acknowledged. This is not label creation, tracking or print evidence.');
            setOperationId(crypto.randomUUID());
        } catch { if (activeRef.current) { setBlocked(true); setMessage(`Operation ${operationId} unconfirmed/conflicted. Preserve draft and reconcile; abort/closing is not rollback. No automatic retry admitted.`); } }
        finally { pendingRef.current = false; if (activeRef.current) setBusy(false); }
    };
    const labelFor = (key: string) => key.replace(/([A-Z])/g, ' $1').replace(/^./, value => value.toUpperCase());
    const configGroups = [
        { title: 'Carrier connection', keys: ['apiProduct', 'apiEnvironment', 'accountNumber', 'paymentMethod'] },
        { title: 'Dispatch and services', keys: ['dispatchStatus', 'defaultDomesticService', 'defaultExpressService', 'defaultInternationalService', 'defaultPackagePresetId'] },
        { title: 'Labels and fulfillment', keys: ['defaultPrintStationId', 'labelFormat', 'labelPrintGroup', 'labelLayout', 'labelPaperType', 'printDeliveryMethod', 'labelBranded', 'wooFulfillmentBehavior'] },
        { title: 'Tracking', keys: ['trackingSyncEnabled', 'trackingPollIntervalMinutes', 'trackingPollFailureBackoffMinutes'] },
    ];
    const renderConfig = (key: string) => {
        const value = config[key];
        return <label key={key} className={typeof value === 'boolean' ? 'flex items-center gap-2 text-xs font-medium' : ui.label}>
            <span>{labelFor(key)} {observed[key] === undefined && <span className="font-normal text-slate-400">(draft default)</span>}</span>
            {typeof value === 'boolean' ? <input aria-label={key} className={ui.checkbox} type="checkbox" checked={value} onChange={event => setConfig({ ...config, [key]: event.target.checked })} /> : enums[key] ? <select aria-label={key} className={ui.input} value={String(value)} onChange={event => setConfig({ ...config, [key]: event.target.value })}>{!enums[key].includes(String(value)) && <option value={String(value)}>Unknown saved policy; select explicitly</option>}{enums[key].map(option => <option key={option} value={option}>{option || 'Not configured'}</option>)}</select> : <input aria-label={key} className={ui.input} type={typeof defaults[key] === 'number' ? 'number' : 'text'} maxLength={255} value={String(value)} onChange={event => setConfig({ ...config, [key]: typeof defaults[key] === 'number' ? Number(event.target.value) : event.target.value })} />}
        </label>;
    };
    return <ShippingPageShell title="Shipping settings" description="Scoped versioned configuration and deliberate provider/station actions. Opening this page makes no provider calls."><div className="space-y-5">
        <div className="flex flex-wrap items-center justify-between gap-3"><span className={ui.badge}><ShieldCheck size={14} className="mr-1.5" />Saved credentials: {snapshot.credentialsConfigured ? 'configured (not exposed)' : 'not observed'}</span><button className={ui.secondary} type="button" disabled={busy} onClick={() => { if ((!dirty && !blocked && !token) || window.confirm('Discard local draft/secrets and reload? Any unconfirmed operation remains recorded; do not repeat it.')) reload(); }}>Discard draft / reload observations</button></div>
        <DataNote title="Draft defaults and credentials">Missing configuration is shown as draft defaults, not observed production policy. New drafts disable carrier/tracking, have no automation triggers and use PDF preparation.</DataNote>
        {message && <p className={blocked ? ui.alert : ui.notice} role={blocked ? 'alert' : 'status'}>{message}</p>}
        <form className="space-y-5" onSubmit={event => { event.preventDefault(); void run('save'); }}><fieldset disabled={!editable} className="min-w-0 space-y-5">
            <section className={`${ui.card} space-y-4`}><h2 className={`${ui.title} flex items-center gap-2`}><KeyRound size={16} className="text-indigo-500" />Credentials (blank retains saved secret)</h2><div className="grid gap-4 sm:grid-cols-2"><label className={ui.label}>Display name<input className={ui.input} value={displayName} maxLength={120} onChange={event => setDisplayName(event.target.value)} /></label><label className="flex items-center gap-2 text-xs font-medium"><input className={ui.checkbox} type="checkbox" checked={enabled} onChange={event => setEnabled(event.target.checked)} /> Enable carrier</label><label className={ui.label}>New API key<input type="password" autoComplete="new-password" className={ui.input} value={apiKey} maxLength={1000} onChange={event => setApiKey(event.target.value)} /></label><label className={ui.label}>New API secret<input type="password" autoComplete="new-password" className={ui.input} value={apiSecret} maxLength={1000} onChange={event => setApiSecret(event.target.value)} /></label></div></section>
            <div className="grid items-start gap-5 xl:grid-cols-2">{configGroups.map(group => <section className={`${ui.card} space-y-4`} key={group.title}><h2 className={`${ui.title} flex items-center gap-2`}><Settings size={16} className="text-indigo-500" />{group.title}</h2><div className="grid gap-4 sm:grid-cols-2">{group.keys.map(renderConfig)}</div></section>)}</div>
            <section className={`${ui.card} space-y-4`}><h2 className={`${ui.title} flex items-center gap-2`}><MapPin size={16} className="text-indigo-500" />Sender</h2><div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">{senderFields.map(key => <label key={key} className={ui.label}>{labelFor(key)}<input aria-label={key} className={ui.input} value={sender[key]} maxLength={key === 'country' ? 2 : 200} onChange={event => setSender({ ...sender, [key]: event.target.value })} /></label>)}</div></section>
            <details className={ui.card}><summary className="cursor-pointer text-sm font-semibold">Advanced endpoints and automation</summary><div className="mt-4 space-y-4"><div className="grid gap-4 sm:grid-cols-2">{Object.keys(config).filter(key => !configGroups.some(group => group.keys.includes(key))).map(renderConfig)}</div><label className={ui.label}>Shipping method mappings (JSON array: wooShippingMethod, auspostServiceCode, matchType)<textarea className={`${ui.input} font-mono`} rows={5} maxLength={80000} value={mappings} onChange={event => setMappings(event.target.value)} /></label><label className={ui.label}>Opted-in tracking automation trigger IDs (JSON array; default empty)<textarea className={`${ui.input} font-mono`} rows={3} maxLength={2000} value={allowlist} onChange={event => setAllowlist(event.target.value)} /></label><p className={`break-words ${ui.muted}`}>Supported triggers: {triggers.join(', ')}. Reference service names/codes do not prove live account eligibility. Configure exact verified codes; no inferred services are inserted.</p></div></details>
        </fieldset><div className="flex justify-end"><button className={ui.primary} type="submit" disabled={!editable || !dirty}>Save reviewed settings</button></div></form>
        <div className="flex flex-wrap gap-3"><button className={ui.secondary} type="button" disabled={!editable || dirty || !settings} onClick={() => void run('test')}>Review saved-credential test</button><button className={ui.secondary} type="button" disabled={!editable || dirty || !settings} onClick={() => void run('refresh')}>Review provider catalog refresh</button></div>
        <section className={`${ui.card} space-y-4`}><h2 className={`${ui.title} flex items-center gap-2`}><Printer size={16} className="text-indigo-500" />Print stations (local observations, up to 100)</h2>{stations.loading ? <p role="status" className={ui.muted}>Loading stations…</p> : stations.error || !stations.data ? <p role="alert" className={ui.alert}>Stations unavailable; no offline/online conclusion inferred.</p> : <>{stations.data.partial && <p className={ui.notice}>Station window is partial.</p>}<div className="grid gap-3 lg:grid-cols-2">{stations.data.printStations.map(station => <div key={station.id} className="space-y-3 rounded-lg border border-slate-200 p-4 dark:border-slate-700"><div className="flex flex-wrap justify-between gap-2"><h3 className="break-words text-sm font-medium">{station.name}</h3><span className={ui.badge}>{station.status}</span></div><p className={ui.muted}>Heartbeat {station.lastSeenAt ? new Date(station.lastSeenAt).toLocaleString() : 'not observed'}</p><button className={ui.secondary} type="button" disabled={!editable || dirty} onClick={() => void run('rotate', station)}>Review token rotation for {station.name}</button></div>)}</div>{!stations.data.printStations.length && <p className={ui.empty}>No print stations in this window.</p>}</>}<div className="grid gap-3 border-t border-slate-100 pt-4 sm:grid-cols-2 dark:border-slate-700"><label className={ui.label}>New station name<input className={ui.input} disabled={!editable} maxLength={120} value={name} onChange={event => setName(event.target.value)} /></label><label className={ui.label}>Default printer name<input className={ui.input} disabled={!editable} maxLength={200} value={printer} onChange={event => setPrinter(event.target.value)} /></label></div><button className={ui.secondary} type="button" disabled={!editable || dirty || !name.trim()} onClick={() => void run('create')}>Review station registration</button>{token && <div className={`${ui.notice} space-y-3`}><p>Transient station token. Save securely; hidden in 60 seconds. Not stored in replay receipts.</p><code className="block break-all rounded bg-white/60 p-3 dark:bg-slate-900">{token}</code><button className={ui.secondary} type="button" onClick={() => setToken(null)}>Dismiss token now</button></div>}</section>
    </div></ShippingPageShell>;
}
