import { useEffect, useRef, useState } from 'react';
import { z } from 'zod';
import { usePermissions } from '../../hooks/usePermissions';
import { ShippingPageShell } from './ShippingPageShell';
import { ShippingBoundary, ShippingReadState, identity, date, useDraftUnload, useShippingRead, type ShippingScope } from './shippingWorkspace';
import { shippingFetch } from './shippingApi';

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
    return <ShippingPageShell title="Shipping settings" description="Scoped versioned configuration and deliberate provider/station actions. Opening this page makes no provider calls."><div className="space-y-5"><p>Saved credentials: {snapshot.credentialsConfigured ? 'configured (not exposed)' : 'not observed'}. Missing configuration is shown as draft defaults, not observed production policy. New drafts disable carrier/tracking, have no automation triggers and use PDF preparation.</p>{message && <p role={blocked ? 'alert' : 'status'}>{message}</p>}<button type="button" disabled={busy} onClick={() => { if ((!dirty && !blocked && !token) || window.confirm('Discard local draft/secrets and reload? Any unconfirmed operation remains recorded; do not repeat it.')) reload(); }}>Discard draft / reload observations</button><form className="space-y-4" onSubmit={event => { event.preventDefault(); void run('save'); }}><fieldset disabled={!editable} className="space-y-3"><label className="block">Display name<input className="block w-full border dark:bg-slate-800" value={displayName} maxLength={120} onChange={event => setDisplayName(event.target.value)} /></label><label className="block"><input type="checkbox" checked={enabled} onChange={event => setEnabled(event.target.checked)} /> Enable carrier</label><h2 className="font-semibold">Credentials (blank retains saved secret)</h2><label className="block">New API key<input type="password" autoComplete="new-password" className="block w-full border dark:bg-slate-800" value={apiKey} maxLength={1000} onChange={event => setApiKey(event.target.value)} /></label><label className="block">New API secret<input type="password" autoComplete="new-password" className="block w-full border dark:bg-slate-800" value={apiSecret} maxLength={1000} onChange={event => setApiSecret(event.target.value)} /></label><h2 className="font-semibold">Carrier and output policy</h2><div className="grid gap-3 sm:grid-cols-2">{Object.entries(config).map(([key, value]) => <label key={key} className="block">{key} {observed[key] === undefined && <span className="text-xs">(draft default)</span>}{typeof value === 'boolean' ? <input className="ml-2" type="checkbox" checked={value} onChange={event => setConfig({ ...config, [key]: event.target.checked })} /> : enums[key] ? <select className="block w-full border dark:bg-slate-800" value={String(value)} onChange={event => setConfig({ ...config, [key]: event.target.value })}>{!enums[key].includes(String(value)) && <option value={String(value)}>Unknown saved policy; select explicitly</option>}{enums[key].map(option => <option key={option} value={option}>{option || 'Not configured'}</option>)}</select> : <input className="block w-full border dark:bg-slate-800" type={typeof defaults[key] === 'number' ? 'number' : 'text'} maxLength={255} value={String(value)} onChange={event => setConfig({ ...config, [key]: typeof defaults[key] === 'number' ? Number(event.target.value) : event.target.value })} />}</label>)}</div><h2 className="font-semibold">Sender</h2><div className="grid gap-3 sm:grid-cols-2">{senderFields.map(key => <label key={key}>{key}<input className="block w-full border dark:bg-slate-800" value={sender[key]} maxLength={key === 'country' ? 2 : 200} onChange={event => setSender({ ...sender, [key]: event.target.value })} /></label>)}</div><label className="block">Shipping method mappings (JSON array: wooShippingMethod, auspostServiceCode, matchType)<textarea className="block w-full border font-mono dark:bg-slate-800" rows={5} maxLength={80000} value={mappings} onChange={event => setMappings(event.target.value)} /></label><label className="block">Opted-in tracking automation trigger IDs (JSON array; default empty)<textarea className="block w-full border dark:bg-slate-800" rows={3} maxLength={2000} value={allowlist} onChange={event => setAllowlist(event.target.value)} /></label><p className="text-sm">Supported triggers: {triggers.join(', ')}. Reference service names/codes do not prove live account eligibility. Configure exact verified codes; no inferred services are inserted.</p></fieldset><button type="submit" disabled={!editable || !dirty}>Save reviewed settings</button></form><div className="flex flex-wrap gap-3"><button type="button" disabled={!editable || dirty || !settings} onClick={() => void run('test')}>Review saved-credential test</button><button type="button" disabled={!editable || dirty || !settings} onClick={() => void run('refresh')}>Review provider catalog refresh</button></div><section className="space-y-3"><h2 className="font-semibold">Print stations (local observations, up to 100)</h2>{stations.loading ? <p role="status">Loading stations…</p> : stations.error || !stations.data ? <p role="alert">Stations unavailable; no offline/online conclusion inferred.</p> : <>{stations.data.partial && <p>Station window is partial.</p>}{stations.data.printStations.map(station => <div key={station.id} className="rounded border p-3"><p>{station.name} · recorded {station.status} · heartbeat {station.lastSeenAt ? new Date(station.lastSeenAt).toLocaleString() : 'not observed'}</p><button type="button" disabled={!editable || dirty} onClick={() => void run('rotate', station)}>Review token rotation for {station.name}</button></div>)}</>}<label className="block">New station name<input className="block border dark:bg-slate-800" disabled={!editable} maxLength={120} value={name} onChange={event => setName(event.target.value)} /></label><label className="block">Default printer name<input className="block border dark:bg-slate-800" disabled={!editable} maxLength={200} value={printer} onChange={event => setPrinter(event.target.value)} /></label><button type="button" disabled={!editable || dirty || !name.trim()} onClick={() => void run('create')}>Review station registration</button>{token && <div className="rounded border p-3"><p>Transient station token. Save securely; hidden in 60 seconds. Not stored in replay receipts.</p><code className="break-all">{token}</code><button type="button" onClick={() => setToken(null)}>Dismiss token now</button></div>}</section></div></ShippingPageShell>;
}
