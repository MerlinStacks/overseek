import { useCallback, useEffect, useState } from 'react';
import { useScopedMutation } from '../../hooks/useScopedMutation';
import { api } from '../../services/api';

/** The admin page mounts under its user/token key. Each read has an independent slot. */
export function useAdminRead<T>(url: string, token: string | null, decode: (value: unknown) => T, immediate = false) {
    const [data, setData] = useState<T | null>(null);
    const { run, busy, error, isPending, isActive } = useScopedMutation();
    const refresh = useCallback(async () => {
        if (!token || isPending() || !isActive()) return;
        const result = await run(async signal => decode(await api.request(url, { token, signal })), 'Read unavailable. Any displayed data is from the last successful refresh.');
        if (result.ok) { setData(result.value); return result.value; }
    }, [url, token, decode, run, isPending, isActive]);
    useEffect(() => {
        let disposed = false;
        if (immediate) queueMicrotask(() => { if (!disposed) void refresh(); });
        return () => { disposed = true; };
    }, [refresh, immediate]);
    return { data, busy, error, refresh, isPending };
}
