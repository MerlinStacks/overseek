import { useAuth } from '../../context/AuthContext';
import { useAccount } from '../../context/AccountContext';
import { usePermissions } from '../../hooks/usePermissions';
import { useScopedRequest } from '../../hooks/useScopedRequest';
import { getDateRange } from '../../utils/dateUtils';
import { count, label, metric, record, rows } from './analyticsRead';

function decodePages(value: unknown) {
    const result = rows(value); if (result.length > 50) throw new Error('Oversized sample');
    return result.map(row => { const visits = count(row.totalVisits), exits = count(row.exits), rate = metric(row.exitRate); if (exits > visits || rate > 100) throw new Error('Invalid exit evidence'); return { url: label(row.url).slice(0, 2048), title: label(row.pageTitle).slice(0, 500), visits, exits, rate }; });
}
function decodeEvents(value: unknown) { const data = record(value); return rows(data.funnel).map(row => ({ stage: label(row.stage), count: count(row.count) })); }
export function RoadblocksView({ dateRange }: { dateRange: string }) {
    const { token, user } = useAuth(); const { currentAccount } = useAccount(); const { hasPermission } = usePermissions();
    if (!token || !currentAccount || !hasPermission('view_analytics')) return <p role="alert">Analytics access and an account are required.</p>;
    const range = getDateRange(dateRange);
    return <ScopedRoadblocks key={JSON.stringify([user?.id, token, currentAccount.id, dateRange])} token={token} accountId={currentAccount.id} query={new URLSearchParams({ startDate: range.startDate, endDate: range.endDate }).toString()} />;
}
function ScopedRoadblocks({ token, accountId, query }: { token: string; accountId: string; query: string }) {
    const pages = useScopedRequest(`/api/analytics/behaviour/roadblocks?${query}`, accountId, token, decodePages);
    const events = useScopedRequest(`/api/analytics/behaviour/funnel-dropoff?${query}`, accountId, token, decodeEvents);
    return <div className="space-y-5 text-slate-900 dark:text-slate-100">
        <section className="rounded-xl border p-4 bg-white dark:bg-slate-900"><h3 className="font-semibold">Observed inactive-visit exits</h3><p className="text-sm">At most 50 selected pages from locally observed visits with a recorded cart amount. This is not a full-site census or proof of friction or lost revenue. Currency coverage is unavailable, so monetary totals are not shown.</p>
            {pages.loading ? <p role="status">Loading observed exits…</p> : pages.error || !pages.data ? <p role="alert">Exit observations unavailable. <button type="button" onClick={pages.retry}>Retry exits</button></p> : pages.data.length === 0 ? <p>No matching observations in this sample; this does not establish absence of checkout problems.</p> : <div className="overflow-x-auto"><table className="w-full text-left"><thead><tr><th>Page</th><th>Observed visits</th><th>Inactive exits</th><th>Exit share</th></tr></thead><tbody>{pages.data.map((page, index) => <tr key={`${page.url}-${index}`}><th scope="row" className="p-2 max-w-xs break-words">{page.title}<span className="block text-xs">{page.url}</span></th><td>{page.visits}</td><td>{page.exits}</td><td>{page.rate}%</td></tr>)}</tbody></table></div>}
        </section>
        <section className="rounded-xl border p-4 bg-white dark:bg-slate-900"><h3 className="font-semibold">Recorded event counts</h3><p className="text-sm">Independent events, not unique people or an ordered conversion funnel. Conversion and drop-off rates are unavailable.</p>{events.loading ? <p role="status">Loading events…</p> : events.error || !events.data ? <p role="alert">Event counts unavailable. <button type="button" onClick={events.retry}>Retry events</button></p> : <ul>{events.data.map(row => <li key={row.stage}>{row.stage}: {row.count}</li>)}</ul>}</section>
    </div>;
}
