import { useState, useCallback } from 'react';
import { useVisibilityPolling } from '../../hooks/useVisibilityPolling';
import { Logger } from '../../utils/logger';
import { useAuth } from '../../context/AuthContext';
import { useAccount } from '../../context/AccountContext';
import { RefreshCw, CheckCircle, XCircle, Clock, Package, ShoppingCart, Users, Star, Layers } from 'lucide-react';

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

/** Entity types available for sync */
const SYNC_ENTITIES = [
    { key: 'orders', label: 'Orders', icon: ShoppingCart },
    { key: 'products', label: 'Products', icon: Package },
    { key: 'customers', label: 'Customers', icon: Users },
    { key: 'reviews', label: 'Reviews', icon: Star },
] as const;

/** BOM is handled separately - always full sync via dedicated queue */
const BOM_ENTITY = { key: 'bom', label: 'BOM Inventory', icon: Layers };

type SyncEntityKey = typeof SYNC_ENTITIES[number]['key'];

export function SyncStatus() {
    const { token } = useAuth();
    const { currentAccount } = useAccount();
    const [logs, setLogs] = useState<SyncLog[]>([]);
    const [lastSyncs, setLastSyncs] = useState<Record<string, string>>({});
    const [isSyncing, setIsSyncing] = useState(false);

    // Per-entity full sync toggles
    const [fullSyncTypes, setFullSyncTypes] = useState<Record<SyncEntityKey, boolean>>({
        orders: false,
        products: false,
        customers: false,
        reviews: false,
    });

    // BOM sync toggle (always full sync when triggered)
    const [syncBOM, setSyncBOM] = useState(false);

    const fetchStatus = useCallback(async () => {
        if (!currentAccount || !token) return;

        try {
            const res = await fetch(`/api/sync/status?accountId=${currentAccount.id}`, {
                headers: { Authorization: `Bearer ${token}`, 'x-account-id': currentAccount.id }
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
    }, [currentAccount, token]);

    // Use visibility-aware polling with tab coordination
    useVisibilityPolling(fetchStatus, 10000, [fetchStatus], 'sync-status');

    const toggleFullSync = (key: SyncEntityKey) => {
        setFullSyncTypes(prev => ({ ...prev, [key]: !prev[key] }));
    };

    const selectAll = () => {
        setFullSyncTypes({ orders: true, products: true, customers: true, reviews: true });
    };

    const deselectAll = () => {
        setFullSyncTypes({ orders: false, products: false, customers: false, reviews: false });
    };

    const allSelected = Object.values(fullSyncTypes).every(Boolean);
    const noneSelected = Object.values(fullSyncTypes).every(v => !v);

    const handleSync = async () => {
        if (!currentAccount || !token) return;
        setIsSyncing(true);

        try {
            // Split: types marked for full sync vs incremental
            const fullSyncList = SYNC_ENTITIES.filter(e => fullSyncTypes[e.key]).map(e => e.key);
            const incrementalList = SYNC_ENTITIES.filter(e => !fullSyncTypes[e.key]).map(e => e.key);

            // Dispatch full sync types (if any)
            if (fullSyncList.length > 0) {
                await fetch('/api/sync/manual', {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        Authorization: `Bearer ${token}`,
                        'x-account-id': currentAccount.id
                    },
                    body: JSON.stringify({
                        accountId: currentAccount.id,
                        types: fullSyncList,
                        incremental: false
                    })
                });
            }

            // Dispatch incremental sync types (if any)
            if (incrementalList.length > 0) {
                await fetch('/api/sync/manual', {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        Authorization: `Bearer ${token}`,
                        'x-account-id': currentAccount.id
                    },
                    body: JSON.stringify({
                        accountId: currentAccount.id,
                        types: incrementalList,
                        incremental: true
                    })
                });
            }

            // Dispatch BOM sync if selected
            if (syncBOM) {
                await fetch('/api/inventory/bom/sync-all', {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        Authorization: `Bearer ${token}`,
                        'x-account-id': currentAccount.id
                    },
                    body: JSON.stringify({})
                });
            }

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
                <button
                    onClick={handleSync}
                    disabled={isSyncing}
                    className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors text-sm font-medium disabled:opacity-50"
                >
                    <RefreshCw className={`w-4 h-4 ${isSyncing ? 'animate-spin' : ''}`} />
                    Sync Now
                </button>
            </div>

            {/* Per-entity Full Sync Toggles */}
            <div className="mb-4 p-4 bg-gray-50 rounded-lg border border-gray-100">
                <div className="flex items-center justify-between mb-3">
                    <span className="text-sm font-medium text-gray-700">Full Sync (unchecked = incremental)</span>
                    <button
                        onClick={allSelected ? deselectAll : selectAll}
                        className="text-xs text-blue-600 hover:text-blue-700 font-medium"
                    >
                        {allSelected ? 'Deselect All' : 'Select All'}
                    </button>
                </div>
                <div className="flex flex-wrap gap-3">
                    {SYNC_ENTITIES.map(({ key, label, icon: Icon }) => (
                        <label
                            key={key}
                            className={`flex items-center gap-2 px-3 py-2 rounded-lg cursor-pointer transition-colors border ${fullSyncTypes[key]
                                ? 'bg-blue-50 border-blue-200 text-blue-700'
                                : 'bg-white border-gray-200 text-gray-600 hover:bg-gray-50'
                                }`}
                        >
                            <input
                                type="checkbox"
                                checked={fullSyncTypes[key]}
                                onChange={() => toggleFullSync(key)}
                                className="sr-only"
                            />
                            <Icon size={16} />
                            <span className="text-sm font-medium">{label}</span>
                            {fullSyncTypes[key] && (
                                <CheckCircle size={14} className="text-blue-600" />
                            )}
                        </label>
                    ))}

                    {/* BOM Sync - separate from WooCommerce entities */}
                    <div className="w-px bg-gray-200 mx-1" />
                    <label
                        className={`flex items-center gap-2 px-3 py-2 rounded-lg cursor-pointer transition-colors border ${syncBOM
                            ? 'bg-emerald-50 border-emerald-200 text-emerald-700'
                            : 'bg-white border-gray-200 text-gray-600 hover:bg-gray-50'
                            }`}
                    >
                        <input
                            type="checkbox"
                            checked={syncBOM}
                            onChange={() => setSyncBOM(!syncBOM)}
                            className="sr-only"
                        />
                        <Layers size={16} />
                        <span className="text-sm font-medium">BOM Inventory</span>
                        {syncBOM && (
                            <CheckCircle size={14} className="text-emerald-600" />
                        )}
                    </label>
                </div>
            </div>

            <div className="space-y-4">
                {/* Last Sync Times */}
                <div className="grid grid-cols-2 md:grid-cols-5 gap-3 text-sm">
                    {[...SYNC_ENTITIES, BOM_ENTITY].map(({ key, label, icon: Icon }) => (
                        <div key={key} className="flex flex-col p-3 bg-gray-50 rounded-lg">
                            <div className="flex items-center gap-2 text-gray-500 mb-1">
                                <Icon size={14} />
                                <span className="text-xs">{label}</span>
                            </div>
                            <span className="text-gray-900 font-medium text-sm">
                                {lastSyncs[key] ? new Date(lastSyncs[key]).toLocaleTimeString() : 'Never'}
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
