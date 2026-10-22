import { useState } from 'react';
import { z } from 'zod';
import { ProductSearchInput } from '../../components/inventory/ProductSearchInput';
import { usePermissions } from '../../hooks/usePermissions';
import { cmToMm, gramsToKg, kgToGrams, mmToCm } from './shippingApi';
import { catalogSchema, decodeCatalog, overrideData, packageData, ShippingBoundary, ShippingReadState, useDraftUnload, useReviewedShippingWrite, useShippingRead, type ShippingScope } from './shippingWorkspace';
import { ShippingPageShell } from './ShippingPageShell';
type Kind = 'package' | 'override';
const emptyPackage = { name: '', type: 'custom_box', innerLengthMm: null, innerWidthMm: null, innerHeightMm: null, outerLengthMm: null, outerWidthMm: null, outerHeightMm: null, fallbackItemWeightGrams: null, forcedPackageWeightGrams: null, packagingWeightGrams: 0, maxWeightGrams: null, selectionPriority: 0, carrierProductCode: null, isDefault: false, isActive: true };
const emptyOverride = { wooProductId: null, wooVariationId: null, packagePresetId: null, weightGrams: null, lengthMm: null, widthMm: null, heightMm: null, packingMode: 'combine_quantities', dangerousGoods: false, fragile: false, customsDescription: null, countryOfOrigin: null, hsCode: null, notes: null };
function toForm(input: Record<string, unknown>) { return Object.fromEntries(Object.entries(input).map(([key, value]) => [key, typeof value === 'boolean' ? value : value === null ? '' : key.endsWith('Mm') ? String(mmToCm(value as number)) : key.endsWith('Grams') ? String(gramsToKg(value as number)) : String(value)])); }
export function ShippingCatalogEditor({ kind }: { kind: Kind }) { return <ShippingBoundary>{scope => <CatalogRead scope={scope} kind={kind} />}</ShippingBoundary>; }
function CatalogRead({ scope, kind }: { scope: ShippingScope; kind: Kind }) {
    const read = useShippingRead('/workspace/catalog', scope, decodeCatalog);
    if (read.loading || read.error || !read.data || [...read.data.packages, ...read.data.overrides].some(row => row.accountId !== scope.accountId)) return <ShippingReadState loading={read.loading} retry={read.retry} />;
    return <CatalogDraft key={JSON.stringify(read.data)} scope={scope} kind={kind} snapshot={read.data} reload={read.retry} />;
}
function CatalogDraft({ scope, kind, snapshot, reload }: { scope: ShippingScope; kind: Kind; snapshot: z.infer<typeof catalogSchema>; reload: () => void }) {
    const { hasPermission } = usePermissions(), editable = hasPermission('manage_shipping_packages'), write = useReviewedShippingWrite(scope);
    const [resource, setResource] = useState<{ id: string; updatedAt: string } | null>(null), [form, setForm] = useState(() => toForm(kind === 'package' ? emptyPackage : emptyOverride)), [baseline, setBaseline] = useState(() => JSON.stringify(form)), [message, setMessage] = useState('');
    const dirty = JSON.stringify(form) !== baseline; useDraftUnload(dirty || write.busy || write.blocked);
    const records = kind === 'package' ? snapshot.packages : snapshot.overrides;
    const changeSelection = (record?: Record<string, unknown>) => {
        if (write.isPending() || write.blocked) return;
        if (dirty && !window.confirm('Discard this local draft before selecting another record?')) return;
        const shape = kind === 'package' ? emptyPackage : emptyOverride;
        const fields = Object.fromEntries(Object.keys(shape).map(key => [key, record ? record[key] : shape[key as keyof typeof shape]]));
        const next = toForm(fields); setForm(next); setBaseline(JSON.stringify(next)); setResource(record ? { id: String(record.id), updatedAt: String(record.updatedAt) } : null); setMessage('');
    };
    const save = async (remove: boolean) => {
        if (!editable || write.isPending() || write.blocked) return;
        let data: unknown = {};
        try {
            const numbers = new Set(['wooProductId', 'wooVariationId', 'selectionPriority']);
            const converted = Object.fromEntries(Object.entries(form).map(([key, value]) => [key, typeof value === 'boolean' ? value : key.endsWith('Mm') ? cmToMm(value) : key.endsWith('Grams') ? kgToGrams(value) : numbers.has(key) ? value === '' ? null : /^\d+$/.test(value) ? Number(value) : NaN : value === '' ? null : value]));
            if (!remove) data = kind === 'package' ? packageData.parse(converted) : overrideData.parse(converted);
        } catch { setMessage('Invalid fields. Use positive bounded dimensions/weights, exact cm (one decimal) and kg (three decimals); IDs and priorities are integers. Blank optional values mean unknown.'); return; }
        if (!window.confirm(remove ? `Deliberately ${kind === 'package' ? 'disable' : 'delete'} this observed record? Existing label snapshots are not changed.` : 'Save this reviewed local packing configuration? No carrier request or printing is performed.')) return;
        const result = await write.run('/workspace/catalog-write', { kind, resourceId: resource?.id ?? null, version: resource?.updatedAt ?? null, remove, data });
        if (result.ok && write.isActive()) { setMessage('Write acknowledged.'); reload(); }
    };
    return <ShippingPageShell title={kind === 'package' ? 'Packages' : 'Item overrides'} description="Versioned local packing configuration. These observations do not certify carrier acceptance."><div className="space-y-4 text-slate-900 dark:text-slate-100">{snapshot.partial && <p role="status">Catalog is partial: at most 1,000 rows per kind. Narrow the catalog through an operator-reviewed workflow before relying on completeness.</p>}{write.error && <p role="alert">{write.error}</p>}{message && <p role="status">{message}</p>}<div className="flex gap-3"><button type="button" disabled={!editable || write.busy || write.blocked} onClick={() => changeSelection()}>New {kind}</button><button type="button" disabled={write.busy} onClick={() => { if ((!dirty && !write.blocked) || window.confirm('Discard the local draft and reload? Unconfirmed server writes are not rolled back.')) reload(); }}>Discard / reload</button></div><div className="grid gap-6 lg:grid-cols-2"><div className="overflow-x-auto"><table className="w-full text-left"><thead><tr><th>Recorded identity</th><th>Review</th></tr></thead><tbody>{records.map(record => <tr key={record.id}><td>{'name' in record ? record.name : `Product ${record.wooProductId}${record.wooVariationId ? ` / variation ${record.wooVariationId}` : ''}`}</td><td><button type="button" disabled={write.busy || write.blocked} onClick={() => changeSelection(record)}>Edit record {record.id}</button></td></tr>)}</tbody></table>{!records.length && <p>No records in this acknowledged local window.</p>}</div><form className="space-y-3" onSubmit={event => { event.preventDefault(); void save(false); }}><h2>{resource ? `Edit ${resource.id}` : `New ${kind}`}</h2><p>Inner dimensions must fit outer dimensions; forced/fallback/package weights must respect maximum weight. An inactive package cannot be default. All three override dimensions or none. No silent rounding is applied.</p><fieldset disabled={!editable || write.busy || write.blocked} className="space-y-3">{kind === 'override' && <ProductSearchInput onSelect={product => setForm(previous => ({ ...previous, wooProductId: String(product.wooId), wooVariationId: product.variationWooId ? String(product.variationWooId) : '' }))} onClear={() => setForm(previous => ({ ...previous, wooProductId: '', wooVariationId: '' }))} disabled={!editable || write.busy || write.blocked} />}{Object.entries(form).map(([key, value]) => {
        const label = key.replace(/([A-Z])/g, ' $1').replace(/Mm$/, '(cm)').replace(/Grams$/, '(kg)');
        if (typeof value === 'boolean') return <label className="block" key={key}><input type="checkbox" checked={value} onChange={event => setForm({ ...form, [key]: event.target.checked })} /> {label}</label>;
        const options = key === 'type' ? ['custom_box', 'satchel', 'poly_mailer', 'mailer_bag', 'flat_mailer'] : key === 'packingMode' ? ['combine_quantities', 'separate_items'] : null;
        return <label className="block" key={key}>{label}{key === 'packagePresetId' ? <select className="block w-full border dark:bg-slate-800" value={value} onChange={event => setForm({ ...form, [key]: event.target.value })}><option value="">No package preset</option>{snapshot.packages.filter(p => p.isActive).map(p => <option key={p.id} value={p.id}>{p.name}</option>)}</select> : options ? <select className="block w-full border dark:bg-slate-800" value={value} onChange={event => setForm({ ...form, [key]: event.target.value })}>{options.map(option => <option key={option}>{option}</option>)}</select> : <input className="block w-full border dark:bg-slate-800" value={value} maxLength={key === 'notes' ? 2000 : 255} readOnly={key === 'wooProductId' || key === 'wooVariationId'} onChange={event => setForm({ ...form, [key]: event.target.value })} />}</label>;
    })}</fieldset><div className="flex gap-3"><button type="submit" disabled={!editable || !dirty || write.busy || write.blocked}>Save reviewed {kind}</button>{resource && <button type="button" disabled={!editable || write.busy || write.blocked} onClick={() => void save(true)}>{kind === 'package' ? 'Disable package' : 'Delete override'}</button>}</div></form></div></div></ShippingPageShell>;
}
