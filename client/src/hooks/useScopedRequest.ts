import { useEffect, useState } from 'react';

/** Mount the caller under an account/auth/resource key to hide old data immediately. */
export function useScopedRequest<T>(url: string | null, accountId: string, token: string, decode: (value: unknown) => T, transport?: (signal: AbortSignal) => Promise<unknown>) {
    const [data, setData] = useState<T | null>(null);
    const [loading, setLoading] = useState(Boolean(url));
    const [error, setError] = useState(false);
    const [attempt, setAttempt] = useState(0);
    useEffect(() => {
        if (!url) return;
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 30000);
        let disposed = false;
        queueMicrotask(() => {
            if (disposed) return;
            setLoading(true); setError(false);
            void (async () => {
                try {
                    let value: unknown;
                    if (transport) value = await transport(controller.signal);
                    else {
                        const response = await fetch(url, { signal: controller.signal, headers: { Authorization: `Bearer ${token}`, 'X-Account-ID': accountId } });
                        if (!response.ok) throw new Error('Request failed'); value = await response.json();
                    }
                    const result = decode(value);
                    if (!disposed && !controller.signal.aborted) setData(result);
                } catch { if (!disposed) setError(true); }
                finally { clearTimeout(timeout); if (!disposed) setLoading(false); }
            })();
        });
        return () => { disposed = true; controller.abort(); clearTimeout(timeout); };
    }, [url, accountId, token, decode, transport, attempt]);
    return { data, loading, error, retry: () => setAttempt(value => value + 1) };
}
