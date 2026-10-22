import { useEffect, useRef } from 'react';
/** A synchronous lock; aborting a request does not imply the server rolled it back. */
export function useRecoveryAttempt() {
    const busy = useRef(false), active = useRef(false), controller = useRef<AbortController | null>(null);
    useEffect(() => { active.current = true; return () => { active.current = false; controller.current?.abort(); }; }, []);
    return {
        begin: () => { if (busy.current || !active.current) return null; busy.current = true; controller.current = new AbortController(); return controller.current; },
        current: (attempt: AbortController, allowAborted = false) => active.current && controller.current === attempt && (allowAborted || !attempt.signal.aborted),
        finish: () => { busy.current = false; },
    };
}
