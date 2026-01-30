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
    completedAt?: string;
}

interface SyncStatusContextType {
    isSyncing: boolean;
    activeJobs: SyncJob[];
    syncState: SyncState[];
    logs: SyncLog[];
    controlSync: (action: 'pause' | 'resume' | 'cancel', queueName?: string, jobId?: string) => Promise<void>;
    runSync: (types?: string[], incremental?: boolean) => Promise<void>;
}

export interface SyncState {
    id: string;
    accountId: string;
    entityType: string;
    lastSyncedAt: string | null;
    cursor: string | null;
    updatedAt: string;
}

const SyncStatusContext = createContext<SyncStatusContextType | undefined>(undefined);

export function SyncStatusProvider({ children }: { children: ReactNode }) {
    const { token } = useAuth();
    const { currentAccount } = useAccount();
    const { socket } = useSocket();
    const [activeJobs, setActiveJobs] = useState<SyncJob[]>([]);
    const [syncState, setSyncState] = useState<SyncState[]>([]);
    const [logs, setLogs] = useState<SyncLog[]>([]);
    const [isSyncing, setIsSyncing] = useState(false);

    const fetchStatus = useCallback(async () => {
        if (!currentAccount?.id || !token) return;
        try {
            const url = new URL('/api/sync/active', window.location.origin);
            url.searchParams.append('accountId', currentAccount.id);

            const res = await fetch(url.toString(), {
                headers: { Authorization: `Bearer ${token}`, 'x-account-id': currentAccount.id }
            });

            if (res.ok) {
                const data = await res.json();
                setActiveJobs(data);
                setIsSyncing(data.length > 0);
            }

            // Also fetch persistent state
            const stateRes = await fetch(`/api/sync/status?accountId=${currentAccount.id}`, {
                headers: { Authorization: `Bearer ${token}`, 'x-account-id': currentAccount.id }
            });
            if (stateRes.ok) {
                const data = await stateRes.json();
                setSyncState(data.state || []);
                setLogs(data.logs || []);
            }
        } catch (error) {
            Logger.error('Failed to fetch sync status', { error: error });
        }
    }, [currentAccount?.id, token]);

    // Listen for Socket.IO sync events (real-time updates)
    useEffect(() => {
        if (!socket) return;

        const handleSyncStarted = (data: { accountId: string; type: string }) => {
            setIsSyncing(true);
            fetchStatus(); // Refresh full state
        };

        const handleSyncCompleted = (data: { accountId: string; type: string; status: string }) => {
            fetchStatus(); // Refresh full state to get updated logs
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
        if (!currentAccount?.id || !token) return;
        try {
            const res = await fetch('/api/sync/control', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    Authorization: `Bearer ${token}`,
                    'x-account-id': currentAccount.id
                },
                body: JSON.stringify({
                    accountId: currentAccount.id,
                    action,
                    queueName,
                    jobId
                })
            });

            if (!res.ok) {
                const errorData = await res.json().catch(() => ({ message: 'Unknown error' }));
                throw new Error(`Control action failed: ${errorData.message || res.statusText}`);
            }

            // Immediately fetch status update
            fetchStatus();
        } catch (error) {
            Logger.error(`Failed to ${action} sync`, { error });
            throw error;
        }
    };

    const runSync = async (types?: string[], incremental: boolean = true) => {
        if (!currentAccount?.id || !token) return;
        try {
            await fetch('/api/sync/manual', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    Authorization: `Bearer ${token}`,
                    'x-account-id': currentAccount.id
                },
                body: JSON.stringify({
                    accountId: currentAccount.id,
                    types,
                    incremental
                })
            });
            fetchStatus();
        } catch (error) {
            Logger.error('Failed to start sync', { error: error });
            throw error;
        }
    };

    return (
        <SyncStatusContext.Provider value={{ isSyncing, activeJobs, syncState, logs, controlSync, runSync }}>
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

