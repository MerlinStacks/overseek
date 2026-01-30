import { useEffect, useState, useRef, useCallback } from 'react';

/**
 * Unique identifier for this browser tab instance.
 * Generated once per page load to ensure consistent identity.
 */
const TAB_ID = `tab-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;

/**
 * Heartbeat interval for leader election (ms).
 * Leader broadcasts heartbeat at this interval; followers detect leader loss after 2x this value.
 */
const HEARTBEAT_INTERVAL = 2000;
const LEADER_TIMEOUT = HEARTBEAT_INTERVAL * 2.5;

interface TabMessage {
    type: 'heartbeat' | 'claim' | 'resign';
    tabId: string;
    timestamp: number;
}

/**
 * Hook for cross-tab leader election using BroadcastChannel.
 * Only ONE tab becomes the leader; others become followers.
 * 
 * Uses lowest-ID-wins algorithm with heartbeat-based failure detection.
 * 
 * @param channelName - Unique channel name for this leader election group
 * @returns { isLeader, tabId } - Whether this tab is the leader and its unique ID
 * 
 * @example
 * const { isLeader, tabId } = useTabLeader('overseek-polling');
 * if (isLeader) {
 *   // Only this tab should poll the API
 * }
 */
export function useTabLeader(channelName: string): { isLeader: boolean; tabId: string } {
    const [isLeader, setIsLeader] = useState(false);
    const channelRef = useRef<BroadcastChannel | null>(null);
    const knownTabsRef = useRef<Map<string, number>>(new Map());
    const heartbeatIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
    const leaderCheckIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

    /**
     * Determines if this tab should be leader based on lowest-ID-wins algorithm.
     * Why: Deterministic election without coordination overhead.
     */
    const determineLeadership = useCallback(() => {
        const now = Date.now();
        // Filter out stale tabs (no heartbeat within timeout)
        const activeTabs: string[] = [];
        knownTabsRef.current.forEach((timestamp, tabId) => {
            if (now - timestamp < LEADER_TIMEOUT) {
                activeTabs.push(tabId);
            } else {
                knownTabsRef.current.delete(tabId);
            }
        });

        // Add self if not present
        if (!activeTabs.includes(TAB_ID)) {
            activeTabs.push(TAB_ID);
        }

        // Lowest ID wins
        activeTabs.sort();
        const shouldBeLeader = activeTabs[0] === TAB_ID;

        setIsLeader(shouldBeLeader);
    }, []);

    /**
     * Broadcasts a heartbeat message to all tabs.
     */
    const sendHeartbeat = useCallback(() => {
        if (channelRef.current) {
            const message: TabMessage = {
                type: 'heartbeat',
                tabId: TAB_ID,
                timestamp: Date.now(),
            };
            channelRef.current.postMessage(message);
        }
        // Update own timestamp
        knownTabsRef.current.set(TAB_ID, Date.now());
    }, []);

    useEffect(() => {
        // BroadcastChannel not supported in all environments (e.g., SSR, older browsers)
        if (typeof BroadcastChannel === 'undefined') {
            // Fallback: this tab is always leader
            setIsLeader(true);
            return;
        }

        const channel = new BroadcastChannel(channelName);
        channelRef.current = channel;

        // Handle incoming messages
        channel.onmessage = (event: MessageEvent<TabMessage>) => {
            const { type, tabId, timestamp } = event.data;

            if (type === 'heartbeat' || type === 'claim') {
                knownTabsRef.current.set(tabId, timestamp);
                determineLeadership();
            } else if (type === 'resign') {
                knownTabsRef.current.delete(tabId);
                determineLeadership();
            }
        };

        // Register self immediately
        knownTabsRef.current.set(TAB_ID, Date.now());

        // Claim leadership candidacy on mount
        const claimMessage: TabMessage = {
            type: 'claim',
            tabId: TAB_ID,
            timestamp: Date.now(),
        };
        channel.postMessage(claimMessage);

        // Start heartbeat
        heartbeatIntervalRef.current = setInterval(sendHeartbeat, HEARTBEAT_INTERVAL);

        // Periodically check for stale leaders
        leaderCheckIntervalRef.current = setInterval(determineLeadership, HEARTBEAT_INTERVAL);

        // Initial leadership determination
        determineLeadership();

        // Cleanup on unmount
        return () => {
            // Notify other tabs this tab is leaving
            if (channelRef.current) {
                const resignMessage: TabMessage = {
                    type: 'resign',
                    tabId: TAB_ID,
                    timestamp: Date.now(),
                };
                channelRef.current.postMessage(resignMessage);
                channelRef.current.close();
            }

            if (heartbeatIntervalRef.current) {
                clearInterval(heartbeatIntervalRef.current);
            }
            if (leaderCheckIntervalRef.current) {
                clearInterval(leaderCheckIntervalRef.current);
            }
        };
    }, [channelName, determineLeadership, sendHeartbeat]);

    return { isLeader, tabId: TAB_ID };
}
