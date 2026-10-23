import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext';
import { useAccount } from '../../context/AccountContext';
import { useWidgetRead } from '../../hooks/useWidgetRead';
import { usePermissions } from '../../hooks/usePermissions';
import { isRecord } from '../../utils/responseValidation';
import { formatRelativeTime, observationAge } from '../../utils/relativeTime';
import { getSafeNavigationUrl } from '../../utils/url';
import { Activity, RefreshCw } from 'lucide-react';
import { workspaceStyles as ui } from '../ui/workspaceStyles';
import { DataNote } from '../ui/DataNote';
type Level = 'healthy' | 'warning' | 'critical' | 'unknown';
const sectionLabels: Record<string, string> = { sync: 'Store sync', webhooks: 'Webhooks', storeHealth: 'Store connection', revenueAlerts: 'Revenue alerts' };
const detailLabels: Record<string, string> = { lastSuccessAt: 'Last successful sync', lastWebhookAt: 'Last webhook', todayRevenue: 'Today’s revenue', baselineRevenue: 'Baseline revenue', currency: 'Currency', failureRate24h: 'Failure rate (24 hours)', percentChange: 'Change from baseline', responseTimeMs: 'Response time', configured: 'Configured', connected: 'Reported connection' };
const levelStyles: Record<Level, string> = {
    healthy: 'border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-900 dark:bg-emerald-950/40 dark:text-emerald-300',
    warning: 'border-amber-200 bg-amber-50 text-amber-800 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-300',
    critical: 'border-red-200 bg-red-50 text-red-700 dark:border-red-900 dark:bg-red-950/40 dark:text-red-300',
    unknown: 'border-slate-200 bg-slate-100 text-slate-600 dark:border-slate-600 dark:bg-slate-700 dark:text-slate-300',
};
function decode(value: unknown) {
    if (!isRecord(value)) throw new Error('Invalid status observation');
    return ['sync', 'webhooks', 'storeHealth', 'revenueAlerts'].map(key => { const raw = value[key]; if (!isRecord(raw)) return { key, level: 'unknown' as Level, message: 'Observation unavailable', time: null as string | null, details: {} as Record<string, unknown> }; const level: Level = ['healthy', 'warning', 'critical'].includes(raw.status as string) ? raw.status as Level : 'unknown'; return { key, level, message: typeof raw.message === 'string' ? raw.message.slice(0, 1000) : 'Observation unavailable', time: typeof raw.lastChecked === 'string' ? raw.lastChecked : null, details: isRecord(raw.details) && Object.keys(raw.details).length <= 50 ? raw.details : {} }; });
}
function detail(key: string, value: unknown, details: Record<string, unknown>) {
    if (value === null || value === undefined || typeof value === 'object' || typeof value === 'number' && !Number.isFinite(value)) return 'Unavailable';
    if (['todayRevenue', 'baselineRevenue'].includes(key) && typeof value === 'number') return typeof details.currency === 'string' && /^[A-Z]{3}$/.test(details.currency) ? `${details.currency} ${value.toFixed(2)}` : 'Monetary basis unavailable';
    if (['lastSuccessAt', 'lastWebhookAt'].includes(key)) return typeof value === 'string' ? formatRelativeTime(value) : 'Unavailable';
    if (typeof value === 'number') return ['failureRate24h', 'percentChange'].includes(key) ? `${value}%` : key === 'responseTimeMs' ? `${value} ms` : String(value);
    return typeof value === 'boolean' ? value ? 'Yes' : 'No' : typeof value === 'string' ? value.slice(0, 500) : 'Unavailable';
}
export function StatusCenterPanel() { const { token, user } = useAuth(); const { currentAccount } = useAccount(); if (!token || !currentAccount) return <p>Select an account and sign in.</p>; return <ScopedStatus key={JSON.stringify([user?.id, token, currentAccount.id])} accountId={currentAccount.id} token={token} />; }
function ScopedStatus({ accountId, token }: { accountId: string; token: string }) {
    const read = useWidgetRead('/api/status-center', accountId, token, decode, 60000), { currentAccount } = useAccount(), { hasPermission } = usePermissions();
    const [now, setNow] = useState(Date.now); useEffect(() => { const timer = setInterval(() => setNow(Date.now()), 30000); return () => clearInterval(timer); }, []);
    const store = getSafeNavigationUrl(currentAccount?.wooUrl);
    return <div className="min-w-0 space-y-4 text-slate-900 dark:text-slate-100">
        <div className="flex flex-wrap items-center justify-between gap-3"><h2 className="flex items-center gap-2 text-xl font-semibold"><Activity size={20} aria-hidden="true" className="text-indigo-500" />Reported status observations</h2><button className={ui.secondary} type="button" disabled={read.busy} onClick={() => void read.refresh()}><RefreshCw size={15} aria-hidden="true" className={read.busy ? 'animate-spin motion-reduce:animate-none' : ''} />Refresh status observations</button></div>
        <DataNote title="About reported status">These are bounded local/reported observations, not a guarantee that all systems are operational. Observations older than two minutes, invalid dates and future clocks are not current health.</DataNote>
        {read.error && <p className={ui.alert} role="alert">Status refresh unavailable. Any retained observations are from an earlier successful read.</p>}
        {!read.data ? <p className={ui.empty} role="status">{read.busy ? 'Loading observations…' : 'Status observations unavailable.'}</p> : <div className="grid gap-4 md:grid-cols-2">{read.data.map(section => {
            const age = observationAge(section.time, now), current = age.state === 'observed' && age.milliseconds <= 120000, level = current && !read.error ? section.level : 'unknown';
            return <section className={`${ui.card} space-y-4`} key={section.key} aria-label={sectionLabels[section.key]}>
                <div className="flex flex-wrap items-start justify-between gap-2"><h3 className={ui.title}>{sectionLabels[section.key]}</h3><span className={`inline-flex rounded-full border px-2.5 py-1 text-xs font-medium ${levelStyles[level]}`}>{level === 'unknown' ? 'Unknown / not current' : `Reported ${level}`}</span></div>
                <p className="break-words text-sm leading-relaxed">{section.message}</p><p className={ui.muted}>Checked {formatRelativeTime(section.time, now)}</p>
                <dl className="grid gap-3 border-t border-slate-100 pt-3 sm:grid-cols-2 dark:border-slate-700">{Object.entries(section.details).filter(([key]) => Object.prototype.hasOwnProperty.call(detailLabels, key)).slice(0, 8).map(([key, value]) => <div className="min-w-0" key={key}><dt className={ui.muted}>{detailLabels[key]}</dt><dd className="mt-1 break-words text-sm font-medium tabular-nums">{detail(key, value, section.details)}</dd></div>)}</dl>
            </section>;
        })}</div>}
        <div className="flex flex-wrap gap-3">{hasPermission('manage_channels') && <Link className={ui.secondary} to="/settings?tab=webhooks">Review webhook settings</Link>}{hasPermission('manage_settings') && <Link className={ui.secondary} to="/settings?tab=sync">Review sync settings</Link>}{store && <a className={ui.secondary} href={store} target="_blank" rel="noopener noreferrer">Open store</a>}</div>
    </div>;
}
export default StatusCenterPanel;
