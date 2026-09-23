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
        <p className="text-sm text-amber-800 dark:text-amber-300">Method and instance metadata identify the provider. Exact options use the full actual Woo rate ID, never a title or rule number. Exact overrides win. WBS/WBSNG require an exact mapping or an explicitly confirmed instance-wide policy; old unverified WBS rows remain blank. Renaming a provider option may change its ID.</p>
        <div className="overflow-x-auto">
            <table className="w-full text-sm"><caption className="sr-only">Draft WooCommerce shipping mappings</caption>
                <thead><tr>{['Zone', 'Method identity', 'Title / type', 'Transit days', 'Enabled', ''].map((title, i) => <th className="p-2 text-left" key={i} scope="col">{title}</th>)}</tr></thead>
                <tbody>{settings.shippingMethods.map((row, index) => <tr key={index} className="align-top border-t border-slate-200 dark:border-slate-700">
                    <td className="p-2 min-w-36"><label>Zone ID<input aria-label={`Row ${index + 1} zone ID`} type="number" required min={0} max={2147483647} step={1}
                        value={Number.isNaN(row.zoneId) ? '' : row.zoneId} onChange={e => update(index, { zoneId: e.target.valueAsNumber })} /></label>
                        <label>Zone name<input maxLength={200} value={row.zoneName} onChange={e => update(index, { zoneName: e.target.value })} /></label></td>
                    <td className="p-2 min-w-44"><label>Method ID<input aria-label={`Row ${index + 1} method ID`} required pattern="[a-zA-Z0-9_-]{1,100}" maxLength={100}
                        value={row.methodId} onChange={e => update(index, { methodId: e.target.value })} /></label>
                        <label>Instance ID<input aria-label={`Row ${index + 1} instance ID`} type="number" required min={0} max={2147483647} step={1}
                            value={Number.isNaN(row.instanceId) ? '' : row.instanceId} onChange={e => update(index, { instanceId: e.target.valueAsNumber })} /></label>
                        <label>Mapping policy<select aria-label={`Row ${index + 1} mapping policy`} value={row.mappingKind ?? 'core_instance'} onChange={e => update(index, { mappingKind: e.target.value as ShippingMethod['mappingKind'], rateId: undefined, allRatesConfirmed: undefined })}>
                            <option value="core_instance">Core instance (legacy default)</option><option value="exact_rate">Exact actual rate ID</option><option value="all_provider_rates">All provider rates in this instance</option>
                        </select></label>
                        {row.mappingKind === 'exact_rate' && <label>Actual rate ID<input aria-label={`Row ${index + 1} actual rate ID`} required maxLength={200} value={row.rateId ?? ''} onChange={e => update(index, { rateId: e.target.value })} /></label>}
                        {row.mappingKind === 'all_provider_rates' && <label><input type="checkbox" checked={row.allRatesConfirmed === true} onChange={e => update(index, { allRatesConfirmed: e.target.checked })} />I confirm every option emitted by this instance shares this transit range, except configured exact overrides.</label>}
                        {['wbs', 'wbsng'].includes(row.methodId) && (!row.mappingKind || row.mappingKind === 'core_instance') && <p>Unverified WBS policy: no estimates until you choose an explicit mapping.</p>}
                    </td>
                    <td className="p-2 min-w-44"><label>Title<input required maxLength={200} value={row.title} onChange={e => update(index, { title: e.target.value })} /></label>
                        <label>Fulfilment<select value={row.fulfilmentType} onChange={e => update(index, { fulfilmentType: e.target.value as ShippingMethod['fulfilmentType'] })}>
                            <option value="delivery">Delivery</option><option value="collection">Click and Collect</option>
                        </select></label></td>
                    <td className="p-2 min-w-32">{(['minTransitDays', 'maxTransitDays'] as const).map(key => <label key={key}>{key === 'minTransitDays' ? 'Minimum' : 'Maximum'}
                        <input aria-label={`Row ${index + 1} ${key === 'minTransitDays' ? 'minimum' : 'maximum'} transit days`} type="number" required min={0} max={3650} step={1}
                            value={Number.isNaN(row[key]) ? '' : row[key]} onChange={e => update(index, { [key]: e.target.valueAsNumber })} /></label>)}</td>
                    <td className="p-2"><input aria-label={`Enable row ${index + 1}`} type="checkbox" checked={row.enabled} disabled={!!unconfiguredKey(row)} onChange={e => update(index, { enabled: e.target.checked })} />
                        {!row.enabled && <p>Disabled — review transit configuration before enabling.</p>}
                        {unconfiguredKey(row) && <><p>Unconfigured: 0 days is a draft placeholder, not a verified estimate.</p><button type="button"
                            disabled={!Number.isInteger(row.minTransitDays) || !Number.isInteger(row.maxTransitDays) || row.minTransitDays < 0 || row.maxTransitDays < row.minTransitDays || row.maxTransitDays > 3650}
                            onClick={() => onConfigured?.(unconfiguredKey(row)!)}>Confirm transit configuration for row {index + 1}</button></>}
                        {discovery?.status === 'available' && (() => {
                            const match = discovery.methods.find(method => method.methodId === row.methodId && method.instanceId === row.instanceId);
                            return !match ? <p>Missing from latest WooCommerce discovery — draft retained.</p> : !match.enabled ? <p>Disabled in WooCommerce — review this draft mapping.</p> : null;
                        })()}
                    </td>
                    <td className="p-2"><button type="button" aria-label={`Remove shipping row ${index + 1}`} onClick={() => onChange({ ...settings, shippingMethods: settings.shippingMethods.filter((_, i) => i !== index) })}>Remove</button></td>
                </tr>)}</tbody>
            </table>
        </div>
        {!settings.shippingMethods.length && <p>No shipping mappings configured.</p>}
        <button type="button" disabled={settings.shippingMethods.length >= 500} onClick={() => onChange({ ...settings, shippingMethods: [...settings.shippingMethods, {
            zoneId: 0, zoneName: '', methodId: '', instanceId: 0, title: '', enabled: true, minTransitDays: 0, maxTransitDays: 0, fulfilmentType: 'delivery',
        }] })}>Add draft shipping method</button>
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
