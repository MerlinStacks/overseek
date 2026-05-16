import { useCallback, useEffect, useRef, useState } from 'react';

/**
 * Keeps modal form draft state consistent across open/close cycles.
 * - Rehydrates draft from latest initial state when modal opens
 * - Provides a reset helper for Cancel/Close flows
 */
export function useModalDraftState<T>(initialState: T, isOpen: boolean) {
    const [draft, setDraft] = useState<T>(initialState);
    const initialRef = useRef<T>(initialState);
    const wasOpenRef = useRef<boolean>(isOpen);

    useEffect(() => {
        initialRef.current = initialState;

        const openedNow = isOpen && !wasOpenRef.current;
        wasOpenRef.current = isOpen;

        if (openedNow) {
            queueMicrotask(() => {
                setDraft(initialState);
            });
        }
    }, [initialState, isOpen]);

    const resetDraft = useCallback(() => {
        setDraft(initialRef.current);
    }, []);

    return {
        draft,
        setDraft,
        resetDraft,
    };
}
