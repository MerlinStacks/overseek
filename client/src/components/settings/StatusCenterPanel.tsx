import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext';
import { useAccount } from '../../context/AccountContext';
import { useWidgetRead } from '../../hooks/useWidgetRead';
import { usePermissions } from '../../hooks/usePermissions';
import { isRecord } from '../../utils/responseValidation';
import { formatRelativeTime, observationAge } from '../../utils/relativeTime';
import { getSafeNavigationUrl } from '../../utils/url';
type Level = 'healthy' | 'warning' | 'critical' | 'unknown';
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
    return <div className="space-y-4 text-slate-900 dark:text-slate-100"><h2 className="text-xl font-semibold">Reported status observations</h2><p>These are bounded local/reported observations, not a guarantee that all systems are operational. Observations older than two minutes, invalid dates and future clocks are not current health.</p><button type="button" disabled={read.busy} onClick={() => void read.refresh()}>Refresh status observations</button>{read.error && <p role="alert">Status refresh unavailable. Any retained observations are from an earlier successful read.</p>}{!read.data ? <p role="status">{read.busy ? 'Loading observations…' : 'Status observations unavailable.'}</p> : <div className="grid gap-4 md:grid-cols-2">{read.data.map(section => { const age = observationAge(section.time, now), current = age.state === 'observed' && age.milliseconds <= 120000, level = current && !read.error ? section.level : 'unknown'; return <section className="rounded-xl border p-4 bg-white dark:bg-slate-900" key={section.key}><h3 className="font-semibold">{section.key}: {level === 'unknown' ? 'Unknown / not current' : `Reported ${level}`}</h3><p>{section.message}</p><p>Checked {formatRelativeTime(section.time, now)}</p><dl>{Object.entries(section.details).filter(([key]) => ['lastSuccessAt', 'lastWebhookAt', 'todayRevenue', 'baselineRevenue', 'currency', 'failureRate24h', 'percentChange', 'responseTimeMs', 'configured', 'connected'].includes(key)).slice(0, 8).map(([key, value]) => <div key={key}><dt>{key}</dt><dd>{detail(key, value, section.details)}</dd></div>)}</dl></section>; })}</div>}<div className="flex flex-wrap gap-4">{hasPermission('manage_channels') && <Link to="/settings?tab=webhooks">Review webhook settings</Link>}{hasPermission('manage_settings') && <Link to="/settings?tab=sync">Review sync settings</Link>}{store && <a href={store} target="_blank" rel="noopener noreferrer">Open store</a>}</div></div>;
}
export default StatusCenterPanel;
