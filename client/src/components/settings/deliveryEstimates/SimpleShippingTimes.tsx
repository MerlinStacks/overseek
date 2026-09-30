import { useEffect, useEffectEvent, useState } from 'react';
import { requestShippingMethods } from './api';
import { mergeDiscoveredMethods } from './discovery';
import { methodKey, type SettingsFieldsProps, type ShippingMethod } from './types';

const supported = new Set(['flat_rate', 'free_shipping', 'local_pickup', 'wbs', 'wbsng']);

/** Discover identities automatically; shipping durations always come from the merchant. */
export function SimpleShippingTimes({ accountId, token, canEdit, settings, onChange }: SettingsFieldsProps & {
    accountId: string; token: string; canEdit: boolean;
}) {
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState('');
    const [attempt, setAttempt] = useState(0);
    const [search, setSearch] = useState('');
    const [blank, setBlank] = useState<Set<string>>(new Set());
    const applyDiscovery = useEffectEvent((methods: Parameters<typeof mergeDiscoveredMethods>[1]) => {
        const merged = mergeDiscoveredMethods(settings, methods.filter(row => row.enabled && supported.has(row.methodId)));
        const added = merged.shippingMethods.slice(settings.shippingMethods.length);
        if (!added.length) return;
        setBlank(previous => new Set([...previous, ...added.flatMap(row => [`${methodKey(row)}:minTransitDays`, `${methodKey(row)}:maxTransitDays`])]));
        onChange({ ...merged, shippingMethods: merged.shippingMethods.map(row => row.methodId === 'local_pickup'
            ? { ...row, fulfilmentType: 'collection' } : row) });
    });
    const discover = useEffectEvent((signal: AbortSignal) => requestShippingMethods(accountId, token, signal));
    useEffect(() => {
        if (!canEdit) return;
        const controller = new AbortController();
        setLoading(true); setError('');
        discover(controller.signal).then(result => {
            if (controller.signal.aborted) return;
            if (result.status !== 'available') setError('Update the Overseek plugin to load your shipping methods.');
            else applyDiscovery(result.methods);
        }).catch(() => {
            if (!controller.signal.aborted) setError('Could not load shipping methods from your store.');
        }).finally(() => { if (!controller.signal.aborted) setLoading(false); });
        return () => controller.abort();
    }, [accountId, canEdit, attempt]);

    const update = (index: number, patch: Partial<ShippingMethod>) => {
        const rows = settings.shippingMethods.map((row, i) => i === index ? { ...row, ...patch } : row);
        const defaultMethod = settings.defaultMethod && rows.some(row => row.enabled && methodKey(row) === methodKey(settings.defaultMethod!))
            ? settings.defaultMethod : null;
        onChange({ ...settings, shippingMethods: rows, defaultMethod });
    };
    return <section className="space-y-4" aria-label="Shipping times">
        <div><h3 className="text-lg font-semibold">How long does shipping take?</h3>
            <p className="text-sm text-slate-500 dark:text-slate-400">Enter a day range for the methods you want to show estimates for.</p></div>
        {loading && <p role="status" className="text-sm">Loading shipping methods…</p>}
        {error && <div role="alert" className="text-sm"><p>{error}</p><button type="button" onClick={() => setAttempt(value => value + 1)}>Try again</button></div>}
        {!loading && !error && !settings.shippingMethods.length && <p className="text-sm">Add a shipping method in WooCommerce to get started.</p>}
        {settings.shippingMethods.length > 0 && <label className="block">Find shipping methods<input type="search" value={search}
            placeholder="Search by method or zone" onChange={event => setSearch(event.target.value)} /></label>}
        <div role="region" aria-label="Shipping methods" tabIndex={0} className="max-h-96 space-y-2 overflow-y-auto overscroll-contain p-1">{settings.shippingMethods.map((row, index) => {
            if (!`${row.title} ${row.zoneName}`.toLowerCase().includes(search.trim().toLowerCase())) return null;
            const key = methodKey(row);
            const providerWide = ['wbs', 'wbsng'].includes(row.methodId) && row.mappingKind !== 'exact_rate';
            const policy = providerWide ? { mappingKind: 'all_provider_rates' as const, allRatesConfirmed: true } : {};
            const unconfigured = blank.has(`${key}:minTransitDays`) || blank.has(`${key}:maxTransitDays`);
            return <div key={`${row.methodId}:${row.instanceId}:${index}`} className="flex flex-col gap-2 rounded-lg border border-slate-200 p-3 sm:flex-row sm:items-center sm:justify-between dark:border-slate-700">
                <div className="min-w-0"><label className="flex items-center gap-2 font-medium">
                    <input type="checkbox" checked={row.enabled} disabled={unconfigured || !supported.has(row.methodId)} aria-label={`Show estimates for ${row.title}`}
                        onChange={event => update(index, { enabled: event.target.checked, ...(event.target.checked ? policy : {}) })} />
                    {row.title}</label>
                    <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">{row.zoneName || 'All locations'}{row.fulfilmentType === 'collection' ? ' · Collection' : ''}</p>
                    {providerWide && <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">This time applies to all options for this method.</p>}
                    {!supported.has(row.methodId) && <p className="text-xs">This shipping method is not supported yet.</p>}
                </div>
                <div className="flex items-end gap-2">{(['minTransitDays', 'maxTransitDays'] as const).map(field => <label key={field} className="w-24 text-xs">
                    {field === 'minTransitDays' ? 'From' : 'To'}
                    <input aria-label={`${row.title} ${field === 'minTransitDays' ? 'minimum' : 'maximum'} days`} type="number" min={0} max={3650} step={1}
                        disabled={!supported.has(row.methodId)} placeholder="Days"
                        value={blank.has(`${key}:${field}`) || Number.isNaN(row[field]) ? '' : row[field]}
                        onChange={event => {
                            const nextBlank = new Set(blank); nextBlank.delete(`${key}:${field}`);
                            setBlank(nextBlank);
                            const value = event.target.valueAsNumber;
                            const min = field === 'minTransitDays' ? value : row.minTransitDays;
                            const max = field === 'maxTransitDays' ? value : row.maxTransitDays;
                            const complete = !nextBlank.has(`${key}:minTransitDays`) && !nextBlank.has(`${key}:maxTransitDays`)
                                && Number.isInteger(min) && Number.isInteger(max) && min >= 0 && max >= min && max <= 3650;
                            update(index, { [field]: value, ...(complete && (unconfigured || row.enabled) ? { enabled: true, ...policy } : {}) });
                        }} />
                </label>)}<span className="pb-2 text-sm text-slate-500">days</span></div>
            </div>;
        })}</div>
        {search.trim() && !settings.shippingMethods.some(row => `${row.title} ${row.zoneName}`.toLowerCase().includes(search.trim().toLowerCase())) && <p role="status" className="text-sm">No matching shipping methods.</p>}
    </section>;
}
