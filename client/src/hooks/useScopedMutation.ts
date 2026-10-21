import { useCallback, useEffect, useRef, useState } from 'react';

type Outcome<T> = { ok: true; value: T } | { ok: false };

/** One mutation at a time; callers remount this hook with their auth/resource scope. */
export function useScopedMutation() {
    const active = useRef(true);
    const pending = useRef(false);
    const request = useRef<AbortController | null>(null);
    const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState<string | null>(null);
    useEffect(() => {
        active.current = true;
        return () => { active.current = false; request.current?.abort(); if (timer.current) clearTimeout(timer.current); };
    }, []);
    const run = useCallback(async <T,>(task: (signal: AbortSignal) => Promise<T>, failure: string): Promise<Outcome<T>> => {
        if (pending.current || !active.current) return { ok: false };
        pending.current = true; setBusy(true); setError(null);
        const controller = new AbortController(); request.current = controller;
        const timeout = setTimeout(() => controller.abort(), 30000); timer.current = timeout;
        let abort!: () => void;
        const cancelled = new Promise<never>((_, reject) => {
            abort = () => reject(new Error('Request cancelled'));
            controller.signal.addEventListener('abort', abort, { once: true });
        });
        try {
            // Some API adapters/backoff waits do not reject promptly on abort.
            const value = await Promise.race([task(controller.signal), cancelled]);
            if (!active.current || controller.signal.aborted) throw new Error('Request cancelled');
            return { ok: true, value };
        } catch {
            if (active.current) setError(failure);
            return { ok: false };
        } finally {
            controller.signal.removeEventListener('abort', abort);
            clearTimeout(timeout); timer.current = null; request.current = null; pending.current = false;
            if (active.current) setBusy(false);
        }
    }, []);
    return { run, busy, error, isActive: useCallback(() => active.current, []), isPending: useCallback(() => pending.current, []) };
}
