import { useAuth } from '../../context/AuthContext';
import { useAdminRead } from './useAdminRead';
import { decodeHealth, isCount } from './adminValidation';
import { isRecord } from '../../utils/responseValidation';
import { useScopedMutation } from '../../hooks/useScopedMutation';
import { api } from '../../services/api';
import { useState } from 'react';
import { workspaceStyles as ui } from '../../components/ui/workspaceStyles';
import { Metric, MetricStrip } from '../../components/ui/MetricStrip';
import { Activity, CheckCircle2, RefreshCw, Search, Server, TriangleAlert, Trash2, Webhook } from 'lucide-react';
import type { SystemHealthData } from './useDiagnostics';

const statusStyles = {
    healthy: 'bg-emerald-50 text-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-300',
    degraded: 'bg-amber-50 text-amber-800 dark:bg-amber-950/40 dark:text-amber-300',
    unhealthy: 'bg-red-50 text-red-800 dark:bg-red-950/40 dark:text-red-300',
};
function HealthBadge({ status }: { status: SystemHealthData['status'] }) {
    return <span className={`inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-xs font-medium capitalize ${statusStyles[status]}`}>
        {status === 'healthy' ? <CheckCircle2 className="size-3.5" aria-hidden="true" /> : <TriangleAlert className="size-3.5" aria-hidden="true" />}{status}
    </span>;
}

function QueuePanel({ queues }: { queues: SystemHealthData['queues'] }) {
    const [search, setSearch] = useState('');
    const [filter, setFilter] = useState('all');
    const entries = Object.entries(queues);
    const totals = entries.reduce((sum, [, queue]) => ({ waiting: sum.waiting + queue.waiting, active: sum.active + queue.active, failed: sum.failed + queue.failed }), { waiting: 0, active: 0, failed: 0 });
    const query = search.trim().replace(/_/g, ' ').toLowerCase();
    const filtered = entries.filter(([name, queue]) => name.replace(/_/g, ' ').toLowerCase().includes(query) && (filter === 'all' || (filter === 'failed' ? queue.failed > 0 : queue.waiting + queue.active > 0)))
        .sort(([a, left], [b, right]) => right.failed - left.failed || right.waiting - left.waiting || a.localeCompare(b));
    return <section className={`${ui.card} !p-0 overflow-hidden`} aria-labelledby="queue-title">
        <div className="space-y-4 p-5">
            <div><h2 id="queue-title" className={ui.title}>Job queues</h2><p className={`${ui.muted} mt-1`}>Failures first. Counts reflect the latest health snapshot.</p></div>
            <dl className="flex flex-wrap gap-x-6 gap-y-2 text-sm tabular-nums">
                {([['Waiting', totals.waiting], ['Active', totals.active], ['Failed', totals.failed]] as const).map(([label, count]) => <div key={label} className="flex items-baseline gap-2"><dt className="text-slate-500 dark:text-slate-400">{label}</dt><dd className={`font-semibold ${label === 'Failed' && count > 0 ? 'text-red-700 dark:text-red-300' : ''}`}>{count.toLocaleString()}</dd></div>)}
            </dl>
            <div className="flex flex-wrap gap-2">
                <label className="relative min-w-0 flex-1 basis-48"><span className="sr-only">Search queues</span><Search aria-hidden="true" className="pointer-events-none absolute left-3 top-2.5 size-4 text-slate-400" /><input className={`${ui.input} pl-9`} placeholder="Search queues…" value={search} onChange={event => setSearch(event.target.value)} /></label>
                <label><span className="sr-only">Filter queues</span><select className={ui.input} value={filter} onChange={event => setFilter(event.target.value)}><option value="all">All queues</option><option value="failed">With failures</option><option value="busy">Waiting or active</option></select></label>
            </div>
        </div>
        <div className="overflow-x-auto">
            <table className={ui.table}>
                <caption className="sr-only">Queue Statistics: waiting, active, completed and failed jobs by queue</caption>
                <thead className={ui.tableHead}><tr><th scope="col" className={ui.cell}>Queue</th>{['Waiting', 'Active', 'Completed', 'Failed'].map(label => <th scope="col" key={label} className={`${ui.cell} text-right`}>{label}</th>)}</tr></thead>
                <tbody className={ui.tableBody}>{filtered.map(([name, queue]) => <tr key={name} className="hover:bg-slate-50 dark:hover:bg-slate-900/40">
                    <th scope="row" className={`${ui.cell} min-w-44 max-w-64 break-words font-medium`}><span className="block" title={name}>{name.replace(/_/g, ' ')}</span></th>
                    {(['waiting', 'active', 'completed', 'failed'] as const).map(key => <td key={key} className={`${ui.cell} text-right tabular-nums ${queue[key] === 0 ? 'text-slate-500 dark:text-slate-400' : key === 'failed' ? 'font-semibold text-red-700 dark:text-red-300' : key === 'active' ? 'font-semibold text-blue-700 dark:text-blue-300' : ''}`}>{queue[key].toLocaleString()}</td>)}
                </tr>)}</tbody>
            </table>
        </div>
        {filtered.length === 0 && <p className="px-5 py-8 text-center text-sm text-slate-500 dark:text-slate-400">{entries.length === 0 ? 'No job queues reported.' : 'No queues match your filters.'}</p>}
        <p className="border-t border-slate-200 px-5 py-3 text-xs text-slate-500 dark:border-slate-700 dark:text-slate-400" role="status">Showing {filtered.length} of {entries.length} queues</p>
    </section>;
}

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
    const webhooks = health.data?.webhooks;
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
    return <div className="min-w-0 space-y-6 text-slate-900 dark:text-slate-100">
        <header className={ui.toolbar}>
            <div><h1 className={ui.heading}>System Overview</h1><p className="mt-1 text-sm text-slate-500 dark:text-slate-400">Monitor platform health, background jobs and account activity.</p></div>
            <button className={ui.secondary} type="button" disabled={stats.busy || mutation.busy} onClick={() => void stats.refresh()}><RefreshCw aria-hidden="true" className="size-4" />Refresh statistics</button>
        </header>
        <section className="space-y-3" aria-label="Admin statistics">
            {stats.busy && <p className={ui.muted} role="status">Loading statistics...</p>}{stats.error && <p className={ui.alert} role="alert">Statistics: {stats.error}</p>}
            <MetricStrip label="Admin statistics summary" className="rounded-lg bg-white dark:bg-slate-800 [&>.metric-strip-item]:px-5 [&>.metric-strip-item]:py-4">{([['totalAccounts', 'Total Accounts'], ['totalUsers', 'Total Users'], ['activeSyncs', 'Active Syncs'], ['failedSyncs24h', 'Failed Syncs (24h)']] as const).map(([key, label]) => <Metric key={key} label={label} value={stats.data?.[key].toLocaleString() ?? 'Unavailable'} valueClassName={key === 'failedSyncs24h' && stats.data && stats.data[key] > 0 ? 'text-red-700 dark:text-red-300' : undefined} />)}</MetricStrip>
        </section>
        <section className={`${ui.card} space-y-5`} aria-label="System health">
            <div className={ui.toolbar}>
                <div className="flex items-center gap-3"><Activity aria-hidden="true" className="size-5 text-blue-600 dark:text-blue-400" /><h2 className={ui.title}>System Health</h2>{health.data && <HealthBadge status={health.data.status} />}</div>
                <button className={ui.secondary} type="button" disabled={health.busy} onClick={() => void health.refresh()}><RefreshCw aria-hidden="true" className="size-4" />Refresh health</button>
            </div>
            {health.busy && <p className={ui.muted} role="status">Loading system health...</p>}{health.error && <p className={ui.alert} role="alert">System health: {health.error}</p>}
            {!health.data ? <p className={ui.empty}>Health unavailable</p> : <>
                {health.data.status !== 'healthy' && <p className={`flex items-start gap-2 rounded-lg p-3 text-sm ${statusStyles[health.data.status]}`}><TriangleAlert aria-hidden="true" className="mt-0.5 size-4 shrink-0" />{health.data.status === 'degraded' ? 'System performance is degraded. Review service status and queue failures below.' : 'The system is unhealthy. Review service status and queue failures below.'}</p>}
                <dl className="grid grid-cols-1 gap-3 md:grid-cols-3">{Object.entries(health.data.services).map(([name, service]) => <div key={name} className="min-w-0 rounded-lg border border-slate-200 p-4 dark:border-slate-700">
                    <dt className="flex items-center gap-2 text-sm font-medium capitalize"><Server aria-hidden="true" className="size-4 shrink-0 text-slate-400" />{name}</dt>
                    <dd className="mt-3 flex flex-wrap items-center justify-between gap-2"><HealthBadge status={service.status} />{service.latencyMs != null && <span className="text-xs tabular-nums text-slate-500 dark:text-slate-400">{service.latencyMs} ms</span>}</dd>
                    {service.details && <dd className={`${ui.muted} mt-2 break-words`}>{service.details}</dd>}
                </div>)}</dl>
                <div className="flex flex-wrap gap-x-5 gap-y-1 border-t border-slate-100 pt-3 text-xs text-slate-500 dark:border-slate-700 dark:text-slate-400"><span>App v{health.data.version.app}</span><span>Node {health.data.version.node}</span><span>Uptime {health.data.version.uptimeFormatted}</span></div>
            </>}
        </section>
        <div className="grid min-w-0 grid-cols-1 items-start gap-6 xl:grid-cols-[minmax(0,1fr)_300px]">
            {health.data ? <QueuePanel queues={health.data.queues} /> : <section className={ui.card}><h2 className={ui.title}>Job queues</h2><p className={`${ui.muted} mt-2`}>Queue data is unavailable until system health loads.</p></section>}
            <div className="min-w-0 space-y-6">
                <section className={ui.card} aria-labelledby="webhooks-title">
                    <div className="flex items-center gap-2"><Webhook aria-hidden="true" className="size-4 text-slate-400" /><h2 id="webhooks-title" className={ui.title}>Webhooks</h2><span className="ml-auto text-xs text-slate-500 dark:text-slate-400">Last 24h</span></div>
                    {webhooks ? <dl className="mt-4 space-y-3 text-sm">{([['Received', 'received24h'], ['Processed', 'processed24h'], ['Failed', 'failed24h']] as const).map(([label, key]) => <div key={key} className="flex items-center justify-between gap-3"><dt className="text-slate-500 dark:text-slate-400">{label}</dt><dd className={`font-semibold tabular-nums ${key === 'failed24h' && webhooks[key] > 0 ? 'text-red-700 dark:text-red-300' : ''}`}>{webhooks[key].toLocaleString()}</dd></div>)}</dl> : <p className={`${ui.muted} mt-4`}>Webhook data unavailable.</p>}
                </section>
                <section className={ui.card} aria-labelledby="maintenance-title">
                    <h2 id="maintenance-title" className={ui.title}>Log maintenance</h2><p className={`${ui.muted} mt-2 mb-4`}>Permanently delete failed sync logs across every account, from all time. This does not retry failed jobs.</p>
                    <button className={`${ui.danger} w-full`} type="button" disabled={!stats.data || !!stats.error || stats.busy || mutation.busy} onClick={() => void clear()}><Trash2 aria-hidden="true" className="size-4 shrink-0" />{mutation.busy ? 'Clearing...' : 'Clear failed logs (all time)'}</button>
                    {message && <p className={`${ui.notice} mt-3`} role="status">{message}</p>}{mutation.error && <p className={`${ui.alert} mt-3`} role="alert">{mutation.error}</p>}
                </section>
            </div>
        </div>
    </div>;
}
