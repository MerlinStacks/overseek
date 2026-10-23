import { useId } from 'react';
import { useAuth } from '../../context/AuthContext';
import { useAccount } from '../../context/AccountContext';
import { useScopedRequest } from '../../hooks/useScopedRequest';
import { Card, CardContent, CardHeader, CardTitle } from '../ui/Card';
import { record, rows, label, metric, count, money, validDays } from './analyticsRead';

function decodeTrend(value: unknown) {
    const points = rows(value).map(row => {
        const date = label(row.date);
        if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !Number.isFinite(Date.parse(date)) || new Date(date).toISOString().slice(0, 10) !== date) throw new Error('Invalid trend date');
        return { date, aov: metric(row.aov), orders: count(row.orders) };
    }).sort((a, b) => a.date.localeCompare(b.date));
    if (new Set(points.map(point => point.date)).size !== points.length) throw new Error('Duplicate trend dates');
    return points;
}
function decodeComparison(value: unknown) { const data = record(value); return { current: metric(data.current), previous: metric(data.previous) }; }
export function AOVTrendView({ days }: { days: number }) {
    const { token } = useAuth(); const { currentAccount } = useAccount();
    if (!token || !currentAccount) return <p>Select an account and sign in to view AOV.</p>;
    if (!validDays(days)) return <p role="alert">Invalid AOV range.</p>;
    return <AOVContent key={`${currentAccount.id}:${token}:${days}:${currentAccount.currency}`} days={days} accountId={currentAccount.id} token={token} currency={currentAccount.currency} />;
}
function AOVContent({ days, accountId, token, currency }: { days: number; accountId: string; token: string; currency: string }) {
    const trend = useScopedRequest(`/api/analytics/aov-trend?days=${days}`, accountId, token, decodeTrend);
    const comparison = useScopedRequest(`/api/analytics/aov-trend/comparison?days=${days}`, accountId, token, decodeComparison);
    const id = useId();
    const points = trend.data?.filter(point => point.orders > 0) || [];
    const totalOrders = points.reduce((sum, point) => sum + point.orders, 0);
    const average = totalOrders ? points.reduce((sum, point) => sum + point.aov * point.orders, 0) / totalOrders : null;
    const max = points.length ? Math.max(...points.map(point => point.aov)) : 0;
    const min = points.length ? Math.min(...points.map(point => point.aov)) : 0;
    const first = trend.data?.[0] ? Date.parse(trend.data[0].date) : 0;
    const last = trend.data?.length ? Date.parse(trend.data[trend.data.length - 1].date) : first;
    const plotted = points.map((point, index) => { const date = Date.parse(point.date); return { ...point, x: 4 + (date - first) / (last - first || 1) * 92, y: 36 - (point.aov - min) / (max - min || 1) * 30, connected: index > 0 && date - Date.parse(points[index - 1].date) === 86400000 }; });
    const path = plotted.map((point, index) => `${index && point.connected ? 'L' : 'M'} ${point.x} ${point.y}`).join(' ');
    const change = comparison.data && comparison.data.previous > 0 ? (comparison.data.current - comparison.data.previous) / comparison.data.previous * 100 : null;
    return <Card><CardHeader><CardTitle>AOV Trend</CardTitle></CardHeader><CardContent className="space-y-4">
        {comparison.loading ? <p role="status">Loading AOV comparison…</p> : comparison.error || !comparison.data ? <div role="alert">AOV comparison unavailable. <button onClick={comparison.retry}>Retry comparison</button></div> :
            <p className="rounded-xl border border-indigo-100 bg-indigo-50/50 p-4 text-sm font-medium text-indigo-800 dark:border-indigo-900 dark:bg-indigo-950/30 dark:text-indigo-200">Current: {money(comparison.data.current, currency)} · Previous: {money(comparison.data.previous, currency)} · Change: {change == null ? 'Unavailable (zero baseline)' : `${change >= 0 ? '+' : ''}${change.toFixed(1)}%`}</p>}
        {trend.loading ? <p role="status">Loading AOV trend…</p> : trend.error ? <div role="alert">AOV trend unavailable. <button onClick={trend.retry}>Retry trend</button></div> : !points.length ? <p>No AOV observations with orders in this range.</p> : <>
            <svg role="img" aria-labelledby={id} viewBox="0 0 100 44" className="w-full h-28"><title id={id}>Daily average order value; gaps have no order observations. {points.length} observations.</title>
                <path d={path} fill="none" stroke="currentColor" strokeWidth="1" className="text-indigo-500" />
                {plotted.map(point => <circle key={point.date} cx={point.x} cy={point.y} r="1.5" fill="currentColor" className="text-indigo-500"><title>{point.date}: {money(point.aov, currency)} ({point.orders} orders)</title></circle>)}
            </svg>
            <p className="text-xs text-slate-500 dark:text-slate-400">{points[0].date} – {points[points.length - 1].date}</p>
            <div className="grid grid-cols-1 gap-3 text-xs sm:grid-cols-3"><p className="rounded-lg bg-slate-50 p-3 dark:bg-slate-900/50">Highest AOV: {money(max, currency)}</p><p className="rounded-lg bg-slate-50 p-3 dark:bg-slate-900/50">Order-weighted average: {money(average!, currency)}</p><p className="rounded-lg bg-slate-50 p-3 dark:bg-slate-900/50">Lowest AOV: {money(min, currency)}</p></div>
        </>}
    </CardContent></Card>;
}
