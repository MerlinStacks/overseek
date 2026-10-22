import { useEffect, useState } from 'react';
import { useAuth } from '../../context/AuthContext';
import { useAccount } from '../../context/AccountContext';
import { useScopedRequest } from '../../hooks/useScopedRequest';
import { DateRangeFilter } from '../../components/analytics/DateRangeFilter';
import { record, rows, metric, count, label } from '../../components/analytics/analyticsRead';
import { reportingWindow } from '../../utils/reportingWindow';
import { CROView } from '../../components/analytics/CROView';
import { GeographyView } from '../../components/analytics/GeographyView';
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
    const list = (title: string, read: ReturnType<typeof useScopedRequest<{ label: string; count: number }[]>>) => <section className="p-5 rounded-xl bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700"><h2 className="font-semibold">{title}</h2>{read.loading ? <p role="status">Loading {title.toLowerCase()}…</p> : read.error ? <p role="alert">{title} unavailable. <button type="button" onClick={read.retry}>Retry {title.toLowerCase()}</button></p> : !read.data?.length ? <p>No returned observations in this range.</p> : <ul>{read.data.map((row, index) => <li key={index} className="flex justify-between gap-3"><span className="break-all">{row.label}</span><span>{row.count}</span></li>)}</ul>}</section>;
    return <div className="space-y-5">
        <div className="grid md:grid-cols-2 gap-5">{list('Conversion Funnel', flow)}<section><h2>Audience Insights</h2>{stats.loading ? <p role="status">Loading audience…</p> : stats.error || !stats.data ? <p role="alert">Audience unavailable. <button type="button" onClick={stats.retry}>Retry audience</button></p> : <><p>{stats.data.total} tracked sessions · Average duration {stats.data.total ? `${stats.data.duration.toFixed(1)}s` : 'unavailable (no sessions)'}</p><ul>{stats.data.devices.map((row, index) => <li key={index}>{row.label}: {row.count}</li>)}</ul><ul>{stats.data.countries.slice(0, 5).map((row, index) => <li key={index}>{row.label}: {row.count}</li>)}</ul></>}</section></div>
        <section><h2>Cart Abandonment</h2>{cart.loading ? <p role="status">Loading cart abandonment…</p> : cart.error || !cart.data ? <p role="alert">Cart abandonment unavailable. <button type="button" onClick={cart.retry}>Retry cart abandonment</button></p> : <dl className="grid grid-cols-2 md:grid-cols-4 gap-3"><div><dt>Added to cart</dt><dd>{cart.data.added}</dd></div><div><dt>Purchased</dt><dd>{cart.data.purchased}</dd></div><div><dt>Abandoned</dt><dd>{cart.data.abandoned}</dd></div><div><dt>Abandonment rate</dt><dd>{cart.data.rate == null ? 'Unavailable (no cart observations)' : `${cart.data.rate}%`}</dd></div></dl>}</section>
        <div className="grid md:grid-cols-2 gap-5">{list('Top Search Terms', search)}{list('Top Exit Pages', exit)}</div>
        <CROView dateRange="today" explicitRange={range} />
        <GeographyView dateRange="today" explicitRange={range} />
        <p className="text-xs">Tracked observations may exclude consent-denied, blocked or unlinked activity. Empty results do not establish zero store activity.</p>
    </div>;
}
export default AnalyticsOverviewPage;
