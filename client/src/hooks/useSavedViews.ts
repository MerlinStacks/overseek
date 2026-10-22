import { create } from 'zustand';
import { useCallback, useEffect, useMemo, useRef } from 'react';
import { useAuth } from '../context/AuthContext';
import { useAccount } from '../context/AccountContext';
import { isRecord } from '../utils/responseValidation';

export interface SavedView {
    id: string; name: string; context: string; filters: Record<string, unknown>; isDefault?: boolean; createdAt: string;
}
interface State { views: SavedView[]; activeViewId: Record<string, string | null>; persistenceError: string | null }
const empty = (): State => ({ views: [], activeViewId: {}, persistenceError: null });
const text = (value: unknown, max = 200): value is string => typeof value === 'string' && !!value.trim() && value.length <= max;
function jsonValue(value: unknown, depth = 0): boolean {
    if (depth > 12) return false;
    if (value === null || typeof value === 'boolean' || typeof value === 'string') return true;
    if (typeof value === 'number') return Number.isFinite(value);
    if (Array.isArray(value)) return value.length <= 1000 && value.every(item => jsonValue(item, depth + 1));
    return isRecord(value) && [Object.prototype, null].includes(Object.getPrototypeOf(value)) && Object.entries(value).length <= 1000 && Object.entries(value).every(([key, item]) => !['__proto__', 'prototype', 'constructor'].includes(key) && jsonValue(item, depth + 1));
}
function validView(value: unknown): value is SavedView {
    return isRecord(value) && text(value.id, 500) && text(value.name) && text(value.context) && isRecord(value.filters) && jsonValue(value.filters) &&
        (value.isDefault === undefined || typeof value.isDefault === 'boolean') && typeof value.createdAt === 'string' && Number.isFinite(Date.parse(value.createdAt));
}
function hydrate(key: string): State {
    const state = empty();
    try {
        const raw = localStorage.getItem(key);
        if (!raw) return state;
        if (raw.length > 1000000) throw new Error();
        const value: unknown = JSON.parse(raw);
        if (!isRecord(value) || value.version !== 2 || !Array.isArray(value.views) || value.views.length > 200 || !value.views.every(validView) || !isRecord(value.activeViewId)) throw new Error();
        const ids = new Set(value.views.map(view => view.id));
        if (ids.size !== value.views.length) throw new Error();
        state.views = value.views;
        state.activeViewId = Object.fromEntries(Object.entries(value.activeViewId).filter(([context, id]) => text(context) && (id === null || typeof id === 'string' && state.views.some(view => view.id === id && view.context === context)))) as Record<string, string | null>;
        return state;
    } catch { return { ...state, persistenceError: 'Saved views could not be restored on this browser.' }; }
}
function makeStore(key: string | null) {
    const store = create<State>(() => key ? hydrate(key) : empty());
    if (key) store.subscribe(state => {
        try {
            const raw = JSON.stringify({ version: 2, views: state.views, activeViewId: state.activeViewId });
            if (raw.length > 1000000) throw new Error();
            localStorage.setItem(key, raw);
            if (state.persistenceError) store.setState({ persistenceError: null });
        } catch {
            if (!state.persistenceError) store.setState({ persistenceError: 'Changes are in memory only; saved views could not be stored on this browser.' });
        }
    });
    return store;
}
const cache = new Map<string, ReturnType<typeof makeStore>>();
const signedOutStore = makeStore(null);
function getStore(key: string | null) {
    if (!key) return signedOutStore;
    if (!cache.has(key)) cache.set(key, makeStore(key));
    return cache.get(key)!;
}

/** Browser-local presets only. Never read legacy account-only keys or pretend to sync to a server. */
export function useSavedViews(context: string) {
    const { token, user } = useAuth(); const { currentAccount } = useAccount();
    const key = token && user?.id && currentAccount?.id && text(context) ? `overseek-saved-views:v2:${JSON.stringify([user.id, currentAccount.id])}` : null;
    const store = useMemo(() => getStore(key), [key]);
    const allViews = store(state => state.views);
    const activeIds = store(state => state.activeViewId);
    const persistenceError = store(state => state.persistenceError);
    const views = useMemo(() => allViews.filter(view => view.context === context), [allViews, context]);
    const activeId = Object.prototype.hasOwnProperty.call(activeIds, context) ? activeIds[context] : null;
    const activeView = views.find(view => view.id === activeId) ?? null;
    // A callback retained from an old render must not mutate a different scope.
    const lifecycle = useMemo(() => ({ key, context }), [key, context]);
    const active = useRef<typeof lifecycle | null>(null);
    useEffect(() => { active.current = lifecycle; return () => { active.current = null; }; }, [lifecycle]);
    const update = useCallback((change: (state: State) => Partial<State>) => {
        if (key && active.current === lifecycle) store.setState(change);
    }, [key, store, lifecycle]);
    const saveCurrentView = useCallback((name: string, filters: Record<string, unknown>): SavedView | null => {
        if (!key || active.current !== lifecycle) return null;
        try {
            const view = { id: crypto.randomUUID(), name: name.trim(), context, filters, createdAt: new Date().toISOString() };
            if (!validView(view) || JSON.stringify(view).length > 50000 || store.getState().views.length >= 200) return null;
            const copy = JSON.parse(JSON.stringify(view)) as SavedView;
            update(state => ({ views: [...state.views, copy], activeViewId: { ...state.activeViewId, [context]: copy.id } }));
            return JSON.parse(JSON.stringify(copy)) as SavedView;
        } catch { return null; }
    }, [key, lifecycle, context, store, update]);
    const applyView = useCallback((id: string | null) => update(state => id === null || state.views.some(view => view.id === id && view.context === context)
        ? { activeViewId: { ...state.activeViewId, [context]: id } } : {}), [context, update]);
    const removeView = useCallback((id: string) => update(state => state.views.some(view => view.id === id && view.context === context)
        ? { views: state.views.filter(view => view.id !== id), activeViewId: { ...state.activeViewId, [context]: state.activeViewId[context] === id ? null : state.activeViewId[context] } } : {}), [context, update]);
    const renameView = useCallback((id: string, name: string) => {
        if (!text(name)) return;
        update(state => ({ views: state.views.map(view => view.id === id && view.context === context ? { ...view, name: name.trim() } : view) }));
    }, [context, update]);
    return { views, activeView, saveCurrentView, applyView, removeView, renameView, clearActiveView: () => applyView(null),
        storageMode: 'local' as const, persistenceError, canSave: !!key };
}
