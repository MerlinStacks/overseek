import { createContext, useContext, useState, useEffect, ReactNode, useCallback } from 'react';
import { Logger } from '../utils/logger';
import { useAccount } from './AccountContext';
import { useAuth } from './AuthContext';
import { useSocket } from './SocketContext';
import { useVisibilityPolling } from '../hooks/useVisibilityPolling';


export interface SyncJob {
    id: string;
    queue: string;
    progress: number;
    data: any;
}

export interface SyncLog {
    id: string;
    entityType: string;
    status: 'SUCCESS' | 'FAILED' | 'IN_PROGRESS';
    itemsProcessed: number;
    errorMessage?: string;
    startedAt: string;
    completedAt?: string | null;
    /** Enriched fields from /health endpoint */
    triggerSource?: string;
    retryCount?: number;
    errorCode?: string;
    friendlyError?: string;
    nextRetryAt?: string | null;
    willRetry?: boolean;
    maxAttempts?: number;
}

export interface SyncState {
    id: string;
    accountId: string;
    entityType: string;
    lastSyncedAt: string | null;
    cursor: string | null;
    updatedAt: string;
}

/** Summary returned by the /health endpoint */
export interface SyncHealthSummary {
    lastSuccessAt: string | null;
    lastFailureAt: string | null;
    failureRate24h: number;
    activeJobs: number;
}


interface SyncStatusContextType {
    isSyncing: boolean;
    activeJobs: SyncJob[];
    syncState: SyncState[];
    logs: SyncLog[];
    healthSummary: SyncHealthSummary | null;

    controlSync: (action: 'pause' | 'resume' | 'cancel', queueName?: string, jobId?: string) => Promise<void>;
    runSync: (types?: string[], incremental?: boolean) => Promise<void>;
    retrySync: (entityType: string, logId?: string) => Promise<void>;
    reindexOrders: () => Promise<{ totalIndexed: number }>;
    refreshStatus: () => void;
}

const SyncStatusContext = createContext<SyncStatusContextType | undefined>(undefined);

/**
 * Why: Centralises all sync-related API calls and real-time state so
 * every component (sidebar, settings panel, overlays) shares one
 * source of truth without duplicating fetch logic.
 */
export function SyncStatusProvider({ children }: { children: ReactNode }) {
    const { token } = useAuth();
    const { currentAccount } = useAccount();
    const { socket } = useSocket();
    const [activeJobs, setActiveJobs] = useState<SyncJob[]>([]);
    const [syncState, setSyncState] = useState<SyncState[]>([]);
    const [logs, setLogs] = useState<SyncLog[]>([]);
    const [isSyncing, setIsSyncing] = useState(false);
    const [healthSummary, setHealthSummary] = useState<SyncHealthSummary | null>(null);


    /** Helper to build auth headers */
    const headers = useCallback(() => {
        if (!currentAccount?.id || !token) return null;
        return {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${token}`,
            'x-account-id': currentAccount.id,
        };
    }, [currentAccount?.id, token]);

    const fetchStatus = useCallback(async () => {
        const h = headers();
        if (!h || !currentAccount?.id) return;

        try {
            // Fetch active jobs
            const url = new URL('/api/sync/active', window.location.origin);
            url.searchParams.append('accountId', currentAccount.id);
            const res = await fetch(url.toString(), { headers: h });
            if (res.ok) {
                const data = await res.json();
                setActiveJobs(data);
                setIsSyncing(data.length > 0);
            }

            // Fetch health (includes enriched logs with retry info)
            const healthRes = await fetch(`/api/sync/health?accountId=${currentAccount.id}`, { headers: h });
            if (healthRes.ok) {
                const data = await healthRes.json();
                setSyncState(data.state || []);
                setLogs(data.recent || []);
                setHealthSummary(data.summary || null);
            } else {
                // Fallback to basic status if health endpoint isn't available
                const stateRes = await fetch(`/api/sync/status?accountId=${currentAccount.id}`, { headers: h });
                if (stateRes.ok) {
                    const data = await stateRes.json();
                    setSyncState(data.state || []);
                    setLogs(data.logs || []);
                }
            }
        } catch (error) {
            Logger.error('Failed to fetch sync status', { error });
        }
    }, [currentAccount?.id, headers]);

    // Listen for Socket.IO sync events (real-time updates)
    useEffect(() => {
        if (!socket) return;

        const handleSyncStarted = (data: { accountId: string; type: string }) => {
            setIsSyncing(true);
            fetchStatus();
        };

        const handleSyncCompleted = (data: { accountId: string; type: string; status: string; error?: string }) => {
            fetchStatus();
        };

        socket.on('sync:started', handleSyncStarted);
        socket.on('sync:completed', handleSyncCompleted);

        return () => {
            socket.off('sync:started', handleSyncStarted);
            socket.off('sync:completed', handleSyncCompleted);
        };
    }, [socket, fetchStatus]);

    // Visibility-aware fallback polling with tab coordination
    useVisibilityPolling(fetchStatus, 30000, [fetchStatus], 'sync-context');

    const controlSync = async (action: 'pause' | 'resume' | 'cancel', queueName?: string, jobId?: string) => {
        const h = headers();
        if (!h || !currentAccount?.id) return;

        try {
            const res = await fetch('/api/sync/control', {
                method: 'POST',
                headers: h,
                body: JSON.stringify({ accountId: currentAccount.id, action, queueName, jobId })
            });

            if (!res.ok) {
                const errorData = await res.json().catch(() => ({ message: 'Unknown error' }));
                throw new Error(`Control action failed: ${errorData.message || res.statusText}`);
            }

            fetchStatus();
        } catch (error) {
            Logger.error(`Failed to ${action} sync`, { error });
            throw error;
        }
    };

    const runSync = async (types?: string[], incremental: boolean = true) => {
        const h = headers();
        if (!h || !currentAccount?.id) return;

        try {
            await fetch('/api/sync/manual', {
                method: 'POST',
                headers: h,
                body: JSON.stringify({ accountId: currentAccount.id, types, incremental })
            });
            fetchStatus();
        } catch (error) {
            Logger.error('Failed to start sync', { error });
            throw error;
        }
    };

    /** Retry a specific failed entity type */
    const retrySync = async (entityType: string, logId?: string) => {
        const h = headers();
        if (!h || !currentAccount?.id) return;

        try {
            const res = await fetch('/api/sync/retry', {
                method: 'POST',
                headers: h,
                body: JSON.stringify({ entityType, logId })
            });

            if (!res.ok) {
                const errorData = await res.json().catch(() => ({ error: 'Unknown error' }));
                throw new Error(errorData.error || res.statusText);
            }

            fetchStatus();
        } catch (error) {
            Logger.error('Failed to retry sync', { error });
            throw error;
        }
    };

    /** Rebuild ES search index from Postgres source of truth */
    const reindexOrders = async (): Promise<{ totalIndexed: number }> => {
        const h = headers();
        if (!h || !currentAccount?.id) throw new Error('Please select an account before reindexing');

        const res = await fetch('/api/sync/orders/reindex', {
            method: 'POST',
            headers: h,
            body: JSON.stringify({ accountId: currentAccount.id })
        });

        if (!res.ok) {
            const errorData = await res.json().catch(() => ({ error: 'Reindex failed' }));
            throw new Error(errorData.error || res.statusText);
        }

        const data = await res.json();
        fetchStatus();
        return data;
    };

    return (
        <SyncStatusContext.Provider value={{
            isSyncing, activeJobs, syncState, logs, healthSummary,
            controlSync, runSync, retrySync, reindexOrders, refreshStatus: fetchStatus
        }}>
            {children}
        </SyncStatusContext.Provider>
    );
}

export function useSyncStatus() {
    const context = useContext(SyncStatusContext);
    if (!context) {
        throw new Error('useSyncStatus must be used within a SyncStatusProvider');
    }
    return context;
}
