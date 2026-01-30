import { useEffect, useState } from 'react';
import { Logger } from '../../utils/logger';
import { Users, Server, Activity, AlertTriangle, Database, Trash2, CheckCircle, XCircle, AlertCircle, RefreshCw } from 'lucide-react';
import { useAuth } from '../../context/AuthContext';

interface AdminStats {
    totalAccounts: number;
    totalUsers: number;
    activeSyncs: number;
    failedSyncs24h: number;
}

interface ServiceHealth {
    status: 'healthy' | 'degraded' | 'unhealthy';
    latencyMs?: number;
    details?: string;
}

interface SystemHealth {
    status: 'healthy' | 'degraded' | 'unhealthy';
    timestamp: string;
    version: { app: string; node: string; uptimeFormatted: string };
    services: Record<string, ServiceHealth>;
    queues: Record<string, { waiting: number; active: number; completed: number; failed: number }>;
    webhooks: { failed24h: number; processed24h: number; received24h: number };
}

export function AdminDashboard() {
    const { token } = useAuth();
    const [stats, setStats] = useState<AdminStats | null>(null);
    const [health, setHealth] = useState<SystemHealth | null>(null);
    const [loading, setLoading] = useState(true);
    const [clearing, setClearing] = useState(false);

    const fetchData = async () => {
        try {
            const [statsRes, healthRes] = await Promise.all([
                fetch('/api/admin/stats', { headers: { Authorization: `Bearer ${token}` } }),
                fetch('/api/admin/system-health', { headers: { Authorization: `Bearer ${token}` } })
            ]);

            if (statsRes.ok) setStats(await statsRes.json());
            if (healthRes.ok) setHealth(await healthRes.json());
        } catch (err) {
            Logger.error('AdminDashboard fetch error:', { error: err });
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        fetchData();
    }, [token]);

    const handleClearFailedSyncs = async () => {
        if (!confirm(`Are you sure you want to delete all ${stats?.failedSyncs24h || 0} failed sync logs?\n\nThis action cannot be undone.`)) {
            return;
        }

        setClearing(true);
        try {
            const res = await fetch('/api/admin/sync-logs/failed', {
                method: 'DELETE',
                headers: { Authorization: `Bearer ${token}` }
            });
            if (res.ok) {
                const result = await res.json();
                alert(`Successfully cleared ${result.deleted} failed sync logs.`);
                fetchData(); // Refresh stats
            } else {
                alert('Failed to clear sync logs');
            }
        } catch (err) {
            Logger.error('Clear failed syncs error:', { error: err });
            alert('Failed to clear sync logs');
        } finally {
            setClearing(false);
        }
    };

    const StatCard = ({ title, value, icon: Icon, color, action }: any) => (
        <div className="bg-white p-6 rounded-xl border border-slate-200 shadow-xs">
            <div className="flex justify-between items-start">
                <div>
                    <p className="text-sm font-medium text-slate-500">{title}</p>
                    <h3 className="text-3xl font-bold mt-2 text-slate-900">{value}</h3>
                </div>
                <div className={`p-3 rounded-lg ${color}`}>
                    <Icon className="text-white" size={24} />
                </div>
            </div>
            {action && <div className="mt-4">{action}</div>}
        </div>
    );

    const StatusIcon = ({ status }: { status: string }) => {
        if (status === 'healthy') return <CheckCircle className="text-emerald-500" size={18} />;
        if (status === 'degraded') return <AlertCircle className="text-amber-500" size={18} />;
        return <XCircle className="text-rose-500" size={18} />;
    };

    if (loading) return <div className="p-6">Loading admin dashboard...</div>;

    return (
        <div className="space-y-6">
            <div className="flex items-center justify-between">
                <h1 className="text-2xl font-bold text-slate-800">System Overview</h1>
                <button
                    onClick={() => { setLoading(true); fetchData(); }}
                    className="flex items-center gap-2 px-3 py-2 text-sm text-slate-600 hover:text-slate-800 hover:bg-slate-100 rounded-lg transition-colors"
                >
                    <RefreshCw size={16} />
                    Refresh
                </button>
            </div>

            {/* Stats Cards */}
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
                <StatCard
                    title="Total Accounts"
                    value={stats?.totalAccounts || 0}
                    icon={Server}
                    color="bg-blue-600"
                />
                <StatCard
                    title="Total Users"
                    value={stats?.totalUsers || 0}
                    icon={Users}
                    color="bg-emerald-600"
                />
                <StatCard
                    title="Active Syncs"
                    value={stats?.activeSyncs || 0}
                    icon={Activity}
                    color="bg-indigo-600"
                />
                <StatCard
                    title="Failed Syncs (24h)"
                    value={stats?.failedSyncs24h || 0}
                    icon={AlertTriangle}
                    color="bg-rose-600"
                    action={
                        (stats?.failedSyncs24h || 0) > 0 && (
                            <button
                                onClick={handleClearFailedSyncs}
                                disabled={clearing}
                                className="flex items-center gap-2 px-3 py-1.5 text-xs font-medium text-rose-600 hover:text-rose-700 hover:bg-rose-50 border border-rose-200 rounded-lg transition-colors disabled:opacity-50"
                            >
                                <Trash2 size={14} />
                                {clearing ? 'Clearing...' : 'Clear All'}
                            </button>
                        )
                    }
                />
            </div>

            {/* System Health Panel */}
            {health && (
                <div className="bg-white rounded-xl border border-slate-200 shadow-xs overflow-hidden">
                    <div className="px-6 py-4 border-b border-slate-200 flex items-center justify-between">
                        <div className="flex items-center gap-3">
                            <Database className="text-slate-400" size={20} />
                            <h2 className="text-lg font-semibold text-slate-800">System Health</h2>
                        </div>
                        <div className="flex items-center gap-2">
                            <StatusIcon status={health.status} />
                            <span className={`text-sm font-medium capitalize ${health.status === 'healthy' ? 'text-emerald-600' :
                                    health.status === 'degraded' ? 'text-amber-600' : 'text-rose-600'
                                }`}>
                                {health.status}
                            </span>
                            <span className="text-xs text-slate-400 ml-2">
                                v{health.version.app} • Up {health.version.uptimeFormatted}
                            </span>
                        </div>
                    </div>

                    <div className="p-6 grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                        {/* Services */}
                        {Object.entries(health.services).map(([name, service]) => (
                            <div key={name} className="flex items-center justify-between p-3 bg-slate-50 rounded-lg">
                                <div className="flex items-center gap-2">
                                    <StatusIcon status={service.status} />
                                    <span className="text-sm font-medium text-slate-700 capitalize">{name}</span>
                                </div>
                                <span className="text-xs text-slate-500">
                                    {service.latencyMs !== undefined ? `${service.latencyMs}ms` : service.details || '—'}
                                </span>
                            </div>
                        ))}
                    </div>

                    {/* Queue Stats */}
                    <div className="px-6 pb-6">
                        <h3 className="text-sm font-medium text-slate-500 mb-3">Queue Statistics</h3>
                        <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-3">
                            {Object.entries(health.queues).map(([name, q]) => (
                                <div key={name} className="p-3 bg-slate-50 rounded-lg">
                                    <div className="text-xs font-medium text-slate-600 capitalize mb-1">{name.replace(/_/g, ' ')}</div>
                                    <div className="flex items-center gap-2 text-xs">
                                        <span className="text-amber-600">{q.waiting}w</span>
                                        <span className="text-blue-600">{q.active}a</span>
                                        {q.failed > 0 && <span className="text-rose-600">{q.failed}f</span>}
                                    </div>
                                </div>
                            ))}
                        </div>
                    </div>

                    {/* Webhooks */}
                    <div className="px-6 pb-6 border-t border-slate-100 pt-4">
                        <h3 className="text-sm font-medium text-slate-500 mb-3">Webhooks (24h)</h3>
                        <div className="flex items-center gap-6 text-sm">
                            <span className="text-slate-600">Received: <strong>{health.webhooks.received24h}</strong></span>
                            <span className="text-emerald-600">Processed: <strong>{health.webhooks.processed24h}</strong></span>
                            {health.webhooks.failed24h > 0 && (
                                <span className="text-rose-600">Failed: <strong>{health.webhooks.failed24h}</strong></span>
                            )}
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}
