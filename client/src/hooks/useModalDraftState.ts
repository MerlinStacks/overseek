import { useCallback, useState } from 'react';
/** Explicit scope identity is mandatory. Closed/new scopes never expose the prior draft.
 * Reopening takes the latest initial value; in-scope prop refreshes preserve local edits.
 * Values must be structured-cloneable; no unscoped persistent storage is used.
 */
export function useModalDraftState<T>(initialState: T, isOpen: boolean, scopeKey: string) {
    const [state, setState] = useState(() => ({ scopeKey, isOpen, draft: structuredClone(initialState) }));
    let current = state;
    if (state.scopeKey !== scopeKey || state.isOpen !== isOpen) {
        current = { scopeKey, isOpen, draft: structuredClone(initialState) };
        setState(current); // React retries this render before exposing stale content.
    }
    const setDraft = useCallback((update: React.SetStateAction<T>) => {
        setState(previous => previous.scopeKey !== scopeKey || !previous.isOpen ? previous : { ...previous, draft: typeof update === 'function' ? (update as (value: T) => T)(previous.draft) : structuredClone(update) });
    }, [scopeKey]);
    const resetDraft = () => setState(previous => previous.scopeKey !== scopeKey ? previous : { ...previous, draft: structuredClone(initialState) });
    return { draft: current.draft, setDraft, resetDraft };
}
