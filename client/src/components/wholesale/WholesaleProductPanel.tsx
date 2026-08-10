import { forwardRef, useCallback, useEffect, useImperativeHandle, useState } from 'react';
import { AlertTriangle, ChevronLeft, ChevronRight, Loader2, Plus, RefreshCw, Save, Trash2 } from 'lucide-react';
import { useApi } from '../../hooks/useApi';
import { useToast } from '../../context/ToastContext';
import { createWholesaleCatalogService } from '../../services/wholesaleCatalogService';
import type { WholesaleProcess, WholesaleProductHistoryPage, WholesaleProductProfile, WholesaleTaxBasis } from '../../types/wholesaleCatalog';
import { inferWholesaleTierRanges, requiresFinalTierRemovalConfirmation, validateWholesaleTiers } from './tierValidation';
import { formatHistorySnapshot, isLowResolutionImage } from './productUxHelpers';

const PROCESS_OPTIONS: Array<{ value: WholesaleProcess; label: string }> = [
    { value: 'ENGRAVE', label: 'Engraving' },
    { value: 'SUBLIMATE', label: 'Sublimation' },
    { value: 'UV', label: 'UV' },
    { value: 'DTF', label: 'DTF' },
    { value: 'EMBROIDERY', label: 'Embroidery' },
];

const EMPTY_PROFILE: WholesaleProductProfile = {
    notesDocument: '',
    personalisationTypes: [],
    imageUrl: null,
    priceTaxBasis: 'EXCLUSIVE',
    priceTiers: [],
};

interface WholesaleProductPanelProps {
    productId: string;
    canEdit: boolean;
    onDirtyChange?: (isDirty: boolean) => void;
}

export interface WholesaleProductPanelRef {
    save: () => Promise<boolean>;
}

function editableSnapshot(profile: WholesaleProductProfile, baseTurnaroundDays: number | null) {
    return JSON.stringify({
        baseTurnaroundDays,
        notesDocument: typeof profile.notesDocument === 'string' ? profile.notesDocument : '',
        personalisationTypes: profile.personalisationTypes,
        imageUrl: profile.imageUrl || null,
        priceTaxBasis: profile.priceTaxBasis,
        priceTiers: profile.priceTiers.map(({ minimumQuantity, unitPrice, isPoa, leadTimeDays }) => ({
            minimumQuantity,
            unitPrice: isPoa ? null : unitPrice,
            isPoa,
            leadTimeDays: leadTimeDays ?? null,
        })),
    });
}

export const WholesaleProductPanel = forwardRef<WholesaleProductPanelRef, WholesaleProductPanelProps>(function WholesaleProductPanel({ productId, canEdit, onDirtyChange }, ref) {
    const api = useApi();
    const toast = useToast();
    const [profile, setProfile] = useState<WholesaleProductProfile>(EMPTY_PROFILE);
    const [baseTurnaroundDays, setBaseTurnaroundDays] = useState<number | null>(null);
    const [loading, setLoading] = useState(true);
    const [loadSucceeded, setLoadSucceeded] = useState(false);
    const [saving, setSaving] = useState(false);
    const [error, setError] = useState('');
    const [removalWarning, setRemovalWarning] = useState(false);
    const [mainImage, setMainImage] = useState<string | null>(null);
    const [imageWarning, setImageWarning] = useState('');
    const [history, setHistory] = useState<WholesaleProductHistoryPage>({ events: [], total: 0, page: 1, limit: 10, totalPages: 0 });
    const [historyLoading, setHistoryLoading] = useState(false);
    const [savedSnapshot, setSavedSnapshot] = useState(() => editableSnapshot(EMPTY_PROFILE, null));

    const loadHistory = useCallback(async (page: number) => {
        if (!api.isReady) return;
        setHistoryLoading(true);
        try { setHistory(await createWholesaleCatalogService(api).getProductHistory(productId, page)); }
        catch { /* Pricing remains editable if history is temporarily unavailable. */ }
        finally { setHistoryLoading(false); }
    }, [api, productId]);

    const load = useCallback(() => {
        if (!api.isReady) return;
        let active = true;
        setLoading(true);
        setLoadSucceeded(false);
        setError('');
        const service = createWholesaleCatalogService(api);
        Promise.all([service.getProduct(productId), service.getDefaults(), service.getProductHistory(productId, 1)])
            .then(([result, defaults, productHistory]) => {
                if (!active) return;
                setMainImage(result.product.mainImage || result.product.imageUrl || null);
                const nextTurnaroundDays = result.product.baseTurnaroundDays ?? null;
                const nextProfile = result.profile ? {
                    ...result.profile,
                    notesDocument: typeof result.profile.notesDocument === 'string' ? result.profile.notesDocument : '',
                } : { ...EMPTY_PROFILE, priceTaxBasis: defaults.defaults.priceTaxBasis };
                setBaseTurnaroundDays(nextTurnaroundDays);
                setProfile(nextProfile);
                setSavedSnapshot(editableSnapshot(nextProfile, nextTurnaroundDays));
                setHistory(productHistory);
                setLoadSucceeded(true);
            })
            .catch((reason: Error) => active && setError(reason.message || 'Unable to load wholesale pricing.'))
            .finally(() => active && setLoading(false));
        return () => { active = false; };
    }, [api, productId]);
    useEffect(() => load(), [load]);

    const setField = <K extends keyof WholesaleProductProfile>(key: K, value: WholesaleProductProfile[K]) => {
        setProfile(current => ({ ...current, [key]: value }));
    };
    const validationErrors = validateWholesaleTiers(profile.priceTiers);
    if (baseTurnaroundDays != null && (!Number.isInteger(baseTurnaroundDays) || baseTurnaroundDays < 0 || baseTurnaroundDays > 3650)) {
        validationErrors.push('Base turnaround must be a whole number from 0 to 3650 days.');
    }
    const notes = typeof profile.notesDocument === 'string' ? profile.notesDocument : '';
    const ranges = inferWholesaleTierRanges(profile.priceTiers);
    const isDirty = loadSucceeded && editableSnapshot(profile, baseTurnaroundDays) !== savedSnapshot;

    useEffect(() => {
        onDirtyChange?.(isDirty);
        return () => onDirtyChange?.(false);
    }, [isDirty, onDirtyChange]);

    const save = async () => {
        if (!isDirty) return true;
        if (!loadSucceeded || validationErrors.length) return false;
        if (profile.imageUrl) {
            try { new URL(profile.imageUrl); } catch { setError('Image URL must be a valid absolute URL.'); return false; }
        }
        setSaving(true);
        setError('');
        try {
            const result = await createWholesaleCatalogService(api).saveProduct(productId, profile, baseTurnaroundDays);
            setProfile(result.profile);
            setSavedSnapshot(editableSnapshot(result.profile, baseTurnaroundDays));
            await loadHistory(1);
            setRemovalWarning(false);
            toast.success('Wholesale product settings saved.');
            return true;
        } catch (reason) {
            const message = reason instanceof Error ? reason.message : 'Unable to save wholesale pricing.';
            setError(message);
            toast.error(message);
            return false;
        } finally {
            setSaving(false);
        }
    };
    useImperativeHandle(ref, () => ({ save }));
    const previewImage = profile.imageUrl || mainImage;

    if (loading) return <div className="flex items-center gap-2 rounded-xl border border-slate-200 bg-white p-6 text-slate-600 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300"><Loader2 className="animate-spin" size={18} /> Loading wholesale settings...</div>;
    if (!loadSucceeded) return <div role="alert" className="rounded-xl border border-red-200 bg-red-50 p-5 text-red-700 dark:border-red-900 dark:bg-red-950/40 dark:text-red-200"><p>{error || 'Unable to load wholesale pricing.'}</p><button type="button" onClick={() => load()} className="mt-3 inline-flex items-center gap-2 rounded-lg bg-red-700 px-3 py-2 text-sm font-semibold text-white"><RefreshCw size={16} /> Retry</button></div>;

    return (
        <div className="space-y-6">
            {!canEdit && <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-200">You have read-only access to wholesale catalog settings.</div>}
            {error && <div role="alert" className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-700 dark:border-red-900 dark:bg-red-950/40 dark:text-red-200">{error}</div>}
            <section className="rounded-2xl border border-slate-200/70 bg-white/80 p-6 shadow-sm backdrop-blur dark:border-slate-700 dark:bg-slate-800/80">
                <div className="grid gap-6 lg:grid-cols-2">
                    <div>
                        <label className="mb-2 block text-sm font-semibold text-slate-800 dark:text-slate-100">Wholesale notes</label>
                        <textarea value={notes} maxLength={1000} disabled={!canEdit} onChange={event => setField('notesDocument', event.target.value)} rows={6} className="w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm disabled:opacity-60 dark:border-slate-600 dark:bg-slate-900 dark:text-slate-100" placeholder="Materials, lead times, packaging, or ordering notes" />
                        <div className={`mt-1 text-xs ${notes.length > 250 ? 'font-medium text-amber-600' : 'text-slate-500'}`}>{notes.length}/1000{notes.length > 250 ? ' - longer notes may crowd catalog layouts' : ''}</div>
                    </div>
                    <div className="space-y-5">
                        <div>
                            <label className="mb-2 block text-sm font-semibold text-slate-800 dark:text-slate-100">Catalog image URL</label>
                            <input type="url" value={profile.imageUrl || ''} disabled={!canEdit} onChange={event => setField('imageUrl', event.target.value || null)} className="w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm disabled:opacity-60 dark:border-slate-600 dark:bg-slate-900 dark:text-slate-100" placeholder="https://..." />
                            {previewImage ? <div className="mt-3 overflow-hidden rounded-xl border border-slate-200 bg-slate-50 dark:border-slate-700 dark:bg-slate-900"><img key={previewImage} src={previewImage} alt="Selected catalog product" onLoad={event => { const image = event.currentTarget; setImageWarning(isLowResolutionImage(image.naturalWidth, image.naturalHeight) ? `Low-resolution image: ${image.naturalWidth} x ${image.naturalHeight}px. Use at least 800 x 800px for best PDF quality.` : ''); }} onError={() => setImageWarning('The selected image could not be loaded.')} className="aspect-[4/3] w-full object-contain" /></div> : <div className="mt-3 rounded-xl border border-dashed border-slate-300 p-5 text-center text-xs text-slate-500 dark:border-slate-700">No product image available.</div>}
                            {imageWarning && <div role="status" className="mt-2 flex gap-2 text-xs font-medium text-amber-700 dark:text-amber-300"><AlertTriangle size={15} className="shrink-0" /> {imageWarning}</div>}
                        </div>
                        <div>
                            <label className="mb-2 block text-sm font-semibold text-slate-800 dark:text-slate-100">Tax basis</label>
                            <select value={profile.priceTaxBasis} disabled={!canEdit} onChange={event => setField('priceTaxBasis', event.target.value as WholesaleTaxBasis)} className="w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm disabled:opacity-60 dark:border-slate-600 dark:bg-slate-900 dark:text-slate-100">
                                <option value="EXCLUSIVE">Tax exclusive</option>
                                <option value="INCLUSIVE">Tax inclusive</option>
                            </select>
                            <p className="mt-1 text-xs text-slate-500">All tier prices use this tax basis.</p>
                        </div>
                        <div>
                            <label className="mb-2 block text-sm font-semibold text-slate-800 dark:text-slate-100">Base turnaround (business days)</label>
                            <input type="number" min={0} max={3650} step={1} value={baseTurnaroundDays ?? ''} disabled={!canEdit} onChange={event => setBaseTurnaroundDays(event.target.value === '' ? null : Number(event.target.value))} className="w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm disabled:opacity-60 dark:border-slate-600 dark:bg-slate-900 dark:text-slate-100" placeholder="Not set" />
                            <p className="mt-1 text-xs text-slate-500">The product-level default. Quantity breaks can override it below.</p>
                        </div>
                    </div>
                </div>
                <div className="mt-6">
                    <div className="mb-2 text-sm font-semibold text-slate-800 dark:text-slate-100">Available processes</div>
                    <div className="flex flex-wrap gap-2">
                        {PROCESS_OPTIONS.map(option => {
                            const selected = profile.personalisationTypes.includes(option.value);
                            return <button type="button" key={option.value} disabled={!canEdit} onClick={() => setField('personalisationTypes', selected ? profile.personalisationTypes.filter(value => value !== option.value) : [...profile.personalisationTypes, option.value])} className={`rounded-full border px-3 py-1.5 text-sm transition disabled:opacity-60 ${selected ? 'border-indigo-500 bg-indigo-50 text-indigo-700 dark:bg-indigo-950/50 dark:text-indigo-200' : 'border-slate-300 text-slate-600 dark:border-slate-600 dark:text-slate-300'}`}>{option.label}</button>;
                        })}
                    </div>
                </div>
            </section>

            <section className="rounded-2xl border border-slate-200/70 bg-white/80 p-6 shadow-sm backdrop-blur dark:border-slate-700 dark:bg-slate-800/80">
                <div className="mb-4 flex items-center justify-between">
                    <div><h3 className="font-semibold text-slate-900 dark:text-white">Quantity pricing</h3><p className="text-sm text-slate-500">Ranges are calculated automatically from each minimum quantity.</p></div>
                    <button type="button" disabled={!canEdit || profile.priceTiers.length >= 5} onClick={() => setField('priceTiers', [...profile.priceTiers, { minimumQuantity: (profile.priceTiers[profile.priceTiers.length - 1]?.minimumQuantity || 0) + 1, unitPrice: '', isPoa: false, leadTimeDays: null }])} className="inline-flex items-center gap-2 rounded-lg bg-indigo-600 px-3 py-2 text-sm font-medium text-white disabled:opacity-50"><Plus size={16} /> Add tier</button>
                </div>
                <div className="space-y-3">
                    {profile.priceTiers.map((tier, index) => (
                        <div key={index} className="grid items-end gap-3 rounded-xl border border-slate-200 p-3 sm:grid-cols-[120px_100px_1fr_150px_auto_auto] dark:border-slate-700">
                            <label className="text-xs text-slate-500">Range<input value={ranges[index]} readOnly className="mt-1 w-full rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm dark:border-slate-700 dark:bg-slate-900" /></label>
                            <label className="text-xs text-slate-500">Min qty<input type="number" min={1} step={1} value={tier.minimumQuantity} disabled={!canEdit} onChange={event => setField('priceTiers', profile.priceTiers.map((item, itemIndex) => itemIndex === index ? { ...item, minimumQuantity: Number(event.target.value) } : item))} className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm dark:border-slate-600 dark:bg-slate-900" /></label>
                            <label className="text-xs text-slate-500">Unit price<input type="number" min="0.0001" step="0.01" value={tier.unitPrice || ''} disabled={!canEdit || tier.isPoa} onChange={event => setField('priceTiers', profile.priceTiers.map((item, itemIndex) => itemIndex === index ? { ...item, unitPrice: event.target.value } : item))} className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm disabled:opacity-50 dark:border-slate-600 dark:bg-slate-900" /></label>
                            <label className="text-xs text-slate-500">Lead time (days)<input type="number" min={0} max={3650} step={1} value={tier.leadTimeDays ?? ''} placeholder={baseTurnaroundDays == null ? 'Not set' : `Base: ${baseTurnaroundDays}`} disabled={!canEdit} onChange={event => setField('priceTiers', profile.priceTiers.map((item, itemIndex) => itemIndex === index ? { ...item, leadTimeDays: event.target.value === '' ? null : Number(event.target.value) } : item))} className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm dark:border-slate-600 dark:bg-slate-900" /></label>
                            <label className="flex h-10 items-center gap-2 text-sm text-slate-700 dark:text-slate-200"><input type="checkbox" checked={tier.isPoa} disabled={!canEdit} onChange={event => setField('priceTiers', profile.priceTiers.map((item, itemIndex) => itemIndex === index ? { ...item, isPoa: event.target.checked, unitPrice: event.target.checked ? null : '' } : item))} /> POA</label>
                            <button type="button" aria-label={`Remove tier ${index + 1}`} disabled={!canEdit} onClick={() => {
                                const finalTier = requiresFinalTierRemovalConfirmation(profile.priceTiers, index);
                                if (finalTier && !window.confirm('Remove the final pricing tier? Saving afterwards will suspend this product from catalogs.')) return;
                                if (finalTier) setRemovalWarning(true);
                                setField('priceTiers', profile.priceTiers.filter((_, itemIndex) => itemIndex !== index));
                            }} className="rounded-lg p-2 text-red-600 hover:bg-red-50 disabled:opacity-50"><Trash2 size={18} /></button>
                        </div>
                    ))}
                    {!profile.priceTiers.length && <div className="rounded-xl border border-dashed border-slate-300 p-8 text-center text-sm text-slate-500 dark:border-slate-600">No wholesale pricing tiers. This product is not catalog eligible.</div>}
                </div>
                {removalWarning && <div className="mt-4 flex gap-2 rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-200"><AlertTriangle className="shrink-0" size={18} /> Saving with no tiers suspends this product in catalogs until valid pricing is restored.</div>}
                {validationErrors.length > 0 && <ul className="mt-4 space-y-1 rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-700 dark:border-red-900 dark:bg-red-950/40 dark:text-red-200">{validationErrors.map(message => <li key={message}>{message}</li>)}</ul>}
            </section>
            <section className="rounded-2xl border border-slate-200/70 bg-white/80 p-6 shadow-sm backdrop-blur dark:border-slate-700 dark:bg-slate-800/80">
                <div className="mb-4 flex items-center justify-between"><div><h3 className="font-semibold text-slate-900 dark:text-white">Pricing history</h3><p className="text-sm text-slate-500">Compact pricing, tax, and process changes. Wholesale notes are not displayed.</p></div>{historyLoading && <Loader2 className="animate-spin text-slate-400" size={18} />}</div>
                <div className="space-y-3">{history.events.map(event => { const oldValue = formatHistorySnapshot(event.details?.old); const newValue = formatHistorySnapshot(event.details?.new); return <article key={event.id} className="rounded-xl border border-slate-200 p-4 text-sm dark:border-slate-700"><div className="mb-3 flex flex-wrap justify-between gap-2"><span className="font-semibold text-slate-800 dark:text-slate-100">{event.user?.fullName || event.user?.email || 'Wholesale staff'}</span><time className="text-xs text-slate-500">{new Date(event.createdAt).toLocaleString()}</time></div><div className="grid gap-3 md:grid-cols-2"><HistorySnapshot label="Before" value={oldValue} /><HistorySnapshot label="After" value={newValue} /></div></article>; })}{!history.events.length && !historyLoading && <div className="rounded-xl border border-dashed border-slate-300 p-6 text-center text-sm text-slate-500 dark:border-slate-700">No pricing changes recorded yet.</div>}</div>
                {history.totalPages > 1 && <div className="mt-4 flex items-center justify-end gap-3 text-sm"><button aria-label="Previous history page" disabled={historyLoading || history.page <= 1} onClick={() => void loadHistory(history.page - 1)} className="rounded-lg border border-slate-300 p-2 disabled:opacity-40 dark:border-slate-600"><ChevronLeft size={16} /></button><span>Page {history.page} of {history.totalPages}</span><button aria-label="Next history page" disabled={historyLoading || history.page >= history.totalPages} onClick={() => void loadHistory(history.page + 1)} className="rounded-lg border border-slate-300 p-2 disabled:opacity-40 dark:border-slate-600"><ChevronRight size={16} /></button></div>}
            </section>
            {canEdit && <div className="flex justify-end"><button type="button" onClick={() => void save()} disabled={!loadSucceeded || saving || validationErrors.length > 0} className="inline-flex items-center gap-2 rounded-xl bg-indigo-600 px-5 py-2.5 font-medium text-white shadow-sm disabled:opacity-50">{saving ? <Loader2 className="animate-spin" size={18} /> : <Save size={18} />} {saving ? 'Saving wholesale...' : 'Save wholesale settings'}</button></div>}
        </div>
    );
});

function HistorySnapshot({ label, value }: { label: string; value: ReturnType<typeof formatHistorySnapshot> }) {
    return <div className="rounded-lg bg-slate-50 p-3 dark:bg-slate-900/70"><div className="mb-1 text-xs font-semibold uppercase tracking-wide text-slate-500">{label}</div><div>{value.tiers}</div><div className="mt-1 text-xs text-slate-500">{value.tax} · {value.badges} · {value.turnaround}</div></div>;
}
