import { useCallback, useRef, useState } from 'react';
import { useScopedMutation } from './useScopedMutation';
import { useVisibilityPolling } from './useVisibilityPolling';
import { api } from '../services/api';

/** Mount under an auth/account key. Polls and socket refreshes share one request slot. */
export function useWidgetRead<T>(url: string, accountId: string, token: string, decode: (value: unknown) => T, interval: number) {
    const [data, setData] = useState<T | null>(null);
    const queued = useRef(false);
    const { run, busy, error, isPending, isActive } = useScopedMutation();
    const refresh = useCallback(async () => {
        if (!isActive()) return;
        if (isPending()) { queued.current = true; return; }
        do {
            queued.current = false;
            const result = await run(async signal => decode(await api.request(url, { token, accountId, signal })), 'Could not refresh. Any values shown are from the last successful refresh.');
            if (result.ok) setData(result.value);
        } while (queued.current && isActive());
    }, [url, token, accountId, decode, run, isPending, isActive]);
    useVisibilityPolling(refresh, interval, [refresh], `widget:${accountId}:${url}`);
    return { data, busy, error, refresh };
}
