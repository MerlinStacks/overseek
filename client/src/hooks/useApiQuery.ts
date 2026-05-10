import {
    useQuery,
    useMutation,
    useQueryClient,
    type QueryKey,
    type QueryObserverResult,
} from '@tanstack/react-query';

interface UseApiQueryOptions<TData> {
    queryKey: QueryKey;
    queryFn: () => Promise<TData>;
    enabled?: boolean;
    staleTime?: number;
    refetchOnWindowFocus?: boolean;
    refetchInterval?: number;
}

interface UseApiQueryResult<TData> {
    data: TData | undefined;
    isLoading: boolean;
    error: Error | null;
    refetch: () => Promise<TData | undefined>;
}

interface MutateOptions<TData> {
    onSuccess?: (data: TData) => void;
}

export function useApiQuery<TData>({
    queryKey,
    queryFn,
    enabled = true,
    staleTime = 0,
    refetchOnWindowFocus = true,
    refetchInterval,
}: UseApiQueryOptions<TData>): UseApiQueryResult<TData> {
    const result = useQuery<TData, Error>({
        queryKey,
        queryFn,
        enabled,
        staleTime,
        refetchOnWindowFocus,
        refetchInterval,
    });

    const refetch = async (): Promise<TData | undefined> => {
        const refetched: QueryObserverResult<TData, Error> = await result.refetch();
        return refetched.data;
    };

    return {
        data: result.data,
        isLoading: result.isLoading,
        error: result.error as Error | null,
        refetch,
    };
}

interface UseApiMutationOptions<TData, TVariables = void> {
    mutationFn: (variables: TVariables) => Promise<TData>;
    invalidateQueries?: QueryKey[];
    onSuccess?: (data: TData, variables: TVariables) => void;
}

interface UseApiMutationResult<TData, TVariables = void> {
    mutate: (variables?: TVariables, options?: MutateOptions<TData>) => void;
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
        mutate: (variables?: TVariables, options?: MutateOptions<TData>) => {
            if (options?.onSuccess) {
                mutation.mutate(variables as TVariables, { onSuccess: options.onSuccess as any });
            } else {
                mutation.mutate(variables as TVariables);
            }
        },
        mutateAsync: async (variables?: TVariables) => mutation.mutateAsync(variables as TVariables),
        isPending: mutation.isPending,
        error: mutation.error,
    };
}
