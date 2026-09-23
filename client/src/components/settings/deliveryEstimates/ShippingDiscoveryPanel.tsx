import { useEffect, useRef, useState } from 'react';
import { requestShippingMethods } from './api';
import { mergeDiscoveredMethods, type ShippingDiscovery } from './discovery';
import { methodKey, type SettingsFieldsProps } from './types';

export function ShippingDiscoveryPanel({ accountId, token, canImport, settings, onChange, discovery, onDiscovery, onImported }: SettingsFieldsProps & {
    accountId: string; token: string; canImport: boolean;
    discovery: ShippingDiscovery | null;
    onDiscovery: (value: ShippingDiscovery | null) => void;
    onImported: (keys: string[]) => void;
}) {
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState('');
    const controller = useRef<AbortController | null>(null);
    useEffect(() => () => controller.current?.abort(), [accountId]);
    const refresh = async () => {
        controller.current?.abort();
        const request = new AbortController();
        controller.current = request;
        setLoading(true); setError(''); onDiscovery(null);
        try {
            const result = await requestShippingMethods(accountId, token, request.signal);
            if (!request.signal.aborted) onDiscovery(result);
        } catch (error) {
            if (!request.signal.aborted) setError(error instanceof Error ? error.message : 'Shipping discovery failed. Please retry.');
        } finally {
            if (!request.signal.aborted) setLoading(false);
        }
    };
    const merged = discovery?.status === 'available' ? mergeDiscoveredMethods(settings, discovery.methods) : settings;
    return <section aria-label="WooCommerce shipping discovery" className="space-y-3">
        <h3 className="text-lg font-semibold">WooCommerce shipping discovery</h3>
        <button type="button" disabled={loading} onClick={refresh}>{loading ? 'Discovering shipping methods…' : 'Refresh from WooCommerce'}</button>
        <p className="text-sm">Discovery runs only when requested. Import adds disabled draft rows; configure transit days and save separately.</p>
        {error && <p role="alert">Shipping discovery failed: {error}</p>}
        {discovery?.status === 'plugin_update_required' && <p role="status">Shipping discovery requires a newer Overseek companion plugin. Update the WooCommerce plugin, then refresh. Your draft is retained.</p>}
        {discovery?.warnings.map((warning, i) => <p role="note" key={i}>{warning}</p>)}
        {discovery?.timezone && discovery.timezone !== settings.timezone && <p role="note">Timezone mismatch: WooCommerce uses {discovery.timezone}; this draft uses {settings.timezone}. Review the business timezone deliberately; discovery has not changed it.</p>}
        {discovery?.status === 'available' && <>
            <p role="status">{discovery.methods.length} shipping methods discovered. Discovery availability does not mean storefront sync is live.</p>
            <ul className="list-disc pl-5">{discovery.methods.map((method, index) => <li key={`${methodKey(method)}:${index}`}>
                {method.title} — {methodKey(method)} · {method.zoneName || `Zone ${method.zoneId}`} · {method.enabled ? 'Enabled in WooCommerce' : 'Disabled in WooCommerce'} · Provider: {method.provider === 'weight_based' ? 'Weight Based Shipping' : method.provider}
                {(method.requiresRateVerification || method.provider !== 'woocommerce') && <span> — Rate verification required. Discovery identifies only the method/instance; individual rate or rule support is not verified.</span>}
                {method.observedRates?.map(rate => <p key={rate.rateId}>Observed actual option: {rate.title} · <code>{rate.rateId}</code> · {rate.capturedAt} (copy the full ID into an exact mapping; observation is not current eligibility).</p>)}
            </li>)}</ul>
            {!discovery.methods.length && <p>No methods returned. Existing draft rows are retained for review.</p>}
            <p>To capture actual options, use the store cart normally while signed in as a WooCommerce manager, then refresh discovery. Only the last 100 option identities from that administrator's normal shipping calculation are retained for 24 hours; no customer address or prices are captured. Alternatively explicitly confirm an instance-wide timing policy in the grid. Discovery never calculates a quote.</p>
            <button type="button" disabled={!canImport || merged.shippingMethods.length > 500 || merged.shippingMethods.length === settings.shippingMethods.length} onClick={() => {
                if (!canImport) return;
                onImported(merged.shippingMethods.slice(settings.shippingMethods.length).map(methodKey));
                onChange(merged);
            }}>Import discovered methods into draft</button>
            {merged.shippingMethods.length > 500 && <p role="alert">Import exceeds the 500-method limit. Review draft rows before importing.</p>}
            {!canImport && <p>Import requires manage_shipping_settings permission and editable settings.</p>}
        </>}
    </section>;
}
