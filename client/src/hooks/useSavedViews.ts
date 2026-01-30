import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { useAuth } from '../context/AuthContext';
import { useAccount } from '../context/AccountContext';
import { useCallback, useEffect } from 'react';

/**
 * SavedView represents a user-defined filter preset for data tables.
 */
export interface SavedView {
    id: string;
    name: string;
    /** The page/context this view applies to (e.g., 'orders', 'customers') */
    context: string;
    /** Filter configuration - flexible to support different page types */
    filters: Record<string, unknown>;
    /** Whether this is a system-provided default view */
    isDefault?: boolean;
    /** When the view was created */
    createdAt: string;
}

interface SavedViewsState {
    views: SavedView[];
    activeViewId: Record<string, string | null>; // context -> viewId
    setViews: (views: SavedView[]) => void;
    addView: (view: SavedView) => void;
    updateView: (id: string, updates: Partial<SavedView>) => void;
    deleteView: (id: string) => void;
    setActiveView: (context: string, viewId: string | null) => void;
    getViewsForContext: (context: string) => SavedView[];
    getActiveView: (context: string) => SavedView | null;
}

/**
 * Zustand store for saved views with localStorage persistence.
 * Account-scoped via dynamic storage key.
 */
const createSavedViewsStore = (accountId: string) =>
    create<SavedViewsState>()(
        persist(
            (set, get) => ({
                views: [],
                activeViewId: {},

                setViews: (views) => set({ views }),

                addView: (view) => set((state) => ({
                    views: [...state.views, view]
                })),

                updateView: (id, updates) => set((state) => ({
                    views: state.views.map((v) =>
                        v.id === id ? { ...v, ...updates } : v
                    )
                })),

                deleteView: (id) => set((state) => ({
                    views: state.views.filter((v) => v.id !== id),
                    activeViewId: Object.fromEntries(
                        Object.entries(state.activeViewId).map(([ctx, vId]) => [
                            ctx,
                            vId === id ? null : vId
                        ])
                    )
                })),

                setActiveView: (context, viewId) => set((state) => ({
                    activeViewId: { ...state.activeViewId, [context]: viewId }
                })),

                getViewsForContext: (context) =>
                    get().views.filter((v) => v.context === context),

                getActiveView: (context) => {
                    const viewId = get().activeViewId[context];
                    return viewId
                        ? get().views.find((v) => v.id === viewId) || null
                        : null;
                }
            }),
            {
                name: `overseek-saved-views-${accountId}`,
                partialize: (state) => ({
                    views: state.views,
                    activeViewId: state.activeViewId
                })
            }
        )
    );

// Store instance cache (one per account)
const storeCache = new Map<string, ReturnType<typeof createSavedViewsStore>>();

function getStore(accountId: string) {
    if (!storeCache.has(accountId)) {
        storeCache.set(accountId, createSavedViewsStore(accountId));
    }
    return storeCache.get(accountId)!;
}

/**
 * useSavedViews - Hook for managing saved filter views.
 * 
 * @param context - The page context (e.g., 'orders', 'customers')
 * 
 * @example
 * const { views, activeView, saveCurrentView, applyView } = useSavedViews('orders');
 */
export function useSavedViews(context: string) {
    const { token } = useAuth();
    const { currentAccount } = useAccount();
    const accountId = currentAccount?.id || 'default';

    const store = getStore(accountId);

    const views = store((s) => s.getViewsForContext(context));
    const activeView = store((s) => s.getActiveView(context));
    const setActiveView = store((s) => s.setActiveView);
    const addView = store((s) => s.addView);
    const updateView = store((s) => s.updateView);
    const deleteView = store((s) => s.deleteView);

    /**
     * Save current filters as a new view.
     */
    const saveCurrentView = useCallback(
        (name: string, filters: Record<string, unknown>) => {
            const newView: SavedView = {
                id: `view_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`,
                name,
                context,
                filters,
                createdAt: new Date().toISOString()
            };
            addView(newView);
            setActiveView(context, newView.id);

            // Optionally sync to server (fire-and-forget)
            if (token && currentAccount) {
                fetch('/api/user/saved-views', {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        'Authorization': `Bearer ${token}`,
                        'X-Account-ID': currentAccount.id
                    },
                    body: JSON.stringify(newView)
                }).catch(() => {
                    // Silent fail - localStorage is primary storage
                });
            }

            return newView;
        },
        [context, addView, setActiveView, token, currentAccount]
    );

    /**
     * Apply a saved view (set it as active).
     */
    const applyView = useCallback(
        (viewId: string | null) => {
            setActiveView(context, viewId);
        },
        [context, setActiveView]
    );

    /**
     * Remove a saved view.
     */
    const removeView = useCallback(
        (viewId: string) => {
            deleteView(viewId);

            // Optionally sync deletion to server
            if (token && currentAccount) {
                fetch(`/api/user/saved-views/${viewId}`, {
                    method: 'DELETE',
                    headers: {
                        'Authorization': `Bearer ${token}`,
                        'X-Account-ID': currentAccount.id
                    }
                }).catch(() => {
                    // Silent fail
                });
            }
        },
        [deleteView, token, currentAccount]
    );

    /**
     * Rename a saved view.
     */
    const renameView = useCallback(
        (viewId: string, newName: string) => {
            updateView(viewId, { name: newName });
        },
        [updateView]
    );

    return {
        views,
        activeView,
        saveCurrentView,
        applyView,
        removeView,
        renameView,
        clearActiveView: () => applyView(null)
    };
}

/**
 * Default views for common use cases.
 * These are injected on first load if no views exist.
 */
export const DEFAULT_ORDER_VIEWS: Omit<SavedView, 'id' | 'createdAt'>[] = [
    {
        name: 'Processing Orders',
        context: 'orders',
        filters: { status: 'processing' },
        isDefault: true
    },
    {
        name: 'Today\'s Orders',
        context: 'orders',
        filters: { dateRange: 'today' },
        isDefault: true
    },
    {
        name: 'High Value ($100+)',
        context: 'orders',
        filters: { minTotal: 100 },
        isDefault: true
    }
];

export const DEFAULT_CUSTOMER_VIEWS: Omit<SavedView, 'id' | 'createdAt'>[] = [
    {
        name: 'VIP Customers',
        context: 'customers',
        filters: { minSpent: 500, minOrders: 3 },
        isDefault: true
    },
    {
        name: 'Recent Signups',
        context: 'customers',
        filters: { dateRange: 'last30days' },
        isDefault: true
    }
];
