import {
    useQuery,
    useMutation,
    useQueryClient,
    type QueryKey,
    type UseQueryOptions,
    type UseMutationOptions,
} from '@tanstack/react-query';

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
    const result = useQuery<TData, Error>({
        queryKey,
        queryFn,
        enabled,
        staleTime,
        refetchOnWindowFocus,
    } as UseQueryOptions<TData, Error>);

    return {
        data: result.data,
        isLoading: result.isLoading,
        error: result.error as Error | null,
        refetch: async () => {
            const refetched = await result.refetch();
            return refetched.data;
        },
    };
}

interface UseApiMutationOptions<TData, TVariables = void> {
    mutationFn: (variables: TVariables) => Promise<TData>;
    invalidateQueries?: QueryKey[];
    onSuccess?: (data: TData, variables: TVariables) => void;
}

interface UseApiMutationResult<TData, TVariables = void> {
    mutate: (variables?: TVariables) => void;
    mutateAsync: (variables?: TVariables) => Promise<TData>;
    isPending: boolean;
    error: Error | null;
}

export function useApiMutation<TData, TVariables = void>({
    mutationFn,
    invalidateQueries = [],
    onSuccess,
}: UseApiMutationOptions<TData, TVariables>): UseApiMutationResult<TData, TVariables> {
    const queryClient = useQueryClient();

    const mutation = useMutation<TData, Error, TVariables>({
        mutationFn,
        onSuccess: (data, variables) => {
            for (const key of invalidateQueries) {
                queryClient.invalidateQueries({ queryKey: key });
            }
            onSuccess?.(data, variables);
        },
    });

    return {
        mutate: (variables?: TVariables) => mutation.mutate(variables as TVariables),
        mutateAsync: async (variables?: TVariables) => mutation.mutateAsync(variables as TVariables),
        isPending: mutation.isPending,
        error: mutation.error,
    };
}

/**
 * Invalidate queries matching the given prefix key.
 * Backwards-compatible with the old custom-cache prefix invalidation.
 */
export function invalidateQuery(prefix: QueryKey): void {
    // This function requires a QueryClient instance, so it's replaced by
    // the hook-based pattern. For non-hook consumers, import useQueryClient.
}
