import { FormEvent, useEffect, useState } from 'react';
import { Save, ShieldCheck } from 'lucide-react';
import { useAccount } from '../../context/AccountContext';
import { useAuth } from '../../context/AuthContext';
import { useApiMutation, useApiQuery } from '../../hooks/useApiQuery';
import { ShippingComingSoonCard, ShippingPageShell } from './ShippingPageShell';
import { shippingFetch, ShippingPrintStation, ShippingSettingsResponse } from './shippingApi';

const AUSPOST_DEFAULT_BASE_URL = 'https://digitalapi.auspost.com.au/shipping/v1';
const TRACKING_TRIGGER_OPTIONS = [
    'SHIPMENT_RECEIVED_BY_CARRIER',
    'SHIPMENT_IN_TRANSIT',
    'SHIPMENT_OUT_FOR_DELIVERY',
    'SHIPMENT_DELIVERY_ATTEMPTED',
    'SHIPMENT_DELIVERED',
    'SHIPMENT_EXCEPTION',
] as const;
const AUSPOST_DEFAULT_ENDPOINTS = {
    testEndpointPath: '/accounts/{account_number}',
    ratesEndpointPath: '/prices/shipments',
    labelsEndpointPath: '/labels',
    labelPdfEndpointPath: '/labels/{request_id}',
    trackingEndpointPath: '/track?tracking_ids={tracking_ids}',
    cancellationEndpointPath: '/shipments/{shipment_id}',
};

interface SettingsFormState {
    displayName: string;
    isEnabled: boolean;
    apiKey: string;
    apiSecret: string;
    apiProduct: string;
    apiEnvironment: 'sandbox' | 'production';
    apiBaseUrl: string;
    testEndpointPath: string;
    ratesEndpointPath: string;
    labelsEndpointPath: string;
    labelPdfEndpointPath: string;
    trackingEndpointPath: string;
    cancellationEndpointPath: string;
    accountNumber: string;
    paymentMethod: string;
    dispatchStatus: string;
    senderName: string;
    senderCompany: string;
    senderPhone: string;
    senderEmail: string;
    senderAddress1: string;
    senderAddress2: string;
    senderSuburb: string;
    senderState: string;
    senderPostcode: string;
    senderCountry: string;
    defaultDomesticService: string;
    defaultExpressService: string;
    defaultInternationalService: string;
    labelFormat: string;
    labelPrintGroup: 'Parcel Post' | 'Express Post';
    labelLayout: 'A4-1pp' | 'A4-3pp' | 'A4-4pp' | 'A6-1pp';
    labelPaperType: 'a4_label_sheet' | 'single_shipping_label';
    printDeliveryMethod: 'remote_print' | 'open_pdf';
    labelBranded: boolean;
    wooFulfillmentBehavior: string;
    trackingSyncEnabled: boolean;
    trackingAutomationAllowlist: string;
    trackingPollIntervalMinutes: string;
    trackingPollFailureBackoffMinutes: string;
}

const defaultForm: SettingsFormState = {
    displayName: 'Australia Post',
    isEnabled: true,
    apiKey: '',
    apiSecret: '',
    apiProduct: 'SHIPPING_AND_TRACKING',
    apiEnvironment: 'production',
    apiBaseUrl: AUSPOST_DEFAULT_BASE_URL,
    testEndpointPath: AUSPOST_DEFAULT_ENDPOINTS.testEndpointPath,
    ratesEndpointPath: AUSPOST_DEFAULT_ENDPOINTS.ratesEndpointPath,
    labelsEndpointPath: AUSPOST_DEFAULT_ENDPOINTS.labelsEndpointPath,
    labelPdfEndpointPath: AUSPOST_DEFAULT_ENDPOINTS.labelPdfEndpointPath,
    trackingEndpointPath: AUSPOST_DEFAULT_ENDPOINTS.trackingEndpointPath,
    cancellationEndpointPath: AUSPOST_DEFAULT_ENDPOINTS.cancellationEndpointPath,
    accountNumber: '',
    paymentMethod: '',
    dispatchStatus: 'In Dispatch',
    senderName: '',
    senderCompany: '',
    senderPhone: '',
    senderEmail: '',
    senderAddress1: '',
    senderAddress2: '',
    senderSuburb: '',
    senderState: '',
    senderPostcode: '',
    senderCountry: 'AU',
    defaultDomesticService: '',
    defaultExpressService: '',
    defaultInternationalService: '',
    labelFormat: 'PDF',
    labelPrintGroup: 'Parcel Post',
    labelLayout: 'A6-1pp',
    labelPaperType: 'single_shipping_label',
    printDeliveryMethod: 'remote_print',
    labelBranded: true,
    wooFulfillmentBehavior: 'keep_in_dispatch',
    trackingSyncEnabled: true,
    trackingAutomationAllowlist: 'SHIPMENT_DELIVERED',
    trackingPollIntervalMinutes: '30',
    trackingPollFailureBackoffMinutes: '60',
};

export function ShippingSettingsPage() {
    const { token } = useAuth();
    const { currentAccount } = useAccount();
    const [form, setForm] = useState<SettingsFormState>(defaultForm);
    const [stationName, setStationName] = useState('Dispatch PC');
    const [stationPrinter, setStationPrinter] = useState('');
    const [newStationToken, setNewStationToken] = useState<string | null>(null);
    const [testResult, setTestResult] = useState<string | null>(null);

    const canFetch = Boolean(token && currentAccount?.id);
    const settingsQuery = useApiQuery<ShippingSettingsResponse>({
        queryKey: ['shipping-settings', currentAccount?.id],
        enabled: canFetch,
        queryFn: () => shippingFetch('/settings', token!, currentAccount!.id),
    });
    const printStationsQuery = useApiQuery<{ printStations: ShippingPrintStation[] }>({
        queryKey: ['shipping-print-stations', currentAccount?.id],
        enabled: canFetch,
        queryFn: () => shippingFetch('/print-stations', token!, currentAccount!.id),
    });

    useEffect(() => {
        const settings = settingsQuery.data?.carrierAccount;
        if (!settings) return;
        const config = settings.config || {};
        const sender = settings.senderAddress || {};
        setForm(prev => ({
            ...prev,
            displayName: settings.displayName || prev.displayName,
            isEnabled: settings.isEnabled,
            apiProduct: String(config.apiProduct || 'SHIPPING_AND_TRACKING'),
            apiEnvironment: config.apiEnvironment === 'sandbox' ? 'sandbox' : 'production',
            apiBaseUrl: String(config.apiBaseUrl || AUSPOST_DEFAULT_BASE_URL),
            testEndpointPath: String(config.testEndpointPath || AUSPOST_DEFAULT_ENDPOINTS.testEndpointPath),
            ratesEndpointPath: String(config.ratesEndpointPath || AUSPOST_DEFAULT_ENDPOINTS.ratesEndpointPath),
            labelsEndpointPath: String(config.labelsEndpointPath || AUSPOST_DEFAULT_ENDPOINTS.labelsEndpointPath),
            labelPdfEndpointPath: String(config.labelPdfEndpointPath || AUSPOST_DEFAULT_ENDPOINTS.labelPdfEndpointPath),
            trackingEndpointPath: String(config.trackingEndpointPath || AUSPOST_DEFAULT_ENDPOINTS.trackingEndpointPath),
            cancellationEndpointPath: String(config.cancellationEndpointPath || AUSPOST_DEFAULT_ENDPOINTS.cancellationEndpointPath),
            accountNumber: String(config.accountNumber || ''),
            paymentMethod: String(config.paymentMethod || ''),
            dispatchStatus: String(config.dispatchStatus || 'In Dispatch'),
            senderName: String(sender.name || ''),
            senderCompany: String(sender.company || ''),
            senderPhone: String(sender.phone || ''),
            senderEmail: String(sender.email || ''),
            senderAddress1: String(sender.address1 || ''),
            senderAddress2: String(sender.address2 || ''),
            senderSuburb: String(sender.suburb || ''),
            senderState: String(sender.state || ''),
            senderPostcode: String(sender.postcode || ''),
            senderCountry: String(sender.country || 'AU'),
            defaultDomesticService: String(config.defaultDomesticService || ''),
            defaultExpressService: String(config.defaultExpressService || ''),
            defaultInternationalService: String(config.defaultInternationalService || ''),
            labelFormat: String(config.labelFormat || 'PDF'),
            labelPrintGroup: config.labelPrintGroup === 'Express Post' ? 'Express Post' : 'Parcel Post',
            labelLayout: ['A4-1pp', 'A4-3pp', 'A4-4pp', 'A6-1pp'].includes(String(config.labelLayout)) ? String(config.labelLayout) as SettingsFormState['labelLayout'] : 'A6-1pp',
            labelPaperType: config.labelPaperType === 'a4_label_sheet' || config.labelLayout === 'A4-4pp' ? 'a4_label_sheet' : 'single_shipping_label',
            printDeliveryMethod: config.printDeliveryMethod === 'open_pdf' ? 'open_pdf' : 'remote_print',
            labelBranded: config.labelBranded !== false,
            wooFulfillmentBehavior: String(config.wooFulfillmentBehavior || 'keep_in_dispatch'),
            trackingSyncEnabled: config.trackingSyncEnabled !== false,
            trackingAutomationAllowlist: Array.isArray(config.trackingAutomationAllowlist) ? config.trackingAutomationAllowlist.join(', ') : 'SHIPMENT_DELIVERED',
            trackingPollIntervalMinutes: String(config.trackingPollIntervalMinutes || 30),
            trackingPollFailureBackoffMinutes: String(config.trackingPollFailureBackoffMinutes || 60),
        }));
    }, [settingsQuery.data]);

    const saveSettings = useApiMutation<ShippingSettingsResponse, SettingsFormState>({
        invalidateQueries: [['shipping-settings', currentAccount?.id]],
        mutationFn: (values) => shippingFetch('/settings', token!, currentAccount!.id, {
            method: 'PATCH',
            body: JSON.stringify({
                displayName: values.displayName,
                isEnabled: values.isEnabled,
                apiKey: values.apiKey || undefined,
                apiSecret: values.apiSecret || undefined,
                apiProduct: values.apiProduct,
                apiEnvironment: values.apiEnvironment,
                apiBaseUrl: values.apiBaseUrl || undefined,
                testEndpointPath: values.testEndpointPath || undefined,
                ratesEndpointPath: values.ratesEndpointPath || undefined,
                labelsEndpointPath: values.labelsEndpointPath || undefined,
                labelPdfEndpointPath: values.labelPdfEndpointPath || undefined,
                trackingEndpointPath: values.trackingEndpointPath || undefined,
                cancellationEndpointPath: values.cancellationEndpointPath || undefined,
                accountNumber: values.accountNumber,
                paymentMethod: values.paymentMethod,
                dispatchStatus: values.dispatchStatus,
                senderAddress: {
                    name: values.senderName,
                    company: values.senderCompany,
                    phone: values.senderPhone,
                    email: values.senderEmail,
                    address1: values.senderAddress1,
                    address2: values.senderAddress2,
                    suburb: values.senderSuburb,
                    state: values.senderState,
                    postcode: values.senderPostcode,
                    country: values.senderCountry,
                },
                defaultDomesticService: values.defaultDomesticService,
                defaultExpressService: values.defaultExpressService,
                defaultInternationalService: values.defaultInternationalService,
                labelFormat: values.labelFormat,
                labelPrintGroup: values.labelPrintGroup,
                labelPaperType: values.labelPaperType,
                labelLayout: values.labelPaperType === 'a4_label_sheet' ? 'A4-4pp' : 'A6-1pp',
                printDeliveryMethod: values.printDeliveryMethod,
                labelBranded: values.labelBranded,
                wooFulfillmentBehavior: values.wooFulfillmentBehavior,
                trackingSyncEnabled: values.trackingSyncEnabled,
                trackingAutomationAllowlist: values.trackingAutomationAllowlist
                    .split(',')
                    .map((item) => item.trim())
                    .filter((item): item is typeof TRACKING_TRIGGER_OPTIONS[number] => TRACKING_TRIGGER_OPTIONS.includes(item as typeof TRACKING_TRIGGER_OPTIONS[number])),
                trackingPollIntervalMinutes: Number(values.trackingPollIntervalMinutes || 30),
                trackingPollFailureBackoffMinutes: Number(values.trackingPollFailureBackoffMinutes || 60),
            }),
        }),
        onSuccess: () => setForm(prev => ({ ...prev, apiKey: '', apiSecret: '' })),
    });

    const createPrintStation = useApiMutation<{ printStation: ShippingPrintStation; token: string }, { name: string; defaultPrinterName: string }>({
        invalidateQueries: [['shipping-print-stations', currentAccount?.id]],
        mutationFn: (values) => shippingFetch('/print-stations', token!, currentAccount!.id, {
            method: 'POST',
            body: JSON.stringify({ name: values.name, defaultPrinterName: values.defaultPrinterName || null }),
        }),
        onSuccess: (data) => {
            setNewStationToken(data.token);
            setStationName('Dispatch PC');
            setStationPrinter('');
        },
    });
    const rotatePrintStationToken = useApiMutation<{ printStation: ShippingPrintStation; token: string }, string>({
        invalidateQueries: [['shipping-print-stations', currentAccount?.id]],
        mutationFn: (id) => shippingFetch(`/print-stations/${id}/rotate-token`, token!, currentAccount!.id, { method: 'POST' }),
        onSuccess: (data) => setNewStationToken(data.token),
    });
    const testConnection = useApiMutation<{ ok: boolean; status: string; message: string }, void>({
        invalidateQueries: [['shipping-settings', currentAccount?.id]],
        mutationFn: () => shippingFetch('/settings/test-connection', token!, currentAccount!.id, { method: 'POST' }),
        onSuccess: (data) => setTestResult(data.message),
    });

    const update = (key: keyof SettingsFormState, value: string | boolean) => setForm(prev => ({ ...prev, [key]: value }));
    const handleSubmit = (event: FormEvent) => {
        event.preventDefault();
        saveSettings.mutate(form);
    };

    return (
        <ShippingPageShell
            title="Settings"
            description="Configure AusPost credentials, sender details, payment method, dispatch status, label format, print stations, and tracking sync behavior."
        >
            <form onSubmit={handleSubmit} className="grid gap-6 xl:grid-cols-2">
                <ShippingComingSoonCard>
                    <div className="mb-4 flex items-center gap-3">
                        <ShieldCheck className="text-indigo-600" size={22} />
                        <h2 className="text-lg font-bold text-slate-900 dark:text-white">AusPost Credentials</h2>
                    </div>
                    <p className="mb-4 text-sm text-slate-600 dark:text-slate-300">Enter the AusPost Shipping and Tracking API credentials here. Secrets are encrypted server-side and are never returned to the browser after saving.</p>
                    {settingsQuery.data?.credentialsConfigured ? <p className="mb-4 rounded-lg bg-emerald-50 px-3 py-2 text-sm text-emerald-700">Credentials are configured. Leave API fields blank to keep existing secrets.</p> : null}
                    <div className="space-y-4">
                        <TextField label="Display name" value={form.displayName} onChange={(v) => update('displayName', v)} />
                        <label className="block text-sm font-semibold text-slate-700 dark:text-slate-200">API product<select value={form.apiProduct} onChange={(event) => update('apiProduct', event.target.value)} className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 dark:border-slate-600 dark:bg-slate-900"><option value="SHIPPING_AND_TRACKING">Shipping and Tracking API</option></select></label>
                        <label className="block text-sm font-semibold text-slate-700 dark:text-slate-200">Environment<select value={form.apiEnvironment} onChange={(event) => update('apiEnvironment', event.target.value as 'sandbox' | 'production')} className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 dark:border-slate-600 dark:bg-slate-900"><option value="production">Production</option><option value="sandbox">Sandbox</option></select></label>
                        <TextField label="API base URL" value={form.apiBaseUrl} onChange={(v) => update('apiBaseUrl', v)} placeholder={AUSPOST_DEFAULT_BASE_URL} />
                        <TextField label="API key" value={form.apiKey} onChange={(v) => update('apiKey', v)} autoComplete="off" />
                        <TextField label="API password / secret" value={form.apiSecret} onChange={(v) => update('apiSecret', v)} type="password" autoComplete="new-password" />
                        <TextField label="AusPost account number / charge account" value={form.accountNumber} onChange={(v) => update('accountNumber', v)} />
                        <TextField label="Payment method" value={form.paymentMethod} onChange={(v) => update('paymentMethod', v)} />
                        <TextField label="Dispatch status trigger" value={form.dispatchStatus} onChange={(v) => update('dispatchStatus', v)} />
                        <div className="rounded-xl border border-slate-200 p-4 dark:border-slate-700">
                            <p className="font-semibold text-slate-900 dark:text-white">Advanced API endpoint mapping</p>
                            <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">Defaults are from the AusPost reference. Use <code>{'{tracking_ids}'}</code> or <code>{'{trackingNumber}'}</code> in the tracking path.</p>
                            <div className="mt-3 grid gap-3 md:grid-cols-2">
                                <TextField label="Credential test path" value={form.testEndpointPath} onChange={(v) => update('testEndpointPath', v)} />
                                <TextField label="Tracking path" value={form.trackingEndpointPath} onChange={(v) => update('trackingEndpointPath', v)} />
                                <TextField label="Rates path" value={form.ratesEndpointPath} onChange={(v) => update('ratesEndpointPath', v)} />
                                <TextField label="Label creation path" value={form.labelsEndpointPath} onChange={(v) => update('labelsEndpointPath', v)} />
                                <TextField label="Label PDF path" value={form.labelPdfEndpointPath} onChange={(v) => update('labelPdfEndpointPath', v)} />
                                <TextField label="Cancellation path" value={form.cancellationEndpointPath} onChange={(v) => update('cancellationEndpointPath', v)} />
                            </div>
                        </div>
                        <button type="button" onClick={() => testConnection.mutate()} className="rounded-lg border border-indigo-200 px-4 py-2 text-sm font-semibold text-indigo-700 hover:bg-indigo-50 dark:border-indigo-500/40 dark:text-indigo-300 dark:hover:bg-indigo-500/10">Test saved credentials</button>
                        {testResult ? <p className="text-sm text-slate-600 dark:text-slate-300">{testResult}</p> : null}
                        {testConnection.error ? <p className="text-sm text-red-600">{testConnection.error.message}</p> : null}
                    </div>
                </ShippingComingSoonCard>

                <ShippingComingSoonCard>
                    <h2 className="mb-4 text-lg font-bold text-slate-900 dark:text-white">Sender Details</h2>
                    <div className="grid gap-4 md:grid-cols-2">
                        <TextField label="Sender name" value={form.senderName} onChange={(v) => update('senderName', v)} />
                        <TextField label="Company" value={form.senderCompany} onChange={(v) => update('senderCompany', v)} />
                        <TextField label="Phone" value={form.senderPhone} onChange={(v) => update('senderPhone', v)} />
                        <TextField label="Email" value={form.senderEmail} onChange={(v) => update('senderEmail', v)} />
                        <TextField label="Address 1" value={form.senderAddress1} onChange={(v) => update('senderAddress1', v)} />
                        <TextField label="Address 2" value={form.senderAddress2} onChange={(v) => update('senderAddress2', v)} />
                        <TextField label="Suburb" value={form.senderSuburb} onChange={(v) => update('senderSuburb', v)} />
                        <TextField label="State" value={form.senderState} onChange={(v) => update('senderState', v)} />
                        <TextField label="Postcode" value={form.senderPostcode} onChange={(v) => update('senderPostcode', v)} />
                        <TextField label="Country" value={form.senderCountry} onChange={(v) => update('senderCountry', v)} />
                    </div>
                </ShippingComingSoonCard>

                <ShippingComingSoonCard>
                    <h2 className="mb-4 text-lg font-bold text-slate-900 dark:text-white">Defaults</h2>
                    <div className="space-y-4">
                        <TextField label="Default domestic service" value={form.defaultDomesticService} onChange={(v) => update('defaultDomesticService', v)} />
                        <TextField label="Default express service" value={form.defaultExpressService} onChange={(v) => update('defaultExpressService', v)} />
                        <TextField label="Default international service" value={form.defaultInternationalService} onChange={(v) => update('defaultInternationalService', v)} />
                        <TextField label="Label format" value={form.labelFormat} onChange={(v) => update('labelFormat', v)} />
                        <label className="block text-sm font-semibold text-slate-700 dark:text-slate-200">Label print group<select value={form.labelPrintGroup} onChange={(event) => update('labelPrintGroup', event.target.value as SettingsFormState['labelPrintGroup'])} className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 dark:border-slate-600 dark:bg-slate-900"><option value="Parcel Post">Parcel Post</option><option value="Express Post">Express Post</option></select></label>
                        <label className="block text-sm font-semibold text-slate-700 dark:text-slate-200">Label paper<select value={form.labelPaperType} onChange={(event) => update('labelPaperType', event.target.value as SettingsFormState['labelPaperType'])} className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 dark:border-slate-600 dark:bg-slate-900"><option value="single_shipping_label">Single standard shipping label</option><option value="a4_label_sheet">A4 label sheets</option></select></label>
                        <label className="block text-sm font-semibold text-slate-700 dark:text-slate-200">After label creation<select value={form.printDeliveryMethod} onChange={(event) => update('printDeliveryMethod', event.target.value as SettingsFormState['printDeliveryMethod'])} className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 dark:border-slate-600 dark:bg-slate-900"><option value="remote_print">Send to remote print agent</option><option value="open_pdf">Open PDF on screen</option></select></label>
                        <label className="block text-sm font-semibold text-slate-700 dark:text-slate-200">
                            Woo fulfilment checkpoint
                            <select
                                value={form.wooFulfillmentBehavior}
                                onChange={(event) => update('wooFulfillmentBehavior', event.target.value)}
                                className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 dark:border-slate-600 dark:bg-slate-900"
                            >
                                <option value="keep_in_dispatch">Keep in dispatch (no auto-complete)</option>
                                <option value="label_created">Complete when label is created</option>
                                <option value="print_success">Complete when print succeeds</option>
                            </select>
                        </label>
                        <label className="flex items-center gap-2 text-sm font-semibold text-slate-700 dark:text-slate-200"><input type="checkbox" checked={form.isEnabled} onChange={(e) => update('isEnabled', e.target.checked)} /> Enable AusPost shipping</label>
                        <label className="flex items-center gap-2 text-sm font-semibold text-slate-700 dark:text-slate-200"><input type="checkbox" checked={form.labelBranded} onChange={(e) => update('labelBranded', e.target.checked)} /> Include AusPost branding on labels</label>
                        <label className="flex items-center gap-2 text-sm font-semibold text-slate-700 dark:text-slate-200"><input type="checkbox" checked={form.trackingSyncEnabled} onChange={(e) => update('trackingSyncEnabled', e.target.checked)} /> Enable tracking polling</label>
                        <TextField label="Automation allowlist (comma-separated trigger types)" value={form.trackingAutomationAllowlist} onChange={(v) => update('trackingAutomationAllowlist', v)} placeholder={TRACKING_TRIGGER_OPTIONS.join(', ')} />
                        <TextField label="Tracking poll interval minutes" value={form.trackingPollIntervalMinutes} onChange={(v) => update('trackingPollIntervalMinutes', v)} />
                        <TextField label="Tracking failure backoff minutes" value={form.trackingPollFailureBackoffMinutes} onChange={(v) => update('trackingPollFailureBackoffMinutes', v)} />
                    </div>
                </ShippingComingSoonCard>

                <ShippingComingSoonCard>
                    <h2 className="mb-4 text-lg font-bold text-slate-900 dark:text-white">Print Agent</h2>
                    <p className="text-sm text-slate-600 dark:text-slate-300">Register the local computer that will run the OverSeek Print Agent. The token is shown once.</p>
                    <div className="mt-4 space-y-3">
                        <TextField label="Station name" value={stationName} onChange={setStationName} />
                        <TextField label="Default printer name" value={stationPrinter} onChange={setStationPrinter} />
                        <button type="button" onClick={() => createPrintStation.mutate({ name: stationName, defaultPrinterName: stationPrinter })} className="rounded-lg border border-indigo-200 px-4 py-2 text-sm font-semibold text-indigo-700 hover:bg-indigo-50 dark:border-indigo-500/40 dark:text-indigo-300 dark:hover:bg-indigo-500/10">Register Print Station</button>
                        {newStationToken ? <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900"><p className="font-bold">Copy this station token now. It will not be shown again.</p><code className="mt-2 block break-all rounded bg-white p-2">{newStationToken}</code></div> : null}
                    </div>
                    <div className="mt-5 space-y-2">
                        {printStationsQuery.data?.printStations.map((station) => (
                            <div key={station.id} className="rounded-lg border border-slate-200 p-3 text-sm dark:border-slate-700">
                                <div className="flex items-center justify-between gap-3">
                                    <p className="font-semibold text-slate-900 dark:text-white">{station.name}</p>
                                    <span className="rounded-full bg-slate-100 px-2 py-1 text-xs font-semibold uppercase text-slate-600 dark:bg-slate-700 dark:text-slate-200">{station.status}</span>
                                </div>
                                <p className="mt-1 text-slate-500 dark:text-slate-400">Printer: {station.defaultPrinterName || 'Not set'} · Last seen: {station.lastSeenAt ? new Date(station.lastSeenAt).toLocaleString() : 'Never'}</p>
                                {station.lastErrorMessage ? <p className="mt-1 text-red-600">{station.lastErrorMessage}</p> : null}
                                <button type="button" onClick={() => rotatePrintStationToken.mutate(station.id)} className="mt-2 text-xs font-semibold text-indigo-600 hover:underline dark:text-indigo-300">Rotate station token</button>
                            </div>
                        ))}
                    </div>
                    {saveSettings.error ? <p className="mt-4 text-sm text-red-600">{saveSettings.error.message}</p> : null}
                    <button type="submit" disabled={saveSettings.isPending} className="mt-6 inline-flex w-full items-center justify-center gap-2 rounded-lg bg-indigo-600 px-4 py-2 text-sm font-semibold text-white hover:bg-indigo-700 disabled:opacity-60"><Save size={16} /> Save Settings</button>
                </ShippingComingSoonCard>
            </form>
        </ShippingPageShell>
    );
}

function TextField({ label, value, onChange, type = 'text', autoComplete, placeholder }: { label: string; value: string; onChange: (value: string) => void; type?: string; autoComplete?: string; placeholder?: string }) {
    return <label className="block text-sm font-semibold text-slate-700 dark:text-slate-200">{label}<input type={type} value={value} autoComplete={autoComplete} placeholder={placeholder} onChange={(e) => onChange(e.target.value)} className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 dark:border-slate-600 dark:bg-slate-900" /></label>;
}
