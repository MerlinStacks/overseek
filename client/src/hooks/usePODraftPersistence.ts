import { useEffect, useRef, useCallback } from 'react';
import { Logger } from '../utils/logger';

/** Shape of a single PO line item stored in the draft */
interface PODraftItem {
    id?: string;
    productId?: string;
    supplierItemId?: string;
    name: string;
    quantity: number;
    unitCost: number;
    totalCost: number;
    sku?: string;
    wooId?: number;
    variationWooId?: number;
}

/** Full form snapshot persisted to localStorage */
export interface PODraftState {
    supplierId: string;
    status: string;
    notes: string;
    orderDate: string;
    expectedDate: string;
    trackingNumber: string;
    trackingLink: string;
    items: PODraftItem[];
    /** Epoch ms — drafts older than MAX_DRAFT_AGE_MS are discarded */
    savedAt: number;
}

/** 24 hours in milliseconds */
const MAX_DRAFT_AGE_MS = 24 * 60 * 60 * 1000;

/** Debounce delay before writing to localStorage */
const SAVE_DEBOUNCE_MS = 500;

/**
 * Build the localStorage key scoped to account + PO.
 * Why: prevents collisions when a user works across multiple accounts or POs.
 */
export function buildDraftKey(accountId: string, poId: string): string {
    return `po-draft:${accountId}:${poId}`;
}

/**
 * Try to read a stored draft, returning null if missing or expired.
 * Why: centralised read logic keeps expiry checks in one place.
 */
export function readDraft(key: string): PODraftState | null {
    try {
        const raw = localStorage.getItem(key);
        if (!raw) return null;

        const parsed: PODraftState = JSON.parse(raw);

        if (Date.now() - parsed.savedAt > MAX_DRAFT_AGE_MS) {
            localStorage.removeItem(key);
            return null;
        }

        return parsed;
    } catch {
        localStorage.removeItem(key);
        return null;
    }
}

/**
 * Write a draft snapshot to localStorage.
 * Why: separated so it can be called independently and tested easily.
 */
export function writeDraft(key: string, state: PODraftState): void {
    try {
        localStorage.setItem(key, JSON.stringify(state));
    } catch (err) {
        // Why: quota exceeded or private-browsing — log but don't crash
        Logger.error('Failed to persist PO draft', { error: err });
    }
}

interface UsePODraftPersistenceOptions {
    /** Current account ID used to scope the draft key */
    accountId: string;
    /** PO ID or "new" for unsaved POs */
    poId: string;
    /** Current form state snapshot — the hook auto-saves whenever this changes */
    formState: Omit<PODraftState, 'savedAt'>;
    /** Whether auto-save is enabled (disable while loading server data) */
    enabled?: boolean;
}

interface UsePODraftPersistenceReturn {
    /** Load an existing draft, or null if none / expired */
    loadDraft: () => PODraftState | null;
    /** Remove the draft from localStorage */
    clearDraft: () => void;
    /** Whether a draft existed at mount time */
    hasDraft: boolean;
}

/**
 * Auto-saves PO form state to localStorage with debounce.
 * Why: prevents data loss when the browser refreshes or crashes mid-edit.
 *
 * @example
 * ```ts
 * const { loadDraft, clearDraft, hasDraft } = usePODraftPersistence({
 *   accountId: currentAccount.id,
 *   poId: id ?? 'new',
 *   formState: { supplierId, status, notes, ... items },
 * });
 * ```
 */
export function usePODraftPersistence({
    accountId,
    poId,
    formState,
    enabled = true,
}: UsePODraftPersistenceOptions): UsePODraftPersistenceReturn {
    const key = buildDraftKey(accountId, poId);
    const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const hasDraftRef = useRef(false);

    // Check for existing draft on first render
    useEffect(() => {
        hasDraftRef.current = readDraft(key) !== null;
    }, [key]);

    // Debounced auto-save whenever formState changes
    useEffect(() => {
        if (!enabled) return;

        if (timerRef.current) clearTimeout(timerRef.current);

        timerRef.current = setTimeout(() => {
            writeDraft(key, { ...formState, savedAt: Date.now() });
        }, SAVE_DEBOUNCE_MS);

        return () => {
            if (timerRef.current) clearTimeout(timerRef.current);
        };
        // Why: stringify comparison avoids missing deep changes in items array
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [key, enabled, JSON.stringify(formState)]);

    const loadDraft = useCallback((): PODraftState | null => {
        return readDraft(key);
    }, [key]);

    const clearDraft = useCallback((): void => {
        localStorage.removeItem(key);
        hasDraftRef.current = false;
    }, [key]);

    return {
        loadDraft,
        clearDraft,
        hasDraft: hasDraftRef.current,
    };
}
