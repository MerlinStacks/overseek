/**
 * useClickOutside — Closes dropdowns/modals when user clicks outside the ref element.
 * Listens for pointer events (including touch and pen) on the document
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

        const element = ref.current;
        const owner = element?.ownerDocument ?? document;
        const listener = (event: Event) => {
            const current = ref.current;
            const target = event.target;
            const NodeType = owner.defaultView?.Node;
            if (!current || !target || !NodeType || !(target instanceof NodeType)) return;
            if (current.contains(target) || event.composedPath().includes(current)) return;
            handler();
        };

        const eventName = typeof owner.defaultView?.PointerEvent === 'function' ? 'pointerdown' : 'mousedown';
        owner.addEventListener(eventName, listener);
        return () => owner.removeEventListener(eventName, listener);
    }, [handler, enabled]);

    return ref;
}
