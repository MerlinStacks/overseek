import { useEffect, useCallback, useRef } from 'react';
import { useTabLeader } from './useTabLeader';

/**
 * Message format for data broadcast between tabs.
 */
interface PollingDataMessage {
    type: 'polling-complete';
    channelName: string;
    timestamp: number;
}

/**
 * Custom hook for visibility-aware polling with optional cross-tab coordination.
 * Pauses polling when the tab is hidden to save resources.
 * 
 * When `channelName` is provided, only the leader tab executes the callback.
 * Other tabs receive a notification when polling completes and can refetch from cache.
 * 
 * @param callback - The function to call on each poll
 * @param intervalMs - Polling interval in milliseconds
 * @param deps - Dependencies array for the callback
 * @param channelName - Optional channel name for cross-tab coordination
 * 
 * @example
 * // Basic usage (no tab coordination)
 * useVisibilityPolling(fetchData, 10000, [accountId]);
 * 
 * // With tab coordination (only leader polls)
 * useVisibilityPolling(fetchStats, 10000, [accountId], 'live-stats');
 */
export function useVisibilityPolling(
    callback: () => void | Promise<void>,
    intervalMs: number,
    deps: React.DependencyList = [],
    channelName?: string
): void {
    const savedCallback = useRef(callback);
    const dataChannelRef = useRef<BroadcastChannel | null>(null);

    // Only use leader election when channelName is provided
    const { isLeader } = useTabLeader(channelName ? `visibility-${channelName}` : 'unused');
    const shouldCoordinate = Boolean(channelName);

    // Update ref when callback changes
    useEffect(() => {
        savedCallback.current = callback;
    }, [callback]);

    // Set up data channel for coordination mode
    useEffect(() => {
        if (!shouldCoordinate || typeof BroadcastChannel === 'undefined') {
            return;
        }

        const channel = new BroadcastChannel(`visibility-data-${channelName}`);
        dataChannelRef.current = channel;

        // When leader completes polling, followers re-execute to get cached data
        channel.onmessage = (event: MessageEvent<PollingDataMessage>) => {
            if (event.data.type === 'polling-complete' && event.data.channelName === channelName) {
                // Only non-leaders should react to this
                if (!isLeader && document.visibilityState === 'visible') {
                    savedCallback.current();
                }
            }
        };

        return () => {
            channel.close();
        };
    }, [channelName, shouldCoordinate, isLeader]);

    useEffect(() => {
        /**
         * Execute callback if visible and (not coordinating OR is leader).
         * Broadcasts completion to other tabs when coordinating.
         */
        const executeIfVisible = async () => {
            if (document.visibilityState !== 'visible') {
                return;
            }

            // In coordination mode, only leader executes
            if (shouldCoordinate && !isLeader) {
                return;
            }

            await savedCallback.current();

            // Notify other tabs that data is fresh (they can refetch from cache)
            if (shouldCoordinate && dataChannelRef.current) {
                const message: PollingDataMessage = {
                    type: 'polling-complete',
                    channelName: channelName!,
                    timestamp: Date.now(),
                };
                dataChannelRef.current.postMessage(message);
            }
        };

        // Delay initial fetch when coordinating so leader election can settle
        let initialTimeout: ReturnType<typeof setTimeout> | null = null;
        if (shouldCoordinate) {
            initialTimeout = setTimeout(executeIfVisible, 500);
        } else {
            executeIfVisible();
        }

        // Set up polling interval
        const interval = setInterval(executeIfVisible, intervalMs);

        // Refetch when tab becomes visible again
        const handleVisibilityChange = () => {
            if (document.visibilityState === 'visible') {
                // In coordination mode, only leader refetches on visibility change
                if (!shouldCoordinate || isLeader) {
                    savedCallback.current();
                }
            }
        };
        document.addEventListener('visibilitychange', handleVisibilityChange);

        // Cleanup
        return () => {
            clearInterval(interval);
            if (initialTimeout) clearTimeout(initialTimeout);
            document.removeEventListener('visibilitychange', handleVisibilityChange);
        };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [intervalMs, shouldCoordinate, isLeader, channelName, ...deps]);
}

