import { useEffect, useState } from 'react';
import { Modal } from '../ui/Modal';
import { formatCurrency, formatDateTime } from '../../utils/format';
import { productKey, reasons, type Reason, type WriteOff, type WriteOffProduct, type WriteOffRequest } from './stockWriteOffs';

export const writeOffInput = 'w-full rounded-lg border border-slate-300 bg-white p-2 dark:border-slate-600 dark:bg-slate-900 dark:text-slate-100';
export const writeOffButton = 'rounded-lg border border-slate-300 px-3 py-2 text-sm font-medium hover:bg-slate-100 disabled:opacity-50 dark:border-slate-600 dark:hover:bg-slate-700';
export function StockSyncBadge({ status }: { status: WriteOff['syncStatus'] }) {
    if (status === 'NOT_REQUIRED') return null;
    const label = { PENDING: 'Stock sync pending', NEEDS_ATTENTION: 'Stock sync needs attention', SYNCED: 'Stock synced' }[status];
    return <span className={`inline-block rounded-full px-2 py-1 text-xs ${status === 'SYNCED' ? 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300' : 'bg-amber-100 text-amber-900 dark:bg-amber-950 dark:text-amber-300'}`}>{label}</span>;
}

type Line = WriteOffProduct & { quantity: string; override: string };
export function StockWriteOffEditor({ initial, request, currency, onClose, onChanged }: {
    initial: WriteOff | null; request: WriteOffRequest; currency: string; onClose: () => void; onChanged: () => void;
}) {
    const [doc, setDoc] = useState(initial);
    const [reason, setReason] = useState<Reason>(initial?.reason ?? 'MISSING');
    const [notes, setNotes] = useState(initial?.notes ?? '');
    const [lines, setLines] = useState<Line[]>(initial?.items.map(i => ({ ...i, quantity: String(i.quantity), override: i.unitCostOverride == null ? '' : String(i.unitCostOverride) })) ?? []);
    const [dirty, setDirty] = useState(!initial);
    const [search, setSearch] = useState('');
    const [products, setProducts] = useState<WriteOffProduct[]>([]);
    const [searching, setSearching] = useState(false);
    const [searchError, setSearchError] = useState('');
    const [error, setError] = useState('');
    const [busy, setBusy] = useState(false);
    const [confirmation, setConfirmation] = useState<'finalize' | 'delete' | null>(null);
    const readOnly = doc?.status === 'FINALIZED';
    const money = (value: number) => formatCurrency(value, currency, { maximumFractionDigits: 4 });

    useEffect(() => {
        if (readOnly) return;
        let active = true;
        setProducts([]); setSearching(true); setSearchError('');
        const timer = setTimeout(() => {
            request<{ items: WriteOffProduct[] }>(`/products?search=${encodeURIComponent(search)}`)
                .then(data => { if (active) setProducts(data.items); })
                .catch(e => { if (active) setSearchError(e.message); })
                .finally(() => { if (active) setSearching(false); });
        }, 300);
        return () => { active = false; clearTimeout(timer); };
    }, [search, request, readOnly]);

    const update = (index: number, patch: Partial<Line>) => { setLines(items => items.map((line, i) => i === index ? { ...line, ...patch } : line)); setDirty(true); };
    const invalid = !lines.length || lines.some(i => !Number.isInteger(Number(i.quantity)) || Number(i.quantity) < 1 || Number(i.quantity) > 1_000_000 ||
        (i.override === '' ? i.unitCost == null : !Number.isFinite(Number(i.override)) || Number(i.override) < 0 || Number(i.override) > 999_999_999));
    const total = lines.reduce((sum, i) => sum + (i.override === '' ? i.unitCost ?? 0 : Number(i.override)) * Number(i.quantity), 0);
    const accept = (next: WriteOff) => {
        setDoc(next); setReason(next.reason); setNotes(next.notes ?? '');
        setLines(next.items.map(i => ({ ...i, quantity: String(i.quantity), override: i.unitCostOverride == null ? '' : String(i.unitCostOverride) })));
        setDirty(false); onChanged();
    };
    async function save() {
        if (busy || invalid) return;
        setBusy(true); setError('');
        try {
            accept(await request<WriteOff>(doc ? `/${encodeURIComponent(doc.id)}` : '', doc ? 'PUT' : 'POST', {
                reason, notes, items: lines.map(i => ({ productId: i.productId || undefined, variationId: i.variationId || undefined,
                    internalProductId: i.internalProductId || undefined, quantity: Number(i.quantity), unitCostOverride: i.override === '' ? undefined : Number(i.override) }))
            }));
        } catch (e) { setError((e as Error).message); } finally { setBusy(false); }
    }
    async function confirmed() {
        if (!doc || busy) return;
        setBusy(true); setError('');
        try {
            if (confirmation === 'delete') { await request(`/${encodeURIComponent(doc.id)}`, 'DELETE'); onChanged(); onClose(); }
            else accept(await request<WriteOff>(`/${encodeURIComponent(doc.id)}/finalize`, 'POST'));
            setConfirmation(null);
        } catch (e) { setError((e as Error).message); setConfirmation(null); } finally { setBusy(false); }
    }
    return <Modal isOpen onClose={busy ? undefined : () => { if (!dirty || window.confirm('Discard unsaved draft changes?')) onClose(); }} title={doc?.reference ?? 'New stock write-off'} maxWidth="max-w-4xl">
        <div className="space-y-4 text-slate-900 dark:text-slate-100">
            {error && <p role="alert" className="text-red-600 dark:text-red-400">{error}</p>}
            {doc && <div className="flex flex-wrap items-center gap-3"><strong>{readOnly ? 'Finalized · Read-only' : 'Draft'}</strong><StockSyncBadge status={doc.syncStatus} />{doc.finalizedAt && <span>{formatDateTime(doc.finalizedAt)}</span>}</div>}
            {readOnly && <>
                <p>Costs and stock movements are frozen snapshots. Local stock has been deducted; remote sync may still be pending.</p>
                {doc?.syncStatus === 'NEEDS_ATTENTION' && <p role="alert">Stock transport needs attention. Review receipt transport/reconciliation; do not create another write-off for the same loss.</p>}
                {[...(doc?.syncOperations?.flatMap(o => [o.lastError, o.cascadeError]) ?? []), ...(doc?.items.map(i => i.cascadeError) ?? [])].filter(Boolean).map((message, i) => <p key={i} role="alert" className="break-words text-red-600 dark:text-red-400">{message}</p>)}
                <button className={writeOffButton} disabled={busy} onClick={async () => { setBusy(true); setError(''); try { accept(await request<WriteOff>(`/${encodeURIComponent(doc!.id)}`)); } catch (e) { setError((e as Error).message); } finally { setBusy(false); } }}>Refresh sync status</button>
            </>}
            <fieldset disabled={busy || readOnly || !!confirmation} className="space-y-4">
                <div className="grid gap-4 sm:grid-cols-2">
                    <label>Reason<select className={writeOffInput} value={reason} onChange={e => { setReason(e.target.value as Reason); setDirty(true); }}>{Object.entries(reasons).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
                    <label>Notes<textarea className={writeOffInput} maxLength={5000} value={notes} onChange={e => { setNotes(e.target.value); setDirty(true); }} /></label>
                </div>
                {!readOnly && <>
                    <p className="text-sm text-slate-600 dark:text-slate-400">1. Add products or components. 2. Save draft. 3. Review and finalize to deduct stock. Estimates use COGS + all extras; finalization reloads current costs.</p>
                    <label className="block">Search eligible products, variants and components<input className={writeOffInput} value={search} maxLength={200} onChange={e => setSearch(e.target.value)} placeholder="Product name or SKU" /></label>
                    <p className="text-xs">Results are limited. Refine your search if an item is missing. BOM-derived finished products are excluded.</p>
                    {searchError && <p role="alert">{searchError}</p>}
                    <div className="max-h-48 overflow-y-auto space-y-1">
                        {searching ? <p role="status">Searching…</p> : products.length === 0 ? <p>No eligible products found.</p> : products.map(p => <button type="button" key={productKey(p)} className={`${writeOffButton} flex w-full flex-wrap justify-between gap-2 text-left`} disabled={lines.length >= 100 || lines.some(i => productKey(i) === productKey(p))} onClick={() => { setLines(items => [...items, { ...p, quantity: '1', override: '' }]); setDirty(true); }}>
                            <span>{p.name} · {p.sku || 'No SKU'} ({p.type === 'INTERNAL' ? 'Component' : p.type === 'VARIATION' ? 'Variant' : 'Product'})</span><span>Stock: {p.stockQuantity} · {p.unitCost == null ? 'Cost override required' : money(p.unitCost)}</span>
                        </button>)}
                    </div>
                </>}
                <div className="space-y-3">{lines.map((line, index) => <div key={productKey(line)} className="rounded-xl border border-slate-200 p-3 dark:border-slate-700">
                    <div className="flex justify-between gap-2"><div><strong>{line.name}</strong><p className="text-sm">{line.sku || 'No SKU'} · {line.type}</p></div>{!readOnly && <button type="button" className={writeOffButton} aria-label={`Remove ${line.name}`} onClick={() => { setLines(items => items.filter((_, i) => i !== index)); setDirty(true); }}>Remove</button>}</div>
                    <div className="mt-2 grid gap-3 sm:grid-cols-3">
                        <label>Quantity<input aria-label={`Quantity for ${line.name}`} className={writeOffInput} type="number" min="1" max="1000000" step="1" value={line.quantity} onChange={e => update(index, { quantity: e.target.value })} /></label>
                        {!readOnly && <label>Total unit cost override<input aria-label={`Total unit cost override for ${line.name}`} className={writeOffInput} type="number" min="0" max="999999999" step="any" value={line.override} placeholder={line.unitCost == null ? 'Required (zero accepted)' : money(line.unitCost)} onChange={e => update(index, { override: e.target.value })} /></label>}
                        <div><p>{readOnly ? 'Snapshot unit cost' : 'Estimated unit cost'}: {readOnly ? money(doc!.items[index].unitCost!) : line.override === '' && line.unitCost == null ? 'Missing' : money(line.override === '' ? line.unitCost! : Number(line.override))}</p><p>Line loss: {money(readOnly ? doc!.items[index].totalCost : (line.override === '' ? line.unitCost ?? 0 : Number(line.override)) * Number(line.quantity))}</p></div>
                    </div>
                    {!readOnly && <p className="mt-2 text-xs">Override replaces the entire unit cost, including extras. {line.unitCost == null && line.override === '' ? 'Missing/invalid COGS: enter an explicit cost, including zero if intended.' : 'Leave blank to use catalogue COGS + extras.'}</p>}
                    {readOnly && <p className="text-sm">Stock: {doc?.items[index]?.stockBefore ?? 'Unknown'} → {doc?.items[index]?.stockAfter ?? 'Unknown'}</p>}
                </div>)}</div>
            </fieldset>
            <p className="text-lg font-semibold">{readOnly ? 'Finalized loss' : 'Estimated loss'}: {money(readOnly ? doc!.totalCost : total)} {currency}</p>
            {!readOnly && <div className="flex flex-wrap gap-2">
                <button className={writeOffButton} disabled={busy || invalid || !!confirmation} onClick={save}>{busy ? 'Working…' : 'Save draft'}</button>
                {doc && <><button className={writeOffButton} disabled={busy || dirty || !!confirmation} onClick={() => setConfirmation('finalize')}>Finalize write-off</button><button className={writeOffButton} disabled={busy || !!confirmation} onClick={() => setConfirmation('delete')}>Delete draft</button></>}
                {dirty && doc && <p className="w-full text-sm">Save changes before finalizing.</p>}
            </div>}
            {confirmation && <div role="group" aria-label="Confirm action" className="space-y-3 rounded-xl border border-amber-400 p-4">
                <p>{confirmation === 'finalize' ? 'Finalize this write-off? This permanently deducts stock and freezes current COGS + extras (or your total unit cost overrides). It cannot be edited or deleted afterwards.' : 'Delete this draft? This does not change stock.'}</p>
                <div className="flex gap-2"><button className={writeOffButton} disabled={busy} onClick={confirmed}>{confirmation === 'finalize' ? 'Confirm finalize' : 'Confirm delete'}</button><button className={writeOffButton} disabled={busy} onClick={() => setConfirmation(null)}>Cancel</button></div>
            </div>}
        </div>
    </Modal>;
}
