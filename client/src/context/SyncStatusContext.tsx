import { createContext, useContext, useState, useEffect, ReactNode } from 'react';
import { useAccount } from './AccountContext';
import { useAuth } from './AuthContext';

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
    const [activeJobs, setActiveJobs] = useState<SyncJob[]>([]);
    const [syncState, setSyncState] = useState<SyncState[]>([]);
    const [logs, setLogs] = useState<SyncLog[]>([]);
    const [isSyncing, setIsSyncing] = useState(false);

    const fetchStatus = async () => {
        if (!currentAccount?.id || !token) return;
        try {
            const url = new URL(`${import.meta.env.VITE_API_URL}/api/sync/active`);
            url.searchParams.append('accountId', currentAccount.id);

            const res = await fetch(url.toString(), {
                headers: { Authorization: `Bearer ${token}` }
            });

            if (res.ok) {
                const data = await res.json();
                setActiveJobs(data);
                setIsSyncing(data.length > 0);
            } else {
                console.error('Failed to fetch sync status', res.status, res.statusText);
            }

            // Also fetch persistent state
            const stateRes = await fetch(`${import.meta.env.VITE_API_URL}/api/sync/status?accountId=${currentAccount.id}`, {
                headers: { Authorization: `Bearer ${token}` }
            });
            if (stateRes.ok) {
                const data = await stateRes.json();
                setSyncState(data.state || []);
                setLogs(data.logs || []);
            }


        } catch (error) {
            console.error('Failed to fetch sync status', error);
        }
    };

    useEffect(() => {
        if (!currentAccount?.id || !token) return;

        // Initial fetch
        fetchStatus();

        // Poll every 2 seconds
        const interval = setInterval(fetchStatus, 2000);
        return () => clearInterval(interval);
    }, [currentAccount?.id, token]);

    const controlSync = async (action: 'pause' | 'resume' | 'cancel', queueName?: string, jobId?: string) => {
        if (!currentAccount?.id || !token) return;
        try {
            const res = await fetch(`${import.meta.env.VITE_API_URL}/api/sync/control`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    Authorization: `Bearer ${token}`
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
            console.error(`Failed to ${action} sync`, error);
            throw error;
        }
    };

    const runSync = async (types?: string[], incremental: boolean = true) => {
        if (!currentAccount?.id || !token) return;
        try {
            await fetch(`${import.meta.env.VITE_API_URL}/api/sync/manual`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    Authorization: `Bearer ${token}`
                },
                body: JSON.stringify({
                    accountId: currentAccount.id,
                    types,
                    incremental
                })
            });
            fetchStatus();
        } catch (error) {
            console.error('Failed to start sync', error);
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

