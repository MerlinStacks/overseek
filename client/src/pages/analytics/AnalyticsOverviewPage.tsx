import { useEffect, useState } from 'react';
import { useAuth } from '../../context/AuthContext';
import { useAccount } from '../../context/AccountContext';
import { useScopedRequest } from '../../hooks/useScopedRequest';
import { DateRangeFilter } from '../../components/analytics/DateRangeFilter';
import { record, rows, metric, count, label } from '../../components/analytics/analyticsRead';
import { reportingWindow } from '../../utils/reportingWindow';
import { CROView } from '../../components/analytics/CROView';
import { GeographyView } from '../../components/analytics/GeographyView';
import { workspaceStyles as ui } from '../../components/ui/workspaceStyles';
const abandonment = (value: unknown) => {
    const data = record(value); const added = count(data.addedToCartCount), purchased = count(data.purchasedCount), abandoned = count(data.abandonedCount);
    const rate = metric(data.abandonmentRate); if (rate > 100) throw new Error('Invalid abandonment rate'); return { added, purchased, abandoned, rate: added ? rate : null };
};
const searches = (value: unknown) => rows(record(value).topQueries).map(row => ({ label: label(row.query), count: count(row.count) }));
const exits = (value: unknown) => rows(record(value).topExitPages).map(row => ({ label: label(row.page), count: count(row.count) }));
const funnel = (value: unknown) => rows(record(value).stages).map(row => ({ label: label(row.name), count: count(row.count) }));
const audience = (value: unknown) => {
    const data = record(value); return { total: count(data.totalSessions), duration: metric(data.avgSessionDuration),
        countries: rows(data.countries).map(row => ({ label: label(row.country), count: count(row.sessions) })),
        devices: rows(data.devices).map(row => ({ label: label(row.type), count: count(row.sessions) })) };
};
export const AnalyticsOverviewPage = () => {
    const { token, user } = useAuth(); const { currentAccount } = useAccount();
    if (!token || !currentAccount) return <p>Sign in and select an account to view analytics.</p>;
    return <ScopedOverview key={JSON.stringify([user?.id, token, currentAccount.id, currentAccount.timezone])} token={token} accountId={currentAccount.id} timezone={currentAccount.timezone} />;
};
function ScopedOverview({ token, accountId, timezone }: { token: string; accountId: string; timezone?: string }) {
    const [days, setDays] = useState(1); const [now, setNow] = useState(() => new Date());
    useEffect(() => { const timer = setInterval(() => setNow(new Date()), 60000); return () => clearInterval(timer); }, []);
    let window: ReturnType<typeof reportingWindow> | null = null;
    try { window = reportingWindow(days, timezone, now); } catch { /* Invalid timezone is an unavailable report, not a guessed local range. */ }
    return <div className="p-4 space-y-5 text-slate-900 dark:text-slate-100"><header className="flex flex-wrap justify-between gap-3"><h1 className="text-2xl font-bold">Analytics Overview</h1><DateRangeFilter value={days} onChange={setDays} /></header>
        {!window ? <p role="alert">Reporting window unavailable. Check the account timezone.</p> : <>
            <p>Reporting calendar: {window.timezone}{window.timezoneUnavailable ? ' (account timezone unavailable; UTC fallback)' : ''}. All sections use {window.startDate} through {window.endDate}.</p>
            <OverviewContent key={`${window.startDate}:${window.endDate}`} accountId={accountId} token={token} range={window} />
        </>}
    </div>;
}
function OverviewContent({ accountId, token, range }: { accountId: string; token: string; range: { startDate: string; endDate: string } }) {
    const query = new URLSearchParams({ startDate: range.startDate, endDate: range.endDate }).toString();
    const cart = useScopedRequest(`/api/tracking/abandonment?${query}`, accountId, token, abandonment);
    const search = useScopedRequest(`/api/tracking/searches?${query}`, accountId, token, searches);
    const exit = useScopedRequest(`/api/tracking/exits?${query}`, accountId, token, exits);
    const flow = useScopedRequest(`/api/tracking/funnel?${query}`, accountId, token, funnel);
    const stats = useScopedRequest(`/api/tracking/stats?${query}`, accountId, token, audience);
    const list = (title: string, read: ReturnType<typeof useScopedRequest<{ label: string; count: number }[]>>) => <section className={`${ui.card} space-y-4`}><h2 className={ui.title}>{title}</h2>{read.loading ? <p role="status" className={ui.muted}>Loading {title.toLowerCase()}…</p> : read.error ? <p role="alert" className={ui.alert}>{title} unavailable. <button className={ui.secondary} type="button" onClick={read.retry}>Retry {title.toLowerCase()}</button></p> : !read.data?.length ? <p className={ui.muted}>No returned observations in this range.</p> : <ul className="divide-y divide-slate-100 dark:divide-slate-700">{read.data.map((row, index) => <li key={index} className="flex justify-between gap-3 py-2.5 text-sm"><span className="break-all">{row.label}</span><span className="shrink-0 font-semibold tabular-nums">{row.count}</span></li>)}</ul>}</section>;
    return <div className="space-y-5">
        <div className="grid md:grid-cols-2 gap-5">{list('Conversion Funnel', flow)}<section className={`${ui.card} space-y-4`}><h2 className={ui.title}>Audience Insights</h2>{stats.loading ? <p role="status">Loading audience…</p> : stats.error || !stats.data ? <p role="alert" className={ui.alert}>Audience unavailable. <button className={ui.secondary} type="button" onClick={stats.retry}>Retry audience</button></p> : <><p className="rounded-lg bg-indigo-50 p-3 text-sm font-medium text-indigo-800 dark:bg-indigo-950/30 dark:text-indigo-200">{stats.data.total} tracked sessions · Average duration {stats.data.total ? `${stats.data.duration.toFixed(1)}s` : 'unavailable (no sessions)'}</p><div className="grid gap-4 sm:grid-cols-2"><ul className="space-y-2">{stats.data.devices.map((row, index) => <li className="flex justify-between gap-2 text-xs" key={index}><span>{row.label}</span><span className="font-semibold tabular-nums">{row.count}</span></li>)}</ul><ul className="space-y-2">{stats.data.countries.slice(0, 5).map((row, index) => <li className="flex justify-between gap-2 text-xs" key={index}><span>{row.label}</span><span className="font-semibold tabular-nums">{row.count}</span></li>)}</ul></div></>}</section></div>
        <section className="space-y-3"><h2 className={ui.title}>Cart Abandonment</h2>{cart.loading ? <p role="status">Loading cart abandonment…</p> : cart.error || !cart.data ? <p role="alert" className={ui.alert}>Cart abandonment unavailable. <button className={ui.secondary} type="button" onClick={cart.retry}>Retry cart abandonment</button></p> : <dl className="metric-strip" aria-label="Cart abandonment summary">{[['Added to cart', cart.data.added], ['Purchased', cart.data.purchased], ['Abandoned', cart.data.abandoned], ['Abandonment rate', cart.data.rate == null ? 'Unavailable (no cart observations)' : `${cart.data.rate}%`]].map(([title, value]) => <div className="metric-strip-item" key={title}><dt className={ui.muted}>{title}</dt><dd className="mt-1 text-xl font-semibold tabular-nums">{value}</dd></div>)}</dl>}</section>
        <div className="grid md:grid-cols-2 gap-5">{list('Top Search Terms', search)}{list('Top Exit Pages', exit)}</div>
        <CROView dateRange="today" explicitRange={range} />
        <GeographyView dateRange="today" explicitRange={range} />
        <p className="text-xs">Tracked observations may exclude consent-denied, blocked or unlinked activity. Empty results do not establish zero store activity.</p>
    </div>;
}
export default AnalyticsOverviewPage;
