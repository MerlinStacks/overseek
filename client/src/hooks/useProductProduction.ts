import { useCallback, useEffect, useRef, useState } from 'react';
import { useAuth } from '../context/AuthContext';
import { useAccount } from '../context/AccountContext';
import { useAccountFeature } from './useAccountFeature';
import { usePermissions } from './usePermissions';
import { validateProductionRange, type ProductionRangeDraft } from '../utils/productionRange';

type Range = { productionMinDays: number | null; productionMaxDays: number | null };
type Row = Range & { id: string; wooId: number };
type Product = Row & { variations: Row[] };
export type ProductionDraft = { parent: ProductionRangeDraft; values: Record<number, ProductionRangeDraft> };
const range = (row: Range): ProductionRangeDraft => ({ min: row.productionMinDays?.toString() ?? '', max: row.productionMaxDays?.toString() ?? '' });
export const productionDraft = (product: Product): ProductionDraft => ({ parent: range(product), values: Object.fromEntries(product.variations.map(row => [row.wooId, range(row)])) });
const equal = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
export function productionError(draft: ProductionDraft): string | null {
    return validateProductionRange(draft.parent) || Object.entries(draft.values).map(([id, value]) => {
        const error = validateProductionRange(value);
        return error ? `Variation #${id}: ${error}` : null;
    }).find(Boolean) || null;
}
function productionIdentityError(draft: ProductionDraft, product: Product): string | null {
    const ids = new Set(product.variations.map(row => row.wooId));
    const removed = Object.keys(draft.values).filter(id => !ids.has(Number(id)));
    if (removed.length) return `Production drafts for removed variations #${removed.join(', #')} are retained. Sync to restore those variations, or use Discard Draft to explicitly discard unsaved changes before saving.`;
    const missing = product.variations.filter(row => !Object.prototype.hasOwnProperty.call(draft.values, row.wooId) || !draft.values[row.wooId]);
    return missing.length ? `Production ranges are missing for variations #${missing.map(row => row.wooId).join(', #')}. Reload production settings before saving.` : null;
}
export function productionPayload(draft: ProductionDraft, product: Product) {
    const issue = productionIdentityError(draft, product) || productionError(draft);
    if (issue) throw new Error(issue);
    const fields = (value: ProductionRangeDraft): Range => ({ productionMinDays: value.min === '' ? null : Number(value.min), productionMaxDays: value.max === '' ? null : Number(value.max) });
    return { ...fields(draft.parent), variations: product.variations.map(row => ({ id: row.id, ...fields(draft.values[row.wooId]) })) };
}

/** Loaded independently of tabs; only current server identities are ever sent to the API. */
export function useProductProduction(productId: string | undefined) {
    const { token } = useAuth();
    const { currentAccount } = useAccount();
    const enabled = useAccountFeature('DELIVERY_ESTIMATES');
    const { hasPermission } = usePermissions();
    const visible = enabled && hasPermission('view_products');
    const editable = visible && hasPermission('edit_products');
    const scope = `${currentAccount?.id}:${productId}:${visible}`;
    const live = useRef({ scope, token, editable, visible, enabled });
    live.current = { scope, token, editable, visible, enabled };
    const [state, setState] = useState<{ scope: string; product: Product; draft: ProductionDraft; saved: ProductionDraft }>();
    const stateRef = useRef(state);
    stateRef.current = state;
    const [error, setError] = useState<string>();
    const [loading, setLoading] = useState(false);
    const [attempt, setAttempt] = useState(0);
    const readyRef = useRef<string | undefined>(undefined);
    const discardRef = useRef(false);
    const requests = useRef(new Set<AbortController>());
    const key = `product-production-draft:${currentAccount?.id}:${productId}`;
    const url = `/api/delivery-estimates/products/${encodeURIComponent(productId || '')}`;
    const persist = useCallback((draft: ProductionDraft, saved: ProductionDraft) => {
        try {
            if (equal(draft, saved)) localStorage.removeItem(key);
            else localStorage.setItem(key, JSON.stringify({ draft, saved, savedAt: Date.now() }));
        } catch { /* Storage may be unavailable. In-memory edits remain usable. */ }
    }, [key]);
    useEffect(() => {
        const controller = new AbortController();
        const previous = stateRef.current?.scope === scope ? stateRef.current : undefined;
        const discard = discardRef.current;
        discardRef.current = false;
        readyRef.current = undefined;
        if (!previous || discard) { stateRef.current = undefined; setState(undefined); }
        setError(undefined);
        if (!visible || !currentAccount?.id || !productId) return;
        setLoading(true);
        const accountId = currentAccount.id;
        void (async () => {
            try {
                const response = await fetch(url, { signal: controller.signal, headers: { Authorization: `Bearer ${live.current.token}`, 'X-Account-ID': accountId } });
                const data = await response.json();
                if (controller.signal.aborted || live.current.scope !== scope) return;
                if (!response.ok) throw new Error(response.status === 404 ? 'Production identity is no longer available. Sync or reload the product, then retry loading production settings.' : data.error || 'Unable to load production settings.');
                const product = data.product as Product;
                if (product.id !== productId) throw new Error('Production product identity mismatch.');
                const saved = productionDraft(product);
                let draft = saved;
                let restored: { draft: ProductionDraft; saved?: ProductionDraft } | undefined = discard ? undefined : previous;
                try {
                    const stored = JSON.parse(localStorage.getItem(key) || 'null');
                    const valid = (value: unknown): value is ProductionRangeDraft => !!value && typeof value === 'object' && 'min' in value && typeof value.min === 'string' && 'max' in value && typeof value.max === 'string';
                    if (!discard && !restored && stored && Date.now() - stored.savedAt < 86400000 && valid(stored.draft?.parent)) {
                        const values = Object.fromEntries(Object.entries(stored.draft.values || {}).filter((entry): entry is [string, ProductionRangeDraft] => valid(entry[1])));
                        restored = { draft: { parent: stored.draft.parent, values }, saved: stored.saved };
                    }
                } catch { /* Ignore malformed drafts. */ }
                if (restored) {
                    draft = { parent: equal(restored.draft.parent, restored.saved?.parent) ? saved.parent : restored.draft.parent, values: { ...saved.values } };
                    for (const [wooId, value] of Object.entries(restored.draft.values)) {
                        // Retain changed orphan rows as well: deletion must never silently erase a draft.
                        if (!equal(value, restored.saved?.values?.[Number(wooId)])) draft.values[Number(wooId)] = value;
                    }
                }
                const next = { scope, product, draft, saved };
                stateRef.current = next; setState(next); readyRef.current = scope;
                // Rebase persisted drafts too: a successful write whose ACK was lost must
                // not be resurrected over a later external edit on the next visit.
                persist(draft, saved);
            } catch (err) {
                if (!controller.signal.aborted && live.current.scope === scope) setError(err instanceof Error ? err.message : 'Unable to load production settings.');
            } finally { if (!controller.signal.aborted && live.current.scope === scope) setLoading(false); }
        })();
        const pending = requests.current;
        return () => { controller.abort(); pending.forEach(request => request.abort()); pending.clear(); };
    }, [scope, attempt, productId, currentAccount?.id, visible, url, key, persist]);
    const current = state?.scope === scope ? state : undefined;
    const warning = current ? productionIdentityError(current.draft, current.product) || undefined : undefined;
    const dirty = !!current && !equal(current.draft, current.saved);
    useEffect(() => {
        if (!dirty) return;
        const warn = (event: BeforeUnloadEvent) => event.preventDefault();
        window.addEventListener('beforeunload', warn);
        return () => window.removeEventListener('beforeunload', warn);
    }, [dirty]);
    const update = (change: (draft: ProductionDraft) => ProductionDraft) => {
        const latest = stateRef.current;
        if (!latest || latest.scope !== scope || !editable || live.current.scope !== scope || !live.current.editable || readyRef.current !== scope) return;
        const draft = change(latest.draft);
        const next = { ...latest, draft };
        stateRef.current = next; setState(next); setError(undefined); persist(draft, latest.saved);
    };
    const validate = () => {
        const value = stateRef.current;
        const issue = !visible ? null : readyRef.current !== scope || value?.scope !== scope
            ? 'Production settings are not ready. Wait for loading to finish, or retry loading production settings before saving.'
            : productionIdentityError(value.draft, value.product) || (!equal(value.draft, value.saved) && !live.current.editable ? 'Production editing permission is required to save this draft. Restore access or discard the draft.' : productionError(value.draft));
        if (issue) setError(issue);
        return issue;
    };
    const save = async (snapshot = stateRef.current) => {
        if (!snapshot || equal(snapshot.draft, snapshot.saved)) return;
        if (!live.current.enabled) throw new Error('Delivery estimates were disabled during saving. Production drafts are retained. Re-enable the feature before retrying.');
        if (!live.current.visible || !live.current.editable) throw new Error('Production editing permission changed during saving. Drafts are retained. Restore access before retrying.');
        if (live.current.scope !== scope || snapshot.scope !== scope) throw new Error('Product scope changed. Reload the product before retrying.');
        if (readyRef.current !== scope) throw new Error('Production settings need reloading before saving. Retry loading production settings.');
        const issue = productionError(snapshot.draft);
        if (issue) throw new Error(issue);
        const controller = new AbortController(); requests.current.add(controller);
        try {
            const response = await fetch(url, { method: 'PUT', signal: controller.signal, headers: { Authorization: `Bearer ${live.current.token}`, 'X-Account-ID': currentAccount!.id, 'Content-Type': 'application/json' }, body: JSON.stringify(productionPayload(snapshot.draft, snapshot.product)) });
            const data = await response.json();
            if (controller.signal.aborted || live.current.scope !== scope) throw new Error('Product scope changed.');
            if (!response.ok) throw new Error(response.status === 404 ? 'Production identity changed. Sync or reload the product before retrying; your draft is retained.' : data.error || 'Unable to save production settings.');
            const latest = stateRef.current!;
            // Acknowledge only the submitted snapshot; edits typed in flight stay dirty.
            const next = { ...latest, saved: snapshot.draft };
            stateRef.current = next; setState(next); persist(next.draft, next.saved); setError(undefined);
        } catch (err) {
            if (live.current.scope === scope) setError(err instanceof Error ? err.message : 'Unable to save production settings.');
            throw err;
        } finally { requests.current.delete(controller); }
    };
    // The controlled fields block unloaded values themselves; authorized users must
    // still be able to retry a failed load from an expanded variation.
    const disabled = !editable || loading;
    const refresh = () => { readyRef.current = undefined; setLoading(true); setAttempt(value => value + 1); };
    return {
        dirty, validate, save, refresh, warning,
        captureSave: () => { const snapshot = stateRef.current; return () => snapshot ? save(snapshot) : Promise.resolve(); },
        isDirty: () => { const value = stateRef.current; return value?.scope === scope && !equal(value.draft, value.saved); },
        discard: () => { try { localStorage.removeItem(key); } catch { /* Discard must still reset in-memory drafts when storage is unavailable. */ } discardRef.current = true; refresh(); },
        general: visible ? { value: current?.draft.parent, onChange: (parent: ProductionRangeDraft) => update(draft => ({ ...draft, parent })), disabled: !editable || loading, loading, error: readyRef.current === scope ? undefined : error, onRetry: refresh } : undefined,
        variations: visible ? { parent: current?.draft.parent ?? { min: '', max: '' }, values: current?.draft.values ?? {}, onChange: (wooId: number, value: ProductionRangeDraft) => update(draft => draft.values[wooId] ? { ...draft, values: { ...draft.values, [wooId]: value } } : draft), disabled, loading, error: readyRef.current === scope ? undefined : error, onRetry: refresh } : undefined,
    };
}
