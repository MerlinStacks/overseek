import { useEffect, useRef, useState } from 'react';
import { useAccount } from '../../context/AccountContext';
import { useAuth } from '../../context/AuthContext';
import { useAccountFeature } from '../../hooks/useAccountFeature';
import { usePermissions } from '../../hooks/usePermissions';

type Range = { productionMinDays: number | null; productionMaxDays: number | null };
type Variation = Range & { id: string; wooId: number };
type ProductionProduct = Variation & { variations: Variation[] };
type Response = { product: ProductionProduct; status: { syncStatus: string; storefrontActivated: boolean } };
type DraftRange = { min: string; max: string };
type Draft = DraftRange & { variations: (DraftRange & { id: string; wooId: number })[] };
type Props = { productId: string; variationNames?: Record<number, string> };

const draftRange = (range: Range): DraftRange => ({ min: range.productionMinDays?.toString() ?? '', max: range.productionMaxDays?.toString() ?? '' });
const toDraft = (product: ProductionProduct): Draft => ({ ...draftRange(product), variations: product.variations.map(v => ({ id: v.id, wooId: v.wooId, ...draftRange(v) })) });

function rangeError(range: DraftRange): string | null {
    if (range.min === '' && range.max === '') return null;
    if (range.min === '' || range.max === '') return 'Enter both minimum and maximum, or leave both blank.';
    if (![range.min, range.max].every(value => /^\d+$/.test(value) && Number(value) <= 3650)) return 'Use whole days from 0 to 3650.';
    if (Number(range.min) > Number(range.max)) return 'Minimum must not exceed maximum.';
    return null;
}

const toRange = (range: DraftRange): Range => ({ productionMinDays: range.min === '' ? null : Number(range.min), productionMaxDays: range.max === '' ? null : Number(range.max) });
const rangeLabel = (range: DraftRange) => `${range.min}–${range.max} production days`;

/** Keyed scope prevents old account/product requests and drafts leaking into a new editor. */
export function DeliveryProductionEditor(props: Props) {
    const { currentAccount } = useAccount();
    const { token } = useAuth();
    const enabled = useAccountFeature('DELIVERY_ESTIMATES');
    const { hasPermission } = usePermissions();
    const canEdit = hasPermission('edit_products');
    if (!enabled || !hasPermission('view_products')) return null;
    if (!currentAccount || !token) return <p role="status">Loading account…</p>;
    return <ProductionForm key={`${currentAccount.id}:${props.productId}:${canEdit}`} {...props} accountId={currentAccount.id} token={token} canEdit={canEdit} />;
}

function ProductionForm({ productId, variationNames = {}, accountId, token, canEdit }: Props & { accountId: string; token: string; canEdit: boolean }) {
    const [draft, setDraft] = useState<Draft | null>(null);
    const [saved, setSaved] = useState('');
    const [status, setStatus] = useState<Response['status'] | null>(null);
    const [error, setError] = useState('');
    const [message, setMessage] = useState('');
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);
    const [blocked, setBlocked] = useState(false);
    const [attempt, setAttempt] = useState(0);
    const requests = useRef(new Set<AbortController>());
    const savingRef = useRef(false);
    // Silent auth refresh must not reload over unsaved production edits.
    const tokenRef = useRef(token);
    tokenRef.current = token;
    const url = `/api/delivery-estimates/products/${encodeURIComponent(productId)}`;

    useEffect(() => {
        const pending = requests.current;
        return () => { pending.forEach(controller => controller.abort()); pending.clear(); };
    }, []);

    useEffect(() => {
        const controller = new AbortController();
        requests.current.add(controller);
        const load = async () => {
            setLoading(true); setError(''); setBlocked(false);
            try {
                const res = await fetch(url, { headers: { Authorization: `Bearer ${tokenRef.current}`, 'X-Account-ID': accountId }, signal: controller.signal });
                const data = await res.json();
                if (controller.signal.aborted) return;
                if (!res.ok) throw new Error(data.error || 'Unable to load production settings.');
                const next = toDraft((data as Response).product);
                setDraft(next); setSaved(JSON.stringify(next)); setStatus(data.status);
            } catch (err) {
                if (!controller.signal.aborted) setError(err instanceof Error ? err.message : 'Unable to load production settings.');
            } finally {
                requests.current.delete(controller);
                if (!controller.signal.aborted) setLoading(false);
            }
        };
        void load();
        return () => controller.abort();
    }, [accountId, url, attempt]);

    const save = async () => {
        if (!draft || !canEdit || blocked || savingRef.current) return;
        const invalid = rangeError(draft) || draft.variations.map(v => {
            const issue = rangeError(v);
            return issue ? `Variation #${v.wooId}: ${issue}` : null;
        }).find(Boolean);
        if (invalid) { setError(invalid); return; }
        const controller = new AbortController();
        requests.current.add(controller);
        savingRef.current = true; setSaving(true); setError(''); setMessage('');
        try {
            const res = await fetch(url, {
                method: 'PUT', signal: controller.signal,
                headers: { Authorization: `Bearer ${tokenRef.current}`, 'X-Account-ID': accountId, 'Content-Type': 'application/json' },
                body: JSON.stringify({ ...toRange(draft), variations: draft.variations.map(v => ({ id: v.id, ...toRange(v) })) }),
            });
            const data = await res.json();
            if (controller.signal.aborted) return;
            if (!res.ok) {
                if (res.status === 403) setBlocked(true);
                throw new Error(data.code === 'FEATURE_DISABLED' ? 'Delivery estimates were disabled for this account.' : data.error || 'Unable to save production settings.');
            }
            const next = toDraft((data as Response).product);
            setDraft(next); setSaved(JSON.stringify(next)); setStatus(data.status);
            setMessage('Production settings saved in Overseek.');
        } catch (err) {
            if (!controller.signal.aborted) setError(err instanceof Error ? err.message : 'Unable to save production settings.');
        } finally {
            requests.current.delete(controller);
            if (!controller.signal.aborted) { savingRef.current = false; setSaving(false); }
        }
    };

    const update = (next: Draft) => { setDraft(next); setError(''); setMessage(''); };
    const disabled = !canEdit || saving || blocked;
    const dirty = draft !== null && JSON.stringify(draft) !== saved;
    return <section aria-label="Delivery production settings" className="space-y-5 rounded-xl border border-slate-200 dark:border-slate-700 bg-white/80 dark:bg-slate-800/80 p-5 text-slate-900 dark:text-slate-100">
        <h2 className="text-xl font-semibold">Delivery production settings</h2>
        <p className="text-sm">Saved locally in Overseek using the separate Save production settings button. The page’s Save Changes button does not save these settings.</p>
        {status && <p role="note" className="rounded-lg bg-amber-50 dark:bg-amber-950 p-3 text-amber-900 dark:text-amber-200">Last acknowledged activation: {status.storefrontActivated ? 'active' : 'inactive'}. Check settings and production sync readiness and the launch panel in Delivery estimates settings for current verified storefront status. Saving production settings does not request activation; individual estimates depend on synchronized inputs and fresh stock proofs.</p>}
        <p className="text-sm">Leave both product fields blank for no estimate. If any cart item has no resolved production range, the entire cart estimate is blank. Blank variation fields inherit the parent product; zero is an explicit value.</p>
        <p className="text-sm">A 0–1 range means production today/tomorrow before the configured cutoff when both dates are working days. The configured timezone, production calendar and closures apply; after cutoff, the start moves to the next working day. Transit is additional.</p>
        {loading && <p role="status">Loading production settings…</p>}
        {error && <p role="alert" className="text-red-700 dark:text-red-300">{error}</p>}
        {!loading && !draft && <button type="button" onClick={() => setAttempt(value => value + 1)} className="text-indigo-600 dark:text-indigo-300 underline">Retry loading production settings</button>}
        {!loading && draft && <>
            <RangeFields label="Product" range={draft} disabled={disabled} onChange={range => update({ ...draft, ...range })} />
            <p>{rangeError(draft) ? 'Product range is incomplete or invalid.' : draft.min === '' ? 'Product unset → no estimate; entire cart estimate is blank when this item has no override.' : `Product: ${rangeLabel(draft)}`}</p>
            {draft.variations.map((variation, index) => <div key={variation.id} className="space-y-2 border-t border-slate-200 dark:border-slate-700 pt-4">
                <RangeFields label={variationNames[variation.wooId] ? `${variationNames[variation.wooId]} (Woo variation #${variation.wooId})` : `Woo variation #${variation.wooId}`} range={variation} disabled={disabled} onChange={range => update({ ...draft, variations: draft.variations.map((v, i) => i === index ? { ...v, ...range } : v) })} />
                <p className="text-sm">{rangeError(variation) ? 'Variation range is incomplete or invalid.' : variation.min !== '' ? `Override: ${rangeLabel(variation)}` : rangeError(draft) ? 'Inherits parent: enter a valid product range.' : draft.min === '' ? 'Inherits parent: unset → no estimate; entire cart estimate is blank.' : `Inherits parent: ${rangeLabel(draft)}`}</p>
            </div>)}
            {!canEdit && <p className="text-sm">View only. Editing requires edit_products permission.</p>}
            {dirty && <p role="status">Unsaved production settings — save separately below.</p>}
            {message && <p role="status">{message}</p>}
            {canEdit && <button type="button" onClick={() => void save()} disabled={disabled || !dirty} className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white disabled:opacity-50">{saving ? 'Saving production settings…' : 'Save production settings'}</button>}
        </>}
    </section>;
}

function RangeFields({ label, range, disabled, onChange }: { label: string; range: DraftRange; disabled: boolean; onChange: (range: DraftRange) => void }) {
    return <fieldset disabled={disabled} className="space-y-3">
        <legend className="font-medium">{label}</legend>
        <div className="flex flex-wrap gap-4">
            {(['min', 'max'] as const).map(key => <label key={key} className="flex flex-col gap-1 text-sm">
                {key === 'min' ? 'Minimum days' : 'Maximum days'}
                <input type="text" inputMode="numeric" aria-label={`${label} ${key === 'min' ? 'minimum' : 'maximum'} days`} value={range[key]} placeholder="Unset" onChange={event => onChange({ ...range, [key]: event.target.value })} className="w-36 rounded-lg border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-900 px-3 py-2 disabled:opacity-60" />
            </label>)}
        </div>
    </fieldset>;
}
