import { useEffect, useRef, useCallback } from 'react';
import { useTabLeader } from './useTabLeader';

/**
 * Message format for data broadcast between tabs.
 */
interface DataMessage<T> {
    type: 'data';
    channelName: string;
    payload: T;
    timestamp: number;
}

/**
 * Hook for tab-coordinated polling using BroadcastChannel.
 * 
 * Only the leader tab executes the polling callback; data is broadcast to all tabs.
 * Follower tabs receive data via the onData callback without making API calls.
 * 
 * @param channelName - Unique channel name for this polling group
 * @param fetchCallback - Async function that fetches data (only called by leader)
 * @param onData - Callback invoked when data is received (from API or broadcast)
 * @param intervalMs - Polling interval in milliseconds
 * @param deps - Dependencies array for the fetch callback
 * 
 * @example
 * useTabCoordinatedPolling(
 *   'live-analytics',
 *   async () => await api.get('/analytics/live'),
 *   (data) => setLiveStats(data),
 *   10000,
 *   [accountId]
 * );
 */
export function useTabCoordinatedPolling<T>(
    channelName: string,
    fetchCallback: () => Promise<T>,
    onData: (data: T) => void,
    intervalMs: number,
    deps: React.DependencyList = []
): void {
    const { isLeader } = useTabLeader(`polling-${channelName}`);
    const dataChannelRef = useRef<BroadcastChannel | null>(null);
    const savedFetchCallback = useRef(fetchCallback);
    const savedOnData = useRef(onData);

    // Keep refs updated
    useEffect(() => {
        savedFetchCallback.current = fetchCallback;
    }, [fetchCallback]);

    useEffect(() => {
        savedOnData.current = onData;
    }, [onData]);

    // Set up data broadcast channel
    useEffect(() => {
        if (typeof BroadcastChannel === 'undefined') {
            return;
        }

        const dataChannel = new BroadcastChannel(`data-${channelName}`);
        dataChannelRef.current = dataChannel;

        // Listen for broadcasted data from leader
        dataChannel.onmessage = (event: MessageEvent<DataMessage<T>>) => {
            if (event.data.type === 'data' && event.data.channelName === channelName) {
                savedOnData.current(event.data.payload);
            }
        };

        return () => {
            dataChannel.close();
        };
    }, [channelName]);

    // Execute polling (leader only) with visibility awareness
    useEffect(() => {
        /**
         * Fetches data and broadcasts to all tabs.
         * Only executes if this tab is the leader and visible.
         */
        const executePolling = async () => {
            // Only leader polls, and only when visible
            if (!isLeader || document.visibilityState !== 'visible') {
                return;
            }

            try {
                const data = await savedFetchCallback.current();

                // Invoke local callback
                savedOnData.current(data);

                // Broadcast to other tabs
                if (dataChannelRef.current) {
                    const message: DataMessage<T> = {
                        type: 'data',
                        channelName,
                        payload: data,
                        timestamp: Date.now(),
                    };
                    dataChannelRef.current.postMessage(message);
                }
            } catch (error) {
                // Silently fail - individual components handle their own error states
                console.warn(`[TabCoordinatedPolling] Fetch failed for ${channelName}:`, error);
            }
        };

        // Initial fetch if leader
        executePolling();

        // Set up polling interval
        const interval = setInterval(executePolling, intervalMs);

        // Refetch when tab becomes visible (if leader)
        const handleVisibilityChange = () => {
            if (document.visibilityState === 'visible' && isLeader) {
                executePolling();
            }
        };
        document.addEventListener('visibilitychange', handleVisibilityChange);

        return () => {
            clearInterval(interval);
            document.removeEventListener('visibilitychange', handleVisibilityChange);
        };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [isLeader, channelName, intervalMs, ...deps]);
}
