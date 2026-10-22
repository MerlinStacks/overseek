import {
    useQuery,
    useMutation,
    useQueryClient,
    type QueryKey,
    type QueryObserverResult,
} from '@tanstack/react-query';
import { useEffect, useRef } from 'react';

interface UseApiQueryOptions<TData> {
    queryKey: QueryKey;
    queryFn: (signal?: AbortSignal) => Promise<TData>;
    enabled?: boolean;
    /** Explicit ready-but-on-demand read; never an authorization substitute. */
    manual?: boolean;
    staleTime?: number;
    refetchOnWindowFocus?: boolean;
    refetchInterval?: number;
}

interface UseApiQueryResult<TData> {
    data: TData | undefined;
    isLoading: boolean;
    error: Error | null;
    dataUpdatedAt: number;
    refetch: () => Promise<TData | undefined>;
}

interface MutateOptions<TData> {
    onSuccess?: (data: TData) => void;
}

export function useApiQuery<TData>({
    queryKey,
    queryFn,
    enabled = true,
    manual = false,
    staleTime = 0,
    refetchOnWindowFocus = true,
    refetchInterval,
}: UseApiQueryOptions<TData>): UseApiQueryResult<TData> {
    const result = useQuery<TData, Error>({
        queryKey,
        queryFn: ({ signal }) => queryFn(signal),
        enabled,
        staleTime,
        refetchOnWindowFocus,
        refetchInterval,
    });

    const refetch = async (): Promise<TData | undefined> => {
        if (!enabled && !manual) throw new Error('Read is not currently admitted');
        const refetched: QueryObserverResult<TData, Error> = await result.refetch();
        if (refetched.error || !refetched.isSuccess) throw new Error('Read not acknowledged');
        return refetched.data;
    };

    return {
        data: enabled || manual ? result.data : undefined,
        isLoading: result.isLoading,
        error: result.error as Error | null,
        dataUpdatedAt: result.dataUpdatedAt,
        refetch,
    };
}

interface UseApiMutationOptions<TData, TVariables = void> {
    mutationFn: (variables: TVariables) => Promise<TData>;
    invalidateQueries?: QueryKey[];
    onSuccess?: (data: TData, variables: TVariables) => void;
}

interface UseApiMutationResult<TData, TVariables = void> {
    mutate: (variables: TVariables, options?: MutateOptions<TData>) => void;
    mutateAsync: (variables: TVariables) => Promise<TData>;
    isPending: boolean;
    error: Error | null;
}

export function useApiMutation<TData, TVariables = void>({
    mutationFn,
    invalidateQueries = [],
    onSuccess,
}: UseApiMutationOptions<TData, TVariables>): UseApiMutationResult<TData, TVariables> {
    const queryClient = useQueryClient();
    const pending = useRef(false), active = useRef(true);
    useEffect(() => { active.current = true; return () => { active.current = false; }; }, []);

    const mutation = useMutation<TData, Error, TVariables>({
        mutationFn,
        retry: false,
        onSuccess: async (data, variables) => {
            if (!active.current) return;
            for (const key of invalidateQueries) {
                await queryClient.invalidateQueries({ queryKey: key });
            }
            if (active.current) onSuccess?.(data, variables);
        },
        onSettled: () => { pending.current = false; },
    });

    return {
        mutate: (variables?: TVariables, options?: MutateOptions<TData>) => {
            if (pending.current || !active.current) return;
            pending.current = true;
            if (options?.onSuccess) {
                mutation.mutate(variables as TVariables, { onSuccess: data => { if (active.current) options.onSuccess?.(data); } });
            } else {
                mutation.mutate(variables as TVariables);
            }
        },
        mutateAsync: async (variables?: TVariables) => {
            if (pending.current || !active.current) throw new Error('Mutation busy or abandoned');
            pending.current = true;
            return mutation.mutateAsync(variables as TVariables);
        },
        isPending: mutation.isPending,
        error: mutation.error,
    };
}

/** Prefer for new scoped work. Mount under scopeKey; late results cannot enter a newer scope. */
export { useScopedRequest } from './useScopedRequest';
export { useScopedMutation } from './useScopedMutation';
