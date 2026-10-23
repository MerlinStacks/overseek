import { useNavigate } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext';
import { useAccount } from '../../context/AccountContext';
import { useSearchConsoleStatus, useSearchAnalytics, useKeywordMovers } from '../../hooks/useSeoKeywords';
import { WidgetProps } from './WidgetRegistry';
import { widgetCardClass } from './widgetStyles';
import { workspaceStyles as ui } from '../ui/workspaceStyles';
export function SeoKeywordsWidget({ className }: WidgetProps) {
    const { user, token } = useAuth(); const { currentAccount } = useAccount();
    if (!token || !currentAccount) return <p>Sign in and select an account to view SEO keywords.</p>;
    return <SeoContent key={JSON.stringify([user?.id, token, currentAccount.id])} className={className} />;
}
function SeoContent({ className }: { className?: string }) {
    const navigate = useNavigate(); const status = useSearchConsoleStatus();
    const connected = status.data?.connected === true && !status.data.authError && !status.error;
    const analytics = useSearchAnalytics(28, status.data?.defaultSiteUrl ?? undefined, connected);
    const movers = useKeywordMovers(status.data?.defaultSiteUrl ?? undefined, 14, connected);
    const queries = analytics.data?.queries ?? [];
    const impressions = queries.reduce((sum, row) => sum + row.impressions, 0);
    const clicks = queries.reduce((sum, row) => sum + row.clicks, 0);
    const position = queries.reduce((sum, row) => sum + row.position * row.impressions, 0) / impressions;
    return <section className={`${widgetCardClass} p-5 space-y-3 text-slate-900 dark:text-slate-100 ${className ?? ''}`} aria-label="SEO keywords">
        <h3 className="font-semibold">SEO Keywords</h3>
        {status.isLoading ? <p role="status">Loading Search Console status…</p> : status.error ? <p role="alert">Search Console status unavailable. <button type="button" onClick={() => void status.refetch()}>Retry status</button></p> : status.data?.authError ? <p role="alert">Search Console needs reconnection.</p> : !connected ? <p>Search Console is not connected.</p> : <>
            {analytics.isLoading ? <p role="status">Loading query observations…</p> : analytics.error ? <p role="alert">Query observations unavailable. <button type="button" onClick={() => void analytics.refetch()}>Retry queries</button></p> : !queries.length ? <p>No query rows returned; this is not proof of zero search activity.</p> : <dl className="grid grid-cols-3 gap-2">
                <div className="rounded-lg bg-slate-50 p-2 dark:bg-slate-900/50"><dt className={ui.muted}>Clicks</dt><dd className="mt-1 text-lg font-semibold tabular-nums">{Number.isSafeInteger(clicks) ? clicks.toLocaleString() : 'Unavailable'}</dd></div>
                <div className="rounded-lg bg-slate-50 p-2 dark:bg-slate-900/50"><dt className={ui.muted}>Impressions</dt><dd className="mt-1 text-lg font-semibold tabular-nums">{Number.isSafeInteger(impressions) ? impressions.toLocaleString() : 'Unavailable'}</dd></div>
                <div className="rounded-lg bg-slate-50 p-2 dark:bg-slate-900/50"><dt className={ui.muted}>Weighted position</dt><dd className="mt-1 text-lg font-semibold tabular-nums">{impressions > 0 && Number.isFinite(position) ? position.toFixed(1) : 'Unavailable'}</dd></div>
            </dl>}
            <p className="text-xs">Returned query sample, last 28 days. Anonymized or omitted queries may be absent.</p>
            <h4 className="text-sm font-medium">Last 7 days vs preceding 7 days (14-day window)</h4>
            {movers.error ? <p role="alert">Keyword movement unavailable. <button type="button" onClick={() => void movers.refetch()}>Retry movement</button></p> : movers.isLoading ? <p role="status">Loading movement…</p> : <ul>{[...(movers.data?.movers ?? [])].sort((a, b) => Math.abs(b.positionChange) - Math.abs(a.positionChange)).slice(0, 5).map(row => <li key={row.query} className="flex justify-between gap-3"><span className="truncate">{row.query}</span><span>{row.positionChange > 0 ? 'Improved' : row.positionChange < 0 ? 'Declined' : 'Unchanged'} {Math.abs(row.positionChange).toFixed(1)} · {row.currentPosition >= 1 ? `#${row.currentPosition.toFixed(1)}` : 'Position unavailable'}</span></li>)}</ul>}
        </>}
        <button className={`${ui.secondary} w-full text-xs`} type="button" onClick={() => navigate('/seo')}>View SEO dashboard</button>
    </section>;
}
