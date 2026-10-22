import { useEffect, useRef, useState } from 'react';
import { useLocation } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { useAccount } from '../context/AccountContext';
import { usePermissions } from '../hooks/usePermissions';
import { useScopedRequest } from '../hooks/useScopedRequest';
import { isRecord } from '../utils/responseValidation';
import { DeliveryHealthPanel } from '../components/marketing/DeliveryHealthPanel';

interface Dashboard {
    days: number; rangeStart: string; rangeEnd: string; timezone: string; currency: string | null;
    kpis: { flowRevenue: number | null; broadcastRevenue: number | null; flowSends: number; broadcastSends: number; totalUnsubscribes: number; attemptedCount: number; failedCount: number; failureRate: number | null };
    trends: { date: string; unsubscribes: number; failureRate: number | null }[];
    recentUnsubscribes: { id: string; email: string; scope: string; reason: string | null; createdAt: string }[];
    coverage: { trendComplete: boolean; currentDayPartial: boolean; revenue: string; failureDefinition: string; unsubscribeDefinition: string; unknownStatusRows: number };
}
const count = (value: unknown): value is number => typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
const ratio = (value: unknown) => value === null || typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 100;
const string = (value: unknown, max = 2000) => typeof value === 'string' && value.length <= max;
const date = (value: unknown) => string(value, 40) && Number.isFinite(Date.parse(String(value)));
function decode(value: unknown): Dashboard {
    if (!isRecord(value) || !count(value.days) || value.days < 1 || value.days > 365 || !date(value.rangeStart) || !date(value.rangeEnd) || Date.parse(String(value.rangeStart)) > Date.parse(String(value.rangeEnd)) || value.timezone !== 'UTC' || value.currency !== null && (typeof value.currency !== 'string' || !/^[A-Z]{3}$/.test(value.currency))) throw new Error('Invalid reporting window');
    const kpi = value.kpis, coverage = value.coverage;
    if (!isRecord(kpi) || !['flowSends', 'broadcastSends', 'totalUnsubscribes', 'attemptedCount', 'failedCount'].every(key => count(kpi[key])) || !ratio(kpi.failureRate) || Number(kpi.failedCount) > Number(kpi.attemptedCount) || !['flowRevenue', 'broadcastRevenue'].every(key => kpi[key] === null || typeof kpi[key] === 'number' && Number.isFinite(kpi[key]) && Number(kpi[key]) >= 0) || !isRecord(coverage) || typeof coverage.trendComplete !== 'boolean' || typeof coverage.currentDayPartial !== 'boolean' || !count(coverage.unknownStatusRows) || !['revenue', 'failureDefinition', 'unsubscribeDefinition'].every(key => string(coverage[key]))) throw new Error('Invalid observations');
    if (!Array.isArray(value.trends) || value.trends.length > 365 || value.trends.some(row => !isRecord(row) || typeof row.date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(row.date) || !date(row.date) || !count(row.unsubscribes) || !ratio(row.failureRate)) || new Set(value.trends.map(row => row.date)).size !== value.trends.length) throw new Error('Invalid trends');
    if (value.trends.some(row => new Date(`${row.date}T00:00:00Z`).toISOString().slice(0, 10) !== row.date || row.date < String(value.rangeStart).slice(0, 10) || row.date > String(value.rangeEnd).slice(0, 10))) throw new Error('Trend date outside reporting window');
    if (!Array.isArray(value.recentUnsubscribes) || value.recentUnsubscribes.length > 10 || value.recentUnsubscribes.some(row => !isRecord(row) || !string(row.id, 200) || !string(row.email, 320) || !string(row.scope, 100) || row.reason !== null && !string(row.reason) || !date(row.createdAt))) throw new Error('Invalid unsubscribe records');
    return value as unknown as Dashboard;
}
const card = 'rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 p-4';
export function EmailDashboardPage() {
    const { user, token } = useAuth(); const { currentAccount } = useAccount(); const { hasPermission } = usePermissions();
    if (!token || !currentAccount) return <p role="status">Sign in and select an account.</p>;
    if (!hasPermission('view_marketing')) return <p role="status">Marketing view permission required.</p>;
    return <ScopedEmailDashboard key={JSON.stringify([user?.id, token, currentAccount.id])} token={token} accountId={currentAccount.id} />;
}
function ScopedEmailDashboard({ token, accountId }: { token: string; accountId: string }) {
    const [days, setDays] = useState(30);
    return <main className="space-y-5 text-slate-900 dark:text-slate-100"><h1 className="text-2xl font-bold">Email Hub</h1>
        <div aria-label="Reporting period" className="flex gap-3">{[7, 30, 90].map(value => <button type="button" key={value} aria-pressed={days === value} onClick={() => setDays(value)} className={days === value ? 'rounded bg-indigo-600 text-white px-3 py-2' : 'rounded border px-3 py-2'}>{value}d</button>)}</div>
        <DashboardRead key={days} token={token} accountId={accountId} days={days} />
        <DeliveryHealthPanel token={token} accountId={accountId} />
    </main>;
}
function DashboardRead({ token, accountId, days }: { token: string; accountId: string; days: number }) {
    const { data, loading, error, retry } = useScopedRequest(`/api/marketing/analytics/email-dashboard?days=${days}`, accountId, token, decode);
    const section = useRef<HTMLDivElement>(null), location = useLocation();
    useEffect(() => {
        const element = section.current;
        if (!element || loading || error || !data || new URLSearchParams(location.search).get('focus') !== 'unsubscribes') return;
        element.dataset.focused = 'true'; element.scrollIntoView({ behavior: 'smooth', block: 'start' });
        const timer = window.setTimeout(() => { element.dataset.focused = 'false'; }, 2600);
        return () => { window.clearTimeout(timer); element.dataset.focused = 'false'; };
    }, [loading, error, data, location.search]);
    if (loading) return <p role="status">Loading email observations…</p>;
    if (error || !data || data.days !== days) return <p role="alert">Email observations unavailable. No zero values have been inferred. <button type="button" onClick={retry}>Retry email dashboard</button></p>;
    const money = (value: number | null) => value === null || !data.currency ? 'Unavailable' : new Intl.NumberFormat(undefined, { style: 'currency', currency: data.currency }).format(value);
    const percent = (value: number | null) => value === null ? 'Unavailable' : `${value.toFixed(2)}%`;
    const max = Math.max(1, ...data.trends.map(row => row.unsubscribes));
    return <>
        <p>{data.rangeStart} to {data.rangeEnd} ({data.timezone}; current day {data.coverage.currentDayPartial ? 'partial' : 'complete'}).</p>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {[['Flow revenue', money(data.kpis.flowRevenue)], ['Broadcast revenue', money(data.kpis.broadcastRevenue)], ['New unsubscribe records', data.kpis.totalUnsubscribes.toLocaleString()], ['Failed-status share', percent(data.kpis.failureRate)], ['Flow send events', data.kpis.flowSends.toLocaleString()], ['Broadcast send events', data.kpis.broadcastSends.toLocaleString()]].map(([label, value]) => <div className={card} key={label}><h2>{label}</h2><p className="text-2xl font-semibold">{value}</p></div>)}
        </div>
        <div className={card}><p>{data.coverage.revenue}</p><p>{data.coverage.failureDefinition}</p><p>{data.kpis.failedCount} failed-status rows / {data.kpis.attemptedCount} terminal-status rows; {data.coverage.unknownStatusRows} other-status rows excluded.</p><p>{data.coverage.unsubscribeDefinition}</p></div>
        <div className={card}><h2 className="font-semibold">UTC delivery observations</h2>{!data.coverage.trendComplete ? <p role="status">Daily trends unavailable: row coverage limit exceeded.</p> : data.trends.slice(-10).map(row => <div key={row.date} className="flex flex-wrap items-center gap-3 py-1"><span>{row.date}</span><div className="flex-1 min-w-20 rounded bg-slate-100 dark:bg-slate-800 h-2" aria-hidden="true"><div className="h-2 bg-indigo-500 rounded" style={{ width: `${row.unsubscribes / max * 100}%` }} /></div><span>{row.unsubscribes} new unsubscribe records</span><span>{percent(row.failureRate)} failed-status share</span></div>)}</div>
        <div ref={section} data-focused="false" className={`${card} data-[focused=true]:ring-2 data-[focused=true]:ring-indigo-500`}><h2 className="font-semibold">Recent unsubscribe records in this window</h2>
            {!data.recentUnsubscribes.length ? <p>No unsubscribe records in this window.</p> : <div className="overflow-x-auto"><table className="w-full text-left"><thead><tr><th>Email</th><th>Scope</th><th>Reason</th><th>Created</th></tr></thead><tbody>{data.recentUnsubscribes.map(row => <tr key={row.id}><td className="p-2">{row.email}</td><td className="p-2">{row.scope}</td><td className="p-2">{row.reason || 'Not provided'}</td><td className="p-2">{new Date(row.createdAt).toLocaleString()}</td></tr>)}</tbody></table></div>}
        </div>
    </>;
}
