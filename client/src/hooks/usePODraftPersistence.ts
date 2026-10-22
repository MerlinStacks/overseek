import { useEffect, useRef, useCallback, useState } from 'react';
import { isRecord } from '../utils/responseValidation';

interface PODraftItem {
    id?: string; productId?: string; supplierItemId?: string; name: string;
    quantity: number; unitCost: number; totalCost: number; sku?: string; wooId?: number; variationWooId?: number;
}
interface PODraftState {
    supplierId: string; status: string; notes: string; orderDate: string; expectedDate: string;
    trackingNumber: string; trackingLink: string; items: PODraftItem[]; savedAt: number;
}
const MAX_AGE = 24 * 60 * 60 * 1000;
const statuses = ['DRAFT', 'ORDERED', 'RECEIVED', 'CANCELLED'];
function valid(value: unknown): value is PODraftState {
    if (!isRecord(value) || !Number.isFinite(value.savedAt) || typeof value.savedAt !== 'number' || value.savedAt > Date.now() || Date.now() - value.savedAt > MAX_AGE) return false;
    if (!['supplierId', 'status', 'notes', 'orderDate', 'expectedDate', 'trackingNumber', 'trackingLink'].every(key => typeof value[key] === 'string' && value[key].length <= 50000) || !statuses.includes(value.status as string)) return false;
    if (![value.orderDate, value.expectedDate].every(date => date === '' || typeof date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(date) && Number.isFinite(Date.parse(date)) && new Date(date).toISOString().slice(0, 10) === date)) return false;
    return Array.isArray(value.items) && value.items.length <= 1000 && value.items.every(item => isRecord(item) && typeof item.name === 'string' && item.name.length <= 10000 &&
        ['quantity', 'unitCost', 'totalCost'].every(key => typeof item[key] === 'number' && Number.isFinite(item[key]) && item[key] >= 0 && item[key] <= Number.MAX_SAFE_INTEGER) &&
        ['id', 'productId', 'supplierItemId', 'sku'].every(key => item[key] == null || typeof item[key] === 'string' && item[key].length <= 10000) &&
        ['wooId', 'variationWooId'].every(key => item[key] == null || typeof item[key] === 'number' && Number.isSafeInteger(item[key]) && item[key] >= 0));
}
function remove(key: string) { try { localStorage.removeItem(key); } catch { /* Storage can be unavailable. */ } }
function read(key: string): PODraftState | null {
    try {
        const raw = localStorage.getItem(key);
        if (!raw) return null;
        if (raw.length > 2000000) { remove(key); return null; }
        const envelope: unknown = JSON.parse(raw);
        if (isRecord(envelope) && envelope.version === 2 && valid(envelope.draft)) return envelope.draft;
        remove(key);
    } catch { remove(key); }
    return null;
}
/** Call loadDraft before enabling writes. Legacy unowned drafts are never restored.
 * Flush on pagehide; navigation/scope changes cancel pending writes rather than
 * persisting a potentially stale form during logout or account changes.
 */
export function usePODraftPersistence({ ownerId, accountId, poId, formState, enabled = true }: {
    ownerId: string; accountId: string; poId: string; formState: Omit<PODraftState, 'savedAt'>; enabled?: boolean;
}) {
    const key = ownerId && accountId && poId ? `po-draft:v2:${JSON.stringify([ownerId, accountId, poId])}` : '';
    const [restoredKey, setRestoredKey] = useState('');
    const [hasDraft, setHasDraft] = useState(false);
    const pending = useRef<{ key: string; draft: PODraftState } | null>(null);
    const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
    const cleared = useRef<string | null>(null);
    const snapshot = JSON.stringify(formState);
    const cancel = useCallback(() => { if (timer.current) clearTimeout(timer.current); timer.current = null; pending.current = null; }, []);
    const flush = useCallback(() => {
        const next = pending.current;
        cancel();
        if (!next) return;
        try { if (valid(next.draft)) localStorage.setItem(next.key, JSON.stringify({ version: 2, draft: next.draft })); } catch { /* Optional local recovery only. */ }
    }, [cancel]);
    const loadDraft = useCallback(() => {
        const draft = key ? read(key) : null;
        setHasDraft(!!draft); setRestoredKey(key);
        return draft;
    }, [key]);
    useEffect(() => {
        cancel();
        if (!key || !enabled || restoredKey !== key || cleared.current === snapshot) return;
        const draft: unknown = { ...JSON.parse(snapshot), savedAt: Date.now() };
        try { if (!valid(draft)) return; } catch { return; }
        pending.current = { key, draft };
        timer.current = setTimeout(flush, 500);
        return cancel;
    }, [key, enabled, restoredKey, snapshot, cancel, flush]);
    useEffect(() => {
        window.addEventListener('pagehide', flush);
        return () => { window.removeEventListener('pagehide', flush); cancel(); };
    }, [flush, cancel]);
    const clearDraft = useCallback(() => { cancel(); cleared.current = snapshot; if (key) remove(key); setHasDraft(false); }, [key, snapshot, cancel]);
    return { loadDraft, clearDraft, hasDraft };
}
