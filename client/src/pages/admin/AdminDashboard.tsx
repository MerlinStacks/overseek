import { useAuth } from '../../context/AuthContext';
import { useAdminRead } from './useAdminRead';
import { decodeHealth, isCount } from './adminValidation';
import { isRecord } from '../../utils/responseValidation';
import { useScopedMutation } from '../../hooks/useScopedMutation';
import { api } from '../../services/api';
import { useState } from 'react';

interface Stats { totalAccounts: number; totalUsers: number; activeSyncs: number; failedSyncs24h: number }
function decodeStats(value: unknown): Stats {
    if (!isRecord(value) || !['totalAccounts', 'totalUsers', 'activeSyncs', 'failedSyncs24h'].every(key => isCount(value[key]))) throw new Error('Invalid statistics');
    return value as unknown as Stats;
}
export function AdminDashboard() {
    const { token, user } = useAuth();
    if (!token || !user?.isSuperAdmin) return <p role="status">Sign in as a super admin to view system status.</p>;
    return <Dashboard key={JSON.stringify([token, user.id])} token={token} />;
}
function Dashboard({ token }: { token: string }) {
    const stats = useAdminRead('/api/admin/stats', token, decodeStats, true);
    const health = useAdminRead('/api/admin/system-health', token, decodeHealth, true);
    const mutation = useScopedMutation(); const [message, setMessage] = useState('');
    const clear = async () => {
        if (mutation.isPending() || stats.isPending() || !stats.data || stats.error) return;
        if (!confirm('Delete ALL failed sync logs from ALL TIME, across every account? The 24-hour count shown does not limit this deletion. This cannot be undone.')) return;
        setMessage('');
        const result = await mutation.run(async signal => {
            const value: unknown = await api.request('/api/admin/sync-logs/failed', { method: 'DELETE', token, signal });
            if (!isRecord(value) || value.success !== true || !isCount(value.deleted)) throw new Error('Invalid deletion confirmation');
            return value.deleted;
        }, 'Could not confirm deletion. Refresh statistics and check the outcome before retrying.');
        if (result.ok) { setMessage(`Cleared ${result.value} failed sync logs (all time).`); void stats.refresh(); }
    };
    const card = 'p-6 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 space-y-3';
    return <main className="space-y-6 text-slate-900 dark:text-slate-100">
        <h1 className="text-2xl font-bold">System Overview</h1>
        {message && <p role="status">{message}</p>}{mutation.error && <p role="alert">{mutation.error}</p>}
        <section className={card} aria-label="Admin statistics"><h2 className="font-semibold">Statistics</h2><button type="button" disabled={stats.busy || mutation.busy} onClick={() => void stats.refresh()}>Refresh statistics</button>
            {stats.busy && <p role="status">Loading statistics...</p>}{stats.error && <p role="alert">Statistics: {stats.error}</p>}
            <dl className="grid grid-cols-2 md:grid-cols-4 gap-4">{([['totalAccounts', 'Total Accounts'], ['totalUsers', 'Total Users'], ['activeSyncs', 'Active Syncs'], ['failedSyncs24h', 'Failed Syncs (24h)']] as const).map(([key, label]) => <div key={key}><dt>{label}</dt><dd className="text-3xl font-bold">{stats.data?.[key].toLocaleString() ?? 'Unavailable'}</dd></div>)}</dl>
            <button type="button" disabled={!stats.data || !!stats.error || stats.busy || mutation.busy} onClick={() => void clear()}>{mutation.busy ? 'Clearing...' : 'Clear failed logs (all time)'}</button>
        </section>
        <section className={card} aria-label="System health"><h2 className="font-semibold">System Health</h2><button type="button" disabled={health.busy} onClick={() => void health.refresh()}>Refresh health</button>
            {health.busy && <p role="status">Loading system health...</p>}{health.error && <p role="alert">System health: {health.error}</p>}
            {!health.data ? <p>Health unavailable</p> : <><p className="capitalize">{health.data.status} · v{health.data.version.app} · Up {health.data.version.uptimeFormatted}</p>
                <dl className="grid grid-cols-1 sm:grid-cols-3 gap-3">{Object.entries(health.data.services).map(([name, service]) => <div key={name}><dt className="capitalize">{name}</dt><dd>{service.status}{service.latencyMs === undefined ? '' : ` · ${service.latencyMs}ms`}{service.details ? ` · ${service.details}` : ''}</dd></div>)}</dl>
                <h3 className="font-medium">Queue Statistics</h3><ul>{Object.entries(health.data.queues).map(([name, queue]) => <li key={name}>{name}: {queue.waiting} waiting · {queue.active} active · {queue.completed} completed · {queue.failed} failed</li>)}</ul>
                <h3 className="font-medium">Webhooks (24h)</h3><p>Received: {health.data.webhooks.received24h} · Processed: {health.data.webhooks.processed24h} · Failed: {health.data.webhooks.failed24h}</p>
            </>}
        </section>
    </main>;
}
