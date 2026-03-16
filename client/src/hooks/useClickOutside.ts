/**
 * useClickOutside — Closes dropdowns/modals when user clicks outside the ref element.
 * Listens for mousedown events on the document and calls the handler
 * if the click target is outside the referenced element.
 */
import { useEffect, useRef, type RefObject } from 'react';

/**
 * Calls `handler` when a click occurs outside the element referenced by the returned ref.
 * @param handler - Callback invoked on outside click
 * @param enabled - Toggle listening on/off (default: true)
 */
export function useClickOutside<T extends HTMLElement = HTMLElement>(
    handler: () => void,
    enabled = true
): RefObject<T | null> {
    const ref = useRef<T | null>(null);

    useEffect(() => {
        if (!enabled) return;

        const listener = (event: MouseEvent) => {
            if (!ref.current || ref.current.contains(event.target as Node)) return;
            handler();
        };

        document.addEventListener('mousedown', listener);
        return () => document.removeEventListener('mousedown', listener);
    }, [handler, enabled]);

    return ref;
}
