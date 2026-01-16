import { useState } from 'react';
import { useAuth } from '../../context/AuthContext';
import {
    Activity,
    Database,
    Server,
    HardDrive,
    RefreshCw,
    CheckCircle,
    XCircle,
    AlertTriangle,
    Clock,
    Inbox,
    Webhook,
    Layers
} from 'lucide-react';
import { cn } from '../../utils/cn';

interface ServiceHealth {
    status: 'healthy' | 'degraded' | 'unhealthy';
    latencyMs?: number;
    details?: string;
}

interface QueueStats {
    waiting: number;
    active: number;
    completed: number;
    failed: number;
}

interface SyncEntityType {
    type: string;
    accountsTracked: number;
    accountsSynced: number;
    oldestSync: string | null;
    newestSync: string | null;
}

interface SystemHealthData {
    status: 'healthy' | 'degraded' | 'unhealthy';
    timestamp: string;
    version: {
        app: string;
        node: string;
        uptime: number;
        uptimeFormatted: string;
    };
    services: Record<string, ServiceHealth>;
    queues: Record<string, QueueStats>;
    sync: {
        totalAccounts: number;
        entityTypes: SyncEntityType[];
    };
    webhooks: {
        failed24h: number;
        processed24h: number;
        received24h: number;
    };
}

/**
 * System Health Panel for Super Admin diagnostics.
 * Displays version info, service health, queue stats, and sync status.
 */
export function SystemHealthPanel() {
    const { token } = useAuth();
    const [loading, setLoading] = useState(false);
    const [health, setHealth] = useState<SystemHealthData | null>(null);
    const [error, setError] = useState<string | null>(null);

    const fetchHealth = async () => {
        setLoading(true);
        setError(null);
        try {
            const res = await fetch('/api/admin/system-health', {
                headers: { Authorization: `Bearer ${token}` }
            });
            if (!res.ok) throw new Error('Failed to fetch system health');
            const data = await res.json();
            setHealth(data);
        } catch (e: any) {
            setError(e.message);
        } finally {
            setLoading(false);
        }
    };

    const getStatusIcon = (status: 'healthy' | 'degraded' | 'unhealthy') => {
        switch (status) {
            case 'healthy':
                return <CheckCircle className="text-green-500" size={20} />;
            case 'degraded':
                return <AlertTriangle className="text-amber-500" size={20} />;
            case 'unhealthy':
                return <XCircle className="text-red-500" size={20} />;
        }
    };

    const getStatusBg = (status: 'healthy' | 'degraded' | 'unhealthy') => {
        switch (status) {
            case 'healthy':
                return 'bg-green-50 border-green-200';
            case 'degraded':
                return 'bg-amber-50 border-amber-200';
            case 'unhealthy':
                return 'bg-red-50 border-red-200';
        }
    };

    const formatRelativeTime = (isoString: string | null) => {
        if (!isoString) return 'Never';
        const date = new Date(isoString);
        const now = new Date();
        const diffMs = now.getTime() - date.getTime();
        const diffMins = Math.floor(diffMs / 60000);

        if (diffMins < 1) return 'Just now';
        if (diffMins < 60) return `${diffMins}m ago`;
        const diffHours = Math.floor(diffMins / 60);
        if (diffHours < 24) return `${diffHours}h ago`;
        const diffDays = Math.floor(diffHours / 24);
        return `${diffDays}d ago`;
    };

    return (
        <div className="bg-white rounded-xl shadow-xs border border-slate-200 p-6">
            <div className="flex items-center justify-between mb-4">
                <h2 className="text-lg font-semibold text-slate-800 flex items-center gap-2">
                    <Activity size={20} />
                    System Health
                </h2>
                <button
                    onClick={fetchHealth}
                    disabled={loading}
                    className="inline-flex items-center gap-2 px-4 py-2 text-sm font-medium text-blue-700 bg-blue-50 rounded-lg hover:bg-blue-100 transition-colors disabled:opacity-50"
                >
                    <RefreshCw size={16} className={loading ? 'animate-spin' : ''} />
                    {health ? 'Refresh' : 'Load Health'}
                </button>
            </div>

            {error && (
                <div className="flex items-center gap-2 p-3 mb-4 bg-red-50 border border-red-200 rounded-lg text-red-700 text-sm">
                    <XCircle size={16} />
                    {error}
                </div>
            )}

            {health && (
                <div className="space-y-6">
                    {/* Overall Status */}
                    <div className={cn("flex items-center justify-between p-4 rounded-lg border", getStatusBg(health.status))}>
                        <div className="flex items-center gap-3">
                            {getStatusIcon(health.status)}
                            <div>
                                <div className="font-medium text-slate-800 capitalize">{health.status}</div>
                                <div className="text-sm text-slate-500">
                                    v{health.version.app} • Node {health.version.node} • Up {health.version.uptimeFormatted}
                                </div>
                            </div>
                        </div>
                        <div className="text-xs text-slate-500">
                            {new Date(health.timestamp).toLocaleTimeString()}
                        </div>
                    </div>

                    {/* Services Grid */}
                    <div>
                        <h3 className="text-sm font-medium text-slate-700 mb-3 flex items-center gap-2">
                            <Server size={16} />
                            Services
                        </h3>
                        <div className="grid grid-cols-3 gap-3">
                            {Object.entries(health.services).map(([name, service]) => (
                                <div key={name} className="flex items-center gap-2 p-3 bg-slate-50 rounded-lg">
                                    {getStatusIcon(service.status)}
                                    <div className="flex-1 min-w-0">
                                        <div className="font-medium text-slate-700 capitalize text-sm">{name}</div>
                                        {service.latencyMs !== undefined && (
                                            <div className="text-xs text-slate-500">{service.latencyMs}ms</div>
                                        )}
                                    </div>
                                </div>
                            ))}
                        </div>
                    </div>

                    {/* Queue Stats */}
                    <div>
                        <h3 className="text-sm font-medium text-slate-700 mb-3 flex items-center gap-2">
                            <Layers size={16} />
                            Queue Statistics
                        </h3>
                        <div className="overflow-x-auto">
                            <table className="w-full text-sm">
                                <thead>
                                    <tr className="text-left text-slate-500 border-b border-slate-200">
                                        <th className="pb-2 font-medium">Queue</th>
                                        <th className="pb-2 font-medium text-center">Waiting</th>
                                        <th className="pb-2 font-medium text-center">Active</th>
                                        <th className="pb-2 font-medium text-center">Completed</th>
                                        <th className="pb-2 font-medium text-center">Failed</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {Object.entries(health.queues).map(([name, stats]) => (
                                        <tr key={name} className="border-b border-slate-100">
                                            <td className="py-2 font-medium text-slate-700 capitalize">{name}</td>
                                            <td className="py-2 text-center text-slate-600">{stats.waiting >= 0 ? stats.waiting : '-'}</td>
                                            <td className="py-2 text-center text-slate-600">{stats.active >= 0 ? stats.active : '-'}</td>
                                            <td className="py-2 text-center text-green-600">{stats.completed >= 0 ? stats.completed : '-'}</td>
                                            <td className="py-2 text-center text-red-600">{stats.failed >= 0 ? stats.failed : '-'}</td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>
                    </div>

                    {/* Sync Status */}
                    <div>
                        <h3 className="text-sm font-medium text-slate-700 mb-3 flex items-center gap-2">
                            <Database size={16} />
                            Sync Status ({health.sync.totalAccounts} accounts)
                        </h3>
                        <div className="grid grid-cols-2 gap-3">
                            {health.sync.entityTypes.map(entity => (
                                <div key={entity.type} className="p-3 bg-slate-50 rounded-lg">
                                    <div className="font-medium text-slate-700 capitalize mb-1">{entity.type}</div>
                                    <div className="text-xs text-slate-500 space-y-0.5">
                                        <div>{entity.accountsSynced}/{entity.accountsTracked} accounts synced</div>
                                        <div className="flex items-center gap-1">
                                            <Clock size={12} />
                                            Last: {formatRelativeTime(entity.newestSync)}
                                        </div>
                                    </div>
                                </div>
                            ))}
                        </div>
                    </div>

                    {/* Webhook Health */}
                    <div>
                        <h3 className="text-sm font-medium text-slate-700 mb-3 flex items-center gap-2">
                            <Webhook size={16} />
                            Webhooks (24h)
                        </h3>
                        <div className="grid grid-cols-3 gap-3">
                            <div className="p-3 bg-slate-50 rounded-lg text-center">
                                <div className="text-2xl font-bold text-slate-700">{health.webhooks.received24h}</div>
                                <div className="text-xs text-slate-500">Received</div>
                            </div>
                            <div className="p-3 bg-green-50 rounded-lg text-center">
                                <div className="text-2xl font-bold text-green-600">{health.webhooks.processed24h}</div>
                                <div className="text-xs text-green-600">Processed</div>
                            </div>
                            <div className={cn(
                                "p-3 rounded-lg text-center",
                                health.webhooks.failed24h > 0 ? "bg-red-50" : "bg-slate-50"
                            )}>
                                <div className={cn(
                                    "text-2xl font-bold",
                                    health.webhooks.failed24h > 0 ? "text-red-600" : "text-slate-400"
                                )}>
                                    {health.webhooks.failed24h}
                                </div>
                                <div className={cn(
                                    "text-xs",
                                    health.webhooks.failed24h > 0 ? "text-red-600" : "text-slate-500"
                                )}>
                                    Failed
                                </div>
                            </div>
                        </div>
                    </div>
                </div>
            )}

            {!health && !loading && !error && (
                <div className="text-center py-8 text-slate-400">
                    <Activity size={32} className="mx-auto mb-2 opacity-50" />
                    <p className="text-sm">Click "Load Health" to view system status</p>
                </div>
            )}
        </div>
    );
}
