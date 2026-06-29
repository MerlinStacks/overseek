import { useEffect, useRef, type MutableRefObject } from 'react';
import { useTabLeader } from './useTabLeader';

/**
 * Message format for data broadcast between tabs.
 */
interface PollingDataMessage {
    type: 'polling-complete';
    channelName: string;
    timestamp: number;
}

const AUTH_REFRESHING_KEY = 'overseek:auth-refreshing';

function isAuthRefreshInProgress(): boolean {
    return sessionStorage.getItem(AUTH_REFRESHING_KEY) === '1';
}

function postMessageSafely(channel: BroadcastChannel, message: PollingDataMessage): void {
    try {
        channel.postMessage(message);
    } catch (error) {
        if (!(error instanceof DOMException) || error.name !== 'InvalidStateError') {
            throw error;
        }
    }
}

async function runOnce(inFlightRef: MutableRefObject<boolean>, callbackRef: MutableRefObject<() => void | Promise<void>>): Promise<boolean> {
    if (inFlightRef.current) return false;

    inFlightRef.current = true;
    try {
        await callbackRef.current();
        return true;
    } finally {
        inFlightRef.current = false;
    }
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
    const deferredUntilAuthRef = useRef(false);
    const inFlightRef = useRef(false);

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
                    void runOnce(inFlightRef, savedCallback);
                }
            }
        };

        return () => {
            if (dataChannelRef.current === channel) {
                dataChannelRef.current = null;
            }
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

            if (isAuthRefreshInProgress()) {
                deferredUntilAuthRef.current = true;
                return;
            }

            // In coordination mode, only leader executes
            if (shouldCoordinate && !isLeader) {
                return;
            }

            const didRun = await runOnce(inFlightRef, savedCallback);
            if (!didRun) return;

            // Notify other tabs that data is fresh (they can refetch from cache)
            const channel = dataChannelRef.current;
            if (shouldCoordinate && channel) {
                const message: PollingDataMessage = {
                    type: 'polling-complete',
                    channelName: channelName!,
                    timestamp: Date.now(),
                };
                postMessageSafely(channel, message);
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
                    void executeIfVisible();
                }
            }
        };

        const handleAuthRefreshCompleted = () => {
            if (!deferredUntilAuthRef.current) return;
            deferredUntilAuthRef.current = false;
            void executeIfVisible();
        };

        document.addEventListener('visibilitychange', handleVisibilityChange);
        window.addEventListener('overseek:auth-refresh-completed', handleAuthRefreshCompleted);

        // Cleanup
        return () => {
            clearInterval(interval);
            if (initialTimeout) clearTimeout(initialTimeout);
            document.removeEventListener('visibilitychange', handleVisibilityChange);
            window.removeEventListener('overseek:auth-refresh-completed', handleAuthRefreshCompleted);
        };
    }, [intervalMs, shouldCoordinate, isLeader, channelName, ...deps]);
}
