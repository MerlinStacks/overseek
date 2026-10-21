/** Race adapters that do not themselves observe AbortSignal; always remove listeners. */
export async function abortable<T>(work: Promise<T>, signal?: AbortSignal | null): Promise<T> {
    signal?.throwIfAborted();
    if (!signal) return work;
    let abort!: () => void;
    const cancelled = new Promise<never>((_, reject) => {
        abort = () => reject(signal.reason ?? new DOMException('Request aborted', 'AbortError'));
        signal.addEventListener('abort', abort, { once: true });
    });
    try { return await Promise.race([work, cancelled]); }
    finally { signal.removeEventListener('abort', abort); }
}

export function abortableDelay(ms: number, signal?: AbortSignal | null): Promise<void> {
    signal?.throwIfAborted();
    let timer!: ReturnType<typeof setTimeout>;
    const work = new Promise<void>(resolve => { timer = setTimeout(resolve, ms); });
    return abortable(work, signal).finally(() => clearTimeout(timer));
}
