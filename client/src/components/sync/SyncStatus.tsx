import { useState, useEffect } from 'react';
import { Logger } from '../../utils/logger';
import { useAuth } from '../../context/AuthContext';
import { useAccount } from '../../context/AccountContext';
import { RefreshCw, CheckCircle, XCircle, Clock } from 'lucide-react';

interface SyncLog {
    id: string;
    entityType: string;
    status: 'SUCCESS' | 'FAILED' | 'IN_PROGRESS';
    itemsProcessed: number;
    errorMessage?: string;
    startedAt: string;
    completedAt?: string;
}

interface SyncState {
    entityType: string;
    lastSyncedAt: string;
}

export function SyncStatus() {
    const { token } = useAuth();
    const { currentAccount } = useAccount();
    const [logs, setLogs] = useState<SyncLog[]>([]);
    const [lastSyncs, setLastSyncs] = useState<Record<string, string>>({});
    const [isSyncing, setIsSyncing] = useState(false);
    const [forceFullSync, setForceFullSync] = useState(false);

    const fetchStatus = async () => {
        if (!currentAccount || !token) return;

        try {
            const res = await fetch(`/api/sync/status?accountId=${currentAccount.id}`, {
                headers: { Authorization: `Bearer ${token}` }
            });
            if (res.ok) {
                const data = await res.json();
                setLogs(data.logs);

                // Map state to object
                const stateMap: Record<string, string> = {};
                data.state.forEach((s: SyncState) => {
                    stateMap[s.entityType] = s.lastSyncedAt;
                });
                setLastSyncs(stateMap);
            }
        } catch (err) {
            Logger.error('Failed to fetch sync status', { error: err });
        }
    };

    useEffect(() => {
        fetchStatus();
        const interval = setInterval(fetchStatus, 10000); // Poll every 10s
        return () => clearInterval(interval);
    }, [currentAccount, token]);

    const handleSync = async () => {
        if (!currentAccount || !token) return;
        setIsSyncing(true);
        try {
            await fetch('/api/sync/manual', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    Authorization: `Bearer ${token}`
                },
                body: JSON.stringify({
                    accountId: currentAccount.id,
                    incremental: !forceFullSync
                })
            });
            // Don't wait for completion log, just refresh status immediately to see IN_PROGRESS ??
            // Actually API returns immediately.
            setTimeout(fetchStatus, 1000);
        } catch (err) {
            Logger.error('Sync trigger failed', { error: err });
        } finally {
            setIsSyncing(false);
        }
    };

    if (!currentAccount) return null;

    return (
        <div className="bg-white p-6 rounded-xl border border-gray-100 shadow-xs">
            <div className="flex items-center justify-between mb-4">
                <h3 className="text-lg font-medium text-gray-900">Sync Status</h3>
                <div className="flex items-center gap-4">
                    <label className="flex items-center gap-2 text-sm text-gray-600 cursor-pointer">
                        <input
                            type="checkbox"
                            checked={forceFullSync}
                            onChange={(e) => setForceFullSync(e.target.checked)}
                            className="rounded-sm border-gray-300 text-blue-600 focus:ring-blue-500"
                        />
                        Force Full Sync
                    </label>
                    <button
                        onClick={handleSync}
                        disabled={isSyncing}
                        className="flex items-center gap-2 px-3 py-1.5 bg-blue-50 text-blue-600 rounded-lg hover:bg-blue-100 transition-colors text-sm font-medium disabled:opacity-50"
                    >
                        <RefreshCw className={`w-4 h-4 ${isSyncing ? 'animate-spin' : ''}`} />
                        Sync Now
                    </button>
                </div>
            </div>

            <div className="space-y-4">
                {/* Last Sync Times */}
                <div className="grid grid-cols-2 gap-4 text-sm">
                    {['orders', 'products'].map(type => (
                        <div key={type} className="flex justify-between items-center p-2 bg-gray-50 rounded-lg">
                            <span className="capitalize text-gray-600">{type}</span>
                            <span className="text-gray-900 font-medium">
                                {lastSyncs[type] ? new Date(lastSyncs[type]).toLocaleTimeString() : 'Never'}
                            </span>
                        </div>
                    ))}
                </div>

                {/* Recent Logs list */}
                <div className="border-t border-gray-100 pt-4">
                    <h4 className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-3">Recent Activity</h4>
                    <div className="space-y-3 max-h-60 overflow-y-auto">
                        {logs.map(log => (
                            <div key={log.id} className="flex items-start gap-3 text-sm">
                                {log.status === 'SUCCESS' && <CheckCircle className="w-4 h-4 text-green-500 mt-0.5" />}
                                {log.status === 'FAILED' && <XCircle className="w-4 h-4 text-red-500 mt-0.5" />}
                                {log.status === 'IN_PROGRESS' && <Clock className="w-4 h-4 text-blue-500 mt-0.5 animate-pulse" />}

                                <div>
                                    <div className="flex items-center gap-2">
                                        <span className="font-medium text-gray-900 capitalize">{log.entityType}</span>
                                        <span className="text-gray-400 text-xs">
                                            {new Date(log.startedAt).toLocaleString()}
                                        </span>
                                    </div>
                                    <p className="text-gray-500 text-xs">
                                        {log.itemsProcessed} items • {log.status}
                                        {log.errorMessage && <span className="text-red-500 block">{log.errorMessage}</span>}
                                    </p>
                                </div>
                            </div>
                        ))}
                        {logs.length === 0 && <p className="text-gray-400 text-sm">No recent syncs.</p>}
                    </div>
                </div>
            </div>
        </div>
    );
}
