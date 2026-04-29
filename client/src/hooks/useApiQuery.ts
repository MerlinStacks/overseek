import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

type QueryKey = readonly unknown[];

type QueryCacheEntry<T> = {
    data: T;
    updatedAt: number;
    keyParts: QueryKey;
};

const queryCache = new Map<string, QueryCacheEntry<unknown>>();
const queryListeners = new Map<string, Set<() => void>>();

function keyToString(key: QueryKey): string {
    return JSON.stringify(key);
}

function notifyKey(keyString: string): void {
    const listeners = queryListeners.get(keyString);
    if (!listeners) return;
    for (const listener of listeners) listener();
}

function subscribeKey(keyString: string, cb: () => void): () => void {
    const listeners = queryListeners.get(keyString) ?? new Set<() => void>();
    listeners.add(cb);
    queryListeners.set(keyString, listeners);

    return () => {
        const current = queryListeners.get(keyString);
        if (!current) return;
        current.delete(cb);
        if (current.size === 0) queryListeners.delete(keyString);
    };
}

function startsWithPrefix(keyParts: QueryKey, prefix: QueryKey): boolean {
    if (prefix.length > keyParts.length) return false;
    for (let i = 0; i < prefix.length; i += 1) {
        if (keyParts[i] !== prefix[i]) return false;
    }
    return true;
}

export function invalidateQuery(prefix: QueryKey): void {
    for (const [keyString, entry] of queryCache.entries()) {
        if (startsWithPrefix(entry.keyParts, prefix)) {
            queryCache.delete(keyString);
            notifyKey(keyString);
        }
    }
}

interface UseApiQueryOptions<TData> {
    queryKey: QueryKey;
    queryFn: () => Promise<TData>;
    enabled?: boolean;
    staleTime?: number;
    refetchOnWindowFocus?: boolean;
}

interface UseApiQueryResult<TData> {
    data: TData | undefined;
    isLoading: boolean;
    error: Error | null;
    refetch: () => Promise<TData | undefined>;
}

export function useApiQuery<TData>({
    queryKey,
    queryFn,
    enabled = true,
    staleTime = 0,
    refetchOnWindowFocus = true,
}: UseApiQueryOptions<TData>): UseApiQueryResult<TData> {
    const keyString = useMemo(() => keyToString(queryKey), [queryKey]);
    const [data, setData] = useState<TData | undefined>(() => {
        const cached = queryCache.get(keyString) as QueryCacheEntry<TData> | undefined;
        return cached?.data;
    });
    const [isLoading, setIsLoading] = useState<boolean>(() => enabled && !queryCache.has(keyString));
    const [error, setError] = useState<Error | null>(null);
    const fetchSeqRef = useRef(0);
    const queryFnRef = useRef(queryFn);
    const queryKeyRef = useRef(queryKey);

    queryFnRef.current = queryFn;
    queryKeyRef.current = queryKey;

    const executeFetch = useCallback(async (force = false): Promise<TData | undefined> => {
        if (!enabled) {
            setIsLoading(false);
            return undefined;
        }

        const cached = queryCache.get(keyString) as QueryCacheEntry<TData> | undefined;
        const isFresh = Boolean(cached && (Date.now() - cached.updatedAt) < staleTime);
        if (!force && isFresh) {
            setData(cached?.data);
            setIsLoading(false);
            setError(null);
            return cached?.data;
        }

        const seq = fetchSeqRef.current + 1;
        fetchSeqRef.current = seq;
        setIsLoading(true);

        try {
            const result = await queryFnRef.current();
            if (fetchSeqRef.current !== seq) return undefined;

            queryCache.set(keyString, {
                data: result,
                updatedAt: Date.now(),
                keyParts: queryKeyRef.current,
            });
            setData(result);
            setError(null);
            setIsLoading(false);
            return result;
        } catch (err) {
            if (fetchSeqRef.current !== seq) return undefined;

            setError(err instanceof Error ? err : new Error(String(err)));
            setIsLoading(false);
            throw err;
        }
    }, [enabled, keyString, staleTime]);

    useEffect(() => {
        const cached = queryCache.get(keyString) as QueryCacheEntry<TData> | undefined;
        setData(cached?.data);
        setError(null);
        setIsLoading(enabled && !cached);
    }, [enabled, keyString]);

    useEffect(() => {
        let cancelled = false;

        queueMicrotask(() => {
            executeFetch().catch(() => {
                if (cancelled) return;
            });
        });

        return () => {
            cancelled = true;
        };
    }, [executeFetch]);

    useEffect(() => {
        const unsubscribe = subscribeKey(keyString, () => {
            executeFetch(true).catch(() => {
                // Intentionally swallowed: consumers rely on state flags.
            });
        });

        return unsubscribe;
    }, [executeFetch, keyString]);

    useEffect(() => {
        if (!refetchOnWindowFocus) return;

        const handleFocus = () => {
            executeFetch().catch(() => {
                // Intentionally swallowed: consumers rely on state flags.
            });
        };

        window.addEventListener('focus', handleFocus);
        return () => window.removeEventListener('focus', handleFocus);
    }, [executeFetch, refetchOnWindowFocus]);

    const refetch = useCallback(() => executeFetch(true), [executeFetch]);

    return { data, isLoading, error, refetch };
}

interface MutateCallbacks<TData> {
    onSuccess?: (data: TData) => void;
    onError?: (error: Error) => void;
}

interface UseApiMutationOptions<TData, TVariables> {
    mutationFn: (variables: TVariables) => Promise<TData>;
    invalidateQueries?: QueryKey[];
    onSuccess?: (data: TData, variables: TVariables) => void;
}

interface UseApiMutationResult<TData, TVariables> {
    mutate: (variables?: TVariables, callbacks?: MutateCallbacks<TData>) => void;
    mutateAsync: (variables?: TVariables) => Promise<TData>;
    isPending: boolean;
    error: Error | null;
}

export function useApiMutation<TData, TVariables = void>({
    mutationFn,
    invalidateQueries: invalidatePrefixes = [],
    onSuccess,
}: UseApiMutationOptions<TData, TVariables>): UseApiMutationResult<TData, TVariables> {
    const [isPending, setIsPending] = useState(false);
    const [error, setError] = useState<Error | null>(null);

    const mutateAsync = useCallback(async (variables?: TVariables): Promise<TData> => {
        setIsPending(true);
        setError(null);

        try {
            const data = await mutationFn(variables as TVariables);
            for (const prefix of invalidatePrefixes) invalidateQuery(prefix);
            onSuccess?.(data, variables as TVariables);
            setIsPending(false);
            return data;
        } catch (err) {
            const parsed = err instanceof Error ? err : new Error(String(err));
            setError(parsed);
            setIsPending(false);
            throw parsed;
        }
    }, [invalidatePrefixes, mutationFn, onSuccess]);

    const mutate = useCallback((variables?: TVariables, callbacks?: MutateCallbacks<TData>) => {
        mutateAsync(variables)
            .then((data) => {
                callbacks?.onSuccess?.(data);
            })
            .catch((err) => {
                const parsed = err instanceof Error ? err : new Error(String(err));
                callbacks?.onError?.(parsed);
            });
    }, [mutateAsync]);

    return { mutate, mutateAsync, isPending, error };
}
