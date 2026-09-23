import { methodKey, type SettingsFieldsProps, type ShippingMethod } from './types';
import type { ShippingDiscovery } from './discovery';

/** Discovery annotations remain outside the persisted settings schema. */
export function ShippingTransitGrid({ settings, onChange, discovery, unconfigured = [], onConfigured }: SettingsFieldsProps & {
    discovery?: ShippingDiscovery | null; unconfigured?: string[]; onConfigured?: (key: string) => void;
}) {
    const update = (index: number, patch: Partial<ShippingMethod>) => onChange({
        ...settings, shippingMethods: settings.shippingMethods.map((row, i) => i === index ? { ...row, ...patch } : row),
    });
    const selectedKey = settings.defaultMethod ? methodKey(settings.defaultMethod) : '';
    const defaultValid = !selectedKey || settings.shippingMethods.some(row => row.enabled && methodKey(row) === selectedKey);
    const unconfiguredKey = (row: ShippingMethod) => unconfigured.find(key => key === methodKey(row) || key === `${row.methodId}:${row.instanceId}`);
    return <section className="space-y-4">
        <h3 className="text-lg font-semibold">Draft shipping transit grid</h3>
        <p className="text-sm text-slate-500 dark:text-slate-400">Names and provider details come from WooCommerce. Set transit days here; expand Mapping for provider-specific options.</p>
        <div className="overflow-x-auto">
            <table className="w-full text-sm"><caption className="sr-only">Draft WooCommerce shipping mappings</caption>
                <thead><tr>{['Shipping method', 'Zone', 'Fulfilment', 'Days (min / max)', 'Enabled', ''].map((title, i) => <th className="p-2 text-left" key={i} scope="col">{title}</th>)}</tr></thead>
                <tbody>{settings.shippingMethods.map((row, index) => <tr key={index} className="align-top border-t border-slate-200 dark:border-slate-700">
                    <td className="p-2 min-w-56">
                        <p className="font-medium">{row.title || 'Untitled shipping method'}</p>
                        <details className="mt-1 text-xs text-slate-500 dark:text-slate-400">
                            <summary className="cursor-pointer w-fit rounded focus-visible:outline-2 focus-visible:outline-indigo-500">Mapping · {row.methodId}:{row.instanceId}</summary>
                            <div className="mt-2 max-w-sm space-y-2">
                        <p>Exact options require the full Woo rate ID, not a title or rule number. Exact overrides win. Renaming an option in WooCommerce may change its ID.</p>
                        <label>Mapping policy<select aria-label={`Row ${index + 1} mapping policy`} value={row.mappingKind ?? 'core_instance'} onChange={e => update(index, { mappingKind: e.target.value as ShippingMethod['mappingKind'], rateId: undefined, allRatesConfirmed: undefined })}>
                            <option value="core_instance">Core instance (legacy default)</option><option value="exact_rate">Exact actual rate ID</option><option value="all_provider_rates">All provider rates in this instance</option>
                        </select></label>
                        {row.mappingKind === 'exact_rate' && <label>Actual rate ID<input aria-label={`Row ${index + 1} actual rate ID`} required maxLength={200} value={row.rateId ?? ''} onChange={e => update(index, { rateId: e.target.value })} /></label>}
                        {row.mappingKind === 'all_provider_rates' && <label><input type="checkbox" checked={row.allRatesConfirmed === true} onChange={e => update(index, { allRatesConfirmed: e.target.checked })} />I confirm every option emitted by this instance shares this transit range, except configured exact overrides.</label>}
                        <button type="button" disabled={settings.shippingMethods.length >= 500} onClick={() => onChange({ ...settings, shippingMethods: [...settings.shippingMethods, {
                            ...row, mappingKind: 'exact_rate', rateId: '', allRatesConfirmed: undefined, enabled: false,
                        }] })}>Add exact rate mapping</button>
                            </div>
                        </details>
                        {['wbs', 'wbsng'].includes(row.methodId) && (!row.mappingKind || row.mappingKind === 'core_instance') && <p className="mt-1 max-w-xs text-xs text-amber-800 dark:text-amber-300">Unverified WBS policy: no estimates until you choose an explicit mapping.</p>}
                        {row.mappingKind === 'exact_rate' && <p className="mt-1 max-w-xs break-all text-xs text-slate-500 dark:text-slate-400">{row.rateId || 'Actual rate ID required — expand Mapping.'}</p>}
                    </td>
                    <td className="p-2 min-w-32"><p>{row.zoneName || 'Unnamed zone'}</p><p className="text-xs text-slate-500 dark:text-slate-400">Zone {row.zoneId}</p></td>
                    <td className="p-2 min-w-40"><select aria-label="Fulfilment" value={row.fulfilmentType} onChange={e => update(index, { fulfilmentType: e.target.value as ShippingMethod['fulfilmentType'] })}>
                            <option value="delivery">Delivery</option><option value="collection">Click and Collect</option>
                        </select></td>
                    <td className="p-2"><div className="flex items-center gap-2">{(['minTransitDays', 'maxTransitDays'] as const).map(key => <label className="w-20 shrink-0" key={key}><span className="sr-only">{key === 'minTransitDays' ? 'Minimum' : 'Maximum'}</span>
                        <input aria-label={`Row ${index + 1} ${key === 'minTransitDays' ? 'minimum' : 'maximum'} transit days`} type="number" required min={0} max={3650} step={1}
                            title={key === 'minTransitDays' ? 'Minimum transit days' : 'Maximum transit days'}
                            value={Number.isNaN(row[key]) ? '' : row[key]} onChange={e => update(index, { [key]: e.target.valueAsNumber })} /></label>)}</div></td>
                    <td className="p-2">
                        <label className="relative inline-flex h-6 w-11 cursor-pointer align-middle">
                            <input className="peer sr-only" aria-label={`Enable row ${index + 1}`} role="switch" type="checkbox" checked={row.enabled} disabled={!!unconfiguredKey(row)} onChange={e => update(index, { enabled: e.target.checked })} />
                            <span aria-hidden="true" className="absolute inset-0 rounded-full bg-slate-300 transition-colors dark:bg-slate-600 peer-checked:bg-indigo-600 peer-focus-visible:ring-2 peer-focus-visible:ring-indigo-500 peer-focus-visible:ring-offset-2 peer-disabled:opacity-40 peer-disabled:cursor-not-allowed" />
                            <span aria-hidden="true" className="pointer-events-none absolute left-0.5 top-0.5 h-5 w-5 rounded-full bg-white shadow-sm transition-transform peer-checked:translate-x-5 peer-disabled:opacity-60" />
                        </label>
                        <div className="max-w-56 text-xs text-amber-800 dark:text-amber-300 space-y-1">
                        {unconfiguredKey(row) && <><p>Unconfigured: 0 days is a draft placeholder, not a verified estimate.</p><button type="button"
                            disabled={!Number.isInteger(row.minTransitDays) || !Number.isInteger(row.maxTransitDays) || row.minTransitDays < 0 || row.maxTransitDays < row.minTransitDays || row.maxTransitDays > 3650}
                            onClick={() => onConfigured?.(unconfiguredKey(row)!)}>Confirm transit configuration for row {index + 1}</button></>}
                        {discovery?.status === 'available' && (() => {
                            const match = discovery.methods.find(method => method.methodId === row.methodId && method.instanceId === row.instanceId);
                            return !match ? <p>Missing from latest WooCommerce discovery — draft retained.</p> : !match.enabled ? <p>Disabled in WooCommerce — review this draft mapping.</p> : null;
                        })()}
                        </div>
                    </td>
                    <td className="p-2"><button type="button" className="inline-flex h-9 w-9 items-center justify-center border-0! p-0! text-red-600 hover:bg-red-50 focus-visible:ring-2 focus-visible:ring-red-500 dark:text-red-400 dark:hover:bg-red-950" title="Remove shipping method" aria-label={`Remove shipping row ${index + 1}`} onClick={() => onChange({ ...settings, shippingMethods: settings.shippingMethods.filter((_, i) => i !== index) })}><span aria-hidden="true" className="text-2xl leading-none">×</span></button></td>
                </tr>)}</tbody>
            </table>
        </div>
        {!settings.shippingMethods.length && <p>No shipping mappings configured.</p>}
        <p className="text-xs text-slate-500 dark:text-slate-400">Import shipping methods from WooCommerce above. To configure another rate for a method, expand Mapping and add an exact rate mapping.</p>
        <label className="block">Default product-page method<select value={selectedKey} onChange={e => {
            const row = settings.shippingMethods.find(method => methodKey(method) === e.target.value);
            onChange({ ...settings, defaultMethod: row ? { methodId: row.methodId, instanceId: row.instanceId, ...(row.mappingKind ? { mappingKind: row.mappingKind } : {}), ...(row.rateId ? { rateId: row.rateId } : {}) } : null });
        }}>
            <option value="">No default selected</option>
            {!defaultValid && <option value={selectedKey}>Unavailable: {selectedKey} — choose a default or clear</option>}
            {settings.shippingMethods.filter(row => row.enabled).map((row, index) => <option key={index} value={methodKey(row)}>{row.title || 'Untitled'} — {methodKey(row)} (zone {row.zoneId})</option>)}
        </select></label>
        {settings.defaultMethod?.mappingKind === 'all_provider_rates' && <label className="block">Default actual rate ID (optional; required when multiple options are offered)<input maxLength={200} value={settings.defaultMethod.rateId ?? ''} onChange={e => onChange({ ...settings, defaultMethod: { ...settings.defaultMethod!, rateId: e.target.value || undefined } })} /></label>}
        <p className="text-sm text-slate-500 dark:text-slate-400">Changing, disabling or removing the selected identity requires choosing a valid default or clearing it. Collection wording is separate; collection timing still requires rollout verification.</p>
    </section>;
}
