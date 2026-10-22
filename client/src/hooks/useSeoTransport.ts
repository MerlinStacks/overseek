import { useQuery, useQueryClient, type QueryKey } from '@tanstack/react-query';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useAuth } from '../context/AuthContext';
import { useApi } from './useApi';
function useScope() {
    const { user, token } = useAuth(); const api = useApi();
    const id = JSON.stringify([user?.id, api.accountId, token]);
    return { id, ready: !!user?.id && !!token && api.isReady };
}
export function useSeoQuery<T>({ queryKey, queryFn, enabled = true, ...options }: {
    queryKey: QueryKey; queryFn: (signal: AbortSignal) => Promise<T>; enabled?: boolean; staleTime?: number; refetchInterval?: number;
}) {
    const scope = useScope(); const allowed = scope.ready && enabled;
    const result = useQuery<T>({ ...options, queryKey: ['scoped-seo', scope.id, ...queryKey], queryFn: ({ signal }) => queryFn(signal), enabled: allowed, retry: false, gcTime: 0 });
    return { ...result, data: allowed ? result.data : undefined, isLoading: allowed && result.isPending,
        refetch: async () => allowed ? (await result.refetch()).data : undefined };
}
/** Every mutation callback and invalidation belongs to its captured auth/account lifecycle. */
export function useSeoMutation<T, V = void>({ mutationFn, invalidateQueries = [] }: {
    mutationFn: (value: V, signal: AbortSignal) => Promise<T>; invalidateQueries?: QueryKey[];
}) {
    const scope = useScope(); const client = useQueryClient();
    const lifecycle = useMemo(() => ({ id: scope.id, ready: scope.ready }), [scope.id, scope.ready]);
    const active = useRef<{ scope: typeof lifecycle; pending: boolean; controller: AbortController | null } | null>(null);
    const [state, setState] = useState<{ id: string; busy: boolean; error: Error | null }>({ id: scope.id, busy: false, error: null });
    useEffect(() => {
        const slot = { scope: lifecycle, pending: false, controller: null as AbortController | null }; active.current = slot;
        return () => { slot.controller?.abort(); if (active.current === slot) active.current = null; };
    }, [lifecycle]);
    const mutateAsync = useCallback(async (value: V): Promise<T> => {
        const slot = active.current;
        if (!slot || slot.scope !== lifecycle || !lifecycle.ready || slot.pending) throw new Error('Mutation unavailable or already pending');
        slot.pending = true; const controller = new AbortController(); slot.controller = controller;
        setState({ id: lifecycle.id, busy: true, error: null });
        const timer = setTimeout(() => controller.abort(), 30000);
        try {
            const result = await mutationFn(value, controller.signal);
            if (active.current !== slot || controller.signal.aborted) throw new Error('Scope changed or request cancelled');
            for (const key of invalidateQueries) void client.invalidateQueries({ queryKey: ['scoped-seo', lifecycle.id, ...key] });
            return result;
        } catch (cause) {
            const error = cause instanceof Error ? cause : new Error('SEO mutation failed');
            if (active.current === slot) setState({ id: lifecycle.id, busy: false, error });
            throw error;
        } finally {
            clearTimeout(timer); slot.pending = false; slot.controller = null;
            if (active.current === slot) setState(previous => ({ ...previous, busy: false }));
        }
    }, [lifecycle, mutationFn, invalidateQueries, client]);
    const mutate = (value: V, options?: { onSuccess?: (data: T) => void }) => {
        void mutateAsync(value).then(result => { if (active.current?.scope === lifecycle) options?.onSuccess?.(result); }).catch(() => {});
    };
    return { mutateAsync, mutate, isPending: state.id === scope.id && state.busy, error: state.id === scope.id ? state.error : null };
}
