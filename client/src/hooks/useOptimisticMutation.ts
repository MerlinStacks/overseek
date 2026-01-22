import { useState, useCallback, useRef } from 'react';
import { Logger } from '../utils/logger';

/**
 * Options for the optimistic mutation hook.
 */
interface OptimisticMutationOptions<TData, TVariables> {
    /** The async mutation function to call */
    mutationFn: (variables: TVariables) => Promise<TData>;

    /** Function to compute the optimistic data before server response */
    optimisticUpdate: (variables: TVariables, currentData: TData | undefined) => TData;

    /** Callback on successful mutation */
    onSuccess?: (data: TData, variables: TVariables) => void;

    /** Callback on error (receives the rolled-back data) */
    onError?: (error: Error, variables: TVariables, rollbackData: TData | undefined) => void;

    /** Callback when mutation settles (success or error) */
    onSettled?: () => void;
}

/**
 * Return type for the optimistic mutation hook.
 */
interface OptimisticMutationResult<TData, TVariables> {
    /** Current data (optimistic or server-confirmed) */
    data: TData | undefined;

    /** Whether a mutation is in progress */
    isPending: boolean;

    /** Last error from a failed mutation */
    error: Error | null;

    /** Execute the mutation with optimistic update */
    mutate: (variables: TVariables) => Promise<TData | undefined>;

    /** Reset state to initial values */
    reset: () => void;

    /** Set data directly (for initializing from server) */
    setData: (data: TData) => void;
}

/**
 * useOptimisticMutation - React hook for optimistic UI updates.
 * 
 * Updates the UI immediately before server response, then rolls back on error.
 * Perfect for operations like adding tags, changing statuses, toggling states.
 * 
 * @example
 * // Order tag management
 * const { data: tags, mutate: addTag } = useOptimisticMutation({
 *   mutationFn: (tag) => api.addOrderTag(orderId, tag),
 *   optimisticUpdate: (tag, current) => [...(current || []), tag],
 *   onError: (error) => toast.error('Failed to add tag')
 * });
 * 
 * @example
 * // Status change
 * const { data: status, mutate: updateStatus } = useOptimisticMutation({
 *   mutationFn: (newStatus) => api.updateOrderStatus(orderId, newStatus),
 *   optimisticUpdate: (newStatus) => newStatus,
 *   onSuccess: () => queryClient.invalidateQueries(['orders'])
 * });
 */
export function useOptimisticMutation<TData, TVariables>(
    options: OptimisticMutationOptions<TData, TVariables>
): OptimisticMutationResult<TData, TVariables> {
    const { mutationFn, optimisticUpdate, onSuccess, onError, onSettled } = options;

    const [data, setData] = useState<TData | undefined>(undefined);
    const [isPending, setIsPending] = useState(false);
    const [error, setError] = useState<Error | null>(null);

    // Store rollback data in a ref to survive re-renders
    const rollbackRef = useRef<TData | undefined>(undefined);

    const mutate = useCallback(async (variables: TVariables): Promise<TData | undefined> => {
        // Store current data for potential rollback
        rollbackRef.current = data;

        // Apply optimistic update immediately
        const optimisticData = optimisticUpdate(variables, data);
        setData(optimisticData);
        setIsPending(true);
        setError(null);

        try {
            // Execute actual mutation
            const result = await mutationFn(variables);

            // Update with server-confirmed data
            setData(result);
            onSuccess?.(result, variables);

            return result;
        } catch (err) {
            const error = err instanceof Error ? err : new Error(String(err));
            Logger.error('[OptimisticMutation] Rolling back due to error', { error: error.message });

            // Rollback to previous state
            setData(rollbackRef.current);
            setError(error);
            onError?.(error, variables, rollbackRef.current);

            return undefined;
        } finally {
            setIsPending(false);
            onSettled?.();
        }
    }, [data, mutationFn, optimisticUpdate, onSuccess, onError, onSettled]);

    const reset = useCallback(() => {
        setData(undefined);
        setIsPending(false);
        setError(null);
        rollbackRef.current = undefined;
    }, []);

    return {
        data,
        isPending,
        error,
        mutate,
        reset,
        setData
    };
}

/**
 * useOptimisticList - Specialized hook for list operations (add, remove, update).
 * 
 * @example
 * const { items, addItem, removeItem } = useOptimisticList({
 *   initialItems: order.tags,
 *   addFn: (tag) => api.addTag(orderId, tag),
 *   removeFn: (tag) => api.removeTag(orderId, tag),
 *   getId: (tag) => tag,
 *   onError: () => toast.error('Operation failed')
 * });
 */
export function useOptimisticList<TItem, TId = string>({
    initialItems = [],
    addFn,
    removeFn,
    getId,
    onError
}: {
    initialItems?: TItem[];
    addFn: (item: TItem) => Promise<TItem>;
    removeFn: (item: TItem) => Promise<void>;
    getId: (item: TItem) => TId;
    onError?: (error: Error, operation: 'add' | 'remove') => void;
}) {
    const [items, setItems] = useState<TItem[]>(initialItems);
    const [pendingIds, setPendingIds] = useState<Set<TId>>(new Set());

    const addItem = useCallback(async (item: TItem) => {
        const id = getId(item);

        // Optimistic add
        setItems(prev => [...prev, item]);
        setPendingIds(prev => new Set(prev).add(id));

        try {
            const result = await addFn(item);
            // Replace optimistic item with server result
            setItems(prev => prev.map(i => getId(i) === id ? result : i));
        } catch (err) {
            // Rollback
            setItems(prev => prev.filter(i => getId(i) !== id));
            onError?.(err instanceof Error ? err : new Error(String(err)), 'add');
        } finally {
            setPendingIds(prev => {
                const next = new Set(prev);
                next.delete(id);
                return next;
            });
        }
    }, [addFn, getId, onError]);

    const removeItem = useCallback(async (item: TItem) => {
        const id = getId(item);
        const previousItems = items;

        // Optimistic remove
        setItems(prev => prev.filter(i => getId(i) !== id));
        setPendingIds(prev => new Set(prev).add(id));

        try {
            await removeFn(item);
        } catch (err) {
            // Rollback
            setItems(previousItems);
            onError?.(err instanceof Error ? err : new Error(String(err)), 'remove');
        } finally {
            setPendingIds(prev => {
                const next = new Set(prev);
                next.delete(id);
                return next;
            });
        }
    }, [items, removeFn, getId, onError]);

    const isPending = useCallback((item: TItem) => pendingIds.has(getId(item)), [pendingIds, getId]);

    return {
        items,
        setItems,
        addItem,
        removeItem,
        isPending,
        hasPending: pendingIds.size > 0
    };
}
